/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: E-Mail Capture (e-mail-capture)
 * Node: Capture
 * Node ID: 0d46a330-acb5-4954-a88e-1e0ee38ac0cf
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

/**
 * Node0 — Transport normalization + lightweight metadata (capture_text -> core_text/core_html)
 *
 * CONTRACT
 * Input (IMAP-ish):
 *   - subject/from + text/plain + text/html (optional)
 *
 * Output (downstream):
 *   - capture_text: normalized newlines, otherwise “as received”
 *   - core_text: transport-cleaned body (forwarded wrapper headers removed, invisible junk stripped, mojibake repaired if detected)
 *   - core_html: HTML with forwarded wrapper header removed (best-effort, non-destructive)
 *   - metadata: title, author, intent, content_type
 *   - debug: has_html/has_plain, lens, forwarded parser, mojibake fixed flags
 *
 * IMPORTANT
 *   - NO teaser/footer/main-content selection here.
 *   - No external deps; stock n8n runner compatible.
 */

const nowIso = new Date().toISOString();

/* ----------------------------- small helpers ----------------------------- */

const pick = (...vals) => {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const s = String(v);
    if (s.trim() !== "") return v;
  }
  return null;
};

const normalizeNewlines = (s) => String(s || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

// Minimal entity decode (text nodes sometimes contain these)
const decodeEntities = (s) =>
  String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");

// Runtime-safe “strip Unicode Cf”
const makeCfRegex = () => {
  try {
    return new RegExp("\\p{Cf}+", "gu"); // format chars (ZWJ/ZWNJ/etc)
  } catch {
    // Fallback: common newsletter offenders
    return /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD\u034F]/g;
  }
};
const RE_CF = makeCfRegex();

// Normalize “weird” Unicode spaces into normal space (helps with \u202F etc)
const RE_UNI_SPACE = /[\u00A0\u1680\u2000-\u200A\u2007\u202F\u205F\u3000]/g;

// Mojibake (guarded) — same spirit as your Node2, but runs earlier for core_text
const MOJI_SIGNAL = /(?:â[\u0080-\u00BF]|Ã[\u0080-\u00BF]|Â[\u0080-\u00BF]|â€”|â€“|â€™|â€œ|â€\x9d|â€¢|â€¦|Â )/;

function mojiScore(s) {
  const str = String(s || "");
  if (!str) return 0;
  const m = str.match(new RegExp(MOJI_SIGNAL.source, "g"));
  const scoreSignals = m ? m.length : 0;
  const scoreRepl = (str.match(/\uFFFD/g) || []).length; // replacement char
  return scoreSignals + scoreRepl;
}

function fixMojibakeGuarded(s) {
  const str = String(s || "");
  if (!str) return { text: str, fixed: false, method: "none" };

  // Strong guard: only attempt when there’s a clear mojibake signal
  if (!MOJI_SIGNAL.test(str) && str.indexOf("\uFFFD") === -1) {
    return { text: str, fixed: false, method: "none" };
  }

  // Attempt: interpret current string as Latin-1 bytes and decode as UTF-8
  try {
    const bytes = Uint8Array.from(str, (c) => c.charCodeAt(0) & 0xff);

    let out = null;

    if (typeof TextDecoder !== "undefined") {
      out = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } else if (typeof Buffer !== "undefined") {
      out = Buffer.from(bytes).toString("utf8");
    }

    if (out && out !== str) {
      // Accept if it doesn’t get “more mojibakey”
      if (mojiScore(out) <= mojiScore(str)) {
        return { text: out, fixed: true, method: "latin1->utf8" };
      }
    }
  } catch (_) {}

  // Fallback: best-effort replacements of the most common sequences
  const out2 = str
    .replace(/â€™/g, "’")
    .replace(/â€œ/g, "“")
    .replace(/â€\x9d/g, "”")
    .replace(/â€“/g, "–")
    .replace(/â€”/g, "—")
    .replace(/â€¦/g, "…")
    .replace(/â€¢/g, "•")
    .replace(/Â /g, " ")
    .replace(/Â/g, ""); // last-resort: stray Â
  return { text: out2, fixed: out2 !== str, method: out2 !== str ? "replace" : "none" };
}

