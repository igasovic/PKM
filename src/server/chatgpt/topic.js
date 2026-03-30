'use strict';

function asText(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function normalizeTopicLabel(value) {
  return asText(value).replace(/\s+/g, ' ');
}

function normalizeTopicKey(value) {
  const label = normalizeTopicLabel(value).toLowerCase();
  if (!label) return '';
  return label
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

module.exports = {
  asText,
  normalizeTopicLabel,
  normalizeTopicKey,
};
