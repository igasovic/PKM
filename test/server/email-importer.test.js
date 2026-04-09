'use strict';

// Mock all external dependencies before requiring the module
const mockInsert = jest.fn();
const mockUpdate = jest.fn();
const mockRunEmailIngestionPipeline = jest.fn();
const mockEnqueueTier1Batch = jest.fn();
const mockBraintrustSink = { logSuccess: jest.fn(), logError: jest.fn() };
const mockGetLogger = jest.fn();

jest.mock('../../src/server/db/write-store.js', () => ({
  insert: mockInsert,
  update: mockUpdate,
}));

jest.mock('../../src/server/ingestion-pipeline.js', () => ({
  runEmailIngestionPipeline: mockRunEmailIngestionPipeline,
}));

jest.mock('../../src/server/tier1-enrichment.js', () => ({
  enqueueTier1Batch: mockEnqueueTier1Batch,
}));

jest.mock('../../src/server/logger/braintrust.js', () => ({
  braintrustSink: mockBraintrustSink,
}));

// The pipeline logger needs a .step() method that just runs the async fn
const mockStep = jest.fn((_label, fn) => fn());
mockGetLogger.mockReturnValue({
  child: () => ({ step: mockStep }),
});
jest.mock('../../src/server/logger/index.js', () => ({
  getLogger: mockGetLogger,
}));

jest.mock('fs/promises');
const fs = require('fs/promises');

const { importEmailMbox } = require('../../src/server/email-importer.js');

// We need access to the pure parsing functions. They are not exported, so we
// test them indirectly through the importer or re-implement quick checks via
// the module internals. We can test the exported importEmailMbox and verify
// that the pipeline calls the right things.

// Helper: build a minimal mbox string
function makeMbox(messages) {
  return messages
    .map((msg, i) => `From sender${i}@example.com Mon Jan 1 00:00:00 2024\n${msg}`)
    .join('\n');
}

