'use strict';
const { getConfig } = require('../../libs/config.js');
const { LiteLLMClient, extractResponseText } = require('../litellm-client.js');
const { buildRetrievalForDb } = require('../quality.js');
const { getBraintrustLogger } = require('../observability.js');
const { getVerbossLogger } = require('./verboss-logger.js');
const {
  parseTier1Json,
  buildTier1Prompt,
  toTier1Response,
  buildBatchRequests,
  parseJsonl,
  mapBatchLineToResult,
  mergeResultRows,
} = require('./domain.js');
const {
  TERMINAL_BATCH_STATUSES,
  getActiveSchema,
  upsertBatchRow,
  upsertBatchItems,
  upsertBatchResults,
  readBatchSummary,
  findBatchRecord,
  getBatchItemRequests,
} = require('./store.js');

let litellmClient = null;
let langGraphModulePromise = null;
let compiledGraphsPromise = null;

function getLiteLLMClient() {
  if (litellmClient) return litellmClient;
  litellmClient = new LiteLLMClient({});
  return litellmClient;
}

function createDefaultChannels() {
  return {
    flow: null,
    input: null,
    options: null,
    batch_id: null,
    loaded: null,
    prompt: null,
    llm: null,
    parsed: null,
    output: null,
  };
}

function nodeErrorInfo(err) {
  return {
    name: err && err.name,
    message: err && err.message,
    stack: err && err.stack,
  };
}

function logNodeError(graph, node, state, err) {
  try {
    getBraintrustLogger().log({
      input: {
        graph,
        node,
        flow: state && state.flow,
        batch_id: state && (state.batch_id || (state.loaded && state.loaded.batch_id) || null),
      },
      error: nodeErrorInfo(err),
      metadata: {
        source: 't1_graph',
      },
    });
  } catch (_err) {
    // Keep node failures visible to callers even if logging fails.
  }
}

function withNodeErrorLogging(graphName, nodeName, fn) {
  return async (state) => {
    try {
      return await fn(state || {});
    } catch (err) {
      logNodeError(graphName, nodeName, state || {}, err);
      throw err;
    }
  };
}

function toBatchFailureInfo(remoteBatch) {
  if (!remoteBatch || typeof remoteBatch !== 'object') return null;
  return {
    status: remoteBatch.status || null,
    errors: remoteBatch.errors || null,
    error: remoteBatch.error || null,
    failed_at: remoteBatch.failed_at || null,
    completed_at: remoteBatch.completed_at || null,
    output_file_id: remoteBatch.output_file_id || null,
    error_file_id: remoteBatch.error_file_id || null,
  };
}

function toEntitySecondaryTopicPairs(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const customId = String((row && row.custom_id) || '').trim();
    const match = customId.match(/^entry_(\d+)$/);
    const entityId = match ? match[1] : customId || null;
    const topicSecondary = row && row.parsed && row.parsed.topic_secondary
      ? String(row.parsed.topic_secondary)
      : null;
    return [entityId, topicSecondary];
  });
}

function syncLoadNode(state) {
  const payload = (state && state.input) || {};
  const clean_text = payload.clean_text ?? '';
  if (!String(clean_text).trim()) {
    throw new Error('enrich/t1 requires clean_text');
  }
  return {
    loaded: {
      title: payload.title ?? null,
      author: payload.author ?? null,
      content_type: payload.content_type ?? 'other',
      clean_text,
    },
  };
}

function syncPromptNode(state) {
  return {
    prompt: buildTier1Prompt(state.loaded || {}),
  };
}

async function syncLlmNode(state) {
  const client = getLiteLLMClient();
  const llmOptions = state && state.options ? state.options.llm : undefined;
  const { response } = await client.sendMessage(state.prompt && state.prompt.prompt, llmOptions);
  return {
    llm: {
      response,
      text: extractResponseText(response),
    },
  };
}

