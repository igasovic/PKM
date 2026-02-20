'use strict';

const fs = require('fs/promises');

class VerbossLogger {
  constructor(opts) {
    const options = opts || {};
    this.path = String(options.path || process.env.T1_LOG_PATH || '/data/t1.log').trim();
  }

  async write(event, payload) {
    const record = {
      event: String(event || 'unknown'),
      ts: new Date().toISOString(),
      payload: payload || {},
    };
    await fs.appendFile(this.path, `${JSON.stringify(record)}\n`, 'utf8');
  }

  async logNormalizationEntry(pairs) {
    await this.write('email_batch.normalization.entry', {
      pairs: Array.isArray(pairs) ? pairs : [],
    });
  }

  async logNormalizationExit(pairs) {
    await this.write('email_batch.normalization.exit', {
      pairs: Array.isArray(pairs) ? pairs : [],
    });
  }

  async logDbInsertExit(pairs) {
    await this.write('email_batch.db_insert.exit', {
      pairs: Array.isArray(pairs) ? pairs : [],
    });
  }

  async logEnqueue(batch) {
    const value = batch || {};
    await this.write('email_batch.t1_enqueue', {
      batch_id: value.batch_id || null,
      timestamp: value.timestamp || new Date().toISOString(),
      entities: Array.isArray(value.entities) ? value.entities : [],
    });
  }

  async logConsumeEntry(batch) {
    const value = batch || {};
    await this.write('email_batch.t1_consume.entry', {
      batch_id: value.batch_id || null,
      timestamp: value.timestamp || new Date().toISOString(),
      result: value.result || null,
      entries: Array.isArray(value.entries) ? value.entries : [],
    });
  }
}

let singleton = null;

function getVerbossLogger() {
  if (singleton) return singleton;
  singleton = new VerbossLogger({});
  return singleton;
}

module.exports = {
  VerbossLogger,
  getVerbossLogger,
};
