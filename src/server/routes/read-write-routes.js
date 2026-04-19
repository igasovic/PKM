'use strict';

const readWriteRepository = require('../repositories/read-write-repository.js');
const {
  requireAdminSecret,
  readBody,
  parseJsonBody,
  bindRunIdFromBody,
  json,
  notFound,
  sendError,
} = require('../app/http-utils.js');
const {
  logApiSuccess,
  logApiError,
} = require('../logger/braintrust.js');

async function handleReadWriteRoutes(ctx) {
  const {
    req,
    res,
    url,
    method,
    logger,
    testModeService,
  } = ctx;

  if (method === 'POST' && (url.pathname.startsWith('/db/') || url.pathname.startsWith('/pkm/'))) {
    const start = Date.now();
    const meta = {
      op: `api${url.pathname.replace(/\//g, '_')}`,
      method,
      path: url.pathname,
    };
    try {
      const raw = await readBody(req);
      const body = parseJsonBody(raw);
      bindRunIdFromBody(body);
      meta.input = body;
      let result;

      if (url.pathname === '/db/delete' || url.pathname === '/db/move' || url.pathname === '/db/test-mode/toggle') {
        requireAdminSecret(req);
      }

      result = await logger.step(
        `api${url.pathname.replace(/\//g, '_')}`,
        async () => {
          if (url.pathname === '/pkm/insert') return readWriteRepository.insertPkm(body);
          if (url.pathname === '/pkm/insert/batch') return readWriteRepository.insertPkmBatch(body);
          if (url.pathname === '/pkm/insert/enriched') return readWriteRepository.insertPkmEnriched(body);
          if (url.pathname === '/db/update') return readWriteRepository.update(body);
          if (url.pathname === '/db/delete') return readWriteRepository.deleteEntries(body);
          if (url.pathname === '/db/move') return readWriteRepository.moveEntries(body);
          if (url.pathname === '/db/read/continue') return readWriteRepository.readContinue(body);
          if (url.pathname === '/db/read/find') return readWriteRepository.readFind(body);
          if (url.pathname === '/db/read/last') return readWriteRepository.readLast(body);
          if (url.pathname === '/db/read/pull') return readWriteRepository.readPull(body);
          if (url.pathname === '/db/read/smoke') return readWriteRepository.readSmoke(body);
          if (url.pathname === '/db/read/entities') return readWriteRepository.readEntities(body);
          if (url.pathname === '/db/test-mode/toggle') {
            const state = await testModeService.toggle();
            return { rows: [{ is_test_mode: state }], rowCount: 1 };
          }
          return null;
        },
        { input: body, output: (out) => ({ rowCount: out && out.rowCount ? out.rowCount : 0 }) }
      );
      if (result === null) {
        notFound(res);
      } else {
        const payload = (result && result.rows) ? result.rows : [];
        logApiSuccess(meta, { rowCount: result.rowCount }, { duration_ms: Date.now() - start });
        json(res, 200, payload);
      }
    } catch (err) {
      logApiError(meta, err, { duration_ms: Date.now() - start });
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleReadWriteRoutes,
};
