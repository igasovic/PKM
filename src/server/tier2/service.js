'use strict';

const db = require('../db.js');
const { getConfig } = require('../../libs/config.js');
const { LiteLLMClient } = require('../litellm-client.js');
const { getLogger } = require('../logger/index.js');
const { resolveTier2Route } = require('./control-plane.js');
const { chunkTextForTier2 } = require('./chunking.js');
const {
  buildDirectDistillPrompt,
  buildChunkNotePrompt,
  buildFinalSynthesisPrompt,
} = require('./prompts.js');
const {
  parseTier2FinalOutput,
  parseTier2ChunkNoteOutput,
  buildTier2Artifact,
  validateTier2Artifact,
} = require('./parsing-validation.js');

let litellmClient = null;

function getLiteLLMClient() {
  if (litellmClient) return litellmClient;
  litellmClient = new LiteLLMClient({});
  return litellmClient;
}

function getDistillConfig() {
  const cfg = getConfig();
  return cfg && cfg.distill ? cfg.distill : {};
}

function getModelForRequestType(distillConfig, requestType) {
  const models = distillConfig && distillConfig.models ? distillConfig.models : {};
  if (requestType === 'chunk_note_generation') {
    return models.chunk_note || models.direct || process.env.T2_MODEL_CHUNK_NOTE || process.env.T2_MODEL_DIRECT || 't2-direct';
  }
  if (requestType === 'final_synthesis') {
    return models.synthesis || models.direct || process.env.T2_MODEL_SYNTHESIS || process.env.T2_MODEL_DIRECT || 't2-direct';
  }
  if (requestType === 'sync_direct_generation') {
    return models.sync_direct || models.direct || process.env.T2_MODEL_SYNC_DIRECT || process.env.T2_MODEL_DIRECT || 't2-direct';
  }
  return models.direct || process.env.T2_MODEL_DIRECT || 't2-direct';
}

function normalizeEntryId(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('entry_id must be a positive integer');
  }
  return Math.trunc(n);
}

function parseRetryCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.trunc(n);
}

async function requestStructuredOutput({
  requestType,
  systemPrompt,
  userPrompt,
  metadata,
  logger,
}) {
  const distillConfig = getDistillConfig();
  const model = getModelForRequestType(distillConfig, requestType);
  const client = getLiteLLMClient();
  const meta = metadata && typeof metadata === 'object' ? metadata : {};

  const result = await logger.step(
    `t2.sync.llm.${requestType}`,
    async () => client.sendMessage(userPrompt, {
      model,
      systemPrompt,
      metadata: {
        stage: 'distill',
        ...meta,
      },
    }),
    {
      input: {
        request_type: requestType,
        model,
        prompt_chars: String(userPrompt || '').length,
      },
      output: (out) => ({
        request_type: requestType,
        model,
        response_chars: String((out && out.text) || '').length,
      }),
      meta: {
        stage: 'distill',
        substage: requestType,
        ...meta,
      },
    }
  );

  return {
    model,
    text: result && result.text ? result.text : '',
  };
}

async function generateDirectArtifact(entry, logger) {
  const prompt = buildDirectDistillPrompt(entry);
  const response = await requestStructuredOutput({
    requestType: 'sync_direct_generation',
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    metadata: {
      route: 'direct',
      substage: 'direct_generation',
      entry_id: entry && entry.entry_id,
      clean_word_count: entry && entry.clean_word_count,
    },
    logger,
  });
  const parsed = parseTier2FinalOutput(response.text);
  return {
    raw: parsed,
    model: response.model,
    request_type: prompt.request_type,
    chunking_strategy: 'direct',
    route: 'direct',
    chunk_count: 0,
  };
}

async function generateChunkedArtifact(entry, logger) {
  const chunks = chunkTextForTier2(entry.clean_text, getConfig());
  if (!chunks.length) {
    throw new Error('chunked generation requires non-empty chunks');
  }

  const chunkNotes = [];
  for (const chunk of chunks) {
    const prompt = buildChunkNotePrompt({
      chunk_index: chunk.index,
      chunk_count: chunks.length,
      title: entry.title || null,
      author: entry.author || null,
      chunk_text: chunk.text,
    });
    const response = await requestStructuredOutput({
      requestType: prompt.request_type,
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      metadata: {
        route: 'chunked',
        substage: 'chunk_note_generation',
        entry_id: entry && entry.entry_id,
        clean_word_count: entry && entry.clean_word_count,
        chunk_index: chunk.index,
        chunk_count: chunks.length,
      },
      logger,
    });
    const note = parseTier2ChunkNoteOutput(response.text);
    chunkNotes.push(note);
  }

  const synthesisPrompt = buildFinalSynthesisPrompt({
    title: entry.title || null,
    author: entry.author || null,
    chunk_notes: chunkNotes,
  });

  const synthesisResponse = await requestStructuredOutput({
    requestType: synthesisPrompt.request_type,
    systemPrompt: synthesisPrompt.systemPrompt,
    userPrompt: synthesisPrompt.userPrompt,
    metadata: {
      route: 'chunked',
      substage: 'final_synthesis',
      entry_id: entry && entry.entry_id,
      clean_word_count: entry && entry.clean_word_count,
      chunk_count: chunks.length,
    },
    logger,
  });

  const parsed = parseTier2FinalOutput(synthesisResponse.text);
  return {
    raw: parsed,
    model: synthesisResponse.model,
    request_type: synthesisPrompt.request_type,
    chunking_strategy: 'structure_paragraph_window_v1',
    route: 'chunked',
    chunk_count: chunks.length,
  };
}

