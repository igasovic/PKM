export interface StandardizedEntryView {
  found: boolean;
  entryId: string;
  author: string;
  contentType: string;
  source: string;
  createdAt: string | null;
  title: string | null;
  url: string | null;
  topicPrimary: string | null;
  topicSecondary: string | null;
  keywords: string[];
  summary: string | null;
  whyItMatters: string | null;
  body: string;
  wordCount: number | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function pickText(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const out = text(record[key]);
    if (out) return out;
  }
  return '';
}

function pickAny(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  }
  return null;
}

function normalizeKeywords(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => text(item))
      .filter(Boolean)
      .slice(0, 12);
  }
  const raw = text(value);
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function countWords(value: string): number {
  const list = value.split(/\s+/).map((part) => part.trim()).filter(Boolean);
  return list.length;
}

function parseWordCount(record: Record<string, unknown>, fallbackBody: string): number | null {
  const cleanWordCountRaw = record.clean_word_count;
  const numeric = Number(cleanWordCountRaw);
  if (Number.isFinite(numeric) && numeric >= 0) return Math.trunc(numeric);

  const textCandidate = pickText(record, ['clean_text', 'working_memory_text', 'excerpt_long', 'excerpt', 'capture_text']);
  const source = textCandidate || fallbackBody;
  if (!source) return null;
  return countWords(source);
}

function buildBody(record: Record<string, unknown>): string {
  const summary = pickText(record, ['distill_summary', 'gist']);
  const whyItMatters = pickText(record, ['distill_why_it_matters']);
  const excerptLong = pickText(record, ['excerpt_long', 'excerpt', 'working_memory_text', 'retrieval_excerpt']);
  const excerptShort = pickText(record, ['snippet']);
  const cleanText = pickText(record, ['clean_text', 'capture_text']);

  if (summary && whyItMatters && excerptLong) {
    return `${summary}\n\nWhy it matters: ${whyItMatters}\n\n${excerptLong}`;
  }
  if (summary && whyItMatters && excerptShort) {
    return `${summary}\n\nWhy it matters: ${whyItMatters}\n\n${excerptShort}`;
  }
  return cleanText || excerptLong || excerptShort || summary || '(no text)';
}

export function toStandardizedEntryView(value: unknown): StandardizedEntryView {
  const record = asRecord(value);
  const body = buildBody(record);
  const entryId = pickText(record, ['entry_id', 'id']) || '?';
  const foundRaw = record.found;
  const found = foundRaw === undefined ? true : Boolean(foundRaw);

  return {
    found,
    entryId,
    author: pickText(record, ['author']) || 'unknown',
    contentType: pickText(record, ['content_type']) || 'unknown',
    source: pickText(record, ['source']) || 'unknown',
    createdAt: pickText(record, ['created_at']) || null,
    title: pickText(record, ['title']) || null,
    url: pickText(record, ['url_canonical', 'url']) || null,
    topicPrimary: pickText(record, ['topic_primary']) || null,
    topicSecondary: pickText(record, ['topic_secondary']) || null,
    keywords: normalizeKeywords(pickAny(record, ['keywords'])),
    summary: pickText(record, ['distill_summary', 'gist']) || null,
    whyItMatters: pickText(record, ['distill_why_it_matters']) || null,
    body,
    wordCount: parseWordCount(record, body),
  };
}
