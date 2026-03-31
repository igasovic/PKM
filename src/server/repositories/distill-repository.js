'use strict';

const distillStore = require('../db/distill-store.js');

module.exports = {
  markDistillStaleInProd: (...args) => distillStore.markTier2StaleInProd(...args),
};