function parseNode(state) {
  const flow = String(state && state.flow ? state.flow : '');
  if (flow === 'sync') {
    return {
      parsed: {
        t1: parseTier1Json(state.llm && state.llm.text),
      },
    };
  }

  if (flow === 'batch_collect') {
    const rows = [];
    if (state.llm && state.llm.output_text) {
      rows.push(
        ...parseJsonl(state.llm.output_text)
          .map(mapBatchLineToResult)
          .filter(Boolean)
      );
    }
    if (state.llm && state.llm.error_text) {
      rows.push(
        ...parseJsonl(state.llm.error_text)
          .map(mapBatchLineToResult)
          .filter(Boolean)
      );
    }

    return {
      parsed: {
        rows: mergeResultRows(rows),
      },
    };
  }

  throw new Error(`unsupported parse flow: ${flow || 'unknown'}`);
}

function syncWriteNode(state) {
  const loaded = state.loaded || {};
  const config = getConfig();
  const quality = buildRetrievalForDb({
    capture_text: loaded.clean_text,
    content_type: loaded.content_type || 'other',
    extracted_text: '',
    url_canonical: null,
    url: null,
    config,
    excerpt_override: null,
    excerpt_source: loaded.clean_text,
    quality_source_text: loaded.clean_text,
  });
  return {
    output: toTier1Response(state.parsed.t1, quality),
  };
}

function batchScheduleLoadNode(state) {
  const input = (state && state.input) || {};
  return {
    loaded: {
      items: Array.isArray(input.items) ? input.items : [],
      options: (state && state.options) || {},
    },
  };
}

function batchSchedulePromptNode(state) {
  return {
    prompt: {
      requests: buildBatchRequests(state.loaded.items),
    },
  };
}

async function batchScheduleLlmNode(state) {
  const client = getLiteLLMClient();
  const { batch, input_file_id } = await client.createBatch(
    state.prompt.requests,
    state.loaded.options
  );
  return {
    llm: {
      batch,
      input_file_id,
    },
  };
}

function batchScheduleParseNode(state) {
  const batch = state.llm && state.llm.batch;
  if (!batch || !batch.id) {
    throw new Error('LiteLLM batch create returned no batch id');
  }
  return {
    parsed: {
      batch,
      request_count: state.prompt.requests.length,
    },
  };
}

async function batchScheduleWriteNode(state) {
  const schema = await getActiveSchema();
  const batch = state.parsed.batch;
  const requestCount = state.parsed.request_count;

  await upsertBatchRow(
    schema,
    batch,
    requestCount,
    {
      request_count: requestCount,
      created_via: 'api',
    }
  );
  await upsertBatchItems(schema, batch.id, state.prompt.requests);

  return {
    output: {
      batch_id: batch.id,
      status: batch.status,
      schema,
      request_count: requestCount,
    },
  };
}

async function batchCollectLoadNode(state) {
  const id = String((state && (state.batch_id || (state.input && state.input.batch_id))) || '').trim();
  if (!id) throw new Error('batch_id is required');

  const found = await findBatchRecord(id);
  if (!found) {
    throw new Error(`batch_id not found: ${id}`);
  }

  return {
    loaded: {
      batch_id: id,
      schema: found.schema,
      local_batch: found.batch,
    },
  };
}

function batchCollectPromptNode(state) {
  return {
    prompt: {
      batch_id: state.loaded.batch_id,
    },
  };
}

async function batchCollectLlmNode(state) {
  const client = getLiteLLMClient();
  const remoteBatch = await client.retrieveBatch(state.prompt.batch_id);

  let output_text = null;
  let error_text = null;
  if (remoteBatch.output_file_id) {
    output_text = await client.getFileContent(remoteBatch.output_file_id);
  }
  if (remoteBatch.error_file_id) {
    error_text = await client.getFileContent(remoteBatch.error_file_id);
  }

  return {
    llm: {
      remote_batch: remoteBatch,
      output_text,
      error_text,
    },
  };
}

