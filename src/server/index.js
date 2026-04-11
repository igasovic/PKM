'use strict';

const http = require('http');
const { URL } = require('url');
const { TestModeService } = require('./test-mode.js');
const {
  startTier1BatchWorker,
  stopTier1BatchWorker,
} = require('./tier1-enrichment.js');
const {
  startTier2BatchWorker,
  stopTier2BatchWorker,
} = require('./tier2-enrichment.js');
const {
  createBatchStatusService,
} = require('./batch-status-service.js');
const {
  getBraintrustLogger,
  logError,
} = require('./logger/braintrust.js');
const { getLogger } = require('./logger/index.js');
const {
  withRequestContext,
  setContextPatch,
} = require('./logger/context.js');
const { json, notFound } = require('./app/http-utils.js');
const { handleControlRoutes } = require('./routes/control-routes.js');
const { handleClassifyRoutes } = require('./routes/classify-routes.js');
const { handleCalendarRoutes } = require('./routes/calendar-routes.js');
const { handleDistillRoutes } = require('./routes/distill-routes.js');
const { handleStatusRoutes } = require('./routes/status-routes.js');
const { handleReadWriteRoutes } = require('./routes/read-write-routes.js');
const { handleRecipesRoutes } = require('./routes/recipes-routes.js');
const { handleTodoistRoutes } = require('./routes/todoist-routes.js');
const { startMaintenanceWorker } = require('./workers/maintenance-worker.js');
const { getServicePort } = require('./runtime-env.js');

const testModeService = new TestModeService();
const batchStatusService = createBatchStatusService();

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const method = (req.method || 'GET').toUpperCase();
  setContextPatch({ route: url.pathname, method, pipeline: 'http_api' });
  const logger = getLogger().child({
    service: 'pkm-server',
    pipeline: 'http_api',
    meta: { route: url.pathname, method },
  });
  const routeContext = {
    req,
    res,
    url,
    method,
    logger,
    testModeService,
    batchStatusService,
  };
  if (await handleControlRoutes(routeContext)) return;
  if (await handleClassifyRoutes(routeContext)) return;
  if (await handleCalendarRoutes(routeContext)) return;
  if (await handleDistillRoutes(routeContext)) return;
  if (await handleStatusRoutes(routeContext)) return;
  if (await handleReadWriteRoutes(routeContext)) return;
  if (await handleRecipesRoutes(routeContext)) return;
  if (await handleTodoistRoutes(routeContext)) return;
  return notFound(res);
}

function createServer() {
  return http.createServer((req, res) => {
    withRequestContext(req, async () => {
      await handleRequest(req, res);
    }).catch((err) => {
      logError(err, req);
      json(res, 500, { error: 'internal_error', message: err.message });
    });
  });
}

function start() {
  const port = getServicePort();
  const logger = getLogger().child({ service: 'pkm-server', pipeline: 'maintenance' });
  // Hard-fail startup if Braintrust can't initialize.
  getBraintrustLogger();
  startTier1BatchWorker();
  startTier2BatchWorker();
  const stopMaintenanceWorker = startMaintenanceWorker(logger);

  const server = createServer();
  server.listen(port, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`server listening on :${port}`);
  });
  const shutdown = () => {
    stopTier1BatchWorker();
    stopTier2BatchWorker();
    stopMaintenanceWorker();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  start();
}

module.exports = {
  createServer,
  handleRequest,
};
