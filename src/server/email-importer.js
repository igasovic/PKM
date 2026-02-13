'use strict';

const fs = require('fs/promises');
const path = require('path');
const db = require('./db.js');
const { normalizeEmail } = require('./normalization.js');
const { enqueueTier1Batch } = require('./tier1-enrichment.js');
const { getBraintrustLogger } = require('./observability.js');

const DEFAULT_T1_BATCH_SIZE = 500;
const MIN_T1_BATCH_SIZE = 500;
const MAX_T1_BATCH_SIZE = 2000;
const DEFAULT_INSERT_CHUNK_SIZE = 200;
const MAX_ERROR_SAMPLES = 50;

function normalizeNewlines(s) {
  return String(s || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function splitMboxMessages(raw) {
  const text = normalizeNewlines(raw);
  if (!text.trim()) return [];

  const chunks = text.split(/\n(?=From [^\n]*\n)/g);
  const out = [];
  for (const chunk of chunks) {
    let msg = chunk;
    if (msg.startsWith('From ')) {
      const idx = msg.indexOf('\n');
      msg = idx === -1 ? '' : msg.slice(idx + 1);
    }
    msg = msg.trim();
    if (msg) out.push(msg);
  }
  return out;
}

function parseHeadersAndBody(rawMessage) {
  const text = normalizeNewlines(rawMessage);
  const splitIdx = text.indexOf('\n\n');
  const headerBlock = splitIdx === -1 ? text : text.slice(0, splitIdx);
  const body = splitIdx === -1 ? '' : text.slice(splitIdx + 2);

  const headers = {};
  const lines = headerBlock.split('\n');
  let lastKey = null;
  for (const line of lines) {
    if (/^\s/.test(line) && lastKey) {
      headers[lastKey] = `${headers[lastKey]} ${line.trim()}`.trim();
      continue;
    }
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    lastKey = String(m[1] || '').trim().toLowerCase();
    const value = String(m[2] || '').trim();
    if (headers[lastKey]) {
      headers[lastKey] = `${headers[lastKey]}, ${value}`;
    } else {
      headers[lastKey] = value;
    }
  }

  return { headers, body };
}

function decodeQuotedPrintable(s) {
  const input = String(s || '');
  const soft = input.replace(/=\n/g, '');
  return soft.replace(/=([0-9A-Fa-f]{2})/g, (_m, hex) => {
    const code = Number.parseInt(hex, 16);
    if (Number.isNaN(code)) return '';
    return String.fromCharCode(code);
  });
}

function decodeBase64(s) {
  try {
    const clean = String(s || '').replace(/[^A-Za-z0-9+/=]/g, '');
    return Buffer.from(clean, 'base64').toString('utf8');
  } catch {
    return String(s || '');
  }
}

function decodeTransfer(body, encoding) {
  const enc = String(encoding || '').toLowerCase();
  if (enc.includes('quoted-printable')) return decodeQuotedPrintable(body);
  if (enc.includes('base64')) return decodeBase64(body);
  return String(body || '');
}

function decodeMimeWords(s) {
  return String(s || '').replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]+)\?=/g,
    (_m, _charset, enc, data) => {
      if (String(enc).toLowerCase() === 'b') {
        return decodeBase64(data);
      }
      const qp = String(data || '').replace(/_/g, ' ');
      return decodeQuotedPrintable(qp);
    }
  );
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/?(div|p|br|li|tr|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function extractBoundary(contentTypeHeader) {
  const ct = String(contentTypeHeader || '');
  const m = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return m ? String(m[1] || m[2] || '').trim() : null;
}

function parseMultipartParts(body, boundary) {
  if (!boundary) return [];
  const delimiter = `--${boundary}`;
  const parts = [];
  const rawParts = String(body || '').split(delimiter).slice(1);
  for (let part of rawParts) {
    part = part.replace(/^\n/, '');
    if (part.startsWith('--')) break;
    part = part.trim();
    if (!part) continue;
    parts.push(part);
  }
  return parts;
}

function extractBestText(headers, body) {
  const contentType = String(headers['content-type'] || 'text/plain').toLowerCase();
  const transferEncoding = headers['content-transfer-encoding'] || '';

  if (contentType.startsWith('multipart/')) {
    const boundary = extractBoundary(headers['content-type']);
    const parts = parseMultipartParts(body, boundary);
    let plain = null;
    let html = null;
    for (const part of parts) {
      const parsed = parseHeadersAndBody(part);
      const text = extractBestText(parsed.headers, parsed.body);
      const ct = String(parsed.headers['content-type'] || '').toLowerCase();
      if (!plain && ct.includes('text/plain') && text) plain = text;
      if (!html && ct.includes('text/html') && text) html = text;
      if (!plain && !ct.includes('text/html') && text) plain = text;
    }
    return (plain || html || '').trim();
  }

  const decoded = decodeTransfer(body, transferEncoding);
  if (contentType.includes('text/html')) {
    return stripHtml(decoded);
  }
  return decoded.trim();
}

function parseEmailAddress(rawFrom) {
  const raw = decodeMimeWords(rawFrom).trim();
  if (!raw) return null;
  return raw;
}

function parseSubject(rawSubject) {
  const raw = decodeMimeWords(rawSubject).trim();
  return raw || null;
}

function parseEnvelope(rawMessage) {
  const { headers, body } = parseHeadersAndBody(rawMessage);
  const from = parseEmailAddress(headers.from || '');
  const subject = parseSubject(headers.subject || '');
  const message_id = headers['message-id'] || headers.message_id || null;
  const date = headers.date || null;
  const textPlain = extractBestText(headers, body) || body || '';
  return {
    from,
    subject,
    message_id: message_id ? String(message_id).trim() : null,
    date: date ? String(date).trim() : null,
    textPlain: String(textPlain || ''),
  };
}

function parseBatchSize(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_T1_BATCH_SIZE;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error('batch_size must be an integer');
  }
  if (n < MIN_T1_BATCH_SIZE || n > MAX_T1_BATCH_SIZE) {
    throw new Error(`batch_size must be between ${MIN_T1_BATCH_SIZE} and ${MAX_T1_BATCH_SIZE}`);
  }
  return n;
}

