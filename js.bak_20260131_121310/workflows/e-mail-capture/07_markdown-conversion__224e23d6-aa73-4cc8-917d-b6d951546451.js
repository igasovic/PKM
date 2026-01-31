/**
 * PKM / n8n Externalized Code Node
 *
 * Workflow: E-Mail Capture (e-mail-capture)
 * Node: Markdown Conversion
 * Node ID: 224e23d6-aa73-4cc8-917d-b6d951546451
 */
'use strict';

module.exports = async function run(ctx) {
  const { $input, $json, $items, $node, $env, helpers } = ctx;

/**
 * Node2 — Markdown extraction (newsletter_text/newsletter_html -> newsletter_md)
 *
 * CONTRACT
 * Input:
 *   - newsletter_text (preferred plain text)
 *   - newsletter_html (optional HTML)
 *   - core_text (fallback if newsletter_text missing)
 *
 * Output:
 *   - newsletter_md: markdown-ish text suitable for final cleanup (Node3)
 *   - debug: which source was chosen and why (metrics + guardrails)
 *
 * PRINCIPLES
 *   - Always compute candidates:
 *       md_from_text
 *       md_from_html
 *   - Choose with quality gates (avoid prageng link-only HTML winning)
 *   - Cleanup is conservative: transport artifacts + whitespace only
 *   - Debug reflects the actual final selection + any overrides
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

function dropTransportArtifactLines(text) {
  const lines = normalizeNewlines(text).split("\n");
  const out = [];
  for (const line of lines) {
    const t = String(line || "").trim();
    if (/^<#m_-?\d+_>\s*$/i.test(t)) continue;
    out.push(line);
  }
  return out.join("\n");
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

/* ---------------------------- HTML -> Markdown ---------------------------- */
/**
 * Best-effort, regex-based converter. IMPORTANT: does NOT delete containers by keywords.
 * Keeps content; only strips scripts/styles and transforms tags into readable text.
 */

function htmlToMarkdownSimple(html) {
  if (!html) return { md: "", debug: { steps: [] } };

  let h = String(html);

  // hard cap (defensive)
  if (h.length > 2_000_000) h = h.slice(0, 2_000_000);

  // normalize newlines early
  h = normalizeNewlines(h);

  // remove scripts/styles/comments
  h = h.replace(/<script[\s\S]*?<\/script>/gi, "");
  h = h.replace(/<style[\s\S]*?<\/style>/gi, "");
  h = h.replace(/<!--([\s\S]*?)-->/g, "");

  // drop tracking pixel imgs (1x1 or hidden)
  h = h.replace(
    /<img[^>]+(?:width=["']?\s*(?:0|1)\s*(?:px)?["']?|height=["']?\s*(?:0|1)\s*(?:px)?["']?|style=["'][^"']*(?:display\s*:\s*none|opacity\s*:\s*0|visibility\s*:\s*hidden|width\s*:\s*(?:0|1)px|height\s*:\s*(?:0|1)px)[^"']*["'])[^>]*>/gi,
    ""
  );

  // convert <br> to newline
  h = h.replace(/<br\s*\/?>/gi, "\n");

  // headings -> markdown headings
  for (let k = 1; k <= 6; k++) {
    const re = new RegExp(`<h${k}[^>]*>([\\s\\S]*?)<\\/h${k}>`, "gi");
    const hashes = "#".repeat(k);
    h = h.replace(re, (_, inner) => `\n${hashes} ${inner}\n`);
  }

  // list items -> "- "
  h = h.replace(/<li[^>]*>/gi, "\n- ");
  h = h.replace(/<\/li>/gi, "");

  // block-ish tags -> paragraph breaks
  h = h.replace(/<\/(p|div|table|tr|td|section|article|header|footer|blockquote)>/gi, "\n\n");
  h = h.replace(/<(p|div|table|tr|td|section|article|header|footer|blockquote)[^>]*>/gi, "\n");

  // <hr> -> separator
  h = h.replace(/<hr[^>]*>/gi, "\n---\n");

  // anchors: <a href="...">text</a> -> [text](url)
  // Keep it conservative: if text is empty, use url as text; if url missing, keep text.
  h = h.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
    const url = String(href || "").trim();
    const txt = String(inner || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!url) return txt || "";
    const label = txt || url;
    return `[${label}](${url})`;
  });

  // emphasis/bold (simple)
  h = h.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, inner) => `**${inner}**`);
  h = h.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, inner) => `*${inner}*`);

  // images: prefer alt text; if no alt, ignore
  h = h.replace(/<img[^>]*alt=["']([^"']+)["'][^>]*>/gi, (_, alt) => {
    const a = String(alt || "").trim();
    return a ? `\n![${a}]\n` : "";
  });
  h = h.replace(/<img[^>]*>/gi, "");

  // strip remaining tags
  h = h.replace(/<[^>]+>/g, " ");

  // entity decode + transport cleanup
  h = decodeEntities(h);
  h = stripInvisibleTransport(h);

  // normalize whitespace
  h = h.replace(/[ \t]+/g, " ");
  h = collapseWhitespacePreserveNewlines(h);

  // reduce markdown noise: collapse repeated separators
  h = h.replace(/\n(?:---\n){2,}/g, "\n---\n");

  return { md: h.trim() };
}

