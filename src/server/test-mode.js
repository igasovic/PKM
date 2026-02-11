'use strict';

const db = require('./db.js');

class TestModeService {
  constructor({ cacheMs = 10000 } = {}) {
    this.cacheMs = cacheMs;
    this.cachedValue = null;
    this.cachedAt = 0;
  }

  async getState() {
    const now = Date.now();
    if (this.cachedValue !== null && (now - this.cachedAt) < this.cacheMs) {
      return this.cachedValue;
    }
    const value = await db.getTestModeStateFromDb();
    this.cachedValue = value;
    this.cachedAt = now;
    return value;
  }

  async setState(nextState) {
    await db.setTestModeStateInDb(!!nextState);
    this.cachedValue = !!nextState;
    this.cachedAt = Date.now();
    return this.cachedValue;
  }

  async toggle() {
    const next = await db.toggleTestModeStateInDb();
    this.cachedValue = next;
    this.cachedAt = Date.now();
    return next;
  }

}

module.exports = {
  TestModeService,
};
