'use strict';

const assert = require('assert');
const sb = require('../js/libs/sql-builder.js');

(() => {
  {
    const table = '"pkm"."entries"';
    const sql = sb.buildInsert({
      table,
      columns: ['a', 'b'],
      values: ['1', '2'],
      returning: ['id'],
    });

    assert.ok(sql.includes('INSERT INTO'));
    assert.ok(sql.includes('RETURNING'));
  }

  {
    const table = '"pkm"."entries"';
    const sql = sb.buildUpdate({
      table,
      set: ['a = 1'],
      where: 'id = 1',
      returning: ['id'],
    });

    assert.ok(sql.startsWith('UPDATE'));
    assert.ok(sql.includes('SET'));
    assert.ok(sql.includes('WHERE id = 1'));
  }

  {
    const config = require('../src/server/config.js').getConfig();
    const sql = sb.buildReadLast({
      config,
      entries_table: '"pkm"."entries"',
      q: 'x',
      days: 1,
      limit: 1,
    });

    assert.ok(sql.includes('WITH params AS'));
    assert.ok(sql.includes('SELECT *'));
  }

  {
    const built = require('../src/server/db.js').buildGenericInsertPayload({
      source: 'telegram',
      capture_text: 'hello',
      clean_word_count: 3,
    });
    assert.ok(Array.isArray(built.columns));
    assert.ok(Array.isArray(built.values));
    assert.ok(built.columns.includes('capture_text'));
    assert.ok(built.values.find(v => v.includes('hello')));
  }

  {
    const built = require('../src/server/db.js').buildGenericUpdatePayload({
      id: '00000000-0000-0000-0000-000000000000',
      title: 'Updated',
    });
    assert.ok(Array.isArray(built.set));
    assert.ok(built.where.includes('id ='));
  }

  // eslint-disable-next-line no-console
  console.log('db-client: OK');
})();