/* ---------------------------- candidate building ---------------------------- */

function buildMdFromText(textInput) {
  let t = String(textInput || "");
  const moji = fixMojibakeGuarded(t);
  t = moji.text;

  t = decodeEntities(t);
  t = stripInvisibleTransport(t);
  t = dropTransportArtifactLines(t);
  t = collapseWhitespacePreserveNewlines(t);

  // Minimal readability tweaks (NOT semantic deletion):
  // - Ensure there's a blank line before obvious headings (ALL CAPS line or "Title:" pattern)
  const lines = t.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = out.length ? out[out.length - 1] : "";

    const trimmed = String(line || "").trim();
    const isAllCaps =
      trimmed.length >= 6 &&
      trimmed.length <= 80 &&
      /^[A-Z0-9][A-Z0-9\s\-:&/]+$/.test(trimmed) &&
      (trimmed.match(/[A-Z]/g) || []).length >= 4;

    const looksHeading = isAllCaps || /^#{1,6}\s+/.test(trimmed);

    if (looksHeading && prev && prev.trim() !== "") out.push("");
    out.push(line);
  }

  t = collapseWhitespacePreserveNewlines(out.join("\n"));

  return { md: t, mojibakeFixed: !!moji.fixed, mojibakeMethod: moji.method };
}

/* ---------------------------- scoring / chooser ---------------------------- */

const URL_RE = /(https?:\/\/[^\s<>()]+|www\.[^\s<>()]+)/ig;

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

function computeMetrics(md) {
  const s = String(md || "");
  const len = s.length;

  const letters = countLetters(s);
  const alphaRatio = len ? letters / len : 0;

  const urls = s.match(URL_RE) || [];
  const urlCount = urls.length;
  const urlChars = urls.reduce((a, u) => a + u.length, 0);
  const urlCharDensity = len ? urlChars / len : 0;

  const lines = normalizeNewlines(s).split("\n");
  const nonEmpty = lines.filter((l) => String(l || "").trim() !== "");
  const lineCount = nonEmpty.length || 0;

  let urlOnlyLines = 0;
  for (const line of nonEmpty) {
    const t = String(line || "").trim();
    const noUrls = t.replace(URL_RE, "").replace(/[\s\W_]+/g, "");
    const hasUrl = URL_RE.test(t);
    // reset regex state (global)
    URL_RE.lastIndex = 0;

    if (hasUrl && noUrls.length === 0) urlOnlyLines += 1;
  }

  const urlOnlyPct = lineCount ? urlOnlyLines / lineCount : 0;

  return {
    len,
    letters,
    alphaRatio,
    urlCount,
    urlChars,
    urlCharDensity,
    lineCount,
    urlOnlyLines,
    urlOnlyPct,
  };
}

function scoreCandidate(m) {
  // higher is better
  // emphasize textiness, penalize url dominance, small boost for “not tiny”
  const lenBoost = Math.min(1, m.len / 2500) * 10; // max +10
  const s =
    m.alphaRatio * 100 +
    lenBoost -
    m.urlCharDensity * 70 -
    m.urlOnlyPct * 60 -
    Math.min(30, Math.log10(1 + m.urlCount) * 8); // mild penalty for many urls
  return s;
}

