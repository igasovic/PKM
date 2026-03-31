'use strict';

const path = require('path');
const { readJsonFile, resolveRepoPath } = require('./io.js');

function loadJson(relativePath) {
  return readJsonFile(resolveRepoPath(relativePath));
}

function ensureArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function assertField(condition, message) {
  if (!condition) throw new Error(message);
}

function validateRouterStatelessCase(row, idx) {
  assertField(row && typeof row === 'object', `router stateless case ${idx} must be object`);
  assertField(typeof row.case_id === 'string' && row.case_id, `router stateless case ${idx} missing case_id`);
  assertField(typeof row.bucket === 'string' && row.bucket, `router stateless case ${idx} missing bucket`);
  assertField(Array.isArray(row.failure_tags), `router stateless case ${row.case_id} missing failure_tags`);
  assertField(row.input && typeof row.input.text === 'string', `router stateless case ${row.case_id} missing input.text`);
  assertField(row.expect && typeof row.expect.route === 'string', `router stateless case ${row.case_id} missing expect.route`);
}

function validateRouterStatefulCase(row, idx) {
  assertField(row && typeof row === 'object', `router stateful case ${idx} must be object`);
  assertField(typeof row.case_id === 'string' && row.case_id, `router stateful case ${idx} missing case_id`);
  assertField(row.setup && typeof row.setup === 'object', `router stateful case ${row.case_id} missing setup`);
  assertField(row.setup.type === 'normalize_open_request', `router stateful case ${row.case_id} setup.type must be normalize_open_request`);
  assertField(typeof row.setup.raw_text === 'string' && row.setup.raw_text, `router stateful case ${row.case_id} missing setup.raw_text`);
  assertField(typeof row.input?.text === 'string' && row.input.text, `router stateful case ${row.case_id} missing input.text`);
  assertField(typeof row.expect?.route === 'string' && row.expect.route, `router stateful case ${row.case_id} missing expect.route`);
}

function validateNormalizeCase(row, idx) {
  assertField(row && typeof row === 'object', `normalize case ${idx} must be object`);
  assertField(typeof row.case_id === 'string' && row.case_id, `normalize case ${idx} missing case_id`);
  assertField(typeof row.bucket === 'string' && row.bucket, `normalize case ${row.case_id} missing bucket`);
  assertField(Array.isArray(row.failure_tags), `normalize case ${row.case_id} missing failure_tags`);
  assertField(typeof row.input?.raw_text === 'string' && row.input.raw_text, `normalize case ${row.case_id} missing input.raw_text`);
  assertField(typeof row.expect?.status === 'string' && row.expect.status, `normalize case ${row.case_id} missing expect.status`);
}

function loadRouterFixtures() {
  const stateless = ensureArray(loadJson('evals/router/fixtures/gold/stateless.json'), 'router stateless fixtures');
  const stateful = ensureArray(loadJson('evals/router/fixtures/gold/stateful.json'), 'router stateful fixtures');
  stateless.forEach(validateRouterStatelessCase);
  stateful.forEach(validateRouterStatefulCase);
  return { stateless, stateful };
}

function loadNormalizeFixtures() {
  const rows = ensureArray(loadJson('evals/calendar/fixtures/gold/normalize.json'), 'calendar normalize fixtures');
  rows.forEach(validateNormalizeCase);
  return rows;
}

function getFixturePath(relativePath) {
  return path.join(resolveRepoPath(), relativePath);
}

module.exports = {
  loadRouterFixtures,
  loadNormalizeFixtures,
  getFixturePath,
};
