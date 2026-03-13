'use strict';

const MDV2_RE = /([_*\[\]()~`>#+\-=|{}.!\\])/g;
const NEWLINE = '\n';

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

function finalizeMarkdownV2(value, opts) {
  return truncateEscaped(String(value === undefined || value === null ? '' : value), opts);
}

function mdv2Render(value, opts) {
  return finalizeMarkdownV2(value, opts);
}

function nl(count = 1) {
  const n = Number(count);
  if (!Number.isFinite(n) || n < 1) return '';
  return NEWLINE.repeat(Math.trunc(n));
}

function bold(value) {
  return `*${mdv2(value)}*`;
}

function italic(value) {
  return `_${mdv2(value)}_`;
}

function code(value) {
  const text = String(value === undefined || value === null ? '' : value).replace(/([`\\])/g, '\\$1');
  return `\`${text}\``;
}

function parens(value) {
  return `\\(${mdv2(value)}\\)`;
}

function brackets(value) {
  return `\\[${mdv2(value)}\\]`;
}

function arrow(left, right) {
  if (right === undefined) return `${mdv2(left)} \\-\\>`;
  return `${mdv2(left)} \\-\\> ${mdv2(right)}`;
}

function kv(label, value, opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const labelText = options.boldLabel === false ? mdv2(label) : bold(label);
  if (value === undefined || value === null || value === '') return labelText;
  const rawValue = options.rawValue === true ? String(value) : mdv2(value);
  return `${labelText}: ${rawValue}`;
}

function bullet(value, opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const body = options.rawValue === true ? String(value === undefined || value === null ? '' : value) : mdv2(value);
  return `• ${body}`;
}

function joinLines(values, opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const list = Array.isArray(values) ? values : [values];
  const out = [];

  for (const value of list) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const nested of value) {
        if (nested === undefined || nested === null) continue;
        out.push(String(nested));
      }
      continue;
    }
    out.push(String(value));
  }

  if (options.trimTrailing === true) {
    while (out.length > 0 && out[out.length - 1] === '') out.pop();
  }

  return out.join(NEWLINE);
}

module.exports = {
  mdv2,
  mdv2Message,
  mdv2Render,
  finalizeMarkdownV2,
  nl,
  bold,
  italic,
  code,
  parens,
  brackets,
  arrow,
  kv,
  bullet,
  joinLines,
  truncateEscaped,
};
