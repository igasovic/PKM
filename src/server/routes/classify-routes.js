'use strict';

const { decideEmailIntent } = require('../normalization.js');
const {
  runTelegramIngestionPipeline,
  runEmailIngestionPipeline,
  runWebpageIngestionPipeline,
  runNotionIngestionPipeline,
} = require('../ingestion-pipeline.js');
const {
  enrichTier1,
  enrichTier1AndPersist,
  enrichTier1AndPersistBatch,
  enqueueTier1Batch,
  runTier1ClassifyRun,
} = require('../tier1-enrichment.js');
const { importEmailMbox } = require('../email-importer.js');
const { ingestTelegramUrlBatch } = require('../telegram-url-batch-ingest.js');
const {
  readBody,
  parseJsonBody,
  bindRunIdFromBody,
  json,
  sendError,
} = require('../app/http-utils.js');
const { logError } = require('../logger/braintrust.js');

async function handleClassifyRoutes(ctx) {
  const {
    req,
    res,
    url,
    method,
    logger,
  } = ctx;

  if (method === 'POST' && url.pathname === '/normalize/telegram') {
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const normalized = await logger.step(
        'api.normalize.telegram',
        async () => runTelegramIngestionPipeline({
          text: body.text,
          source: body.source,
        }),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      json(res, 200, normalized);
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/ingest/telegram/url-batch') {
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const result = await logger.step(
        'api.ingest.telegram.url_batch',
        async () => ingestTelegramUrlBatch({
          text: body.text,
          source: body.source,
          continue_on_error: body.continue_on_error,
          smoke_mode: body.smoke_mode,
          test_run_id: body.test_run_id,
        }),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      json(res, 200, result);
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/normalize/email/intent') {
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const intent = await logger.step(
        'api.normalize.email.intent',
        async () => decideEmailIntent(body.textPlain),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      json(res, 200, { content_type: intent.content_type });
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/normalize/email') {
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const normalized = await logger.step(
        'api.normalize.email',
        async () => runEmailIngestionPipeline({
          raw_text: body.raw_text,
          from: body.from,
          subject: body.subject,
          date: body.date,
          message_id: body.message_id,
          source: body.source,
        }),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      json(res, 200, normalized);
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/normalize/webpage') {
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const normalized = await logger.step(
        'api.normalize.webpage',
        async () => runWebpageIngestionPipeline({
          text: body.text,
          extracted_text: body.extracted_text,
          clean_text: body.clean_text,
          capture_text: body.capture_text,
          content_type: body.content_type,
          url: body.url,
          url_canonical: body.url_canonical,
          excerpt: body.excerpt,
          source: body.source,
        }),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      json(res, 200, normalized);
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/normalize/notion') {
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const normalized = await logger.step(
        'api.normalize.notion',
        async () => runNotionIngestionPipeline({
          id: body.id || body.page_id || null,
          updated_at: body.updated_at,
          created_at: body.created_at,
          content_type: body.content_type,
          title: body.title,
          url: body.url,
          capture_text: body.capture_text,
        }),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      json(res, 200, normalized);
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/enrich/t1') {
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const result = await logger.step(
        'api.enrich.t1',
        async () => enrichTier1({
          title: body.title ?? null,
          author: body.author ?? null,
          clean_text: body.clean_text ?? null,
        }),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      json(res, 200, result);
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/enrich/t1/update') {
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const result = await logger.step(
        'api.enrich.t1.update',
        async () => enrichTier1AndPersist(body || {}),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      json(res, 200, result);
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/enrich/t1/update-batch') {
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const result = await logger.step(
        'api.enrich.t1.update_batch',
        async () => enrichTier1AndPersistBatch(body || {}),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      json(res, 200, result);
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/enrich/t1/batch') {
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const result = await logger.step(
        'api.enrich.t1.batch',
        async () => enqueueTier1Batch(body.items || [], {
          metadata: body.metadata || undefined,
          completion_window: body.completion_window || '24h',
        }),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      json(res, 200, result);
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/enrich/t1/run') {
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const hasRunParams = body
        && typeof body === 'object'
        && !Array.isArray(body)
        && (
          Object.prototype.hasOwnProperty.call(body, 'execution_mode')
          || Object.prototype.hasOwnProperty.call(body, 'dry_run')
          || Object.prototype.hasOwnProperty.call(body, 'limit')
          || Object.prototype.hasOwnProperty.call(body, 'schema')
        );
      if (!hasRunParams) {
        const err = new Error('enrich/t1/run requires at least one parameter (--dry-run, --limit, --sync, --batch, or schema)');
        err.statusCode = 400;
        throw err;
      }
      const result = await logger.step(
        'api.enrich.t1.run',
        async () => runTier1ClassifyRun(body || {}),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      json(res, 200, result);
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  if (method === 'POST' && url.pathname === '/import/email/mbox') {
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      const result = await logger.step(
        'api.import.email.mbox',
        async () => importEmailMbox({
          mbox_path: body.mbox_path || body.path,
          batch_size: body.batch_size,
          insert_chunk_size: body.insert_chunk_size,
          completion_window: body.completion_window,
          max_emails: body.max_emails,
          metadata: body.metadata || undefined,
        }),
        { input: body, output: (out) => out, meta: { route: url.pathname } }
      );
      json(res, 200, result);
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleClassifyRoutes,
};
