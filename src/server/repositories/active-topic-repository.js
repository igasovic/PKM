'use strict';

const activeTopicStore = require('../db/active-topic-store.js');

function listActiveTopics(opts) {
  return activeTopicStore.listActiveTopics(opts);
}

function getTopicState(args, opts) {
  return activeTopicStore.getTopicState(args, opts);
}

function applyTopicSnapshot(args, opts) {
  return activeTopicStore.applyTopicSnapshot(args, opts);
}

module.exports = {
  listActiveTopics,
  getTopicState,
  applyTopicSnapshot,
};