function classifyBadHtml(mdMetrics) {
  // “mostly URLs” / “low textiness” hard gates to fix prageng-style failures
  const bad =
    mdMetrics.len > 0 &&
    (mdMetrics.urlOnlyPct >= 0.45 ||
      mdMetrics.alphaRatio <= 0.085 ||
      (mdMetrics.urlCharDensity >= 0.55 && mdMetrics.alphaRatio < 0.16));

  const reasons = [];
  if (mdMetrics.urlOnlyPct >= 0.45) reasons.push("html_url_only_lines_high");
  if (mdMetrics.alphaRatio <= 0.085) reasons.push("html_alpha_density_low");
  if (mdMetrics.urlCharDensity >= 0.55 && mdMetrics.alphaRatio < 0.16) reasons.push("html_url_density_high");

  return { bad, reasons };
}

function pickBestCandidate(textCand, htmlCand, coreFallbackCand) {
  // Compute metrics + scores
  const mt = computeMetrics(textCand.md);
  const mh = computeMetrics(htmlCand.md);
  const mc = computeMetrics(coreFallbackCand.md);

  const st = scoreCandidate(mt);
  const sh = scoreCandidate(mh);
  const sc = scoreCandidate(mc);

  const reasons = [];
  let used = "text";
  let chosen = textCand.md;
  let chosenMetrics = mt;
  let chosenScore = st;

  // Decide text candidate input source label (newsletter_text vs core_text)
  const textIsEmpty = mt.len === 0;
  const coreHasContent = mc.len > 0;

  if (textIsEmpty && coreHasContent) {
    used = "core_fallback";
    chosen = coreFallbackCand.md;
    chosenMetrics = mc;
    chosenScore = sc;
    reasons.push("newsletter_text_empty_used_core_fallback");
  }

  // If HTML is available, evaluate it vs the currently chosen text-ish candidate
  const htmlExists = mh.len > 0;

  if (htmlExists) {
    const badHtml = classifyBadHtml(mh);

    if (badHtml.bad) {
      reasons.push(...badHtml.reasons);
      reasons.push("prefer_text_due_to_html_quality_gate");
    } else {
      // Compare scores; also consider length ratio
      const otherMetrics = chosenMetrics;
      const otherScore = chosenScore;

      const lenRatio = otherMetrics.len > 0 ? mh.len / otherMetrics.len : 0;

      // If HTML is dramatically shorter, be skeptical unless score is MUCH higher
      const htmlMuchShorter = otherMetrics.len >= 800 && mh.len < otherMetrics.len * 0.35;

      if (sh > otherScore + (htmlMuchShorter ? 12 : 3)) {
        used = "html";
        chosen = htmlCand.md;
        chosenMetrics = mh;
        chosenScore = sh;
        reasons.push("html_score_higher");
        if (htmlMuchShorter) reasons.push("html_short_but_score_strong");
      } else {
        reasons.push("text_score_higher_or_html_not_better");
      }

      // If HTML is slightly better but mostly duplicative/linky, keep text.
      if (used === "html" && (mh.urlOnlyPct > otherMetrics.urlOnlyPct + 0.15)) {
        used = used === "core_fallback" ? "core_fallback" : "text";
        chosen = used === "core_fallback" ? coreFallbackCand.md : textCand.md;
        chosenMetrics = used === "core_fallback" ? mc : mt;
        chosenScore = used === "core_fallback" ? sc : st;
        reasons.push("override_html_due_to_higher_url_only_pct");
      }

      // Guardrail: if chosen ends up extremely small relative to the other, revert
      const altMd = used === "html" ? (chosenMetrics === mh ? (textIsEmpty ? coreFallbackCand.md : textCand.md) : "") : htmlCand.md;
      const altMetrics = used === "html" ? (textIsEmpty ? mc : mt) : mh;

      if (
        chosenMetrics.len > 0 &&
        altMetrics.len >= 900 &&
        chosenMetrics.len < altMetrics.len * 0.10
      ) {
        // revert to the larger candidate
        if (used === "html") {
          used = textIsEmpty ? "core_fallback" : "text";
          chosen = textIsEmpty ? coreFallbackCand.md : textCand.md;
          chosenMetrics = textIsEmpty ? mc : mt;
          chosenScore = textIsEmpty ? sc : st;
          reasons.push("guardrail_revert_html_too_small");
        } else {
          // revert to html only if it was the larger one (rare here)
          used = "html";
          chosen = htmlCand.md;
          chosenMetrics = mh;
          chosenScore = sh;
          reasons.push("guardrail_revert_text_too_small");
        }
      }
    }
  } else {
    reasons.push("no_html_candidate");
  }

  return {
    used,
    reason: reasons.join("; "),
    chosen,
    chosenMetrics,
    chosenScore,
    mt,
    mh,
    mc,
    st,
    sh,
    sc,
  };
}

