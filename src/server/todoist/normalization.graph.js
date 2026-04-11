'use strict';

const { LiteLLMClient } = require('../litellm-client.js');
const { hasLiteLLMKey } = require('../runtime-env.js');
const { getLogger } = require('../logger/index.js');
const { asText } = require('./constants.js');
const {
  parseNormalizationLlmResult,
  buildFallbackNormalization,
  cleanupNormalization,
} = require('./normalization.schema.js');
const {
  buildNormalizationSystemPrompt,
  buildNormalizationUserPrompt,
} = require('./normalization.prompt.js');

const DEFAULT_MODEL = 'pkm-default';

let langGraphModulePromise = null;
let compiledGraphPromise = null;
let litellmClient = null;

function hasLiteLlmKey() {
  return hasLiteLLMKey();
}

function getLiteLLMClient() {
  if (litellmClient) return litellmClient;
  litellmClient = new LiteLLMClient({});
  return litellmClient;
}

function getModel(options) {
  return asText(options && options.model) || DEFAULT_MODEL;
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

function withNodeLogging(nodeName, fn) {
  return async (state) => {
    const logger = getLogger().child({
      pipeline: 'langgraph.todoist_normalization',
      meta: { node: nodeName },
    });

    return logger.step(
      `langgraph.todoist_normalization.${nodeName}`,
      async () => fn(state || {}),
      {
        input: {
          has_input: !!(state && state.input),
          llm_skipped: !!(state && state.llm && state.llm.skipped),
          parse_status: asText(state && state.parsed && state.parsed.parse_status) || null,
        },
        output: (out) => out,
        meta: { graph: 'todoist_normalization', node: nodeName },
      }
    );
  };
}

function loadNode(state) {
  const input = state && typeof state.input === 'object' ? state.input : {};
  const options = state && typeof state.options === 'object' ? state.options : {};
  const rawTitle = asText(input.raw_title);
  if (!rawTitle) {
    throw new Error('raw_title is required');
  }
  return {
    options,
    loaded: {
      raw_title: rawTitle,
      raw_description: asText(input.raw_description) || null,
      project_key: asText(input.project_key) || null,
      todoist_section_name: asText(input.todoist_section_name) || null,
      lifecycle_status: asText(input.lifecycle_status) || 'open',
    },
  };
}

function promptNode(state) {
  const loaded = state && state.loaded ? state.loaded : {};
  return {
    prompt: {
      system: buildNormalizationSystemPrompt(),
      user: buildNormalizationUserPrompt(loaded),
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

  const prompt = state && state.prompt ? state.prompt : {};
  const options = state && state.options ? state.options : {};

  try {
    const client = getLiteLLMClient();
    const response = await client.sendMessage(prompt.user, {
      model: getModel(options),
      systemPrompt: prompt.system,
      metadata: {
        pipeline: 'todoist_planning',
        stage: 'normalize',
      },
    });

    return {
      llm: {
        skipped: false,
        reason: null,
        model: getModel(options),
        text: asText(response && response.text),
      },
    };
  } catch (err) {
    return {
      llm: {
        skipped: true,
        reason: 'llm_error',
        error: asText(err && err.message) || 'llm_error',
      },
    };
  }
}

function parseNode(state) {
  const llm = state && state.llm ? state.llm : {};
  if (llm.skipped || !asText(llm.text)) {
    return {
      parsed: {
        parse_status: llm.skipped ? 'skipped' : 'empty',
        llm_result: null,
      },
    };
  }

  try {
    return {
      parsed: {
        parse_status: 'parsed',
        llm_result: parseNormalizationLlmResult(llm.text),
      },
    };
  } catch (err) {
    return {
      parsed: {
        parse_status: 'parse_error',
        parse_error: asText(err && err.message) || 'parse_error',
        llm_result: null,
      },
    };
  }
}

function validateNode(state) {
  const loaded = state && state.loaded ? state.loaded : {};
  const parsed = state && state.parsed ? state.parsed : {};
  const llmResult = parsed && parsed.llm_result ? parsed.llm_result : null;

  if (!llmResult) {
    return {
      validated: buildFallbackNormalization(loaded, parsed.parse_status || 'no_llm_result'),
    };
  }

  return {
    validated: cleanupNormalization(loaded, llmResult),
  };
}

function writeLogNode(state) {
  const parsed = state && state.parsed ? state.parsed : {};
  const llm = state && state.llm ? state.llm : {};
  const validated = state && state.validated ? state.validated : buildFallbackNormalization({}, 'missing_validated');

  return {
    output: validated,
    trace: {
      llm_used: llm.skipped === true ? false : true,
      llm_reason: asText(llm.reason) || null,
      llm_model: asText(llm.model) || null,
      llm_error: asText(llm.error) || null,
      parse_status: asText(parsed.parse_status) || null,
      parse_error: asText(parsed.parse_error) || null,
      parse_failed: validated.parse_failed === true,
      task_shape: asText(validated.task_shape) || null,
      parse_confidence: Number.isFinite(Number(validated.parse_confidence)) ? Number(validated.parse_confidence) : null,
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
    langGraphModule
    && langGraphModule.default
    && (
      langGraphModule.default.StateGraph
      || langGraphModule.default.START
      || langGraphModule.default.END
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
  const msg = asText(err && err.message).toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('experimental-vm-modules')
    || msg.includes('failed to load @langchain/langgraph')
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

  let state = { ...createDefaultChannels(), ...initialState };
  for (const node of nodes) {
    const patch = await node(state);
    state = { ...state, ...(patch || {}) };
  }
  return state;
}

async function runTodoistNormalizationGraphWithTrace(input, options = {}) {
  const initialState = {
    ...createDefaultChannels(),
    input,
    options,
  };

  let finalState;
  try {
    const graph = await getCompiledGraph();
    finalState = await graph.invoke(initialState);
  } catch (err) {
    if (!shouldFallbackToSequential(err)) throw err;
    finalState = await invokeSequential(initialState);
  }

  const result = finalState && finalState.output ? finalState.output : null;
  if (!result) {
    throw new Error('todoist normalization graph returned empty result');
  }

  return {
    result,
    trace: finalState.trace || null,
  };
}

async function runTodoistNormalizationGraph(input, options = {}) {
  const out = await runTodoistNormalizationGraphWithTrace(input, options);
  return out.result;
}

module.exports = {
  runTodoistNormalizationGraph,
  runTodoistNormalizationGraphWithTrace,
};
