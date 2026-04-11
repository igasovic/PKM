'use strict';

const todoistService = require('../todoist/service.js');

module.exports = {
  syncTodoistSurface: (...args) => todoistService.syncTodoistSurface(...args),
  getReviewQueue: (...args) => todoistService.getReviewQueue(...args),
  acceptReview: (...args) => todoistService.acceptReview(...args),
  overrideReview: (...args) => todoistService.overrideReview(...args),
  reparseReview: (...args) => todoistService.reparseReview(...args),
  buildDailyBriefSurface: (...args) => todoistService.buildDailyBriefSurface(...args),
  buildWaitingBriefSurface: (...args) => todoistService.buildWaitingBriefSurface(...args),
  buildWeeklyBriefSurface: (...args) => todoistService.buildWeeklyBriefSurface(...args),
};
