'use strict';

const { CONFIG_V1 } = require('../../../src/server/config.js');

module.exports = async function ({ $json }) {
  return [{
    json: {
      ...$json,
      config: CONFIG_V1,
    },
  }];
};
