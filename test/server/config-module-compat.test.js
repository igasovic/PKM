'use strict';

const { getConfig: getLegacyConfig } = require('../../src/libs/config.js');
const { getConfig: getModularConfig } = require('../../src/libs/config/index.js');

describe('config module compatibility', () => {
  test('legacy entrypoint and modular entrypoint return equivalent config', () => {
    expect(getLegacyConfig()).toEqual(getModularConfig());
  });

  test('getConfig still returns defensive deep copy', () => {
    const cfg = getLegacyConfig();
    cfg.db.is_test_mode = true;

    expect(getLegacyConfig().db.is_test_mode).toBe(false);
  });
});
