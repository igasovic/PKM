'use strict';

const db = require('../db.js');

module.exports = {
  getCalendarRequestById: (...args) => db.getCalendarRequestById(...args),
  getLatestOpenCalendarRequestByChat: (...args) => db.getLatestOpenCalendarRequestByChat(...args),
  upsertCalendarRequest: (...args) => db.upsertCalendarRequest(...args),
  updateCalendarRequestById: (...args) => db.updateCalendarRequestById(...args),
  finalizeCalendarRequestById: (...args) => db.finalizeCalendarRequestById(...args),
  insertCalendarObservations: (...args) => db.insertCalendarObservations(...args),
};
