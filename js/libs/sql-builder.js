/**
 * SQL Builder — Stateless helpers for safe SQL literal/identifier construction
 * =============================================================================
 *
 * USER GUIDE (for agents)
 * ----------------------
 * Use this library in js/workflows when building SQL for Postgres (INSERT/UPDATE/SELECT).
 * All functions are pure and stateless: same inputs always produce the same output.
 *
 * Literals (use in VALUES, SET, WHERE, params):
 *   lit(v)           — text: null/undefined → NULL, else '...' with backslash/single-quote escaped
 *   jsonbLit(obj)    — jsonb: null/undefined → NULL; optional jsonbLit(obj, { dollarTag: 'x' }) for dollar-quoting (avoids backslash issues in JSON)
 *   intLit(v)        — integer: null/non-finite → NULL, else truncated number string (no quotes)
 *   numLit(v)        — real: null/non-finite → NULL, else number string (no quotes)
 *   boolLit(v)       — boolean: null/undefined → NULL, else 'true'/'false'
 *   bigIntLit(v)     — bigint: trim string, must be non-negative digits only, else NULL (no quotes)
 *   textArrayLit(arr)— text[]: null/empty → NULL, else ARRAY['a','b']::text[] (elements escaped via esc)
 *
 * Escaping (low-level):
 *   esc(s)           — escape string for use inside single-quoted SQL literal (\\ and ')
 *   escapeLikeWildcards(s) — escape % _ \ for use in LIKE/ILIKE patterns (e.g. user search)
 *
 * Identifiers / schema:
 *   isValidIdent(s)  — true if s is a valid SQL identifier (letters, digits, underscore)
 *   qualifiedTable(schema, table) — returns "schema"."table" (validated); invalid schema → uses fallbackSchema
 *   resolveEntriesTable(db)       — given db config { is_test_mode, schema_prod?, schema_test? }, returns "schema"."entries" (default schema 'pkm')
 *
 * Utilities:
 *   clamp01(x)       — clamp number to [0, 1] (e.g. confidence scores)
 *
 * Example:
 *   const sb = require('./libs/sql-builder.js');
 *   const entries_table = sb.resolveEntriesTable(config.db);
 *   const sql = `SELECT * FROM ${entries_table} WHERE id = ${sb.lit(id)}::uuid AND n = ${sb.intLit(n)}`;
 */

'use strict';

/**
 * Escape string for use inside a single-quoted SQL string literal.
 * Escapes backslash and single quote.
 * @param {string} s
 * @returns {string}
 */
function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "''");
}

/**
 * SQL text literal. null/undefined → 'NULL'; otherwise quoted and escaped.
 * @param {*} v
 * @returns {string} 'NULL' or 'escaped_value'
 */
function lit(v) {
  return (v === null || v === undefined) ? 'NULL' : `'${esc(v)}'`;
}

/**
 * SQL jsonb literal. null/undefined → 'NULL'.
 * By default: single-quoted JSON with only single-quote escaped (JSON.stringify handles \ and ").
 * Option { dollarTag: 'tag' } uses dollar-quoting to avoid any escape issues: $tag$...$tag$::jsonb.
 * @param {*} obj
 * @param {{ dollarTag?: string }} [opts]
 * @returns {string}
 */
