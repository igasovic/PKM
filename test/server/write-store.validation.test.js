'use strict';

const { buildGenericUpdatePayload } = require('../../src/server/db/shared.js');
const { insertPkm, insertPkmBatch } = require('../../src/server/db/write-store.js');

describe('write-store generic update validation', () => {
  test('rejects Tier-1 classify fields on generic /db/update payloads', () => {
    expect(() => buildGenericUpdatePayload({
      where: { entry_id: 123 },
      topic_primary: 'parenting',
      topic_secondary: 'bedtime',
      gist: 'summary',
    })).toThrow('generic /db/update does not accept Tier-1 classify fields');
  });

  test('requires idempotency_key_secondary for email source on /pkm/insert', async () => {
    await expect(insertPkm({
      source: 'email',
      intent: 'archive',
      content_type: 'newsletter',
      capture_text: 'hello',
      clean_text: 'hello',
      idempotency_policy_key: 'email_newsletter_v1',
      idempotency_key_primary: '<m@x>',
      idempotency_key_secondary: null,
    })).rejects.toThrow('idempotency_key_secondary is required when source starts with "email"');
  });

  test('requires idempotency_key_secondary for email-batch source on /pkm/insert/batch items', async () => {
    await expect(insertPkmBatch({
      continue_on_error: true,
      items: [{
        source: 'email-batch',
        intent: 'archive',
        content_type: 'newsletter',
        capture_text: 'hello',
        clean_text: 'hello',
        idempotency_policy_key: 'email_newsletter_v1',
        idempotency_key_primary: '<m@x>',
      }],
    })).rejects.toThrow('items[0]: idempotency_key_secondary is required when source starts with "email"');
  });
});
