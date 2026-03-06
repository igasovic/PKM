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
  "/data/js/workflows/10-read/command-parser__926eb875-5735-4746-a0a4-7801b8db586f.js",
  "/data/js/workflows/10-read/command-parser926eb875-5735-4746-a0a4-7801b8db586f.js",
]);

module.exports = async function bridge(ctx) {
  return fn(ctx);
};
