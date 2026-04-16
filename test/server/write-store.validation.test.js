'use strict';

const { buildGenericUpdatePayload } = require('../../src/server/db/shared.js');

describe('write-store generic update validation', () => {
  test('rejects Tier-1 classify fields on generic /db/update payloads', () => {
    expect(() => buildGenericUpdatePayload({
      where: { entry_id: 123 },
      topic_primary: 'parenting',
      topic_secondary: 'bedtime',
      gist: 'summary',
    })).toThrow('generic /db/update does not accept Tier-1 classify fields');
  });
});
