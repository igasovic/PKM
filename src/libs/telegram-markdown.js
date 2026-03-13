'use strict';

const MDV2_RE = /([_*\[\]()~`>#+\-=|{}.!\\])/g;

function mdv2(value) {
  return String(value === undefined || value === null ? '' : value).replace(MDV2_RE, '\\$1');
}

function clampMaxLen(maxLen) {
  const parsed = Number(maxLen);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 32) return 32;
  return Math.trunc(parsed);
}

function truncateEscaped(value, opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const maxLen = clampMaxLen(options.maxLen);
  const suffix = String(options.suffix === undefined ? '…' : options.suffix);
  const text = String(value === undefined || value === null ? '' : value);

  if (maxLen === null || text.length <= maxLen) return text;

  const room = Math.max(1, maxLen - suffix.length);
  let out = text.slice(0, room);

  // If truncation lands on an escape slash, remove dangling escapes.
  while (out.endsWith('\\')) out = out.slice(0, -1);

  return `${out}${suffix}`;
}

function mdv2Message(value, opts) {
  return truncateEscaped(mdv2(value), opts);
}

function mdv2Render(value, opts) {
  return truncateEscaped(value, opts);
}

module.exports = {
  mdv2,
  mdv2Message,
  mdv2Render,
  truncateEscaped,
};
