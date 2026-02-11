'use strict';

const { getConfig } = require('../../../src/libs/config.js');

module.exports = async function ({ $json }) {
  const config = getConfig();
  return [{
    json: {
      ...$json,
      config,
    },
  }];
};
