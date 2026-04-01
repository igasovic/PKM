'use strict';

const {
  getTestModeStateFromDb,
  setTestModeStateInDb,
  toggleTestModeStateInDb,
} = require('./db/runtime-store.js');

class TestModeService {
  constructor({ cacheMs = 2000 } = {}) {
    this.cacheMs = cacheMs;
    this.cachedValue = null;
    this.cachedAt = 0;
    this.testModeOnSince = null;
  }

  async getState() {
    const now = Date.now();
    if (this.cachedValue !== null && (now - this.cachedAt) < this.cacheMs) {
      return this.cachedValue;
    }
    const value = await getTestModeStateFromDb();
    this.cachedValue = value;
    this.cachedAt = now;
    if (value && !this.testModeOnSince) {
      this.testModeOnSince = new Date().toISOString();
    } else if (!value) {
      this.testModeOnSince = null;
    }
    return value;
  }

  async setState(nextState) {
    await setTestModeStateInDb(!!nextState);
    this.cachedValue = !!nextState;
    this.cachedAt = Date.now();
    this.testModeOnSince = nextState ? new Date().toISOString() : null;
    return this.cachedValue;
  }

  async toggle() {
    const next = await toggleTestModeStateInDb();
    this.cachedValue = next;
    this.cachedAt = Date.now();
    this.testModeOnSince = next ? new Date().toISOString() : null;
    return next;
  }

  getWatchdogInfo() {
    return {
      is_test_mode: this.cachedValue,
      test_mode_on_since: this.testModeOnSince,
    };
  }

}

module.exports = {
  TestModeService,
};