describe('email-importer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStep.mockImplementation((_label, fn) => fn());
  });

  describe('importEmailMbox — input validation', () => {
    test('throws when mbox_path is missing', async () => {
      await expect(importEmailMbox({})).rejects.toThrow('mbox_path is required');
    });

    test('throws when mbox_path does not end in .mbox', async () => {
      await expect(importEmailMbox({ mbox_path: 'data.txt' })).rejects.toThrow(
        'mbox_path must point to a .mbox file'
      );
    });

    test('throws for non-integer batch_size', async () => {
      await expect(
        importEmailMbox({ mbox_path: 'mail.mbox', batch_size: 'abc' })
      ).rejects.toThrow('batch_size must be an integer');
    });

    test('throws for batch_size out of range', async () => {
      await expect(
        importEmailMbox({ mbox_path: 'mail.mbox', batch_size: 10 })
      ).rejects.toThrow('batch_size must be between');
    });

    test('throws for non-positive insert_chunk_size', async () => {
      await expect(
        importEmailMbox({ mbox_path: 'mail.mbox', insert_chunk_size: -1 })
      ).rejects.toThrow('insert_chunk_size must be a positive integer');
    });

    test('throws for non-integer max_emails', async () => {
      await expect(
        importEmailMbox({ mbox_path: 'mail.mbox', max_emails: 'abc' })
      ).rejects.toThrow('max_emails must be a positive integer');
    });

    test('throws for non-positive max_emails', async () => {
      await expect(
        importEmailMbox({ mbox_path: 'mail.mbox', max_emails: 0 })
      ).rejects.toThrow('max_emails must be a positive integer');
    });
  });

  describe('importEmailMbox — file access errors', () => {
    test('throws when file does not exist', async () => {
      fs.stat.mockRejectedValue(new Error('ENOENT'));
      await expect(
        importEmailMbox({ mbox_path: 'test.mbox' })
      ).rejects.toThrow('mbox file not found/readable');
    });

    test('throws when path is a directory', async () => {
      fs.stat.mockResolvedValue({ isFile: () => false });
      await expect(
        importEmailMbox({ mbox_path: 'test.mbox' })
      ).rejects.toThrow('mbox_path must be a file');
    });
  });

  describe('importEmailMbox — empty mbox', () => {
    test('throws when mbox has no messages', async () => {
      fs.stat.mockResolvedValue({ isFile: () => true });
      fs.readFile.mockResolvedValue('');
      await expect(
        importEmailMbox({ mbox_path: 'test.mbox' })
      ).rejects.toThrow('no messages found in mbox');
    });

    test('throws for whitespace-only mbox', async () => {
      fs.stat.mockResolvedValue({ isFile: () => true });
      fs.readFile.mockResolvedValue('   \n\n   ');
      await expect(
        importEmailMbox({ mbox_path: 'test.mbox' })
      ).rejects.toThrow('no messages found in mbox');
    });
  });

  describe('importEmailMbox — successful import flow', () => {
    const singleMessage = [
      'From: sender@example.com',
      'Subject: Test email',
      'Date: Mon, 01 Jan 2024 00:00:00 +0000',
      'Message-ID: <abc@test>',
      '',
      'Hello world body text',
    ].join('\n');

    beforeEach(() => {
      fs.stat.mockResolvedValue({ isFile: () => true });
      fs.readFile.mockResolvedValue(
        makeMbox([singleMessage])
      );
      mockRunEmailIngestionPipeline.mockResolvedValue({
        content_type: 'email',
        clean_text: 'Hello world body text',
        title: 'Test email',
        author: 'sender@example.com',
      });
      mockInsert.mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            id: 1,
            entry_id: 'e1',
            source: 'email-batch',
            title: 'Test email',
            author: 'sender@example.com',
            content_type: 'email',
            clean_text: 'Hello world body text',
            action: 'inserted',
          },
        ],
      });
      mockEnqueueTier1Batch.mockResolvedValue({
        batch_id: 'b1',
        status: 'enqueued',
        schema: 'pkm',
        request_count: 1,
      });
      mockUpdate.mockResolvedValue({
        rowCount: 1,
        rows: [{ _batch_ok: true, id: 1, entry_id: 'e1', enrichment_status: 'queued' }],
      });
    });

    test('processes a single-message mbox end-to-end', async () => {
      const result = await importEmailMbox({ mbox_path: 'inbox.mbox' });

      expect(result.total_messages).toBe(1);
      expect(result.normalized_ok).toBe(1);
      expect(result.normalize_errors).toBe(0);
      expect(result.inserted).toBe(1);
      expect(result.insert_errors).toBe(0);
      expect(result.tier1_candidates).toBe(1);
      expect(mockRunEmailIngestionPipeline).toHaveBeenCalledTimes(1);
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    test('sets source to email-batch on normalized items', async () => {
      await importEmailMbox({ mbox_path: 'inbox.mbox' });

      const insertCall = mockInsert.mock.calls[0][0];
      expect(insertCall.items[0].source).toBe('email-batch');
    });

    test('respects max_emails option', async () => {
      const twoMessages = makeMbox([singleMessage, singleMessage]);
      fs.readFile.mockResolvedValue(twoMessages);

      const result = await importEmailMbox({
        mbox_path: 'inbox.mbox',
        max_emails: 1,
      });

      expect(result.total_messages).toBe(1);
      expect(mockRunEmailIngestionPipeline).toHaveBeenCalledTimes(1);
    });

    test('marks enqueued rows as queued after successful enqueue', async () => {
      await importEmailMbox({ mbox_path: 'inbox.mbox' });
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(mockUpdate).toHaveBeenCalledWith({
        items: [{ id: 1, enrichment_status: 'queued' }],
        continue_on_error: true,
        returning: ['id', 'entry_id', 'enrichment_status'],
      });
    });

    test('tracks skipped rows', async () => {
      mockInsert.mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            id: 1,
            entry_id: 'e1',
            action: 'skipped',
            clean_text: 'text',
            enrichment_status: 'done',
          },
        ],
      });

      const result = await importEmailMbox({ mbox_path: 'inbox.mbox' });
      expect(result.skipped).toBe(1);
      expect(result.inserted).toBe(0);
    });

    test('re-enqueues skipped rows that are still pending', async () => {
      mockInsert.mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            id: 2,
            entry_id: 'e2',
            action: 'skipped',
            title: 'Recovered',
            author: 'sender@example.com',
            content_type: 'newsletter',
            clean_text: 'recovered text',
            enrichment_status: 'pending',
          },
        ],
      });
      mockUpdate.mockResolvedValue({
        rowCount: 1,
        rows: [{ _batch_ok: true, id: 2, entry_id: 'e2', enrichment_status: 'queued' }],
      });

      const result = await importEmailMbox({ mbox_path: 'inbox.mbox' });
      expect(result.skipped).toBe(1);
      expect(result.tier1_candidates).toBe(1);
      expect(result.tier1_enqueued_items).toBe(1);
      expect(mockEnqueueTier1Batch).toHaveBeenCalledWith(
        [
          {
            custom_id: 'entry_e2',
            title: 'Recovered',
            author: 'sender@example.com',
            content_type: 'newsletter',
            clean_text: 'recovered text',
          },
        ],
        expect.any(Object)
      );
    });

    test('tracks updated rows', async () => {
      mockInsert.mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            id: 1,
            entry_id: 'e1',
            action: 'updated',
            clean_text: 'text',
            content_type: 'email',
          },
        ],
      });

      const result = await importEmailMbox({ mbox_path: 'inbox.mbox' });
      expect(result.updated).toBe(1);
    });

    test('logs to braintrust sink on success', async () => {
      await importEmailMbox({ mbox_path: 'inbox.mbox' });
      expect(mockBraintrustSink.logSuccess).toHaveBeenCalledTimes(1);
      expect(mockBraintrustSink.logSuccess.mock.calls[0][0]).toBe(
        'email_importer.mbox_import_complete'
      );
    });
  });

  describe('importEmailMbox — error handling', () => {
    const singleMessage = [
      'From: sender@example.com',
      'Subject: Test',
      '',
      'Body',
    ].join('\n');

    beforeEach(() => {
      fs.stat.mockResolvedValue({ isFile: () => true });
      fs.readFile.mockResolvedValue(makeMbox([singleMessage]));
      mockUpdate.mockResolvedValue({ rowCount: 0, rows: [] });
    });

    test('counts normalize_errors when pipeline throws', async () => {
      mockRunEmailIngestionPipeline.mockRejectedValue(new Error('pipeline boom'));

      const result = await importEmailMbox({ mbox_path: 'inbox.mbox' });
      expect(result.normalize_errors).toBe(1);
      expect(result.normalized_ok).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].phase).toBe('normalize');
    });

    test('counts insert_errors from batch insert failures', async () => {
      mockRunEmailIngestionPipeline.mockResolvedValue({
        content_type: 'email',
        clean_text: 'text',
      });
      mockInsert.mockResolvedValue({
        rowCount: 0,
        rows: [
          { _batch_ok: false, _batch_index: 0, error: 'unique violation' },
        ],
      });

      const result = await importEmailMbox({ mbox_path: 'inbox.mbox' });
      expect(result.insert_errors).toBe(1);
      expect(result.errors[0].phase).toBe('insert');
    });

    test('caps error samples at MAX_ERROR_SAMPLES (50)', async () => {
      // Build 60 messages that all fail normalization
      const msgs = Array.from({ length: 60 }, () => singleMessage);
      fs.readFile.mockResolvedValue(makeMbox(msgs));
      mockRunEmailIngestionPipeline.mockRejectedValue(new Error('fail'));

      const result = await importEmailMbox({ mbox_path: 'inbox.mbox' });
      expect(result.normalize_errors).toBe(60);
      expect(result.errors).toHaveLength(50);
    });
  });
});
