'use strict';

const mockBraintrustSinkLog = { logSuccess: jest.fn(), logError: jest.fn() };

jest.mock('../../src/server/logger/sinks/braintrust.js', () => ({
  createBraintrustSink: () => mockBraintrustSinkLog,
}));

jest.mock('../../src/server/runtime-env.js', () => {
  let settings = {};
  const mod = {
    getLiteLLMSettings: () => ({
      apiKey: 'sk-test-key',
      baseUrl: 'http://litellm:4000/v1',
      defaultModel: 't1-default',
      timeoutMs: 60000,
      reasoningEffort: 'minimal',
      batchModel: 't1-batch',
      batchDefaultModel: null,
      batchRequestModel: 'gpt-5-nano',
      batchProviderModel: null,
      inputCostPerM: null,
      outputCostPerM: null,
      ...settings,
    }),
    getFallbackLlmCostEnv: () => ({
      inputPerM: null,
      outputPerM: null,
    }),
    _setOverrides: (overrides) => { settings = overrides; },
    _resetOverrides: () => { settings = {}; },
  };
  return mod;
});

const { LiteLLMClient, DEFAULT_SYSTEM_PROMPT, extractResponseText } = require('../../src/server/litellm-client.js');

// Helper: build a mock fetch Response
function mockFetchResponse(status, body, ok) {
  return {
    ok: ok !== undefined ? ok : status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('litellm-client', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    require('../../src/server/runtime-env.js')._resetOverrides();
  });

  // ---- extractResponseText ----
  describe('extractResponseText', () => {
    test('returns empty string for null/undefined', () => {
      expect(extractResponseText(null)).toBe('');
      expect(extractResponseText(undefined)).toBe('');
    });

    test('extracts from output_text', () => {
      expect(extractResponseText({ output_text: 'hello' })).toBe('hello');
    });

    test('extracts from choices[0].message.content', () => {
      const resp = {
        choices: [{ message: { content: 'from choices' } }],
      };
      expect(extractResponseText(resp)).toBe('from choices');
    });

    test('extracts from output array with content parts', () => {
      const resp = {
        output: [
          {
            content: [
              { type: 'output_text', text: 'extracted text' },
            ],
          },
        ],
      };
      expect(extractResponseText(resp)).toBe('extracted text');
    });

    test('falls back through response chain', () => {
      expect(extractResponseText({ responseText: 'rt' })).toBe('rt');
      expect(extractResponseText({ text: 'txt' })).toBe('txt');
    });
  });

  // ---- DEFAULT_SYSTEM_PROMPT ----
  describe('DEFAULT_SYSTEM_PROMPT', () => {
    test('is a non-empty string', () => {
      expect(typeof DEFAULT_SYSTEM_PROMPT).toBe('string');
      expect(DEFAULT_SYSTEM_PROMPT.length).toBeGreaterThan(20);
    });
  });

  // ---- LiteLLMClient constructor ----
  describe('LiteLLMClient constructor', () => {
    test('creates client with default settings', () => {
      const client = new LiteLLMClient();
      expect(client.apiKey).toBe('sk-test-key');
      expect(client.baseUrl).toBe('http://litellm:4000/v1');
      expect(client.model).toBe('t1-default');
    });

    test('accepts overrides via constructor options', () => {
      const client = new LiteLLMClient({
        baseUrl: 'http://custom:9000/v1',
        model: 'custom-model',
        systemPrompt: 'custom prompt',
      });
      expect(client.baseUrl).toBe('http://custom:9000/v1');
      expect(client.model).toBe('custom-model');
      expect(client.systemPrompt).toBe('custom prompt');
    });

    test('throws when API key is missing', () => {
      require('../../src/server/runtime-env.js')._setOverrides({ apiKey: '' });
      expect(() => new LiteLLMClient()).toThrow('LITELLM_MASTER_KEY is required');
    });
  });

  // ---- sendMessage ----
  describe('sendMessage', () => {
    let client;

    beforeEach(() => {
      require('../../src/server/runtime-env.js')._resetOverrides();
      client = new LiteLLMClient();
    });

    test('throws for empty prompt', async () => {
      await expect(client.sendMessage('')).rejects.toThrow(
        'non-empty prompt'
      );
      await expect(client.sendMessage('   ')).rejects.toThrow(
        'non-empty prompt'
      );
    });

    test('sends chat completion and returns text', async () => {
      const responseBody = {
        choices: [{ message: { content: '{"topic":"test"}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      };

      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(200, responseBody)
      );

      const result = await client.sendMessage('Extract metadata');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, opts] = global.fetch.mock.calls[0];
      expect(url).toBe('http://litellm:4000/v1/chat/completions');
      expect(opts.method).toBe('POST');

      const body = JSON.parse(opts.body);
      expect(body.model).toBe('t1-default');
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[1].role).toBe('user');
      expect(body.messages[1].content).toBe('Extract metadata');
      expect(body.reasoning_effort).toBe('minimal');

      expect(result.text).toBe('{"topic":"test"}');
      expect(result.response).toBeDefined();
    });

    test('includes Authorization header', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(200, { choices: [{ message: { content: 'ok' } }] })
      );

      await client.sendMessage('test');

      const [, opts] = global.fetch.mock.calls[0];
      expect(opts.headers.Authorization).toBe('Bearer sk-test-key');
    });

    test('throws on 4xx response', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(400, { error: { message: 'bad request' } }, false)
      );

      await expect(client.sendMessage('test')).rejects.toThrow(
        'LiteLLM chat completion error'
      );
    });

    test('throws on 5xx response', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(500, { error: { message: 'internal error' } }, false)
      );

      await expect(client.sendMessage('test')).rejects.toThrow(
        'LiteLLM chat completion error'
      );
    });

    test('throws on network/fetch failure', async () => {
      const fetchError = new Error('fetch failed');
      fetchError.cause = { code: 'ECONNREFUSED', address: '127.0.0.1', port: 4000 };
      global.fetch = jest.fn().mockRejectedValue(fetchError);

      await expect(client.sendMessage('test')).rejects.toThrow(
        'LiteLLM request failed'
      );
    });

    test('retries with "low" reasoning_effort on validation error', async () => {
      const errorResponse = mockFetchResponse(
        400,
        { error: { message: 'reasoning_effort: invalid value "minimal"' } },
        false
      );
      const successResponse = mockFetchResponse(200, {
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      });

      global.fetch = jest.fn()
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(successResponse);

      const result = await client.sendMessage('test');

      expect(global.fetch).toHaveBeenCalledTimes(2);
      const secondBody = JSON.parse(global.fetch.mock.calls[1][1].body);
      expect(secondBody.reasoning_effort).toBe('low');
      expect(result.text).toBe('ok');
    });

    test('does not retry reasoning_effort for non-validation errors', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(429, { error: { message: 'rate limit exceeded' } }, false)
      );

      await expect(client.sendMessage('test')).rejects.toThrow(
        'LiteLLM chat completion error'
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('logs success to braintrust sink', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(200, {
          choices: [{ message: { content: 'result' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        })
      );

      await client.sendMessage('test');
      expect(mockBraintrustSinkLog.logSuccess).toHaveBeenCalledTimes(1);
    });

    test('logs error to braintrust sink on failure', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(500, { error: { message: 'boom' } }, false)
      );

      await expect(client.sendMessage('test')).rejects.toThrow();
      expect(mockBraintrustSinkLog.logError).toHaveBeenCalled();
    });

    test('accepts model override via options', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(200, { choices: [{ message: { content: 'ok' } }] })
      );

      await client.sendMessage('test', { model: 'gpt-5' });
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-5');
    });
  });

  // ---- createBatch ----
  describe('createBatch', () => {
    let client;

    beforeEach(() => {
      require('../../src/server/runtime-env.js')._resetOverrides();
      client = new LiteLLMClient();
    });

    test('throws for empty requests array', async () => {
      await expect(client.createBatch([])).rejects.toThrow(
        'non-empty requests array'
      );
    });

    test('throws for requests missing custom_id or prompt', async () => {
      await expect(
        client.createBatch([{ prompt: 'test' }])
      ).rejects.toThrow('custom_id and prompt');
    });

    test('uploads file then creates batch', async () => {
      const fileUploadResponse = mockFetchResponse(200, { id: 'file-123' });
      const batchCreateResponse = mockFetchResponse(200, {
        id: 'batch-456',
        status: 'validating',
      });

      global.fetch = jest.fn()
        .mockResolvedValueOnce(fileUploadResponse)
        .mockResolvedValueOnce(batchCreateResponse);

      const result = await client.createBatch(
        [{ custom_id: 'req-1', prompt: 'Extract this' }],
        { request_model: 'gpt-5-nano' }
      );

      expect(global.fetch).toHaveBeenCalledTimes(2);

      // First call: file upload
      const [uploadUrl, uploadOpts] = global.fetch.mock.calls[0];
      expect(uploadUrl).toBe('http://litellm:4000/v1/files');
      expect(uploadOpts.method).toBe('POST');

      // Second call: batch create
      const [batchUrl, batchOpts] = global.fetch.mock.calls[1];
      expect(batchUrl).toBe('http://litellm:4000/v1/batches');
      expect(batchOpts.method).toBe('POST');
      const batchBody = JSON.parse(batchOpts.body);
      expect(batchBody.input_file_id).toBe('file-123');

      expect(result.batch.id).toBe('batch-456');
      expect(result.input_file_id).toBe('file-123');
    });

    test('throws on file upload failure', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(500, { error: { message: 'upload failed' } }, false)
      );

      await expect(
        client.createBatch(
          [{ custom_id: 'req-1', prompt: 'test' }],
          { request_model: 'gpt-5-nano' }
        )
      ).rejects.toThrow('file upload error');
    });

    test('throws on batch create failure', async () => {
      global.fetch = jest.fn()
        .mockResolvedValueOnce(mockFetchResponse(200, { id: 'file-1' }))
        .mockResolvedValueOnce(
          mockFetchResponse(400, { error: { message: 'batch create failed' } }, false)
        );

      await expect(
        client.createBatch(
          [{ custom_id: 'req-1', prompt: 'test' }],
          { request_model: 'gpt-5-nano' }
        )
      ).rejects.toThrow('batch create error');
    });

    test('uses model as request_model fallback when env settings are empty', async () => {
      require('../../src/server/runtime-env.js')._setOverrides({
        batchRequestModel: '',
        batchProviderModel: '',
      });
      const freshClient = new LiteLLMClient();

      // batchRequestModel and batchProviderModel are empty, but
      // getDefaultBatchRequestModel(model) falls back to model='t1-batch'
      // So createBatch should proceed (not throw) and attempt file upload.
      global.fetch = jest.fn().mockResolvedValueOnce(
        mockFetchResponse(200, { id: 'file-1' })
      ).mockResolvedValueOnce(
        mockFetchResponse(200, { id: 'batch-1', status: 'validating' })
      );

      const result = await freshClient.createBatch(
        [{ custom_id: 'r1', prompt: 'test' }]
      );
      expect(result.batch.id).toBe('batch-1');
    });
  });

  // ---- retrieveBatch ----
  describe('retrieveBatch', () => {
    let client;

    beforeEach(() => {
      client = new LiteLLMClient();
    });

    test('throws for empty batchId', async () => {
      await expect(client.retrieveBatch('')).rejects.toThrow('requires batchId');
    });

    test('returns batch object on success', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(200, {
          id: 'batch-1',
          status: 'completed',
          output_file_id: 'file-out',
        })
      );

      const batch = await client.retrieveBatch('batch-1');
      expect(batch.id).toBe('batch-1');
      expect(batch.status).toBe('completed');

      const [url] = global.fetch.mock.calls[0];
      expect(url).toContain('/batches/batch-1');
    });

    test('throws on non-ok response', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        mockFetchResponse(404, { error: { message: 'not found' } }, false)
      );

      await expect(client.retrieveBatch('batch-x')).rejects.toThrow(
        'batch retrieve error'
      );
    });
  });

  // ---- getFileContent ----
  describe('getFileContent', () => {
    let client;

    beforeEach(() => {
      client = new LiteLLMClient();
    });

    test('throws for empty fileId', async () => {
      await expect(client.getFileContent('')).rejects.toThrow('requires fileId');
    });

    test('returns file content text on success', async () => {
      const jsonlContent = '{"id":"1"}\n{"id":"2"}';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => jsonlContent,
      });

      const content = await client.getFileContent('file-out-1');
      expect(content).toBe(jsonlContent);

      const [url] = global.fetch.mock.calls[0];
      expect(url).toContain('/files/file-out-1/content');
    });

    test('throws on non-ok response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'internal error',
      });

      await expect(client.getFileContent('file-x')).rejects.toThrow(
        'file content error'
      );
    });
  });
});