function stripInvisibleTransport(s) {
  // transport-ish cleanup only
  return String(s || "")
    .replace(/\u0000/g, "") // NUL
    .replace(RE_UNI_SPACE, " ")
    .replace(RE_CF, "")
    .replace(/\uFFFD/g, "") // replacement char is rarely useful in stored text
    .replace(/\u00A0/g, " "); // NBSP -> space (redundant w/ RE_UNI_SPACE; harmless)
}

// Preserve newlines, but normalize whitespace INSIDE lines, cap blank-line runs
function collapseWhitespacePreserveNewlines(s) {
  const text = normalizeNewlines(s);
  const lines = text.split("\n");

  const out = [];
  let blankRun = 0;

  for (let line of lines) {
    line = String(line || "")
      .replace(/[ \t]+/g, " ")
      .trim();

    if (!line) {
      blankRun += 1;
      if (blankRun <= 2) out.push("");
      continue;
    }

    blankRun = 0;
    out.push(line);
  }

  return out.join("\n").trim();
}

const normalizeSubject = (subj) =>
  String(subj || "")
    .replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "")
    .trim() || null;

const nameOnly = (fromVal) => {
  if (!fromVal) return null;
  let s = String(fromVal);

  // Prefer display name before <email>
  const m = s.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  if (m && m[1]) s = m[1];

  // Decode + repair + strip transport junk
  s = decodeEntities(s);
  s = fixMojibakeGuarded(s).text;
  s = stripInvisibleTransport(s);

  s = s.replace(/["“”<>]/g, " ").replace(/\s+/g, " ").trim();

  // Keep letters/numbers/space/hyphen only (unicode-safe). If property escapes fail, fall back.
  try {
    s = s.replace(/[^\p{L}\p{N}\s-]+/gu, "").replace(/\s+/g, " ").trim();
  } catch {
    s = s.replace(/[^A-Za-z0-9\s-]+/g, "").replace(/\s+/g, " ").trim();
  }

  return s || null;
};

/* ---------------------- forwarded wrapper handling (plain) ---------------------- */

function parseMiniHeaderBlock(lines, startIdx, opts) {
  const maxLines = (opts && opts.maxLines) || 30;
  const keys = /^(From|To|Subject|Date|Sent|Cc|Bcc|Reply-To):\s*(.*)\s*$/i;

  let i = startIdx;
  let skipped = 0;
  while (i < lines.length && skipped < 3 && String(lines[i] || "").trim() === "") {
    i++;
    skipped++;
  }

  const headers = {};
  const wrapperLines = [];
  let lastKey = null;
  let seenBlankTerminator = false;

  for (let n = 0; i < lines.length && n < maxLines; i++, n++) {
    const line = String(lines[i] || "");
    wrapperLines.push(line);

    if (line.trim() === "") {
      seenBlankTerminator = true;
      i++; // body starts after the blank line
      break;
    }

    const hm = line.match(keys);
    if (hm) {
      lastKey = hm[1].toLowerCase().replace("-", "_"); // reply-to -> reply_to
      const val = String(hm[2] || "").trim();
      headers[lastKey] = headers[lastKey] ? (headers[lastKey] + " " + val).trim() : val;
      continue;
    }

    // Continuation line
    if (lastKey && /^\s+/.test(line)) {
      headers[lastKey] = (headers[lastKey] + " " + line.trim()).trim();
    }
  }

  const score =
    (headers.from ? 1 : 0) +
    (headers.to ? 1 : 0) +
    (headers.subject ? 1 : 0) +
    (headers.date || headers.sent ? 1 : 0);

  const found = seenBlankTerminator && score >= ((opts && opts.minScore) || 2);

  return { found, headers, wrapperLines, bodyStart: i, score, seenBlankTerminator };
}

function stripTopHeaderBlockIfPresent(text) {
  const t = normalizeNewlines(text);
  const lines = t.split("\n");

  // Find first non-empty line near top
  let first = -1;
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    if (String(lines[i] || "").trim() !== "") {
      first = i;
      break;
    }
  }
  if (first === -1) return { text: t.trim(), stripped: false, parsed: null };

  // For “header-only” stripping, be stricter than marker-based forwarding
  const hb = parseMiniHeaderBlock(lines, first, { minScore: 3, maxLines: 25 });
  if (!hb.found) return { text: t.trim(), stripped: false, parsed: null };

  const remaining = lines.slice(hb.bodyStart).join("\n").trim();
  // Safety: don’t nuke tiny content
  if (remaining.length < 80) return { text: t.trim(), stripped: false, parsed: null };

  return {
    text: remaining,
    stripped: true,
    parsed: { headers: hb.headers, wrapper_text: hb.wrapperLines.join("\n").trim(), score: hb.score },
  };
}

function extractForwardedPlainText(raw) {
  const text = normalizeNewlines(raw);
  const lines = text.split("\n");

  const MAX_SCAN = 80;

  const MARKERS = [
    { name: "gmail", re: /^-+\s*Forwarded message\s*-+\s*$/i },
    { name: "gmail_begin", re: /^Begin forwarded message:\s*$/i },
    { name: "outlook", re: /^-+\s*Original Message\s*-+\s*$/i },
    { name: "generic_fwd", re: /^-+\s*Forwarded\s+Message\s*-+\s*$/i },
    { name: "generic_fwd2", re: /^-{2,}\s*Forwarded\s+message\s*-{2,}\s*$/i },
  ];

  let idx = -1;
  let parser = "none";
  let marker_line = "";

  for (let i = 0; i < Math.min(lines.length, MAX_SCAN); i++) {
    const t = String(lines[i] || "").trim();
    for (const m of MARKERS) {
      if (m.re.test(t)) {
        idx = i;
        parser = m.name;
        marker_line = lines[i] || "";
        break;
      }
    }
    if (idx !== -1) break;
  }

  // No explicit marker — try strict header-only stripping if it starts with From:/To:/Subject:/Date
  if (idx === -1) {
    const stripped = stripTopHeaderBlockIfPresent(text);
    if (stripped.stripped) {
      return {
        found: true,
        parser: "header_block",
        marker_line: null,
        preamble: "",
        headers: stripped.parsed.headers,
        wrapper_text: stripped.parsed.wrapper_text,
        body: stripped.text,
      };
    }

    return {
      found: false,
      parser: "none",
      marker_line: null,
      preamble: "",
      headers: {},
      wrapper_text: "",
      body: text.trim(),
    };
  }

  // Marker found — require a recognizable mini-header block right after it
  const preamble = lines.slice(0, idx).join("\n").trim();
  const hb = parseMiniHeaderBlock(lines, idx + 1, { minScore: 2, maxLines: 35 });

  if (!hb.found) {
    // Marker without headers: don’t strip; too risky.
    return {
      found: false,
      parser: "none",
      marker_line: null,
      preamble: "",
      headers: {},
      wrapper_text: "",
      body: text.trim(),
    };
  }

  let body = lines.slice(hb.bodyStart).join("\n").trim();

  // Safety: if body still starts with mini headers, strip them (rare)
  body = body.replace(/^(?:\s*(?:From|To|Subject|Date|Sent):[^\n]*\n){1,10}\s*\n?/i, "").trim();

  return {
    found: true,
    parser,
    marker_line,
    preamble,
    headers: hb.headers,
    wrapper_text: [marker_line, hb.wrapperLines.join("\n")].filter(Boolean).join("\n").trim(),
    body,
  };
}

/* ---------------------- forwarded wrapper handling (html) ---------------------- */

function stripForwardedHtmlHeaders(html) {
  let h = String(html || "");
  if (!h) return null;

  // Remove scripts/styles (transport noise)
  h = h.replace(/<script[\s\S]*?<\/script>/gi, "");
  h = h.replace(/<style[\s\S]*?<\/style>/gi, "");

  // Gmail forwarded header block
  h = h.replace(
    /<div[^>]*class=["'][^"']*gmail_attr[^"']*["'][^>]*>[\s\S]*?<\/div>\s*(<br\s*\/?>\s*){0,6}/i,
    ""
  );

  // Plain marker text sometimes appears outside gmail_attr
  h = h.replace(/-+\s*Forwarded message\s*-+/gi, "");

  // Outlook-ish “Original Message” header blocks (best-effort, conservative)
  // Only removes a short top block with multiple From/To/Subject lines separated by <br>
  h = h.replace(
    /(?:<br\s*\/?>\s*){0,4}[-_]{2,}\s*(?:Original Message|Forwarded message)\s*[-_]{2,}\s*(?:<br\s*\/?>\s*(?:From|To|Subject|Date|Sent):[^<]{0,300}){2,12}(?:<br\s*\/?>\s*){1,6}/i,
    ""
  );

  // Remove hidden preheaders (display:none) — common transport artifact
  h = h.replace(
    /<[^>]+style=["'][^"']*display\s*:\s*none[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi,
    ""
  );

  return h;
}

/* ------------------------------ intent/content_type ----------------------------- */

// THINK detection: first non-empty line is "think" or "think:" (case-insensitive)
function applyThink(text) {
  const lines = normalizeNewlines(text).split("\n");

  let firstIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (String(lines[i] || "").trim() !== "") {
      firstIdx = i;
      break;
    }
  }
  if (firstIdx === -1) return { intent: "archive", text: "" };

  const first = String(lines[firstIdx] || "").trim();
  const m = first.match(/^think\s*:?\s*(.*)$/i);
  if (!m) return { intent: "archive", text };

  const remainder = String(m[1] || "").trim();
  if (remainder) {
    lines[firstIdx] = remainder;
  } else {
    lines.splice(firstIdx, 1);
  }
  return { intent: "think", text: lines.join("\n").trim() };
}

// Correspondence detection (heuristic)
function looksLikeThread(text) {
  const t = String(text || "");
  if (/^From:\s.+\nSent:\s.+\nTo:\s.+\nSubject:\s.+/im.test(t)) return true;
  if (/^On .+wrote:\s*$/im.test(t)) return true;
  if (/^\s*>/m.test(t)) return true;
  if (/^_{8,}\s*$/m.test(t)) return true;
  return false;
}

/* ----------------------------------- inputs ----------------------------------- */

const subject_raw = pick($json.subject, $json.headers && $json.headers.subject);
const from_raw = pick($json.from && $json.from.text, $json.from, $json.headers && $json.headers.from);

const text_raw = pick(
  $json.text,
  $json.textPlain,
  $json.body && $json.body.text,
  $json.body,
  $json.textContent
) || "";

const html_raw = pick($json.html, $json.textHtml, $json.body && $json.body.html, $json.htmlContent);

// capture_text: as received (except newline normalization)
const capture_text = normalizeNewlines(String(text_raw || ""));

// Debug presence
const debug_has_plain = !!String(text_raw || "").trim();
const debug_has_html = !!String(html_raw || "").trim();
const debug_raw_plain_len = String(text_raw || "").length;
const debug_raw_html_len = String(html_raw || "").length;

/* ------------------------------ build core_text ------------------------------ */

// Split forwarded wrapper (plain)
const fwd = extractForwardedPlainText(capture_text);

// Title: prefer forwarded Subject if present, else envelope subject
{
  const subjCandidate = fwd.headers.subject || subject_raw || "";
  const repaired = fixMojibakeGuarded(stripInvisibleTransport(decodeEntities(subjCandidate)));
  var title = normalizeSubject(repaired.text);
  var debug_title_mojibake_fixed = repaired.fixed;
}

// Author: prefer forwarded From if present, else envelope from
{
  const fromCandidate = fwd.headers.from || from_raw || "";
  const repairedFrom = fixMojibakeGuarded(String(fromCandidate || ""));
  var author = nameOnly(repairedFrom.text);
  var debug_author_mojibake_fixed = repairedFrom.fixed;
}

// core_text_raw: remove forwarded marker + mini-header wrapper, keep preamble above it
let core_text_raw = fwd.found
  ? [fwd.preamble, fwd.body].filter(Boolean).join("\n\n").trim()
  : capture_text.trim();

// If a header block still leaked to top, strip it strictly
const topStrip = stripTopHeaderBlockIfPresent(core_text_raw);
core_text_raw = topStrip.text;

// Mojibake repair (guarded) on core text (this is the main change vs your current node0)
const coreMoji = fixMojibakeGuarded(core_text_raw);
let core_text_clean = coreMoji.text;

// Transport cleanup: invisibles, unicode spaces, replacement chars, whitespace capping
core_text_clean = stripInvisibleTransport(decodeEntities(core_text_clean));
core_text_clean = collapseWhitespacePreserveNewlines(core_text_clean);

// THINK intent (does not do semantic cleanup; just routes notes)
const thinkApplied = applyThink(core_text_clean);
const intent = thinkApplied.intent;
let core_text = thinkApplied.text;

/* ------------------------------ build core_html ------------------------------ */

let core_html = stripForwardedHtmlHeaders(html_raw);
if (core_html) {
  // Keep this transport-level: repair mojibake only if signaled; strip invisibles; normalize newlines
  const htmlMoji = fixMojibakeGuarded(core_html);
  core_html = htmlMoji.text;
  core_html = stripInvisibleTransport(core_html);
  core_html = normalizeNewlines(core_html).trim();
  if (!core_html) core_html = null;

  var debug_core_html_mojibake_fixed = !!htmlMoji.fixed;
} else {
  var debug_core_html_mojibake_fixed = false;
}

/* ------------------------------ content_type -------------------------------- */

let content_type;
if (intent === "think") {
  content_type = "note";
} else {
  content_type = looksLikeThread(core_text) ? "correspondence" : "newsletter";
}

/* ----------------------------------- output ---------------------------------- */

return [
  {
    json: {
      ...$json,

      source: "email",
      created_at: nowIso,

      // stored fields
      intent,
      content_type,
      title,
      author,
      capture_text,
      core_text,
      core_html,

      // forwarded wrapper split (debug/metadata; not used as content downstream)
      forwarded_found: fwd.found,
      forwarded_headers: fwd.headers,
      forwarded_wrapper_text: fwd.wrapper_text,

      // Debug signals / metrics for downstream decisions & regression auditing
      debug_has_plain,
      debug_has_html,
      debug_raw_plain_len,
      debug_raw_html_len,

      debug_capture_len: capture_text.length,
      debug_core_len: core_text.length,
      debug_core_html_len: core_html ? core_html.length : 0,

      debug_forwarded_parser: fwd.parser,          // gmail | outlook | header_block | none
      debug_forwarded_marker_line: fwd.marker_line,
      debug_forwarded_header_keys: Object.keys(fwd.headers || {}),
      debug_top_header_stripped: !!topStrip.stripped,

      debug_mojibake_fixed: !!coreMoji.fixed,
      debug_mojibake_method: coreMoji.method,

      debug_title_mojibake_fixed,
      debug_author_mojibake_fixed,
      debug_core_html_mojibake_fixed,
    },
  },
];
};
