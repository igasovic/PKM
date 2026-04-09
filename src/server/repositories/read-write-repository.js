'use strict';

const writeStore = require('../db/write-store.js');
const readStore = require('../db/read-store.js');

module.exports = {
  insert: (...args) => writeStore.insert(...args),
  update: (...args) => writeStore.update(...args),
  deleteEntries: (...args) => writeStore.deleteEntries(...args),
  moveEntries: (...args) => writeStore.moveEntries(...args),
  readContinue: (...args) => readStore.readContinue(...args),
  readFind: (...args) => readStore.readFind(...args),
  readLast: (...args) => readStore.readLast(...args),
  readPull: (...args) => readStore.readPull(...args),
  readSmoke: (...args) => readStore.readSmoke(...args),
  readEntities: (...args) => readStore.readEntities(...args),
};
