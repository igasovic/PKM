'use strict';

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

function countWords(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function normalizeText(text) {
  return String(text || '').replace(/\r\n?/g, '\n').trim();
}

function splitBySections(text) {
  const lines = String(text || '').split('\n');
  const sections = [];
  let current = [];

  const flush = () => {
    const section = current.join('\n').trim();
    if (section) sections.push(section);
    current = [];
  };

  for (const line of lines) {
    const isHeading = /^\s{0,3}(#{1,6}\s+.+|[A-Z][A-Z0-9 ,.:;'"()/-]{8,})\s*$/.test(line);
    if (isHeading && current.length) flush();
    current.push(line);
  }
  flush();

  if (!sections.length) return [String(text || '').trim()];
  return sections;
}

function splitSectionParagraphs(sectionText) {
  return String(sectionText || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function splitLongParagraph(paragraph, chunkMaxWords) {
  const words = String(paragraph || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  if (words.length <= chunkMaxWords) return [words.join(' ')];

  const out = [];
  for (let i = 0; i < words.length; i += chunkMaxWords) {
    out.push(words.slice(i, i + chunkMaxWords).join(' '));
  }
  return out;
}

function trailingWords(text, overlapWords) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!words.length || overlapWords <= 0) return '';
  return words.slice(-overlapWords).join(' ');
}

function buildChunksFromParagraphs(paragraphs, opts) {
  const chunkTargetWords = toPositiveInt(opts && opts.chunk_target_words, 1800);
  const chunkMaxWords = toPositiveInt(opts && opts.chunk_max_words, 2200);
  const chunkOverlapWords = toPositiveInt(opts && opts.chunk_overlap_words, 150);
  const pieces = [];

  for (const paragraph of paragraphs) {
    pieces.push(...splitLongParagraph(paragraph, chunkMaxWords));
  }

  const chunks = [];
  let current = [];
  let currentWords = 0;

  for (const piece of pieces) {
    const pieceWords = countWords(piece);
    if (!pieceWords) continue;

    if (!current.length) {
      current.push(piece);
      currentWords = pieceWords;
      continue;
    }

    const wouldExceedMax = currentWords + pieceWords > chunkMaxWords;
    const reachedTarget = currentWords >= chunkTargetWords;
    if (wouldExceedMax || reachedTarget) {
      chunks.push(current.join('\n\n').trim());
      current = [piece];
      currentWords = pieceWords;
      continue;
    }

    current.push(piece);
    currentWords += pieceWords;
  }

  if (current.length) chunks.push(current.join('\n\n').trim());

  if (chunks.length <= 1 || chunkOverlapWords <= 0) return chunks;

  const withOverlap = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (i === 0) {
      withOverlap.push(chunk);
      continue;
    }
    const overlap = trailingWords(chunks[i - 1], chunkOverlapWords);
    if (!overlap) {
      withOverlap.push(chunk);
      continue;
    }
    withOverlap.push(`${overlap}\n\n${chunk}`.trim());
  }
  return withOverlap;
}

function chunkTextForTier2(cleanText, config) {
  const text = normalizeText(cleanText);
  if (!text) return [];
  const sections = splitBySections(text);
  const paragraphs = sections.flatMap(splitSectionParagraphs);
  const chunks = buildChunksFromParagraphs(paragraphs, config && config.distill);
  return chunks.map((chunk, index) => ({
    index,
    text: chunk,
    word_count: countWords(chunk),
  }));
}

module.exports = {
  chunkTextForTier2,
};
