'use strict';

const { getConfigStatic } = require('../../../src/libs/config.js');

module.exports = async function ({ $json }) {
  const config = getConfigStatic();
  return [{
    json: {
      ...$json,
      config,
    },
  }];
};
