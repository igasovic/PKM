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
  "/data/js/workflows/10-read/format-telegram-message__f305ac84-35d3-44df-8ef5-1c0e004f37b8.js",
  "/data/js/workflows/10-read/format-telegram-messagef305ac84-35d3-44df-8ef5-1c0e004f37b8.js"
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
