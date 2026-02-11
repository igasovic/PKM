'use strict';

const { getConfig } = require('../../../src/server/config.js');

module.exports = async function ({ $json }) {
  const config = await getConfig();
  return [{
    json: {
      ...$json,
      config,
    },
  }];
};
