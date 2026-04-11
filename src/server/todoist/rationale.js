'use strict';

const { runRationaleAgent } = require('./agents/rationale-agent.js');

async function generateRationales(kind, items, options = {}) {
  const out = await runRationaleAgent(kind, items, options);
  return out && out.result ? out.result : {};
}

module.exports = {
  generateRationales,
  runRationaleAgent,
};
