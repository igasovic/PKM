import '@shared/context-pack-builder-core.js';

const builder = (globalThis as { __pkmContextPackBuilder?: unknown }).__pkmContextPackBuilder;

if (!builder || typeof builder !== 'object') {
  throw new Error('context-pack-builder-core not initialized');
}

export default builder as {
  buildContextPackMarkdown: (
    rows: Array<Record<string, unknown>>,
    meta?: Record<string, unknown>,
    opts?: { markdownV2?: boolean; maxContentLen?: number; layout?: string; whyItMattersShare?: number },
  ) => string;
  deriveExcerptFromRecord: (
    record: Record<string, unknown>,
    opts?: { maxLen?: number; includeFallbackKeys?: boolean },
  ) => string;
};
