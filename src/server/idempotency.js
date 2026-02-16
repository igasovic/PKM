'use strict';

const crypto = require('crypto');

function sha256(parts) {
  const value = Array.isArray(parts)
    ? parts.map((x) => String(x ?? '').trim()).join('|')
    : String(parts ?? '').trim();
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function normalizeWhitespace(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function normalizeEmailAddr(s) {
  const raw = normalizeWhitespace(s).toLowerCase();
  if (!raw) return null;
  const m = raw.match(/<?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>?/i);
  return m ? m[1] : raw;
}

function toDateBucketYYYYMMDD(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  // Prefer explicit date component from the incoming value (ignore timezone).
  let m = raw.match(/\b(\d{4})[-/](\d{2})[-/](\d{2})\b/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  m = raw.match(/\b(\d{4})(\d{2})(\d{2})\b/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;

  const tryParse = (input) => {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  let d = tryParse(raw);
  if (!d) {
    const cleaned = raw.replace(/\bat\b/gi, ' ').replace(/\s+/g, ' ').trim();
    d = tryParse(cleaned);
  }
  if (!d) {
    const noWeekday = raw.replace(/^[A-Za-z]{3,9},\s*/, '').trim();
    d = tryParse(noWeekday);
  }
  if (!d) return null;

  const y = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}${mm}${dd}`;
}

function buildTelegramIdempotency(source, normalized) {
  const src = source || {};
  const canonicalFromNorm = normalizeWhitespace(normalized.url_canonical || '');
  const isLink = !!canonicalFromNorm;

  if (isLink) {
    return {
      idempotency_policy_key: 'telegram_link_v1',
      idempotency_key_primary: canonicalFromNorm,
      idempotency_key_secondary: sha256(canonicalFromNorm),
    };
  }

  const chat = src.chat_id;
  const msg = src.message_id;
  if (chat === undefined || chat === null || msg === undefined || msg === null) {
    return null;
  }

  const clean = normalizeWhitespace(normalized.clean_text || normalized.capture_text);
  return {
    idempotency_policy_key: 'telegram_thought_v1',
    idempotency_key_primary: `tg:${String(chat)}:${String(msg)}`,
    idempotency_key_secondary: clean ? sha256(clean) : null,
  };
}

function buildEmailNewsletterIdempotency(source) {
  const src = source || {};
  const fromAddr = normalizeEmailAddr(src.from_addr || src.from || src.sender);
  if (src.subject === undefined || src.subject === null) {
    throw buildIdempotencyError('email newsletter subject is required', src, null);
  }
  const subjectBase = normalizeWhitespace(src.subject).toLowerCase();
  const dateBucket = toDateBucketYYYYMMDD(src.date);
  const messageId = normalizeWhitespace(src.message_id);

  const secondary = (fromAddr && subjectBase && dateBucket)
    ? sha256([fromAddr, subjectBase, dateBucket])
    : null;

  if (!messageId && !secondary) return null;
  return {
    idempotency_policy_key: 'email_newsletter_v1',
    idempotency_key_primary: messageId || null,
    idempotency_key_secondary: secondary,
  };
}

function buildEmailCorrespondenceIdempotency(source, normalized) {
  const src = source || {};
  const norm = normalized || {};
  const rawSubject = (src.subject !== undefined && src.subject !== null) ? src.subject : norm.title;
  if (rawSubject === undefined || rawSubject === null) {
    throw buildIdempotencyError('email correspondence subject is required', src, norm);
  }
  const subjectBase = normalizeWhitespace(rawSubject).toLowerCase();
  if (!subjectBase) return null;
  return {
    idempotency_policy_key: 'email_correspondence_thread_v1',
    idempotency_key_primary: sha256(subjectBase),
    idempotency_key_secondary: null,
  };
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

function buildIdempotencyError(reason, source, normalized) {
  const err = new Error(
    `idempotency normalization failed: ${reason}; source=${safeJson(source)}; norm=${safeJson(normalized)}`
  );
  err.reason = reason;
  err.source_data = source;
  err.norm_data = normalized;
  return err;
}

function buildIdempotencyForNormalized({ source, normalized }) {
  const src = source || {};
  const norm = normalized || {};
  const system = String(src.system || '').toLowerCase();

  if (system === 'telegram') {
    const out = buildTelegramIdempotency(src, norm);
    if (!out) {
      throw buildIdempotencyError('telegram keys could not be derived', src, norm);
    }
    return out;
  }

  if (system === 'email') {
    if (norm.content_type === 'newsletter') {
      const out = buildEmailNewsletterIdempotency(src);
      if (!out) {
        throw buildIdempotencyError('email newsletter keys could not be derived', src, norm);
      }
      return out;
    }
    if (norm.content_type === 'correspondence' || norm.content_type === 'correspondence_thread') {
      const out = buildEmailCorrespondenceIdempotency(src, norm);
      if (!out) {
        throw buildIdempotencyError('email correspondence keys could not be derived', src, norm);
      }
      return out;
    }
    throw buildIdempotencyError(
      `unsupported email content_type: ${String(norm.content_type || '') || '(empty)'}`,
      src,
      norm
    );
  }

  throw buildIdempotencyError(
    `unsupported source.system: ${String(src.system || '') || '(empty)'}`,
    src,
    norm
  );
}

function attachIdempotencyFields(normalized, idempotency) {
  if (!idempotency) return normalized;
  return {
    ...normalized,
    idempotency_policy_key: idempotency.idempotency_policy_key || null,
    idempotency_key_primary: idempotency.idempotency_key_primary || null,
    idempotency_key_secondary: idempotency.idempotency_key_secondary || null,
  };
}

module.exports = {
  toDateBucketYYYYMMDD,
  buildIdempotencyForNormalized,
  attachIdempotencyFields,
};
