'use strict';

const db = require('../db.js');

module.exports = {
  markDistillStaleInProd: (...args) => db.markTier2StaleInProd(...args),
};
