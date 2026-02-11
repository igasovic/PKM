'use strict';

const { getConfigStatic } = require('../../../src/server/config.js');

module.exports = async function ({ $json }) {
  const config = getConfigStatic();
  return [{
    json: {
      ...$json,
      config,
    },
  }];
};
