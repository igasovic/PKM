'use strict';

const { getConfig } = require('../../libs/config.js');
const { LiteLLMClient } = require('../litellm-client.js');
const { getLogger } = require('../logger/index.js');
const { getRunContext } = require('../logger/context.js');
const { classifyByRules } = require('./routing.rules.js');
const { buildRoutingSystemPrompt, buildRoutingUserPrompt } = require('./routing.prompt.js');
const { parseRoutingLlmResult } = require('./routing.schema.js');

const DEFAULT_ROUTING_MODEL = 'gpt-5-nano';

let langGraphModulePromise = null;
let compiledGraphPromise = null;
let litellmClient = null;

function text(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function buildClarificationQuestion() {
  return 'Should I save this as a note or add it to the family calendar?';
}

function getRoutingModel(options) {
  const model = text(options && options.model) || DEFAULT_ROUTING_MODEL;
  return model;
}

function hasLiteLlmKey() {
  return text(process.env.LITELLM_MASTER_KEY).length > 0;
}

function getLiteLLMClient() {
  if (litellmClient) return litellmClient;
  litellmClient = new LiteLLMClient({});
  return litellmClient;
}

function createDefaultChannels() {
  return {
    input: null,
    options: null,
    loaded: null,
    rule: null,
    llm: null,
    parsed: null,
    output: null,
    trace: null,
  };
}

function logNodeInput(state) {
  return {
    has_input: !!(state && state.input),
    rule_id: state && state.rule && state.rule.rule_id ? state.rule.rule_id : null,
    llm_skipped: !!(state && state.llm && state.llm.skipped),
  };
}

function withNodeLogging(nodeName, fn) {
  return async (state) => {
    const logger = getLogger().child({
      pipeline: 'langgraph.telegram_routing',
      meta: { node: nodeName },
    });

    return logger.step(
      `langgraph.telegram_routing.${nodeName}`,
      async () => fn(state || {}),
      {
        input: logNodeInput(state || {}),
        output: (out) => out,
        meta: { graph: 'telegram_routing', node: nodeName },
      }
    );
  };
}

function loadNode(state) {
  const input = state && typeof state.input === 'object' ? state.input : {};
  const options = state && typeof state.options === 'object' ? state.options : {};
  const rawText = text(input.text || input.raw_text || input.message_text);
  if (!rawText) throw new Error('text is required');

  const cfg = getConfig();
  const prefixes = cfg && cfg.calendar && cfg.calendar.prefixes ? cfg.calendar.prefixes : { calendar: 'cal:', pkm: 'pkm:' };

  return {
    loaded: {
      raw_text: rawText,
      prefixes,
    },
    options,
  };
}

function ruleGateNode(state) {
  const loaded = state && state.loaded ? state.loaded : {};
  const result = classifyByRules(
    { text: loaded.raw_text },
    { prefixes: loaded.prefixes }
  );
  return {
    rule: result,
  };
}

async function llmRouteIfNeededNode(state) {
  const rule = state && state.rule ? state.rule : {};
  if (rule.resolved) {
    return {
      llm: {
        skipped: true,
        reason: 'rule_resolved',
      },
    };
  }

  if (!hasLiteLlmKey()) {
    return {
      llm: {
        skipped: true,
        reason: 'litellm_not_configured',
      },
    };
  }

  const options = state && state.options ? state.options : {};
  const model = getRoutingModel(options);
  const prompt = buildRoutingUserPrompt({ text: state.loaded && state.loaded.raw_text });

  try {
    const client = getLiteLLMClient();
    const res = await client.sendMessage(prompt, {
      model,
      systemPrompt: buildRoutingSystemPrompt(),
      metadata: {
        pipeline: 'telegram_routing',
        stage: 'llm_route_if_needed',
      },
    });

    return {
      llm: {
        skipped: false,
        reason: null,
        model,
        text: text(res && res.text),
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

function parseRouteResultNode(state) {
  const rule = state && state.rule ? state.rule : {};
  if (rule.resolved) {
    const output = {
      route: rule.route,
      confidence: Number(rule.confidence || 0),
    };
    if (rule.route === 'ambiguous') {
      output.clarification_question = buildClarificationQuestion();
    }
    return {
      parsed: {
        ...output,
        route_source: 'rule',
      },
    };
  }

  const llm = state && state.llm ? state.llm : {};
  if (!llm.skipped && text(llm.text)) {
    try {
      const parsed = parseRoutingLlmResult(llm.text);
      return {
        parsed: {
          ...parsed,
          route_source: 'llm',
        },
      };
    } catch (_err) {
      // Keep fallback behavior below.
    }
  }

  const signals = rule && rule.signals && typeof rule.signals === 'object' ? rule.signals : {};
  if (signals.querySignal && signals.createSignal) {
    return {
      parsed: {
        route: 'ambiguous',
        confidence: 0.5,
        clarification_question: buildClarificationQuestion(),
        route_source: 'fallback_ambiguous',
      },
    };
  }

  return {
    parsed: {
      route: 'pkm_capture',
      confidence: 0.62,
      clarification_question: null,
      route_source: 'fallback_pkm_capture',
    },
  };
}

function writeLogNode(state) {
  const parsed = state && state.parsed ? state.parsed : {};
  const llm = state && state.llm ? state.llm : {};
  const rule = state && state.rule ? state.rule : {};

  const output = {
    route: text(parsed.route),
    confidence: Number(parsed.confidence || 0),
  };
  if (parsed.route === 'ambiguous') {
    output.clarification_question = text(parsed.clarification_question) || buildClarificationQuestion();
  }

  return {
    output,
    trace: {
      route_source: text(parsed.route_source) || null,
      rule_id: text(rule.rule_id) || null,
      llm_used: llm.skipped === true ? false : true,
      llm_reason: text(llm.reason) || null,
      llm_model: text(llm.model) || null,
      llm_error: text(llm.error) || null,
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
    .addNode('n_rule_gate', withNodeLogging('rule_gate', ruleGateNode))
    .addNode('n_llm_route_if_needed', withNodeLogging('llm_route_if_needed', llmRouteIfNeededNode))
    .addNode('n_parse_route_result', withNodeLogging('parse_route_result', parseRouteResultNode))
    .addNode('n_write_log', withNodeLogging('write_log', writeLogNode))
    .addEdge(START, 'n_load')
    .addEdge('n_load', 'n_rule_gate')
    .addEdge('n_rule_gate', 'n_llm_route_if_needed')
    .addEdge('n_llm_route_if_needed', 'n_parse_route_result')
    .addEdge('n_parse_route_result', 'n_write_log')
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
    withNodeLogging('rule_gate', ruleGateNode),
    withNodeLogging('llm_route_if_needed', llmRouteIfNeededNode),
    withNodeLogging('parse_route_result', parseRouteResultNode),
    withNodeLogging('write_log', writeLogNode),
  ];
  let state = { ...(initialState || {}) };
  for (const node of nodes) {
    const patch = await node(state);
    state = { ...state, ...(patch || {}) };
  }
  return state;
}

async function runRoutingGraphWithTrace(input, options) {
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

async function runRoutingGraph(input, options) {
  const out = await runRoutingGraphWithTrace(input, options);
  return out && out.result ? out.result : null;
}

module.exports = {
  runRoutingGraph,
  runRoutingGraphWithTrace,
  classifyByRules,
};
