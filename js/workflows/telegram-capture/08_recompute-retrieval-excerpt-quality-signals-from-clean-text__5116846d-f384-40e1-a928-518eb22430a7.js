"use strict";

function loadFirst(paths) {
  let lastErr;
  for (const p of paths) {
    try {
      return require(p);
    } catch (err) {
      lastErr = err;
      if (!err || err.code !== 'MODULE_NOT_FOUND') {
        throw err;
      }
    }
  }
  throw lastErr;
}

const loaded = loadFirst([
  "/data/js/workflows/22-web-extraction/recompute-retrieval-excerpt-quality-signals-from-clean-text__e3d370cf-c8f9-4022-ab8c-cbdce2d351dd.js"
]);
const fn = (typeof loaded === 'function') ? loaded : loaded?.default;

function toItems(result) {
  if (Array.isArray(result)) return result;
  if (result == null) return [];
  if (Array.isArray(result.items)) return result.items;
  if (typeof result === 'object' && (
    Object.prototype.hasOwnProperty.call(result, 'json') ||
    Object.prototype.hasOwnProperty.call(result, 'binary') ||
    Object.prototype.hasOwnProperty.call(result, 'pairedItem')
  )) {
    return [result];
  }
  return [{ json: result }];
}

module.exports = async function bridge(ctx) {
  if (typeof fn !== 'function') {
    throw new Error('Bridge target does not export a function');
  }
  const out = await fn(ctx);
  return toItems(out);
};
