/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: E-Mail Capture (e-mail-capture)
 * Node: Remove Boilerplate
 * Node ID: 02e08da0-cb80-465c-b77b-d881bfe5a0b0
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

/**
 * Node3 — Boilerplate cleanup & polish (newsletter_md -> clean_text + metadata)
 *
 * CONTRACT
 * Input:
 *   - newsletter_md (+ existing metadata fields like author/url_canonical/title/etc)
 *
 * Output:
 *   - clean_text: readable final content (must not be empty unless input is empty)
 *   - url_canonical: best “view online” URL if available (do not overwrite non-empty)
 *   - author: may be derived conservatively, but must NOT override non-empty author
 *   - debug fields: what was removed, anchor decisions, safety reverts
 *
 * PRINCIPLES
 *   - Teaser deletion belongs upstream (Node1). Node3 only does it with VERY strong evidence,
 *     and only if Node1 did NOT already drop teaser (debug_teaser_dropped !== true).
 *   - Footer trimming is anchor-based (handles “address last”).
 *   - Never output empty unless input is effectively empty (hard requirement).
 *   - View-online removal is strict (label line only + URL captured).
 *   - FeedBlitz tracking removal only affects URL-only lines on known tracking hosts,
 *     or surgically removes the URL when line has real text.
 *
 * No external deps; n8n runner-safe.
 */

const nowIso = new Date().toISOString();

/* ----------------------------- common helpers ----------------------------- */

const normalizeNewlines = (s) => String(s || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

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

const makeCfRegex = () => {
  try {
    return new RegExp("\\p{Cf}+", "gu");
  } catch {
    return /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD\u034F]/g;
  }
};
const RE_CF = makeCfRegex();
const RE_UNI_SPACE = /[\u00A0\u1680\u2000-\u200A\u2007\u202F\u205F\u3000]/g;

function stripInvisibleTransport(s) {
  return String(s || "")
    .replace(/\u0000/g, "")
    .replace(RE_UNI_SPACE, " ")
    .replace(RE_CF, "")
    .replace(/\u00A0/g, " ");
}

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

/* ----------------------------- mojibake guard ---------------------------- */

const MOJI_SIGNAL = /(?:â[\u0080-\u00BF]|Ã[\u0080-\u00BF]|Â[\u0080-\u00BF]|â€”|â€“|â€™|â€œ|â€\x9d|â€¢|â€¦|Â )/;

function mojiScore(s) {
  const str = String(s || "");
  if (!str) return 0;
  const m = str.match(new RegExp(MOJI_SIGNAL.source, "g"));
  const scoreSignals = m ? m.length : 0;
  const scoreRepl = (str.match(/\uFFFD/g) || []).length;
  return scoreSignals + scoreRepl;
}

function fixMojibakeGuarded(s) {
  const str = String(s || "");
  if (!str) return { text: str, fixed: false, method: "none" };

  if (!MOJI_SIGNAL.test(str) && str.indexOf("\uFFFD") === -1) {
    return { text: str, fixed: false, method: "none" };
  }

  try {
    const bytes = Uint8Array.from(str, (c) => c.charCodeAt(0) & 0xff);

    let out = null;
    if (typeof TextDecoder !== "undefined") {
      out = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } else if (typeof Buffer !== "undefined") {
      out = Buffer.from(bytes).toString("utf8");
    }

    if (out && out !== str && mojiScore(out) <= mojiScore(str)) {
      return { text: out, fixed: true, method: "latin1->utf8" };
    }
  } catch (_) {}

  const out2 = str
    .replace(/â€™/g, "’")
    .replace(/â€œ/g, "“")
    .replace(/â€\x9d/g, "”")
    .replace(/â€“/g, "–")
    .replace(/â€”/g, "—")
    .replace(/â€¦/g, "…")
    .replace(/â€¢/g, "•")
    .replace(/Â /g, " ")
    .replace(/Â/g, "");

  return { text: out2, fixed: out2 !== str, method: out2 !== str ? "replace" : "none" };
}

