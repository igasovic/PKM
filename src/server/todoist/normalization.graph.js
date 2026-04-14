'use strict';

const { getLogger } = require('../logger/index.js');
const { asText } = require('./constants.js');
const { buildFallbackNormalization } = require('./normalization.schema.js');
const { runNormalizeTaskAgent } = require('./agents/normalize-task-agent.js');

let langGraphModulePromise = null;
let compiledGraphPromise = null;

function createDefaultChannels() {
  return {
    input: null,
    options: null,
    loaded: null,
    agent_run: null,
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
          parse_status: asText(state && state.trace && state.trace.parse_status) || null,
        },
        output: (out) => out,
        meta: { graph: 'todoist_normalization', node: nodeName },
      }
    );
  };
}

function loadNode(state) {
  const input = state && typeof state.input === 'object' ? state.input : {};
  const rawTitle = asText(input.raw_title);
  if (!rawTitle) {
    throw new Error('raw_title is required');
  }

  return {
    options: state && typeof state.options === 'object' ? state.options : {},
    loaded: {
      raw_title: rawTitle,
      raw_description: asText(input.raw_description) || null,
      project_key: asText(input.project_key) || null,
      todoist_section_name: asText(input.todoist_section_name) || null,
      lifecycle_status: asText(input.lifecycle_status) || 'open',
      has_subtasks: input.has_subtasks === true,
      explicit_project_signal: input.explicit_project_signal === true,
      few_shot_examples: Array.isArray(input.few_shot_examples) ? input.few_shot_examples : [],
    },
  };
}

async function agentNode(state) {
  const loaded = state && state.loaded ? state.loaded : {};
  const options = state && state.options ? state.options : {};
  const agentRun = await runNormalizeTaskAgent(loaded, options);
  return {
    agent_run: agentRun,
  };
}

function writeLogNode(state) {
  const loaded = state && state.loaded ? state.loaded : {};
  const agentRun = state && state.agent_run ? state.agent_run : {};
  const result = agentRun && agentRun.result
    ? agentRun.result
    : buildFallbackNormalization(loaded, 'missing_agent_output');
  const trace = agentRun && agentRun.trace ? agentRun.trace : {
    llm_used: false,
    llm_reason: 'missing_agent_output',
    parse_status: 'skipped',
  };

  return {
    output: result,
    trace,
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
    .addNode('n_agent', withNodeLogging('agent', agentNode))
    .addNode('n_write_log', withNodeLogging('write_log', writeLogNode))
    .addEdge(START, 'n_load')
    .addEdge('n_load', 'n_agent')
    .addEdge('n_agent', 'n_write_log')
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
    withNodeLogging('agent', agentNode),
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
