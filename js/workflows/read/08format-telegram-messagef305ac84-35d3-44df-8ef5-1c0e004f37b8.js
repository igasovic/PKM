"use strict";

function loadFirst(paths) {
  let lastErr;
  for (const p of paths) {
    try {
      return require(p);
    } catch (err) {
      lastErr = err;
      if (!err || err.code !== "MODULE_NOT_FOUND") {
        throw err;
      }
    }
  }
  throw lastErr;
}

const fn = loadFirst([
  "/data/js/workflows/10-read/format-telegram-message__f305ac84-35d3-44df-8ef5-1c0e004f37b8.js",
  "/data/js/workflows/10-read/format-telegram-messagef305ac84-35d3-44df-8ef5-1c0e004f37b8.js",
]);

module.exports = async function bridge(ctx) {
  return fn(ctx);
};