/* ------------------------------- URL helpers ------------------------------ */

const URL_RE = /(https?:\/\/[^\s)<>]+|www\.[^\s)<>]+)/ig;

function extractUrls(line) {
  const m = String(line || "").match(URL_RE);
  return m ? m.map((u) => u.trim()) : [];
}

function firstUrl(line) {
  const u = extractUrls(line);
  return u.length ? u[0] : null;
}

function urlFromMarkdownLink(line) {
  const m = String(line || "").match(/\[[^\]]*\]\((https?:\/\/[^)]+)\)/i);
  return m ? m[1] : null;
}

function parseHost(url) {
  const u = String(url || "").trim();
  if (!u) return null;
  try {
    const fixed = u.startsWith("http") ? u : `https://${u}`;
    return new URL(fixed).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function lineIsUrlOnly(line) {
  const l = String(line || "").trim();
  if (!l) return false;

  const urls = extractUrls(l);
  if (!urls.length) return false;

  // remove markdown links first: "[x](url)" -> ""
  let t = l.replace(/\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi, "");

  // remove bare urls
  t = t.replace(URL_RE, "");

  // remove angle brackets + punctuation + whitespace
  t = t.replace(/[<>\[\]()*•·—–\-_,.:;'"“”‘’|/\\]/g, "");
  t = t.replace(/\s+/g, "").trim();

  return t.length === 0;
}

function countLetters(s) {
  const str = String(s || "");
  try {
    const m = str.match(/\p{L}/gu);
    return m ? m.length : 0;
  } catch {
    const m = str.match(/[A-Za-z]/g);
    return m ? m.length : 0;
  }
}

/* ----------------------- transport / artifact filters --------------------- */

function isTransportArtifactLine(line) {
  const l = String(line || "").trim();
  return /^<?#?m_[\w-]+_>?$/i.test(l) || /^<#m_-?\d+_>\s*$/i.test(l);
}

function isEmptyAngleLink(line) {
  const l = String(line || "").trim();
  return /^<\s*>$/.test(l);
}

function isDecorativeSeparator(line) {
  const l = String(line || "").trim();
  if (!l) return false;
  // keep markdown "---" (meaningful), but remove long dash runs
  if (l === "---") return false;
  return /^-{12,}$/.test(l) || /^_{12,}$/.test(l) || /^={12,}$/.test(l);
}

/* -------------------------- view online (strict) -------------------------- */

function looksViewOnlineLabelLineStrict(line) {
  const raw = String(line || "").trim();
  if (!raw) return false;

  // exact labels
  const l = raw.toLowerCase();

  // a markdown link that is ONLY "view online"/"view in browser"
  const md = raw.match(/^\s*\[([^\]]+)\]\((https?:\/\/[^)]+)\)\s*$/i);
  if (md) {
    const label = String(md[1] || "").trim().toLowerCase();
    return (
      label === "view online" ||
      label === "view in browser" ||
      label === "view in your browser" ||
      label === "open in browser" ||
      label === "read online" ||
      label === "web version"
    );
  }

  // strict short label line (not prose)
  if (raw.length > 42) return false;

  return /^(view (online|in (your )?browser)|open in browser|read online|web version)\s*[:\-–—]?\s*$/i.test(
    raw
  );
}

function tryExtractViewOnline(lines) {
  // scan first 30 lines (including blanks, but label is usually non-empty)
  const MAX = Math.min(30, lines.length);

  for (let i = 0; i < MAX; i++) {
    const cur = String(lines[i] || "").trim();
    if (!cur) continue;

    if (!looksViewOnlineLabelLineStrict(cur)) continue;

    // capture url from same line or next non-empty line (ideally url-only)
    let url =
      urlFromMarkdownLink(cur) ||
      firstUrl(cur) ||
      urlFromMarkdownLink(lines[i + 1] || "") ||
      firstUrl(lines[i + 1] || "");

    if (!url) {
      // cannot safely remove anything
      return { found: true, removed: false, url: null, at: i, reason: "label_found_no_url" };
    }

    // remove label line, and remove next line only if it's url-only
    lines[i] = "";

    const next = String(lines[i + 1] || "").trim();
    if (next && lineIsUrlOnly(next)) {
      lines[i + 1] = "";
    }

    return { found: true, removed: true, url, at: i, reason: "label_and_url_removed" };
  }

  return { found: false, removed: false, url: null, at: -1, reason: "not_found" };
}

/* ------------------------ FeedBlitz tracking removal ----------------------- */

function isFeedblitzTrackingHost(host) {
  if (!host) return false;
  return (
    host === "p.feedblitz.com" ||
    host === "app.feedblitz.com" ||
    host === "archive.feedblitz.com" ||
    host === "feeds.feedblitz.com"
  );
}

function removeFeedblitzTracking(lines) {
  let removedLines = 0;
  let strippedUrls = 0;

  const out = [];

  for (let line of lines) {
    const raw = String(line || "");
    const trimmed = raw.trim();
    if (!trimmed) {
      out.push(raw);
      continue;
    }

    const urls = extractUrls(trimmed);
    if (!urls.length) {
      out.push(raw);
      continue;
    }

    const hosts = urls.map(parseHost);
    const hasFeedblitz = hosts.some(isFeedblitzTrackingHost);

    if (!hasFeedblitz) {
      out.push(raw);
      continue;
    }

    // If the whole line is just a tracking URL (or multiple URLs), remove it.
    if (lineIsUrlOnly(trimmed) && hosts.every((h) => isFeedblitzTrackingHost(h))) {
      removedLines++;
      continue;
    }

    // Otherwise, surgically remove only feedblitz URLs, keep the text.
    let newLine = raw;
    for (const u of urls) {
      const h = parseHost(u);
      if (isFeedblitzTrackingHost(h)) {
        // remove the exact URL substring; do not try to be smart about punctuation beyond whitespace cleanup
        newLine = newLine.split(u).join("");
        strippedUrls++;
      }
    }

    // cleanup if we stripped something
    newLine = newLine.replace(/\(\s*\)/g, " ");
    newLine = newLine.replace(/[ \t]+/g, " ").trim();

    // If line becomes empty or effectively url-only after stripping, drop it.
    if (!newLine || newLine.trim() === "" || lineIsUrlOnly(newLine)) {
      removedLines++;
      continue;
    }

    out.push(newLine);
  }

  return { lines: out, removedLines, strippedUrls };
}

/* ------------------------- teaser removal (very strong) ------------------------- */
/**
 * Preferred behavior: do nothing (Node1 owns teaser removal).
 * If Node1 didn't run / didn't drop, allow a very-strong-evidence drop:
 *   - only around first long dashed separator (or markdown --- separator)
 *   - after is MUCH longer
 *   - before is shortish AND teaserish OR duplicated in after strongly
 * Always record removed span in debug_teaser_removed.
 */

function normalizeForDup(s) {
  return String(s || "")
    .toLowerCase()
    .replace(URL_RE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function maybeDropTeaserVeryStrong(text) {
  const t = normalizeNewlines(String(text || "")).trim();
  if (!t) return { text: t, dropped: false, removed: "", reason: "empty" };

  const lines = t.split("\n");

  // find first separator line: either a big dash run OR markdown "---" line
  let sep = -1;
  for (let i = 0; i < Math.min(lines.length, 220); i++) {
    const l = String(lines[i] || "").trim();
    if (l === "---" || /^-{20,}$/.test(l)) {
      sep = i;
      break;
    }
  }
  if (sep === -1) return { text: t, dropped: false, removed: "", reason: "no_separator" };

  const before = lines.slice(0, sep).join("\n").trim();
  const after = lines.slice(sep + 1).join("\n").trim();

  if (!before || !after) return { text: t, dropped: false, removed: "", reason: "no_before_or_after" };

  // VERY conservative thresholds
  if (!(after.length >= before.length * 2.2 && after.length >= 1000)) {
    return { text: t, dropped: false, removed: "", reason: "after_not_much_longer" };
  }
  if (before.length > 1200) {
    return { text: t, dropped: false, removed: "", reason: "before_too_large" };
  }

  const teaserish = /(\.\.\.\s*$|…\s*$)/m.test(before) || /view online|view in (your )?browser/i.test(before);

  const bN = normalizeForDup(before);
  const aN = normalizeForDup(after);

  const needle = bN.slice(0, Math.min(500, bN.length));
  const duplicated = needle.length >= 160 && aN.includes(needle);

  if (!(teaserish || duplicated)) {
    return { text: t, dropped: false, removed: "", reason: "no_strong_teaser_signal" };
  }

  return {
    text: after.trim(),
    dropped: true,
    removed: before.trim(),
    reason: duplicated ? "dup_substring_strong" : "teaserish_strong",
  };
}

/* --------------------------- footer trimming (anchor) --------------------------- */

const FOOTER_ANCHORS_STRONG = [
  /manage subscription/i,
  /manage (your )?preferences/i,
  /update preferences/i,
  /email preferences/i,
  /unsubscribe/i,
  /safely unsubscribe/i,
  /why am i receiving/i,
  /you are receiving/i,
  /this email was sent/i,
  /email subscriptions powered by/i,
  /\bpowered by\b/i,
  /\bfeedblitz\b/i,
  /\bmailchimp\b/i,
  /\bsubstack\b/i,
  /\bbeehiiv\b/i,
  /\bconvertkit\b/i,
  /\bcampaign monitor\b/i,
  /\bconstant contact\b/i,
  /\bklaviyo\b/i,
  /privacy policy/i,
  /\bterms\b/i,
];

const FOOTER_WEAK_TAIL = [
  /\barchives?\b/i,
  /\bpreferences?\b/i,
  /\bcontact\b/i,
  /\bsubscribe\b/i,
];

function lineLooksMostlyLinks(line) {
  const l = String(line || "").trim();
  if (!l) return false;

  const urls = extractUrls(l);
  if (!urls.length) return false;

  const urlChars = urls.reduce((a, u) => a + u.length, 0);
  const alpha = countLetters(l);
  const total = Math.max(1, l.length);

  const alphaRatio = alpha / total;
  const linkDensity = urlChars / total;

  // url-only counts as mostly links
  if (lineIsUrlOnly(l)) return true;

  return linkDensity > 0.60 && alphaRatio < 0.22;
}

function findFooterAnchor(lines) {
  // use trimmed non-empty lines but keep original indices
  let end = lines.length - 1;
  while (end >= 0 && !String(lines[end] || "").trim()) end--;

  if (end < 0) return null;

  const TAIL = 80;
  const start = Math.max(0, end - TAIL);

  const minPos = Math.floor(lines.length * 0.55); // avoid clipping mid-body sections

  let best = null; // { idx, score, line }
  for (let i = start; i <= end; i++) {
    const raw = String(lines[i] || "");
    const t = raw.trim();
    if (!t) continue;

    let score = 0;

    if (FOOTER_ANCHORS_STRONG.some((re) => re.test(t))) score += 6;
    if (FOOTER_WEAK_TAIL.some((re) => re.test(t))) score += 2;

    if (lineIsUrlOnly(t)) score += 2;
    if (lineLooksMostlyLinks(t)) score += 1;

    // require strong-ish evidence
    if (score < 6) continue;
    if (i < minPos) continue;

    // choose the earliest strong anchor in tail (cuts full footer), but keep higher score if same idx
    if (!best || i < best.idx || (i === best.idx && score > best.score)) {
      best = { idx: i, score, line: t };
    }
  }

  return best;
}

function trimFooterByAnchor(text) {
  const orig = normalizeNewlines(String(text || "")).trim();
  const lines = orig.split("\n");

  const anchor = findFooterAnchor(lines);
  if (!anchor) {
    return { text: orig, trimmed: false, anchorFound: false, anchorLine: -1, removedLines: 0, reason: "no_anchor" };
  }

  const kept = lines.slice(0, anchor.idx).join("\n").trim();
  const removedLines = Math.max(0, lines.length - anchor.idx);

  return {
    text: kept,
    trimmed: true,
    anchorFound: true,
    anchorLine: anchor.idx,
    anchorScore: anchor.score,
    anchorPreview: anchor.line.slice(0, 180),
    removedLines,
    reason: "anchor_cut",
  };
}

function trimFooterFallbackFromBottom(text) {
  // conservative bottom-up fallback: remove only if clearly footer-ish, stop early
  const orig = normalizeNewlines(String(text || "")).trim();
  const lines = orig.split("\n");

  let end = lines.length - 1;
  while (end >= 0 && !String(lines[end] || "").trim()) end--;
  if (end < 0) return { text: "", trimmed: false, removedLines: 0, reason: "empty" };

  const footerish = (line) => {
    const t = String(line || "").trim();
    if (!t) return true;

    // strong anchors => footerish
    if (FOOTER_ANCHORS_STRONG.some((re) => re.test(t))) return true;

    // weak anchors only if in tail and line is also linky/nav-ish
    if (FOOTER_WEAK_TAIL.some((re) => re.test(t)) && (lineLooksMostlyLinks(t) || extractUrls(t).length > 0)) return true;

    // purely url-only at bottom is usually footer/nav
    if (lineIsUrlOnly(t) && lineLooksMostlyLinks(t)) return true;

    return false;
  };

  let cut = end;
  let removed = 0;

  while (cut >= 0) {
    const t = String(lines[cut] || "").trim();
    if (!t) {
      cut--;
      continue;
    }

    if (footerish(t)) {
      removed++;
      cut--;
      continue;
    }
    break;
  }

  if (removed === 0) {
    return { text: orig, trimmed: false, removedLines: 0, reason: "no_footerish_tail" };
  }

  const out = lines.slice(0, cut + 1).join("\n").trim();
  return { text: out, trimmed: true, removedLines: removed, reason: "fallback_bottomup" };
}

/* --------------------------- author derivation --------------------------- */

function looksLikePersonName(s) {
  const v = String(s || "").trim();
  if (!v) return false;
  if (v.length < 2 || v.length > 60) return false;
  if (/https?:\/\//i.test(v) || /@/.test(v)) return false;
  if (/[<>]/.test(v)) return false;
  if (/^the\b/i.test(v)) return false;
  if (/^the way\b/i.test(v)) return false;

  // allow letters + spaces + a few name punctuations
  if (!/^[A-Za-z\u00C0-\u024F\u1E00-\u1EFF\s.'’-]+$/.test(v)) return false;

  // avoid single long weird token
  const words = v.split(/\s+/).filter(Boolean);
  if (words.length > 6) return false;

  // require at least 1 letter
  if (countLetters(v) < 2) return false;

  return true;
}

function deriveAuthorFromTop(mdText) {
  const lines = normalizeNewlines(String(mdText || "")).split("\n").slice(0, 25);
  for (const ln of lines) {
    const t = String(ln || "").trim();
    if (!t) continue;

    const m = t.match(/^by\s+(.+)\s*$/i);
    if (!m) continue;

    const cand = String(m[1] || "").trim();
    if (!looksLikePersonName(cand)) continue;

    return cand;
  }
  return null;
}

/* ------------------------------- pipeline ------------------------------- */

const mdInRaw = String($json.newsletter_md || "");
const mdInNorm = normalizeNewlines(mdInRaw);

const inputAlpha = countLetters(mdInNorm);
const inputLen = mdInNorm.trim().length;
const inputMeaningful = inputAlpha >= 180 || (inputLen >= 800 && inputAlpha >= 80);

// Baseline sanitize (do NOT delete semantics)
const moji1 = fixMojibakeGuarded(mdInNorm);
let text = moji1.text;
text = decodeEntities(text);
text = stripInvisibleTransport(text);
text = collapseWhitespacePreserveNewlines(text);

// Work with lines for removals
let lines = text.split("\n");

let debug_transport_removed = 0;
let debug_empty_angle_removed = 0;
let debug_separators_removed = 0;

lines = lines.filter((ln) => {
  if (isTransportArtifactLine(ln)) {
    debug_transport_removed++;
    return false;
  }
  if (isEmptyAngleLink(ln)) {
    debug_empty_angle_removed++;
    return false;
  }
  if (isDecorativeSeparator(ln)) {
    debug_separators_removed++;
    return false;
  }
  return true;
});

// View Online (strict)
const hasUrlCanonicalAlready = $json.url_canonical && String($json.url_canonical).trim() !== "";
const viewOnline = tryExtractViewOnline(lines);
let canonical_url = null;
let debug_view_online_removed = false;

if (viewOnline.found && viewOnline.removed && viewOnline.url) {
  canonical_url = viewOnline.url;
  debug_view_online_removed = true;
}

// If url_canonical already exists, do not overwrite
const url_canonical = hasUrlCanonicalAlready ? String($json.url_canonical).trim() : (canonical_url || null);

// Remove empty lines created by label/url deletion
lines = lines.filter((ln) => String(ln || "").trim() !== "");

// FeedBlitz tracking removal (safe)
const fb = removeFeedblitzTracking(lines);
lines = fb.lines;

// Rebuild candidate pre-footer text
let v1 = collapseWhitespacePreserveNewlines(lines.join("\n"));

// Optional VERY-strong teaser drop (usually disabled in practice)
// Only attempt if Node1 did not already drop teaser.
let debug_teaser_removed = false;
let debug_teaser_removed_reason = "disabled_or_not_triggered";
let debug_teaser_removed_span = "";

const upstreamTeaserDropped = $json.debug_teaser_dropped === true;

if (!upstreamTeaserDropped) {
  const td = maybeDropTeaserVeryStrong(v1);
  if (td.dropped) {
    v1 = td.text;
    debug_teaser_removed = true;
    debug_teaser_removed_reason = td.reason;
    debug_teaser_removed_span = td.removed;
  } else {
    debug_teaser_removed_reason = td.reason;
  }
}

// Footer trim (anchor-first, fallback-second)
const footerAnchorTrim = trimFooterByAnchor(v1);
let v2 = footerAnchorTrim.text;

let footerFallbackTrim = null;
if (!footerAnchorTrim.trimmed) {
  footerFallbackTrim = trimFooterFallbackFromBottom(v1);
  v2 = footerFallbackTrim.text;
}

// Polish: collapse whitespace
v2 = collapseWhitespacePreserveNewlines(v2);

// Safety: NEVER empty (unless input empty)
let clean_text = v2;

let debug_reverted_due_to_small_output = false;
let debug_revert_reason = "none";
let debug_final_stage = "footer_trimmed";

const outLen = clean_text.trim().length;
const outAlpha = countLetters(clean_text);

const tooSmall =
  (inputLen >= 1200 && outLen < Math.max(260, Math.floor(inputLen * 0.12))) ||
  (inputLen >= 800 && outLen < 160) ||
  (inputMeaningful && outAlpha < Math.min(60, Math.floor(inputAlpha * 0.10))) ||
  (inputMeaningful && outLen === 0);

if (tooSmall) {
  // revert to less aggressive version (pre-footer)
  const v1Len = v1.trim().length;
  const v1Alpha = countLetters(v1);

  clean_text = v1;

  debug_reverted_due_to_small_output = true;
  debug_revert_reason = `too_small_after_footer_trim(outLen=${outLen},inLen=${inputLen})`;
  debug_final_stage = "reverted_to_pre_footer";

  // If even v1 is somehow empty but input had content, fall back to baseline text
  if (clean_text.trim().length === 0 && inputLen > 0) {
    clean_text = text.trim();
    debug_revert_reason += "; fallback_to_baseline";
    debug_final_stage = "reverted_to_baseline";
  }

  // If view-online removal was the only meaningful deletion (rare), keep safety
  if (inputMeaningful && v1Len < Math.floor(inputLen * 0.10) && v1Alpha < Math.floor(inputAlpha * 0.10)) {
    clean_text = text.trim();
    debug_revert_reason += "; v1_too_small_fallback_to_baseline";
    debug_final_stage = "reverted_to_baseline";
  }
}

// Final hard requirement: never empty unless input empty/whitespace
if (clean_text.trim().length === 0 && inputLen > 0) {
  clean_text = text.trim();
  debug_reverted_due_to_small_output = true;
  debug_revert_reason = debug_revert_reason === "none" ? "hard_non_empty_fallback" : debug_revert_reason + "; hard_non_empty_fallback";
  debug_final_stage = "hard_fallback";
}

// Author derivation (do NOT override existing)
let author = $json.author && String($json.author).trim() !== "" ? String($json.author).trim() : null;
let debug_author_derived = false;

if (!author) {
  const derived = deriveAuthorFromTop(clean_text);
  if (derived) {
    author = derived;
    debug_author_derived = true;
  }
}

return [
  {
    json: {
      ...$json,

      // outputs
      clean_text,
      author,
      url_canonical,

      node3_at: nowIso,

      // debug
      debug_node3_input_len: inputLen,
      debug_node3_input_alpha: inputAlpha,
      debug_node3_output_len: clean_text.trim().length,
      debug_node3_output_alpha: countLetters(clean_text),

      debug_mojibake_fixed: !!moji1.fixed,
      debug_mojibake_method: moji1.method,

      debug_transport_lines_removed: debug_transport_removed,
      debug_empty_angle_lines_removed: debug_empty_angle_removed,
      debug_decorative_separators_removed: debug_separators_removed,

      debug_view_online_found: !!viewOnline.found,
      debug_view_online_removed: !!debug_view_online_removed,
      debug_view_online_reason: viewOnline.reason,
      debug_view_online_line: viewOnline.at,
      debug_view_online_url: canonical_url || null,

      debug_feedblitz_tracking_lines_removed: fb.removedLines,
      debug_feedblitz_tracking_urls_stripped: fb.strippedUrls,

      debug_footer_anchor_found: !!footerAnchorTrim.anchorFound,
      debug_footer_anchor_line: footerAnchorTrim.anchorFound ? footerAnchorTrim.anchorLine : -1,
      debug_footer_anchor_score: footerAnchorTrim.anchorFound ? footerAnchorTrim.anchorScore : 0,
      debug_footer_anchor_preview: footerAnchorTrim.anchorFound ? footerAnchorTrim.anchorPreview : "",
      debug_footer_trimmed: !!(footerAnchorTrim.trimmed || (footerFallbackTrim && footerFallbackTrim.trimmed)),
      debug_footer_trim_reason: footerAnchorTrim.trimmed
        ? footerAnchorTrim.reason
        : footerFallbackTrim
        ? footerFallbackTrim.reason
        : "none",

      debug_teaser_removed: !!debug_teaser_removed,
      debug_teaser_removed_reason: debug_teaser_removed_reason,
      debug_teaser_removed_span: debug_teaser_removed ? debug_teaser_removed_span.slice(0, 4000) : "",

      debug_reverted_due_to_small_output: !!debug_reverted_due_to_small_output,
      debug_revert_reason: debug_revert_reason,
      debug_final_stage: debug_final_stage,

      debug_author_derived: debug_author_derived,
    },
  },
];
};