function toFailureMetadata(errorCode, details, model, chunkingStrategy, retryCount) {
  return {
    error: {
      code: errorCode || 'generation_error',
      details: details || null,
      at: new Date().toISOString(),
    },
    model: model || null,
    chunking_strategy: chunkingStrategy || null,
    retry_count: parseRetryCount(retryCount),
  };
}

async function persistValidationFailure(entryId, validation, generated, retryCount, logger) {
  await logger.step(
    't2.sync.persist.failed',
    async () => db.persistTier2SyncFailure(entryId, {
      status: 'failed',
      metadata: toFailureMetadata(
        validation && validation.error_code,
        validation && validation.error_details,
        generated && generated.model,
        generated && generated.chunking_strategy,
        retryCount
      ),
    }),
    {
      input: {
        entry_id: entryId,
        error_code: validation && validation.error_code,
      },
      output: (out) => ({ rowCount: out && out.rowCount ? out.rowCount : 0 }),
    }
  );
}

async function persistGenerationFailure(entryId, err, generated, retryCount, logger) {
  await logger.step(
    't2.sync.persist.failed',
    async () => db.persistTier2SyncFailure(entryId, {
      status: 'failed',
      metadata: toFailureMetadata(
        'generation_error',
        { message: err && err.message ? err.message : String(err) },
        generated && generated.model,
        generated && generated.chunking_strategy,
        retryCount
      ),
    }),
    {
      input: { entry_id: entryId },
      output: (out) => ({ rowCount: out && out.rowCount ? out.rowCount : 0 }),
    }
  );
}

async function loadEntryForSync(entryId, logger) {
  const row = await logger.step(
    't2.sync.load_entry',
    async () => db.getTier2SyncEntryByEntryId(entryId),
    {
      input: { entry_id: entryId },
      output: (out) => ({
        found: !!out,
        clean_word_count: out ? out.clean_word_count : null,
        content_type: out ? out.content_type : null,
      }),
    }
  );

  if (!row) {
    const err = new Error(`entry_id not found: ${entryId}`);
    err.statusCode = 404;
    throw err;
  }
  if (!String(row.clean_text || '').trim()) {
    const err = new Error('entry has no usable clean_text');
    err.statusCode = 400;
    throw err;
  }
  return row;
}

async function distillTier2SingleEntrySync(rawEntryId, rawOptions) {
  const entryId = normalizeEntryId(rawEntryId);
  const options = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};
  const retryCount = parseRetryCount(options.retry_count);
  const logger = getLogger().child({
    pipeline: 't2.distill.sync',
    entry_id: entryId,
  });

  const entry = await loadEntryForSync(entryId, logger);
  const routeDecision = resolveTier2Route(entry, getConfig());
  let generated = null;

  await logger.step(
    't2.sync.route_selection',
    async () => routeDecision,
    {
      input: {
        entry_id: entryId,
        clean_word_count: entry.clean_word_count,
      },
      output: (out) => out,
    }
  );

  try {
    generated = routeDecision.route === 'chunked'
      ? await generateChunkedArtifact(entry, logger)
      : await generateDirectArtifact(entry, logger);
  } catch (err) {
    await persistGenerationFailure(entryId, err, generated, retryCount, logger);
    return {
      entry_id: entryId,
      status: 'failed',
      summary: null,
      excerpt: null,
      why_it_matters: null,
      stance: null,
      error_code: 'generation_error',
    };
  }

  const distillConfig = getDistillConfig();
  const artifact = buildTier2Artifact(generated.raw, {
    model: generated.model,
    request_type: generated.request_type,
    chunking_strategy: generated.chunking_strategy,
    content_hash: entry.content_hash,
    distill_version: distillConfig.version || 'distill_v1',
    retry_count: retryCount,
  });

  const validation = await logger.step(
    't2.sync.validate',
    async () => validateTier2Artifact({
      artifact,
      clean_text: entry.clean_text,
      content_hash: entry.content_hash,
    }),
    {
      input: {
        entry_id: entryId,
        route: generated.route,
      },
      output: (out) => out,
    }
  );

  if (!validation.accepted) {
    artifact.distill_metadata = {
      ...(artifact.distill_metadata || {}),
      error: {
        code: validation.error_code,
        details: validation.error_details || null,
        at: new Date().toISOString(),
      },
    };
    await persistValidationFailure(entryId, validation, generated, retryCount, logger);
    return {
      entry_id: entryId,
      status: 'failed',
      summary: null,
      excerpt: null,
      why_it_matters: null,
      stance: null,
      error_code: validation.error_code,
    };
  }

  await logger.step(
    't2.sync.persist.completed',
    async () => db.persistTier2SyncSuccess(entryId, artifact),
    {
      input: {
        entry_id: entryId,
        route: generated.route,
        chunk_count: generated.chunk_count || 0,
      },
      output: (out) => ({ rowCount: out && out.rowCount ? out.rowCount : 0 }),
    }
  );

  return {
    entry_id: entryId,
    status: 'completed',
    summary: artifact.distill_summary,
    excerpt: artifact.distill_excerpt,
    why_it_matters: artifact.distill_why_it_matters,
    stance: artifact.distill_stance,
  };
}

module.exports = {
  distillTier2SingleEntrySync,
};
