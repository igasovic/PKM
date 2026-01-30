/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: E-Mail Capture (e-mail-capture)
 * Node: Normalize
 * Node ID: b74a02d7-1371-4de6-afc4-4499b981e469
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

/**
 * Node1 — Normalization / structural decisions (core_text/core_html -> newsletter_text/newsletter_html)
 *
 * CONTRACT
 * Input:
 *   - core_text (required-ish)
 *   - core_html (optional)
 *
 * Output:
 *   - newsletter_text: best plain-text representation for conversion
 *   - newsletter_html: lightly cleaned HTML (NOT structurally amputated)
 *   - debug fields describing structural decisions (teaser dropped, footer trimmed, etc.)
 *
 * GOALS (per plan)
 *   1) STOP keyword-based container deletion in HTML
 *   2) Reintroduce SAFE teaser/main-content de-dup here (not Node3)
 *   3) Footer trimming is span-aware (trim from anchor to end), consistent method
 *   4) Output both representations for Node2 to choose
 *
 * No external deps; n8n runner-safe.
 */

const nowIso = new Date().toISOString();

/* ----------------------------- common helpers ----------------------------- */

const normalizeNewlines = (s) => String(s || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

const makeCfRegex = () => {
  try {
    return new RegExp("\\p{Cf}+", "gu"); // format chars (ZWJ/ZWNJ/etc)
  } catch {
    return /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD\u034F]/g;
  }
};
const RE_CF = makeCfRegex();

const RE_UNI_SPACE = /[\u00A0\u1680\u2000-\u200A\u2007\u202F\u205F\u3000]/g;

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

/* ---------------------------- text normalization --------------------------- */

