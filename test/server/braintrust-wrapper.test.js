'use strict';

const mockSink = {
  logSuccess: jest.fn(),
  logError: jest.fn(),
};

jest.mock('../../src/server/logger/sinks/braintrust.js', () => ({
  createBraintrustSink: () => mockSink,
}));

jest.mock('../../src/server/logger/braintrust-client.js', () => ({
  getBraintrustLogger: () => ({
    log: jest.fn(),
  }),
}));

const { logApiError } = require('../../src/server/logger/braintrust.js');

describe('logger braintrust wrapper', () => {
  beforeEach(() => {
    mockSink.logSuccess.mockClear();
    mockSink.logError.mockClear();
  });

  test('redacts capture_text on api.request errors', () => {
    logApiError(
      {
        op: 'api_db_insert',
        input: {
          capture_text: 'secret',
          nested: {
            capture_text: 'also-secret',
          },
        },
      },
      new Error('boom')
    );

    expect(mockSink.logError).toHaveBeenCalledTimes(1);
    const payload = mockSink.logError.mock.calls[0][1];
    expect(payload.input.input.capture_text).toBe('[redacted]');
    expect(payload.input.input.nested.capture_text).toBe('[redacted]');
  });
});
