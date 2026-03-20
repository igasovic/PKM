'use strict';

const { createContextPackBuilder } = require('./context-pack-builder-core.js');
const { mdv2Message } = require('./telegram-markdown.js');

const api = createContextPackBuilder({ mdv2Message });
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
  module.exports.default = api;
}
if (typeof globalThis !== 'undefined') {
  globalThis.__pkmContextPackBuilder = api;
}
