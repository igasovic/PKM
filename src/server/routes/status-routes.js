'use strict';

const {
  json,
  notFound,
  sendError,
} = require('../app/http-utils.js');
const { logError } = require('../logger/braintrust.js');

async function handleStatusRoutes(ctx) {
  const {
    req,
    res,
    url,
    method,
    batchStatusService,
  } = ctx;

  const isLegacyClassifyBatchStatusList = method === 'GET' && url.pathname === '/status/t1/batch';
  const isGenericBatchStatusList = method === 'GET' && url.pathname === '/status/batch';
  if (isLegacyClassifyBatchStatusList || isGenericBatchStatusList) {
    try {
      const stage = isLegacyClassifyBatchStatusList ? 't1' : (url.searchParams.get('stage') || 't1');
      const limit = Number(url.searchParams.get('limit') || 50);
      const result = await batchStatusService.getBatchStatusList({
        stage,
        limit,
        schema: url.searchParams.get('schema') || undefined,
        include_terminal: url.searchParams.get('include_terminal'),
      });
      json(res, 200, result);
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  const batchStatusMatch = (method === 'GET')
    ? (url.pathname.match(/^\/status\/batch\/([^/]+)$/)
      || url.pathname.match(/^\/status\/t1\/batch\/([^/]+)$/))
    : null;
  if (batchStatusMatch) {
    try {
      const isLegacyRoute = /^\/status\/t1\/batch\//.test(url.pathname);
      const stage = isLegacyRoute ? 't1' : (url.searchParams.get('stage') || 't1');
      const batch_id = decodeURIComponent(batchStatusMatch[1]);
      const result = await batchStatusService.getBatchStatus({
        stage,
        batch_id,
        schema: url.searchParams.get('schema') || undefined,
        include_items: url.searchParams.get('include_items'),
        items_limit: url.searchParams.get('items_limit'),
      });
      if (!result) {
        notFound(res);
      } else {
        json(res, 200, result);
      }
    } catch (err) {
      logError(err, req);
      sendError(res, err, { includeErrorCodeField: false, includeField: false });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleStatusRoutes,
};
