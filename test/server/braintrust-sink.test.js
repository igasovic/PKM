'use strict';

const mockLog = jest.fn();

jest.mock('../../src/server/logger/braintrust-client.js', () => ({
  getBraintrustLogger: () => ({
    log: mockLog,
  }),
}));

const { createBraintrustSink } = require('../../src/server/logger/sinks/braintrust.js');

describe('braintrust sink', () => {
  beforeEach(() => {
    mockLog.mockClear();
    mockLog.mockImplementation(() => {});
    delete process.env.LLM_INPUT_COST_PER_1M_USD;
    delete process.env.LLM_OUTPUT_COST_PER_1M_USD;
    delete process.env.LLM_MODEL_COSTS_PER_1M_USD_JSON;
    delete process.env.LLM_MODEL_OPENAI_GPT_5_MINI_INPUT_COST_PER_1M_USD;
    delete process.env.LLM_MODEL_OPENAI_GPT_5_MINI_OUTPUT_COST_PER_1M_USD;
    delete process.env.PKM_BRAINTRUST_SINK_WARN_IN_TEST;
    jest.restoreAllMocks();
  });

  test('logs success with success outcome', async () => {
    const sink = createBraintrustSink();
    await sink.logSuccess('unit.test', {
      input: { a: 1 },
      output: { ok: true },
      metadata: { source: 'test' },
      metrics: { duration_ms: 12 },
    });

    expect(mockLog).toHaveBeenCalledTimes(1);
    const payload = mockLog.mock.calls[0][0];
    expect(payload.metadata.outcome).toBe('success');
    expect(payload.metadata.op).toBe('unit.test');
    expect(payload.metrics.duration_ms).toBe(12);
  });

  test('logs error with error outcome', async () => {
    const sink = createBraintrustSink();
    const err = new Error('boom');
    await sink.logError('unit.test', {
      input: { a: 1 },
      error: err,
      metadata: { source: 'test' },
    });

    expect(mockLog).toHaveBeenCalledTimes(1);
    const payload = mockLog.mock.calls[0][0];
    expect(payload.metadata.outcome).toBe('error');
    expect(payload.metadata.op).toBe('unit.test');
    expect(payload.error.message).toBe('boom');
  });

  test('derives estimated LLM cost when usage tokens are available', async () => {
    process.env.LLM_INPUT_COST_PER_1M_USD = '1.5';
    process.env.LLM_OUTPUT_COST_PER_1M_USD = '2.5';
    const sink = createBraintrustSink();

    await sink.logSuccess('chat.completions', {
      input: { model: 't1-default' },
      output: { ok: true },
      metadata: { source: 'litellm' },
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 2000,
      },
      metrics: {
        duration_ms: 40,
      },
    });

    expect(mockLog).toHaveBeenCalledTimes(1);
    const payload = mockLog.mock.calls[0][0];
    // 1000/1e6*1.5 + 2000/1e6*2.5 = 0.0065
    expect(payload.metrics.estimated_cost_usd).toBeCloseTo(0.0065, 8);
    expect(payload.metrics.prompt_tokens).toBe(1000);
    expect(payload.metrics.completion_tokens).toBe(2000);
  });

  test('uses model-specific env costs when present', async () => {
    process.env.LLM_INPUT_COST_PER_1M_USD = '1.5';
    process.env.LLM_OUTPUT_COST_PER_1M_USD = '2.5';
    process.env.LLM_MODEL_OPENAI_GPT_5_MINI_INPUT_COST_PER_1M_USD = '5';
    process.env.LLM_MODEL_OPENAI_GPT_5_MINI_OUTPUT_COST_PER_1M_USD = '7';
    const sink = createBraintrustSink();

    await sink.logSuccess('chat.completions', {
      input: { model: 'openai/gpt-5-mini' },
      output: { ok: true },
      metadata: { source: 'litellm' },
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 2000,
      },
    });

    const payload = mockLog.mock.calls[0][0];
    // 1000/1e6*5 + 2000/1e6*7 = 0.019
    expect(payload.metrics.estimated_cost_usd).toBeCloseTo(0.019, 8);
  });

  test('uses model-cost JSON map over global defaults', async () => {
    process.env.LLM_INPUT_COST_PER_1M_USD = '1.5';
    process.env.LLM_OUTPUT_COST_PER_1M_USD = '2.5';
    process.env.LLM_MODEL_COSTS_PER_1M_USD_JSON = JSON.stringify({
      't2-sync-direct': {
        input: 10,
        output: 20,
      },
    });
    const sink = createBraintrustSink();

    await sink.logSuccess('chat.completions', {
      input: { model: 't2-sync-direct' },
      output: { ok: true },
      metadata: { source: 'litellm' },
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 2000,
      },
    });

    const payload = mockLog.mock.calls[0][0];
    // 1000/1e6*10 + 2000/1e6*20 = 0.05
    expect(payload.metrics.estimated_cost_usd).toBeCloseTo(0.05, 8);
  });

  test('surfaces sink failures with sampled stderr warnings', async () => {
    const sink = createBraintrustSink();
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.PKM_BRAINTRUST_SINK_WARN_IN_TEST = '1';
    mockLog.mockImplementation(() => {
      throw new Error('sink down');
    });

    await sink.logSuccess('chat.completions', {
      input: { model: 't1-default' },
      output: { ok: true },
      metadata: { source: 'litellm' },
    });

    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toContain('braintrust-sink');
    expect(errSpy.mock.calls[0][0]).toContain('write_failed');
  });
});