/* ---------------------------------- inputs ---------------------------------- */

const newsletterTextIn = String($json.newsletter_text || "");
const newsletterHtmlIn = $json.newsletter_html || null;
const coreTextIn = String($json.core_text || "");

/* ---------------------------- build candidates ---------------------------- */

const textCand = buildMdFromText(newsletterTextIn);
const coreCand = buildMdFromText(coreTextIn);

let htmlCand = { md: "" };
let htmlMojibakeFixed = false;
let htmlMojibakeMethod = "none";
if (newsletterHtmlIn && String(newsletterHtmlIn).trim()) {
  const moji = fixMojibakeGuarded(String(newsletterHtmlIn));
  const conv = htmlToMarkdownSimple(moji.text);
  htmlCand = { md: conv.md };

  htmlMojibakeFixed = !!moji.fixed;
  htmlMojibakeMethod = moji.method;
}

/* ------------------------------ choose best ------------------------------ */

const choice = pickBestCandidate(textCand, htmlCand, coreCand);

// Conservative final cleanup only (no semantic deletions)
let newsletter_md = choice.chosen;
newsletter_md = dropTransportArtifactLines(newsletter_md);
newsletter_md = collapseWhitespacePreserveNewlines(newsletter_md);

/* ---------------------------------- debug ---------------------------------- */

function round3(x) {
  return Math.round((x + Number.EPSILON) * 1000) / 1000;
}

return [
  {
    json: {
      ...$json,

      newsletter_md,
      node2_at: nowIso,

      // Actual branch used (set at selection time)
      debug_used: choice.used,
      debug_choice_reason: choice.reason,
      debug_choice_score: round3(choice.chosenScore),

      // Final output metrics
      debug_md_len: choice.chosenMetrics.len,
      debug_alpha_ratio: round3(choice.chosenMetrics.alphaRatio),
      debug_url_count: choice.chosenMetrics.urlCount,
      debug_url_char_density: round3(choice.chosenMetrics.urlCharDensity),
      debug_url_lines_pct: round3(choice.chosenMetrics.urlOnlyPct),

      // Candidate metrics (for audits / regression)
      debug_text_md_len: choice.mt.len,
      debug_text_alpha_ratio: round3(choice.mt.alphaRatio),
      debug_text_url_lines_pct: round3(choice.mt.urlOnlyPct),
      debug_text_url_char_density: round3(choice.mt.urlCharDensity),
      debug_text_score: round3(choice.st),
      debug_text_mojibake_fixed: !!textCand.mojibakeFixed,
      debug_text_mojibake_method: textCand.mojibakeMethod,

      debug_html_md_len: choice.mh.len,
      debug_html_alpha_ratio: round3(choice.mh.alphaRatio),
      debug_html_url_lines_pct: round3(choice.mh.urlOnlyPct),
      debug_html_url_char_density: round3(choice.mh.urlCharDensity),
      debug_html_score: round3(choice.sh),
      debug_html_input_mojibake_fixed: htmlMojibakeFixed,
      debug_html_input_mojibake_method: htmlMojibakeMethod,

      debug_core_fallback_md_len: choice.mc.len,
      debug_core_fallback_alpha_ratio: round3(choice.mc.alphaRatio),
      debug_core_fallback_url_lines_pct: round3(choice.mc.urlOnlyPct),
      debug_core_fallback_url_char_density: round3(choice.mc.urlCharDensity),
      debug_core_fallback_score: round3(choice.sc),
    },
  },
];
};
