'use strict';

const {
  normalizeFailurePackEnvelope,
  redactSecrets,
  validateRelativeArtifactPath,
} = require('../../src/libs/failure-pack.js');

describe('failure-pack utils', () => {
  test('rejects unsupported schema version', () => {
    expect(() => normalizeFailurePackEnvelope({
      schema_version: 'failure-pack.v0',
      run_id: 'run-x',
      correlation: { workflow_name: 'WF' },
      failure: { node_name: 'Node', error_message: 'x' },
    })).toThrow('unsupported schema_version');
  });

  test('redacts known secret fields', () => {
    const out = redactSecrets({
      headers: {
        authorization: 'Bearer abcdef',
        cookie: 'sid=123',
      },
      password: 'secret',
      nested: {
        api_key: 'xyz',
      },
    });

    expect(out.headers.authorization).toBe('Bearer [REDACTED]');
    expect(out.headers.cookie).toBe('[REDACTED]');
    expect(out.password).toBe('[REDACTED]');
    expect(out.nested.api_key).toBe('[REDACTED]');
  });

  test('rejects artifact path traversal', () => {
    expect(() => validateRelativeArtifactPath('../outside.json', 'debug/failures')).toThrow('must not traverse outside root');
  });
});
