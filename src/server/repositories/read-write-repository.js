'use strict';

const db = require('../db.js');

module.exports = {
  insert: (...args) => db.insert(...args),
  update: (...args) => db.update(...args),
  deleteEntries: (...args) => db.delete(...args),
  moveEntries: (...args) => db.move(...args),
  readContinue: (...args) => db.readContinue(...args),
  readFind: (...args) => db.readFind(...args),
  readLast: (...args) => db.readLast(...args),
  readPull: (...args) => db.readPull(...args),
  readSmoke: (...args) => db.readSmoke(...args),
};
