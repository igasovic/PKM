'use strict';

const { getConfig } = require('../../libs/config.js');
const { LiteLLMClient } = require('../litellm-client.js');
const { getLogger } = require('../logger/index.js');
const { getRunContext } = require('../logger/context.js');
const {
  normalizeCalendarRequestDeterministic,
} = require('./deterministic-extractor.js');
const {
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
  buildPromptContext,
} = require('./extraction.prompt.js');
const { parseExtractionLlmResult } = require('./extraction.schema.js');

const DEFAULT_EXTRACTION_MODEL = 'pkm-default';

let langGraphModulePromise = null;
let compiledGraphPromise = null;
let litellmClient = null;

function text(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function nowDateInTz(timezone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  const d = Number(parts.find((p) => p.type === 'day')?.value);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function hasLiteLlmKey() {
  return text(process.env.LITELLM_MASTER_KEY).length > 0;
}

function getLiteLLMClient() {
  if (litellmClient) return litellmClient;
  litellmClient = new LiteLLMClient({});
  return litellmClient;
}

function getExtractionModel(options) {
  return text(options && options.model) || DEFAULT_EXTRACTION_MODEL;
}

function createDefaultChannels() {
  return {
    input: null,
    options: null,
    loaded: null,
    prompt: null,
    llm: null,
    parsed: null,
    validated: null,
    output: null,
    trace: null,
  };
}

function logNodeInput(state) {
  return {
    has_input: !!(state && state.input),
    llm_skipped: !!(state && state.llm && state.llm.skipped),
    parse_status: text(state && state.parsed && state.parsed.parse_status) || null,
  };
}

function withNodeLogging(nodeName, fn) {
  return async (state) => {
    const logger = getLogger().child({
      pipeline: 'langgraph.calendar_extraction',
      meta: { node: nodeName },
    });

    return logger.step(
      `langgraph.calendar_extraction.${nodeName}`,
      async () => fn(state || {}),
      {
        input: logNodeInput(state || {}),
        output: (out) => out,
        meta: { graph: 'calendar_extraction', node: nodeName },
      }
    );
  };
}

function loadNode(state) {
  const input = state && typeof state.input === 'object' ? state.input : {};
  const options = state && typeof state.options === 'object' ? state.options : {};
  const config = getConfig();
  const calendarConfig = config && config.calendar ? config.calendar : {};
  const rawText = text(input.raw_text || input.text);
  if (!rawText) throw new Error('raw_text is required');

  const timezone = text(input.timezone) || text(calendarConfig.timezone) || 'America/Chicago';
  const todayLocal = nowDateInTz(timezone);

  return {
    options,
    loaded: {
      input,
      raw_text: rawText,
      timezone,
      today_local: todayLocal,
      clarification_turns: Array.isArray(input.clarification_turns)
        ? input.clarification_turns
        : [],
      calendar_config: calendarConfig,
    },
  };
}

function promptNode(state) {
  const loaded = state && state.loaded ? state.loaded : {};
  const promptContext = buildPromptContext(loaded.calendar_config, {
    timezone: loaded.timezone,
  });

  return {
    prompt: {
      system: buildExtractionSystemPrompt(promptContext),
      user: buildExtractionUserPrompt({
        raw_text: loaded.raw_text,
        clarification_turns: loaded.clarification_turns,
        today_local: loaded.today_local,
      }),
    },
  };
}

async function llmNode(state) {
  if (!hasLiteLlmKey()) {
    return {
      llm: {
        skipped: true,
        reason: 'litellm_not_configured',
      },
    };
  }

  const loaded = state && state.loaded ? state.loaded : {};
  const prompt = state && state.prompt ? state.prompt : {};
  const options = state && state.options ? state.options : {};
  const model = getExtractionModel(options);

  try {
    const client = getLiteLLMClient();
    const res = await client.sendMessage(prompt.user, {
      model,
      systemPrompt: prompt.system,
      metadata: {
        pipeline: 'calendar_extraction',
        stage: 'llm',
      },
    });

    return {
      llm: {
        skipped: false,
        reason: null,
        model,
        text: text(res && res.text),
        timezone: loaded.timezone,
      },
    };
  } catch (err) {
    return {
      llm: {
        skipped: true,
        reason: 'llm_error',
        error: text(err && err.message) || 'llm_error',
      },
    };
  }
}

function parseNode(state) {
  const llm = state && state.llm ? state.llm : {};
  if (llm.skipped || !text(llm.text)) {
    return {
      parsed: {
        parse_status: llm.skipped ? 'skipped' : 'empty',
        llm_extraction: null,
      },
    };
  }

  try {
    const llmExtraction = parseExtractionLlmResult(llm.text);
    return {
      parsed: {
        parse_status: 'parsed',
        llm_extraction: llmExtraction,
      },
    };
  } catch (err) {
    return {
      parsed: {
        parse_status: 'parse_error',
        parse_error: text(err && err.message) || 'parse_error',
        llm_extraction: null,
      },
    };
  }
}

function validateNode(state) {
  const loaded = state && state.loaded ? state.loaded : {};
  const parsed = state && state.parsed ? state.parsed : {};
  const input = loaded.input || {};
  const llmExtraction = parsed && parsed.llm_extraction ? parsed.llm_extraction : null;

  const result = normalizeCalendarRequestDeterministic({
    ...input,
    raw_text: loaded.raw_text,
    timezone: loaded.timezone,
    clarification_turns: loaded.clarification_turns,
    llm_extraction: llmExtraction,
  });

  return {
    validated: result,
  };
}

function writeLogNode(state) {
  const validated = state && state.validated ? state.validated : null;
  const llm = state && state.llm ? state.llm : {};
  const parsed = state && state.parsed ? state.parsed : {};
  const extraction = parsed && parsed.llm_extraction ? parsed.llm_extraction : null;

  return {
    output: validated,
    trace: {
      llm_used: llm.skipped === true ? false : true,
      llm_reason: text(llm.reason) || null,
      llm_model: text(llm.model) || null,
      llm_error: text(llm.error) || null,
      parse_status: text(parsed.parse_status) || null,
      parse_error: text(parsed.parse_error) || null,
      llm_confidence: extraction ? extraction.confidence : null,
      llm_has_candidate: !!extraction,
      status: text(validated && validated.status) || null,
    },
  };
}

async function getLangGraphModule() {
  if (!langGraphModulePromise) {
    langGraphModulePromise = import('@langchain/langgraph').catch((err) => {
      throw new Error(`Failed to load @langchain/langgraph: ${err.message}`);
    });
  }
  return langGraphModulePromise;
}

async function buildCompiledGraph() {
  const langGraphModule = await getLangGraphModule();
  const resolvedModule = (
    langGraphModule &&
    langGraphModule.default &&
    (
      langGraphModule.default.StateGraph ||
      langGraphModule.default.START ||
      langGraphModule.default.END
    )
  )
    ? langGraphModule.default
    : langGraphModule;

  const { StateGraph, START, END } = resolvedModule;
  if (!StateGraph || !START || !END) {
    throw new Error('Invalid @langchain/langgraph module: missing StateGraph/START/END exports');
  }

  const createStateGraph = () => {
    const channels = createDefaultChannels();
    try {
      return new StateGraph({ channels });
    } catch (channelsErr) {
      const Annotation = resolvedModule && resolvedModule.Annotation;
      if (!Annotation || typeof Annotation.Root !== 'function') {
        throw channelsErr;
      }
      const annotationShape = {};
      for (const key of Object.keys(channels)) {
        annotationShape[key] = Annotation();
      }
      return new StateGraph(Annotation.Root(annotationShape));
    }
  };

  return createStateGraph()
    .addNode('n_load', withNodeLogging('load', loadNode))
    .addNode('n_prompt', withNodeLogging('prompt', promptNode))
    .addNode('n_llm', withNodeLogging('llm', llmNode))
    .addNode('n_parse', withNodeLogging('parse', parseNode))
    .addNode('n_validate', withNodeLogging('validate', validateNode))
    .addNode('n_write_log', withNodeLogging('write_log', writeLogNode))
    .addEdge(START, 'n_load')
    .addEdge('n_load', 'n_prompt')
    .addEdge('n_prompt', 'n_llm')
    .addEdge('n_llm', 'n_parse')
    .addEdge('n_parse', 'n_validate')
    .addEdge('n_validate', 'n_write_log')
    .addEdge('n_write_log', END)
    .compile();
}

async function getCompiledGraph() {
  if (!compiledGraphPromise) {
    compiledGraphPromise = buildCompiledGraph();
  }
  return compiledGraphPromise;
}

function shouldFallbackToSequential(err) {
  const msg = text(err && err.message).toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('experimental-vm-modules') ||
    msg.includes('failed to load @langchain/langgraph')
  );
}

async function invokeSequential(initialState) {
  const nodes = [
    withNodeLogging('load', loadNode),
    withNodeLogging('prompt', promptNode),
    withNodeLogging('llm', llmNode),
    withNodeLogging('parse', parseNode),
    withNodeLogging('validate', validateNode),
    withNodeLogging('write_log', writeLogNode),
  ];
  let state = { ...(initialState || {}) };
  for (const node of nodes) {
    const patch = await node(state);
    state = { ...state, ...(patch || {}) };
  }
  return state;
}

async function runCalendarExtractionGraphWithTrace(input, options) {
  const ctx = getRunContext() || {};
  const initialState = {
    input: input || {},
    options: {
      ...(options || {}),
      run_id: (options && options.run_id) || ctx.run_id || null,
    },
  };

  let state;
  try {
    const graph = await getCompiledGraph();
    state = await graph.invoke(initialState);
  } catch (err) {
    if (!shouldFallbackToSequential(err)) throw err;
    state = await invokeSequential(initialState);
  }

  return {
    result: state && state.output ? state.output : null,
    trace: state && state.trace ? state.trace : null,
  };
}

async function runCalendarExtractionGraph(input, options) {
  const out = await runCalendarExtractionGraphWithTrace(input, options);
  return out && out.result ? out.result : null;
}

module.exports = {
  runCalendarExtractionGraph,
  runCalendarExtractionGraphWithTrace,
};
