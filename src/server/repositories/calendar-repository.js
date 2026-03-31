'use strict';

const calendarStore = require('../db/calendar-store.js');

module.exports = {
  getCalendarRequestById: (...args) => calendarStore.getCalendarRequestById(...args),
  getLatestOpenCalendarRequestByChat: (...args) => calendarStore.getLatestOpenCalendarRequestByChat(...args),
  upsertCalendarRequest: (...args) => calendarStore.upsertCalendarRequest(...args),
  updateCalendarRequestById: (...args) => calendarStore.updateCalendarRequestById(...args),
  finalizeCalendarRequestById: (...args) => calendarStore.finalizeCalendarRequestById(...args),
  insertCalendarObservations: (...args) => calendarStore.insertCalendarObservations(...args),
};
