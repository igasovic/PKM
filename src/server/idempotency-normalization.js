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

function normalizeSubjectBase(subject) {
  let s = normalizeWhitespace(subject).toLowerCase();
  if (!s) return null;

  // Drop list tags like "[List Name]" at the beginning.
  while (/^\[[^\]]+\]\s*/.test(s)) {
    s = s.replace(/^\[[^\]]+\]\s*/, '');
  }

  // Drop common reply/forward prefixes.
  while (/^(re|fw|fwd)\s*:\s*/i.test(s)) {
    s = s.replace(/^(re|fw|fwd)\s*:\s*/i, '');
  }

  s = normalizeWhitespace(s);
  return s || null;
}

function toChicagoDateBucket(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function normalizeUrlForKey(urlValue) {
  const input = normalizeWhitespace(urlValue);
  if (!input) return null;
  let u;
  try {
    u = new URL(input.startsWith('http') ? input : `https://${input}`);
  } catch {
    return input.toLowerCase();
  }

  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  u.hash = '';

  // Remove common tracking query params.
  const drop = new Set([
    'fbclid',
    'gclid',
    'dclid',
    'msclkid',
    'igshid',
    'mc_cid',
    'mc_eid',
    'mkt_tok',
    'oly_anon_id',
    'oly_enc_id',
  ]);
  const next = new URLSearchParams();
  for (const [k, v] of u.searchParams.entries()) {
    const key = String(k || '').toLowerCase();
    if (key.startsWith('utm_')) continue;
    if (drop.has(key)) continue;
    next.append(k, v);
  }
  const query = next.toString();
  u.search = query ? `?${query}` : '';
  return u.toString().replace(/\/$/, '');
}

function buildTelegramIdempotency(source, normalized) {
  const src = source || {};
  const isLink = !!(normalized.url_canonical || normalized.url || src.url);

  if (isLink) {
    const canonical = normalizeUrlForKey(normalized.url_canonical || normalized.url || src.url);
    if (!canonical) return null;
    return {
      idempotency_policy_key: 'telegram_link_v1',
      idempotency_key_primary: canonical,
      idempotency_key_secondary: sha256(canonical),
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
  const subjectBase = normalizeSubjectBase(src.subject);
  const dateBucket = toChicagoDateBucket(src.date);
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
  const subjectBase = normalizeSubjectBase(src.subject || norm.title);
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
  normalizeSubjectBase,
  toChicagoDateBucket,
  buildIdempotencyForNormalized,
  attachIdempotencyFields,
};
