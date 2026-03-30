'use strict';

const { getNotionSettings } = require('./runtime-env.js');

const notionSettings = getNotionSettings();
const NOTION_API_BASE = notionSettings.apiBase;
const NOTION_API_VERSION = notionSettings.apiVersion;
const NOTION_DATABASE_URL = notionSettings.databaseUrl;
const NOTION_DATABASE_ID = notionSettings.databaseId;

const SUPPORTED_BLOCK_TYPES = new Set([
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'callout',
  'toggle',
  'column_list',
  'column',
  'table',
  'table_row',
  'child_page',
  'table_of_contents',
  'bulleted_list_item',
  'numbered_list_item',
  'to_do',
  'quote',
  'code',
  'divider',
]);

function norm(s) {
  return String(s || '').trim();
}

function extractHex32(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const m = raw.match(/[a-f0-9]{32}/i);
  return m ? m[0].toLowerCase() : null;
}

function normalizeNotionId(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(raw)) {
    return raw.toLowerCase();
  }
  const hex = extractHex32(raw);
  if (!hex) return raw;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function extractDatabaseIdFromUrl(urlValue) {
  const raw = String(urlValue || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const fromPath = extractHex32(parsed.pathname);
    if (fromPath) return normalizeNotionId(fromPath);
  } catch {
    const fromRaw = extractHex32(raw);
    if (fromRaw) return normalizeNotionId(fromRaw);
  }
  return null;
}

function formatPageUrlFromId(pageId) {
  const normalized = normalizeNotionId(pageId);
  if (!normalized) return null;
  return `https://www.notion.so/${normalized.replace(/-/g, '')}`;
}