// Drop known transport artifacts (safe)
function dropTransportArtifactLines(text) {
  const lines = normalizeNewlines(text).split("\n");
  const out = [];

  for (const line of lines) {
    const t = String(line || "").trim();

    // n8n / gmail-ish marker lines that are never content
    if (/^<#m_-?\d+_>\s*$/i.test(t)) continue;

    out.push(line);
  }

  return out.join("\n");
}

// Collapse “decorative divider” garbage (incl. mojibake divider runs)
function looksDecorativeDividerLine(line) {
  const s = String(line || "").trim();
  if (!s) return false;

  // classic separators
  if (/^[-_=*•·]{6,}$/.test(s)) return true;

  // Mostly non-alnum, long, low variety -> divider junk
  let alphaNum = 0;
  let uniq = new Set();
  for (let i = 0; i < s.length && i < 300; i++) {
    const c = s[i];
    uniq.add(c);
    if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9")) alphaNum++;
  }
  if (s.length >= 24 && alphaNum === 0 && uniq.size <= 8) return true;

  // Unicode-heavy divider (Substack-ish): very low letters, repetitive
  try {
    const letters = (s.match(/\p{L}/gu) || []).length;
    if (s.length >= 24 && letters === 0 && uniq.size <= 10) return true;
  } catch {
    // ignore
  }

  return false;
}

function collapseDecorativeDividerRuns(text) {
  const lines = normalizeNewlines(text).split("\n");
  const out = [];
  let lastWasDivider = false;

  for (const line of lines) {
    const isDiv = looksDecorativeDividerLine(line);
    if (isDiv) {
      if (!lastWasDivider) out.push("---"); // normalize run to single separator
      lastWasDivider = true;
      continue;
    }
    lastWasDivider = false;
    out.push(line);
  }
  return out.join("\n");
}

/* ---------------------------- teaser de-dup ---------------------------- */

function splitIntoBlocks(text) {
  const lines = normalizeNewlines(text).split("\n");
  const blocks = [];
  let cur = [];

  for (const line of lines) {
    if (String(line || "").trim() === "") {
      if (cur.length) {
        blocks.push(cur);
        cur = [];
      }
      continue;
    }
    cur.push(line);
  }
  if (cur.length) blocks.push(cur);
  return blocks;
}

const TEASER_HEADER_RE = /(view (in (your )?)?browser|view online|read online|open in browser|trouble viewing|having trouble viewing|web version)/i;

function stripTeaserNoiseLines(blockText) {
  const lines = normalizeNewlines(blockText).split("\n");
  const kept = [];
  for (const line of lines) {
    const t = String(line || "").trim();
    if (!t) continue;
    if (TEASER_HEADER_RE.test(t)) continue;
    if (/^(https?:\/\/\S+|www\.\S+)\s*$/i.test(t)) continue; // header links
    kept.push(line);
  }
  return kept.join("\n").trim();
}

function normalizeForDup(s) {
  let t = String(s || "");
  // remove URLs (they vary wildly)
  t = t.replace(/https?:\/\/[^\s<>()]+/gi, " ");
  t = t.replace(/www\.[^\s<>()]+/gi, " ");
  t = t.toLowerCase();
  // remove punctuation-ish
  t = t.replace(/[\u2010-\u2015]/g, "-");
  t = t.replace(/[^a-z0-9\s-]+/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function maybeDropTeaser(text) {
  const blocks = splitIntoBlocks(text);
  if (blocks.length < 2) {
    return { text, dropped: false, reason: "no_blocks", teaserText: "" };
  }

  const joinedBlocks = blocks.map((b) => b.join("\n").trim());

  // Try dropping 1..3 top blocks (conservative)
  const maxDrop = Math.min(3, joinedBlocks.length - 1);

  for (let n = 1; n <= maxDrop; n++) {
    const before = joinedBlocks.slice(0, n).join("\n\n").trim();
    const after = joinedBlocks.slice(n).join("\n\n").trim();

    if (!before || !after) continue;

    const beforeLen = before.length;
    const afterLen = after.length;

    // Condition: after is substantially longer
    if (!(afterLen >= beforeLen * 1.8 && afterLen >= 900)) continue;

    // Condition: clear separator OR teaser-ish ending
    const beforeLastLine = String(joinedBlocks[n - 1].split("\n").slice(-1)[0] || "").trim();
    const hasSeparator =
      looksDecorativeDividerLine(beforeLastLine) ||
      TEASER_HEADER_RE.test(before) ||
      /\.\.\.\s*$/.test(before) ||
      /…\s*$/.test(before);

    if (!hasSeparator) continue;

    // Duplication signal: normalized "before" appears in normalized "after"
    const beforeCore = stripTeaserNoiseLines(before);
    const beforeCoreNorm = normalizeForDup(beforeCore);
    const afterNorm = normalizeForDup(after);

    const teaserish = /\.\.\.\s*$/.test(beforeCore) || /…\s*$/.test(beforeCore);

    // Require meaningful before core for substring test, unless explicitly teaserish
    if (beforeCoreNorm.length < 120 && !teaserish) continue;

    // Use a capped prefix for stability
    const needle = beforeCoreNorm.slice(0, 600);
    const dup = needle && afterNorm.includes(needle);

    if (!dup && !teaserish) continue;

    // Drop teaser
    return {
      text: after.trim(),
      dropped: true,
      reason: dup ? "dup_substring" : "teaser_ellipsis",
      teaserText: before.trim(),
      teaserBlocksDropped: n,
    };
  }

  return { text, dropped: false, reason: "no_match", teaserText: "" };
}

/* ---------------------------- footer trimming ---------------------------- */

const URL_RE = /(https?:\/\/[^\s<>()]+|www\.[^\s<>()]+)/ig;

const FOOTER_STRONG = [
  "unsubscribe",
  "manage preferences",
  "update preferences",
  "email preferences",
  "preferences link",
  "you are receiving",
  "this email was sent",
  "why am i receiving",
  "forward to a friend",
  "email to a friend",
  "view in browser",
  "view in your browser",
  "trouble viewing",
  "having trouble viewing",
  "powered by",
  "feedblitz",
  "substack",
  "mailchimp",
  "beehiiv",
  "convertkit",
  "campaign monitor",
  "constant contact",
  "klaviyo",
  "sendinblue",
];

const FOOTER_WEAK = ["privacy", "contact", "archives", "subscribe", "settings", "terms"];

function countAlpha(s) {
  try {
    const m = String(s || "").match(/\p{L}/gu);
    return m ? m.length : 0;
  } catch {
    const m = String(s || "").match(/[A-Za-z]/g);
    return m ? m.length : 0;
  }
}

function lineFeatures(line) {
  const raw = String(line || "");
  const l = raw.trim();
  const lower = l.toLowerCase();

  const urls = l.match(URL_RE) || [];
  const urlCount = urls.length;
  const urlChars = urls.reduce((a, u) => a + u.length, 0);

  const alpha = countAlpha(l);
  const total = Math.max(1, l.length);
  const alphaRatio = alpha / total;
  const linkDensity = urlChars / total;

  const noUrls = l.replace(URL_RE, "").replace(/[\s\W_]+/g, "");
  const isUrlOnly = noUrls.length === 0 && urlCount > 0;

  const strongHit = FOOTER_STRONG.some((k) => lower.includes(k));
  const weakHit = FOOTER_WEAK.some((k) => lower.includes(k));

  const looksAddress =
    /\b\d{1,6}\b/.test(l) &&
    /\b(st|street|ave|avenue|rd|road|suite|ste|po box|p\.?o\.?\s*box|blvd|boulevard|lane|ln|drive|dr)\b/i.test(l);

  return { lower, alphaRatio, linkDensity, urlCount, isUrlOnly, strongHit, weakHit, looksAddress };
}

function splitBlocksWithSpans(text) {
  const lines = normalizeNewlines(text).split("\n");
  const blocks = [];
  let cur = [];
  let start = 0;

  const flush = (endExclusive) => {
    if (!cur.length) return;
    blocks.push({ start, end: endExclusive, lines: cur.slice() });
    cur = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (String(line || "").trim() === "") {
      flush(i);
      start = i + 1;
      continue;
    }
    cur.push(line);
  }
  flush(lines.length);

  return { lines, blocks };
}

function blockFooterScore(blockLines) {
  let score = 0;
  for (const line of blockLines) {
    const l = String(line || "").trim();
    if (!l) continue;

    const f = lineFeatures(l);

    if (f.strongHit) score += 5;
    if (f.weakHit) score += 2;
    if (f.looksAddress) score += 3;

    if (f.isUrlOnly) score += 2;
    if (f.urlCount > 0 && f.alphaRatio < 0.22) score += 1;
    if (f.linkDensity > 0.55) score += 2;

    // short nav-ish lines
    if (l.length <= 70 && (f.strongHit || f.weakHit || f.isUrlOnly)) score += 1;
  }
  return score;
}

function findFooterAnchorLineIndex(lines) {
  const TAIL_LINES = 140;
  const start = Math.max(0, lines.length - TAIL_LINES);

  let best = null; // { idx, score }
  for (let i = start; i < lines.length; i++) {
    const t = String(lines[i] || "").trim();
    if (!t) continue;

    const f = lineFeatures(t);

    // anchor score (line-based)
    let s = 0;
    if (f.strongHit) s += 6;
    if (f.weakHit) s += 2;
    if (f.looksAddress) s += 4;

    if (f.isUrlOnly) s += 2;
    if (f.urlCount > 0 && f.alphaRatio < 0.20) s += 2;
    if (f.linkDensity > 0.60) s += 2;

    // require a meaningful anchor
    if (s < 6) continue;

    // prefer earlier anchor (trim more), but keep strongest if tie-ish
    if (!best || i < best.idx || (i === best.idx && s > best.score)) {
      best = { idx: i, score: s };
    }
  }

  return best;
}

function trimFooterSpanAware(text) {
  const original = text;
  const { lines, blocks } = splitBlocksWithSpans(text);

  if (!lines.length) {
    return {
      text: "",
      trimmed: false,
      reason: "empty",
      anchor: null,
      blocksDropped: 0,
      removedChars: 0,
    };
  }

  // Step 1: drop trailing footer-ish blocks (consistent, block-based)
  let endBlock = blocks.length - 1;
  let blocksDropped = 0;

  while (endBlock >= 0) {
    const score = blockFooterScore(blocks[endBlock].lines);

    // Conservative threshold: only drop clearly footer-ish blocks
    if (score >= 8) {
      endBlock--;
      blocksDropped++;
      continue;
    }
    break;
  }

  let keptLines = lines.slice(0);
  if (blocks.length && endBlock < blocks.length - 1) {
    const cutLine = blocks[endBlock] ? blocks[endBlock].end : 0;
    keptLines = lines.slice(0, cutLine);
  }

  // Step 2: anchor-based trim within the remaining tail (span-aware)
  const anchor = findFooterAnchorLineIndex(keptLines);
  let anchorTrimmed = false;

  if (anchor && anchor.idx >= Math.floor(keptLines.length * 0.55)) {
    // only trim from anchor if it’s in the last ~45% of the email
    keptLines = keptLines.slice(0, anchor.idx);
    anchorTrimmed = true;
  }

  let out = keptLines.join("\n").trim();

  // Safety: don’t nuke content accidentally
  const origLen = String(original || "").trim().length;
  const outLen = out.length;

  const tooSmall =
    (origLen >= 1200 && outLen < 300) ||
    (origLen >= 2000 && outLen < origLen * 0.25) ||
    (origLen >= 4000 && outLen < origLen * 0.18);

  if (tooSmall) {
    return {
      text: String(original || "").trim(),
      trimmed: false,
      reason: "safety_abort",
      anchor,
      blocksDropped,
      removedChars: 0,
      anchorTrimmed,
    };
  }

  const removedChars = Math.max(0, origLen - outLen);

  return {
    text: out,
    trimmed: blocksDropped > 0 || anchorTrimmed,
    reason: anchorTrimmed ? "anchor_trim" : blocksDropped > 0 ? "block_trim" : "none",
    anchor,
    blocksDropped,
    removedChars,
    anchorTrimmed,
  };
}

/* ------------------------------ HTML cleanup ------------------------------ */
/**
 * IMPORTANT: no keyword-based container deletion.
 * Only safe removals:
 *   - scripts/styles
 *   - tracking pixels (1x1 / display:none / width:0 height:0 / opacity:0)
 *   - obvious hidden preheaders (display:none etc; small; near top)
 */
function cleanHtmlLight(html) {
  if (!html) return null;

  let h = String(html);

  // hard cap (defensive)
  if (h.length > 2_000_000) h = h.slice(0, 2_000_000);

  // strip scripts/styles
  h = h.replace(/<script[\s\S]*?<\/script>/gi, "");
  h = h.replace(/<style[\s\S]*?<\/style>/gi, "");

  // tracking pixel img tags (keep conservative)
  h = h.replace(
    /<img[^>]+(?:width=["']?\s*(?:0|1)\s*(?:px)?["']?|height=["']?\s*(?:0|1)\s*(?:px)?["']?|style=["'][^"']*(?:display\s*:\s*none|opacity\s*:\s*0|visibility\s*:\s*hidden|width\s*:\s*(?:0|1)px|height\s*:\s*(?:0|1)px)[^"']*["'])[^>]*>/gi,
    ""
  );

  // obvious hidden preheaders (small, near top)
  const TOP_SCAN = 60_000;
  const top = h.slice(0, TOP_SCAN);
  const rest = h.slice(TOP_SCAN);

  const hiddenPreheaderRe =
    /<(div|span|p|td)[^>]*style=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0|max-height\s*:\s*0|mso-hide\s*:\s*all)[^"']*["'][^>]*>[\s\S]{0,4000}?<\/\1>/gi;

  const topCleaned = top.replace(hiddenPreheaderRe, "");

  h = topCleaned + rest;

  // normalize transport invisibles (does NOT restructure)
  const moji = fixMojibakeGuarded(h);
  h = stripInvisibleTransport(moji.text);
  h = normalizeNewlines(h).trim();

  return { html: h || null, mojibakeFixed: !!moji.fixed, mojibakeMethod: moji.method };
}

/* ---------------------------------- inputs ---------------------------------- */

let coreText = String($json.core_text || "");
let coreHtml = $json.core_html || null;

const debug_in_core_text_len = coreText.length;
const debug_in_core_html_len = coreHtml ? String(coreHtml).length : 0;

/* ----------------------------- build newsletter_text ----------------------------- */

let text = coreText;

// baseline cleanup (safe)
const mojiText = fixMojibakeGuarded(text);
text = mojiText.text;

text = decodeEntities(text);
text = stripInvisibleTransport(text);
text = dropTransportArtifactLines(text);
text = collapseDecorativeDividerRuns(text);
text = collapseWhitespacePreserveNewlines(text);

// teaser de-dup (safe + conservative)
const teaser = maybeDropTeaser(text);
let newsletter_text = teaser.text;

// footer trimming (span-aware)
const footer = trimFooterSpanAware(newsletter_text);
newsletter_text = footer.text;

// final normalization pass (keeps stable)
newsletter_text = collapseWhitespacePreserveNewlines(newsletter_text);

/* ----------------------------- build newsletter_html ----------------------------- */

let newsletter_html = null;
let debug_html_mojibake_fixed = false;
let debug_html_mojibake_method = "none";

if (coreHtml && String(coreHtml).trim()) {
  const cleaned = cleanHtmlLight(coreHtml);
  if (cleaned) {
    newsletter_html = cleaned.html;
    debug_html_mojibake_fixed = cleaned.mojibakeFixed;
    debug_html_mojibake_method = cleaned.mojibakeMethod;
  }
}

/* ---------------------------------- debug ---------------------------------- */

const debug_out_newsletter_text_len = newsletter_text.length;
const debug_out_newsletter_html_len = newsletter_html ? newsletter_html.length : 0;

const capDebugText = (s, max = 4000) => {
  const t = String(s || "");
  return t.length > max ? t.slice(0, max) + "\n…[truncated]" : t;
};

return [
  {
    json: {
      ...$json,

      // outputs
      newsletter_text,
      newsletter_html,

      // timestamps
      node1_at: nowIso,

      // debug / metrics
      debug_node1_in_core_text_len: debug_in_core_text_len,
      debug_node1_in_core_html_len: debug_in_core_html_len,
      debug_node1_out_newsletter_text_len: debug_out_newsletter_text_len,
      debug_node1_out_newsletter_html_len: debug_out_newsletter_html_len,

      // teaser debug
      debug_teaser_dropped: !!teaser.dropped,
      debug_teaser_reason: teaser.reason,
      debug_teaser_blocks_dropped: teaser.teaserBlocksDropped || 0,
      debug_teaser_text: teaser.dropped ? capDebugText(teaser.teaserText) : "",

      // footer debug
      debug_footer_trimmed: !!footer.trimmed,
      debug_footer_reason: footer.reason,
      debug_footer_blocks_dropped: footer.blocksDropped || 0,
      debug_footer_anchor_line: footer.anchor ? footer.anchor.idx : -1,
      debug_footer_anchor_score: footer.anchor ? footer.anchor.score : 0,
      debug_footer_anchor_trimmed: !!footer.anchorTrimmed,
      debug_footer_removed_chars: footer.removedChars || 0,

      // mojibake debug
      debug_node1_text_mojibake_fixed: !!mojiText.fixed,
      debug_node1_text_mojibake_method: mojiText.method,
      debug_node1_html_mojibake_fixed: debug_html_mojibake_fixed,
      debug_node1_html_mojibake_method: debug_html_mojibake_method,
    },
  },
];
};