function parseInsertChunkSize(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_INSERT_CHUNK_SIZE;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error('insert_chunk_size must be a positive integer');
  }
  return n;
}

function resolveMboxPath(inputPath) {
  const raw = String(inputPath || '').trim();
  if (!raw) throw new Error('mbox_path is required');
  if (!raw.toLowerCase().endsWith('.mbox')) {
    throw new Error('mbox_path must point to a .mbox file');
  }

  const absPath = path.resolve(raw);
  const rootAbs = path.dirname(absPath);
  return { rootAbs, absPath };
}

async function importEmailMbox(opts) {
  const options = opts || {};
  const logger = getBraintrustLogger();

  const batch_size = parseBatchSize(options.batch_size);
  const insert_chunk_size = parseInsertChunkSize(options.insert_chunk_size);
  const completion_window = options.completion_window || '24h';
  const max_emails = options.max_emails ? Number(options.max_emails) : null;
  const { rootAbs, absPath } = resolveMboxPath(options.mbox_path || options.path);
  const relativePath = path.relative(rootAbs, absPath).replace(/\\/g, '/');

  const st = await fs.stat(absPath);
  if (!st.isFile()) {
    throw new Error('mbox_path must be a file');
  }

  const fileText = await fs.readFile(absPath, 'utf8');
  let messages = splitMboxMessages(fileText);
  if (Number.isFinite(max_emails) && max_emails > 0) {
    messages = messages.slice(0, max_emails);
  }
  if (!messages.length) {
    throw new Error('no messages found in mbox');
  }

  const import_id = `email_backlog_${Date.now()}`;
  const summary = {
    import_id,
    mbox_path: relativePath,
    total_messages: messages.length,
    normalized_ok: 0,
    normalize_errors: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    insert_errors: 0,
    tier1_candidates: 0,
    tier1_batches: [],
    tier1_enqueued_items: 0,
    errors: [],
  };

  const insertBuffer = [];
  const tierBuffer = [];
  const insertReturning = [
    'id',
    'entry_id',
    'source',
    'title',
    'author',
    'content_type',
    'clean_text',
  ];

  const pushError = (phase, index, err) => {
    if (summary.errors.length >= MAX_ERROR_SAMPLES) return;
    summary.errors.push({
      phase,
      index,
      message: err && err.message ? err.message : String(err),
    });
  };

  const flushTierBatches = async (flushRemainder) => {
    while (tierBuffer.length >= batch_size || (flushRemainder && tierBuffer.length > 0)) {
      const take = flushRemainder ? Math.min(batch_size, tierBuffer.length) : batch_size;
      const chunk = tierBuffer.splice(0, take);
      const result = await enqueueTier1Batch(chunk, {
        completion_window,
        metadata: {
          source: 'email-batch-import',
          import_id,
          mbox_path: relativePath,
          ...(options.metadata || {}),
        },
      });
      summary.tier1_batches.push({
        batch_id: result.batch_id,
        status: result.status,
        schema: result.schema,
        request_count: result.request_count,
      });
      summary.tier1_enqueued_items += chunk.length;
    }
  };

  const flushInsertBuffer = async () => {
    if (!insertBuffer.length) return;

    const result = await db.insert({
      items: insertBuffer.splice(0, insertBuffer.length),
      continue_on_error: true,
      returning: insertReturning,
    });

    const rows = Array.isArray(result && result.rows) ? result.rows : [];
    for (const row of rows) {
      if (row && row._batch_ok === false) {
        summary.insert_errors += 1;
        pushError('insert', row._batch_index, new Error(row.error || 'insert failed'));
        continue;
      }

      const action = String((row && row.action) || 'inserted');
      if (action === 'skipped') summary.skipped += 1;
      else if (action === 'updated') summary.updated += 1;
      else summary.inserted += 1;

      if (action === 'skipped') continue;
      const clean_text = row && row.clean_text ? String(row.clean_text) : '';
      if (!clean_text.trim()) continue;

      const custom_id = row.entry_id
        ? `entry_${row.entry_id}`
        : (row.id ? `id_${row.id}` : `row_${summary.tier1_candidates}`);
      tierBuffer.push({
        custom_id,
        title: row.title || null,
        author: row.author || null,
        content_type: row.content_type || 'other',
        clean_text,
      });
      summary.tier1_candidates += 1;
    }

    await flushTierBatches(false);
  };

  for (let i = 0; i < messages.length; i++) {
    const rawMessage = messages[i];
    try {
      const env = parseEnvelope(rawMessage);
      const normalized = await normalizeEmail({
        raw_text: env.textPlain,
        from: env.from,
        subject: env.subject,
        source: {
          message_id: env.message_id,
          date: env.date,
        },
      });

      // Backlog imports are tracked as a dedicated source while preserving email idempotency semantics.
      normalized.source = 'email-batch';

      insertBuffer.push(normalized);
      summary.normalized_ok += 1;
      if (insertBuffer.length >= insert_chunk_size) {
        await flushInsertBuffer();
      }
    } catch (err) {
      summary.normalize_errors += 1;
      pushError('normalize', i, err);
    }
  }

  await flushInsertBuffer();
  await flushTierBatches(true);

  logger.log({
    input: {
      import_id,
      mbox_path: relativePath,
      batch_size,
      insert_chunk_size,
      completion_window,
      total_messages: messages.length,
    },
    output: summary,
    metadata: {
      source: 'email_importer',
      event: 'mbox_import_complete',
    },
  });

  return summary;
}

module.exports = {
  importEmailMbox,
};
