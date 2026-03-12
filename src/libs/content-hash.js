'use strict';

const crypto = require('crypto');

function normalizeCleanTextForHash(cleanText) {
  if (cleanText === null || cleanText === undefined) return null;
  const text = String(cleanText);
  if (!text.trim()) return null;
  return text;
}

function deriveContentHashFromCleanText(cleanText) {
  const normalized = normalizeCleanTextForHash(cleanText);
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

module.exports = {
  normalizeCleanTextForHash,
  deriveContentHashFromCleanText,
};