function stripControlWhitespace(s) {
  return String(s || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function richTextToMarkdown(richText) {
  if (!Array.isArray(richText)) return '';
  return richText.map((node) => {
    const plain = String((node && node.plain_text) || '');
    const annotations = (node && node.annotations) || {};
    const href = node && node.href ? String(node.href) : null;
    let text = plain;
    if (!text) return '';
    if (annotations.code) text = `\`${text}\``;
    if (annotations.bold) text = `**${text}**`;
    if (annotations.italic) text = `*${text}*`;
    if (annotations.strikethrough) text = `~~${text}~~`;
    if (annotations.underline) text = `<u>${text}</u>`;
    if (href) {
      if (plain.trim() === href.trim()) return href;
      return `[${text}](${href})`;
    }
    return text;
  }).join('');
}

function tableRowToCells(rowBlock) {
  const node = rowBlock && rowBlock.table_row && typeof rowBlock.table_row === 'object'
    ? rowBlock.table_row
    : {};
  const cells = Array.isArray(node.cells) ? node.cells : [];
  return cells.map((cell) => richTextToMarkdown(cell || []));
}

function renderBlocksToLines(blocks, ctx, depth = 0) {
  if (!Array.isArray(blocks)) return [];
  const lines = [];
  const indent = '  '.repeat(Math.max(0, depth));

  for (let idx = 0; idx < blocks.length; idx++) {
    const block = blocks[idx] || {};
    const type = norm(block.type);
    const id = norm(block.id);
    const path = block.__path || `${depth}:${idx}:${type || 'unknown'}:${id || '?'}`;
    const node = type && block[type] && typeof block[type] === 'object' ? block[type] : {};
    const text = richTextToMarkdown(node.rich_text);
    let line = null;

    if (!SUPPORTED_BLOCK_TYPES.has(type)) {
      ctx.errors.push({
        page_id: ctx.page_id,
        block_id: id || null,
        block_type: type || '(empty)',
        reason: 'unsupported_block_type',
        path,
      });
    } else if (type === 'paragraph') {
      line = text;
    } else if (type === 'heading_1') {
      line = `# ${text}`.trim();
    } else if (type === 'heading_2') {
      line = `## ${text}`.trim();
    } else if (type === 'heading_3') {
      line = `### ${text}`.trim();
    } else if (type === 'callout') {
      const icon = node.icon && typeof node.icon === 'object' && node.icon.type === 'emoji'
        ? String(node.icon.emoji || '').trim()
        : '';
      const prefix = icon ? `${icon} ` : '';
      line = text ? `> ${prefix}${text}` : '>';
    } else if (type === 'toggle') {
      line = text ? `- ▶ ${text}` : '- ▶';
    } else if (type === 'column_list' || type === 'column') {
      line = null;
    } else if (type === 'table_of_contents') {
      line = '[table of contents]';
    } else if (type === 'child_page') {
      const childTitle = String(node.title || '').trim();
      line = childTitle ? `[[${childTitle}]]` : '[[child page]]';
    } else if (type === 'table') {
      const rows = Array.isArray(block.children) ? block.children.filter((b) => b && b.type === 'table_row') : [];
      const matrix = rows.map(tableRowToCells);
      if (matrix.length > 0) {
        const header = matrix[0];
        const body = matrix.slice(1);
        lines.push(`${indent}| ${header.join(' | ')} |`);
        lines.push(`${indent}| ${header.map(() => '---').join(' | ')} |`);
        for (const row of body) {
          lines.push(`${indent}| ${row.join(' | ')} |`);
        }
      }
      line = null;
    } else if (type === 'table_row') {
      line = null;
    } else if (type === 'bulleted_list_item') {
      line = `- ${text}`.trim();
    } else if (type === 'numbered_list_item') {
      line = `1. ${text}`.trim();
    } else if (type === 'to_do') {
      line = `${node.checked === true ? '- [x]' : '- [ ]'} ${text}`.trim();
    } else if (type === 'quote') {
      line = text ? `> ${text}` : '>';
    } else if (type === 'code') {
      const lang = norm(node.language);
      line = `\`\`\`${lang}\n${String(text || '')}\n\`\`\``;
    } else if (type === 'divider') {
      line = '---';
    }

    if (line) lines.push(`${indent}${line}`);

    if (Array.isArray(block.children) && block.children.length > 0) {
      const childLines = renderBlocksToLines(block.children, ctx, depth + 1);
      if (childLines.length > 0) lines.push(...childLines);
    }
  }

  return lines;
}

function extractTitleFromPage(page) {
  const props = page && page.properties && typeof page.properties === 'object'
    ? page.properties
    : {};
  for (const key of Object.keys(props)) {
    const p = props[key];
    if (p && p.type === 'title' && Array.isArray(p.title)) {
      const title = p.title.map((x) => String((x && x.plain_text) || '')).join('').trim();
      if (title) return title;
    }
  }
  return null;
}

class NotionClient {
  constructor(opts = {}) {
    const token = opts.token || notionSettings.apiToken || '';
    this.token = String(token).trim();
    this.apiBase = String(opts.apiBase || NOTION_API_BASE).replace(/\/+$/, '');
    this.version = String(opts.version || NOTION_API_VERSION).trim();
    this.defaultDatabaseId = normalizeNotionId(
      opts.databaseId ||
      NOTION_DATABASE_ID ||
      extractDatabaseIdFromUrl(opts.databaseUrl || NOTION_DATABASE_URL)
    );
  }

  ensureToken() {
    if (!this.token) throw new Error('NOTION_API_TOKEN is required to fetch Notion page blocks');
  }

  async fetchJson(pathname) {
    this.ensureToken();
    const url = `${this.apiBase}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Notion-Version': this.version,
        Accept: 'application/json',
      },
    });
    const text = await res.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
    if (!res.ok) {
      const msg = payload && payload.message ? payload.message : `http_${res.status}`;
      throw new Error(`Notion API error (${pathname}): ${msg}`);
    }
    return payload;
  }

  async retrievePage(pageId) {
    return this.fetchJson(`/pages/${encodeURIComponent(pageId)}`);
  }

  async listAllChildren(blockId) {
    const all = [];
    let cursor = null;
    do {
      const qs = new URLSearchParams({ page_size: '100' });
      if (cursor) qs.set('start_cursor', cursor);
      const out = await this.fetchJson(`/blocks/${encodeURIComponent(blockId)}/children?${qs.toString()}`);
      const rows = Array.isArray(out.results) ? out.results : [];
      all.push(...rows);
      cursor = out.has_more ? out.next_cursor : null;
    } while (cursor);
    return all;
  }

  async fetchBlockTree(blockId, parentPath = 'root') {
    const children = await this.listAllChildren(blockId);
    const out = [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i] || {};
      const type = norm(child.type) || 'unknown';
      const id = norm(child.id) || `idx_${i}`;
      const withMeta = {
        ...child,
        __path: `${parentPath}/${i}:${type}:${id}`,
      };
      out.push(withMeta);

      const hasChildren = child.has_children === true;
      if (!hasChildren) continue;

      const syncedSourceId = (
        type === 'synced_block' &&
        child.synced_block &&
        child.synced_block.synced_from &&
        child.synced_block.synced_from.block_id
      )
        ? String(child.synced_block.synced_from.block_id).trim()
        : null;
      const targetBlockId = syncedSourceId || id;
      withMeta.children = await this.fetchBlockTree(targetBlockId, withMeta.__path);
    }
    return out;
  }

  async buildNotionObject(input = {}) {
    const page_id = normalizeNotionId(norm(
      input.page_id ||
      (input.notion && input.notion.page_id) ||
      input.notion_page_id
    ));
    if (!page_id) throw new Error('notion.page_id is required');

    const updated_at = norm(input.updated_at || (input.notion && input.notion.updated_at));
    if (!updated_at) throw new Error('updated_at is required (Notion Last edited time property)');

    const page = await this.retrievePage(page_id);
    const tree = await this.fetchBlockTree(page_id);
    const ctx = { page_id, errors: [] };
    const lines = renderBlocksToLines(tree, ctx, 0);
    const capture_text = stripControlWhitespace(lines.join('\n'));

    return {
      notion: {
        page_id,
        database_id: normalizeNotionId(
          input.database_id ||
          (input.notion && input.notion.database_id) ||
          (page && page.parent && page.parent.database_id) ||
          this.defaultDatabaseId
        ) || null,
        page_url: norm(
          input.page_url ||
          (input.notion && input.notion.page_url) ||
          page.url ||
          formatPageUrlFromId(page_id)
        ) || null,
      },
      title: norm(input.title) || extractTitleFromPage(page) || null,
      content_type: norm(input.content_type) || null,
      url: norm(input.url) || null,
      created_at: norm(input.created_at) || null,
      updated_at,
      capture_text,
      blocks: tree,
      collect: {
        blocks_fetched_total: countBlocks(tree),
        blocks_rendered: Math.max(0, lines.length),
        blocks_skipped_unsupported: ctx.errors.length,
        errors: ctx.errors,
      },
    };
  }
}

function countBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return 0;
  let total = 0;
  for (const block of blocks) {
    total += 1;
    total += countBlocks(block && block.children);
  }
  return total;
}

let cachedClient = null;

function getNotionClient() {
  if (!cachedClient) cachedClient = new NotionClient();
  return cachedClient;
}

module.exports = {
  NotionClient,
  getNotionClient,
};