function jsonbLit(obj, opts) {
  if (obj === null || obj === undefined) return 'NULL';
  const s = JSON.stringify(obj);
  const tag = opts && opts.dollarTag;
  if (tag && !s.includes(`$${tag}$`)) {
    return `$${tag}$${s}$${tag}$::jsonb`;
  }
  const escaped = s.replace(/'/g, "''");
  return `'${escaped}'::jsonb`;
}

/**
 * SQL integer literal. null/undefined/non-finite → 'NULL'; else truncated number (unquoted).
 * @param {*} v
 * @returns {string}
 */
function intLit(v) {
  if (v === null || v === undefined) return 'NULL';
  const n = Number(v);
  if (!Number.isFinite(n)) return 'NULL';
  return String(Math.trunc(n));
}

/**
 * SQL real/numeric literal. null/undefined/non-finite → 'NULL'; else number string (unquoted).
 * @param {*} v
 * @returns {string}
 */
function numLit(v) {
  if (v === null || v === undefined) return 'NULL';
  const n = Number(v);
  if (!Number.isFinite(n)) return 'NULL';
  return String(n);
}

/**
 * SQL boolean literal. null/undefined → 'NULL'; else 'true' or 'false'.
 * @param {*} v
 * @returns {string}
 */
function boolLit(v) {
  if (v === null || v === undefined) return 'NULL';
  return v ? 'true' : 'false';
}

/**
 * SQL bigint literal (unquoted). Input trimmed; must be non-negative digits only, else 'NULL'.
 * @param {*} v
 * @returns {string}
 */
function bigIntLit(v) {
  const s = String(v ?? '').trim();
  if (!/^\d+$/.test(s)) return 'NULL';
  return s;
}

/**
 * SQL text[] literal. null/non-array/empty → 'NULL'; else ARRAY['a','b']::text[].
 * Elements are trimmed and escaped; empty after trim are skipped.
 * @param {*} arr
 * @returns {string}
 */
function textArrayLit(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 'NULL';
  const items = arr
    .map(x => String(x ?? '').trim())
    .filter(Boolean)
    .map(x => `'${esc(x)}'`);
  if (items.length === 0) return 'NULL';
  return `ARRAY[${items.join(', ')}]::text[]`;
}

/**
 * Escape % _ \ for use in LIKE/ILIKE pattern (e.g. user-provided search).
 * Use with ESCAPE '\\' in SQL.
 * @param {string} s
 * @returns {string}
 */
function escapeLikeWildcards(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * True if s is a valid SQL identifier (starts with letter/underscore, then alphanumeric/underscore).
 * @param {*} s
 * @returns {boolean}
 */
function isValidIdent(s) {
  return (typeof s === 'string') && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s);
}

/**
 * Quoted qualified table: "schema"."table". If schema invalid, uses fallbackSchema (default 'pkm').
 * @param {string} schema
 * @param {string} table
 * @param {string} [fallbackSchema='pkm']
 * @returns {string}
 */
function qualifiedTable(schema, table, fallbackSchema = 'pkm') {
  const sch = isValidIdent(schema) ? schema : fallbackSchema;
  const tbl = isValidIdent(table) ? table : 'entries';
  return `"${sch}"."${tbl}"`;
}

/**
 * Resolve entries table from db config (prod vs test schema).
 * db: { is_test_mode?, schema_prod?, schema_test? }. Default schema names: pkm, pkm_test.
 * @param {{ is_test_mode?: boolean, schema_prod?: string, schema_test?: string }} db
 * @returns {string} "schema"."entries"
 */
function resolveEntriesTable(db) {
  const is_test_mode = !!db.is_test_mode;
  const schema_prod = db.schema_prod || 'pkm';
  const schema_test = db.schema_test || 'pkm_test';
  const schema_candidate = is_test_mode ? schema_test : schema_prod;
  const schema = isValidIdent(schema_candidate) ? schema_candidate : 'pkm';
  return `"${schema}"."entries"`;
}

/**
 * Clamp number to [0, 1] (e.g. confidence scores).
 * @param {number} x
 * @returns {number}
 */
function clamp01(x) {
  return (x < 0 ? 0 : x > 1 ? 1 : x);
}

module.exports = {
  esc,
  lit,
  jsonbLit,
  intLit,
  numLit,
  boolLit,
  bigIntLit,
  textArrayLit,
  escapeLikeWildcards,
  isValidIdent,
  qualifiedTable,
  resolveEntriesTable,
  clamp01,
  buildInsert,
  buildUpdate,
};

/**
 * Build a parameter-free INSERT statement with explicit column/value lists.
 * @param {{ table: string, columns: string[], values: string[], returning?: string[] | string }} opts
 * @returns {string}
 */
function buildInsert(opts) {
  const table = opts && opts.table;
  const columns = opts && opts.columns;
  const values = opts && opts.values;
  const returning = opts && opts.returning;

  if (!table || typeof table !== 'string') {
    throw new Error('buildInsert: table must be a non-empty string');
  }
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('buildInsert: columns must be a non-empty array');
  }
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('buildInsert: values must be a non-empty array');
  }
  if (columns.length !== values.length) {
    throw new Error('buildInsert: columns/values length mismatch');
  }

  const cols = columns.map(c => String(c).trim());
  const vals = values.map(v => String(v).trim());

  let returningClause = '';
  if (returning && Array.isArray(returning) && returning.length > 0) {
    returningClause = `\nRETURNING\n  ${returning.map(r => String(r).trim()).join(',\n  ')}`;
  } else if (returning) {
    const ret = String(returning).trim().replace(/;$/, '');
    if (ret) returningClause = `\nRETURNING\n  ${ret}`;
  }

  return [
    `INSERT INTO ${table} (`,
    `  ${cols.join(',\n  ')}`,
    `)`,
    `VALUES (`,
    `  ${vals.join(',\n  ')}`,
    `)${returningClause};`,
  ].join('\n');
}

/**
 * Build a parameter-free UPDATE statement with explicit SET clauses.
 * @param {{ table: string, set: string[], where: string, returning?: string[] | string }} opts
 * @returns {string}
 */
function buildUpdate(opts) {
  const table = opts && opts.table;
  const set = opts && opts.set;
  const where = opts && opts.where;
  const returning = opts && opts.returning;

  if (!table || typeof table !== 'string') {
    throw new Error('buildUpdate: table must be a non-empty string');
  }
  if (!Array.isArray(set) || set.length === 0) {
    throw new Error('buildUpdate: set must be a non-empty array');
  }
  if (!where || typeof where !== 'string') {
    throw new Error('buildUpdate: where must be a non-empty string');
  }

  const setLines = set.map(line => (line === null || line === undefined) ? '' : String(line).trim());
  const assignmentIdx = [];
  for (let i = 0; i < setLines.length; i += 1) {
    const line = setLines[i];
    if (line === '') continue;
    if (line.startsWith('--')) continue;
    assignmentIdx.push(i);
  }

  const lastAssignment = assignmentIdx.length > 0 ? assignmentIdx[assignmentIdx.length - 1] : -1;
  const renderedSet = setLines.map((line, idx) => {
    if (line === '') return '';
    if (line.startsWith('--')) return line;
    const clean = line.replace(/,+$/, '');
    return (idx === lastAssignment) ? clean : `${clean},`;
  });

  const whereClause = where.trim().toUpperCase().startsWith('WHERE ')
    ? where.trim()
    : `WHERE ${where.trim()}`;

  const returningLines = [];
  if (returning && Array.isArray(returning) && returning.length > 0) {
    returningLines.push('RETURNING');
    returningLines.push(`  ${returning.map(r => String(r).trim()).join(',\n  ')}`);
  } else if (returning) {
    const ret = String(returning).trim().replace(/;$/, '');
    if (ret) {
      returningLines.push('RETURNING');
      returningLines.push(`  ${ret}`);
    }
  }

  const lines = [
    `UPDATE ${table}`,
    'SET',
    `  ${renderedSet.join('\n  ')}`,
    whereClause,
  ];
  if (returningLines.length > 0) {
    lines.push(...returningLines);
  }
  lines[lines.length - 1] = `${lines[lines.length - 1]};`;

  return lines.join('\n');
}