async function batchCollectWriteNode(state) {
  const schema = state.loaded.schema;
  const batchId = state.loaded.batch_id;
  const remoteBatch = state.llm.remote_batch;
  const localBatch = state.loaded.local_batch || {};
  const localMetadata = (
    localBatch &&
    localBatch.metadata &&
    typeof localBatch.metadata === 'object' &&
    !Array.isArray(localBatch.metadata)
  )
    ? localBatch.metadata
    : {};
  let retryInfo = null;

  await upsertBatchRow(
    schema,
    remoteBatch,
    localBatch.request_count || 0,
    localMetadata
  );

  const normalizedStatus = String(remoteBatch.status || '').trim().toLowerCase();
  const isFailed = normalizedStatus === 'failed';
  if (isFailed) {
    const alreadyRetried = !!localMetadata.auto_retry_spawned_batch_id;
    if (!alreadyRetried) {
      try {
        const requests = await getBatchItemRequests(schema, batchId);
        if (requests.length > 0) {
          const client = getLiteLLMClient();
          const { batch: retryBatch } = await client.createBatch(requests, {
            completion_window: '24h',
            metadata: {
              retry_of_batch_id: batchId,
              retry_source: 'batch_collect_auto_retry',
            },
          });
          const retryMetadata = {
            ...localMetadata,
            auto_retry_spawned_batch_id: retryBatch.id,
            auto_retry_spawned_at: new Date().toISOString(),
          };
          await upsertBatchRow(
            schema,
            remoteBatch,
            localBatch.request_count || requests.length,
            retryMetadata
          );
          await upsertBatchRow(
            schema,
            retryBatch,
            requests.length,
            {
              request_count: requests.length,
              created_via: 'auto_retry',
              retry_of_batch_id: batchId,
            }
          );
          await upsertBatchItems(schema, retryBatch.id, requests);
          retryInfo = {
            spawned: true,
            retry_batch_id: retryBatch.id,
            request_count: requests.length,
          };
        }
      } catch (retryErr) {
        getBraintrustLogger().log({
          input: {
            batch_id: batchId,
            schema,
          },
          error: nodeErrorInfo(retryErr),
          metadata: {
            source: 't1_batch_collect',
            event: 'auto_retry_failed',
          },
        });
      }
    }
  }

  const updated_items = await upsertBatchResults(schema, batchId, state.parsed.rows || []);
  const summary = await readBatchSummary(schema, batchId);
  getBraintrustLogger().log({
    input: {
      batch_id: batchId,
      schema,
    },
    output: {
      status: remoteBatch.status || null,
      updated_items,
      summary,
      retry: retryInfo,
      failure: isFailed ? toBatchFailureInfo(remoteBatch) : null,
      consumed_entries: toEntitySecondaryTopicPairs(state.parsed.rows || []),
    },
    metadata: {
      source: 't1_batch_collect',
      event: isFailed ? 'consume_failed' : 'consume',
    },
  });
  try {
    await getVerbossLogger().logConsumeEntry({
      batch_id: batchId,
      timestamp: new Date().toISOString(),
      result: remoteBatch.status || null,
      entries: toEntitySecondaryTopicPairs(state.parsed.rows || []),
    });
  } catch (err) {
    getBraintrustLogger().log({
      input: {
        batch_id: batchId,
        schema,
      },
      error: nodeErrorInfo(err),
      metadata: {
        source: 'verboss_logger',
        event: 'consume_entry_log_failed',
      },
    });
  }

  return {
    output: {
      batch_id: batchId,
      schema,
      status: remoteBatch.status,
      terminal: TERMINAL_BATCH_STATUSES.has(String(remoteBatch.status || '').toLowerCase()),
      updated_items,
      summary,
      retry: retryInfo,
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

async function buildCompiledGraphs() {
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

  const syncGraph = createStateGraph()
    .addNode('n_load', withNodeErrorLogging('sync_enrichment', 'load', syncLoadNode))
    .addNode('n_prompt', withNodeErrorLogging('sync_enrichment', 'prompt', syncPromptNode))
    .addNode('n_llm', withNodeErrorLogging('sync_enrichment', 'llm', syncLlmNode))
    .addNode('n_parse', withNodeErrorLogging('sync_enrichment', 'parse', parseNode))
    .addNode('n_write', withNodeErrorLogging('sync_enrichment', 'write', syncWriteNode))
    .addEdge(START, 'n_load')
    .addEdge('n_load', 'n_prompt')
    .addEdge('n_prompt', 'n_llm')
    .addEdge('n_llm', 'n_parse')
    .addEdge('n_parse', 'n_write')
    .addEdge('n_write', END)
    .compile();

  const batchScheduleGraph = createStateGraph()
    .addNode('n_load', withNodeErrorLogging('batch_schedule', 'load', batchScheduleLoadNode))
    .addNode('n_prompt', withNodeErrorLogging('batch_schedule', 'prompt', batchSchedulePromptNode))
    .addNode('n_llm', withNodeErrorLogging('batch_schedule', 'llm', batchScheduleLlmNode))
    .addNode('n_parse', withNodeErrorLogging('batch_schedule', 'parse', batchScheduleParseNode))
    .addNode('n_write', withNodeErrorLogging('batch_schedule', 'write', batchScheduleWriteNode))
    .addEdge(START, 'n_load')
    .addEdge('n_load', 'n_prompt')
    .addEdge('n_prompt', 'n_llm')
    .addEdge('n_llm', 'n_parse')
    .addEdge('n_parse', 'n_write')
    .addEdge('n_write', END)
    .compile();

  const batchCollectGraph = createStateGraph()
    .addNode('n_load', withNodeErrorLogging('batch_collect', 'load', batchCollectLoadNode))
    .addNode('n_prompt', withNodeErrorLogging('batch_collect', 'prompt', batchCollectPromptNode))
    .addNode('n_llm', withNodeErrorLogging('batch_collect', 'llm', batchCollectLlmNode))
    .addNode('n_parse', withNodeErrorLogging('batch_collect', 'parse', parseNode))
    .addNode('n_write', withNodeErrorLogging('batch_collect', 'write', batchCollectWriteNode))
    .addEdge(START, 'n_load')
    .addEdge('n_load', 'n_prompt')
    .addEdge('n_prompt', 'n_llm')
    .addEdge('n_llm', 'n_parse')
    .addEdge('n_parse', 'n_write')
    .addEdge('n_write', END)
    .compile();

  return {
    syncGraph,
    batchScheduleGraph,
    batchCollectGraph,
  };
}

async function getCompiledGraphs() {
  if (!compiledGraphsPromise) {
    compiledGraphsPromise = buildCompiledGraphs();
  }
  return compiledGraphsPromise;
}

async function runSyncEnrichmentGraph(input, options) {
  const { syncGraph } = await getCompiledGraphs();
  const state = await syncGraph.invoke({
    flow: 'sync',
    input: input || {},
    options: options || {},
  });
  return state.output;
}

async function runBatchScheduleGraph(items, options) {
  const { batchScheduleGraph } = await getCompiledGraphs();
  const state = await batchScheduleGraph.invoke({
    flow: 'batch_schedule',
    input: { items: Array.isArray(items) ? items : [] },
    options: options || {},
  });
  return state.output;
}

async function runBatchCollectGraph(batchId, options) {
  const { batchCollectGraph } = await getCompiledGraphs();
  const state = await batchCollectGraph.invoke({
    flow: 'batch_collect',
    batch_id: batchId,
    options: options || {},
  });
  return state.output;
}

module.exports = {
  runSyncEnrichmentGraph,
  runBatchScheduleGraph,
  runBatchCollectGraph,
};
