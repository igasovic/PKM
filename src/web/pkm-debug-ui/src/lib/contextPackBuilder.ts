import '@shared/context-pack-builder.js';

type ContextPackBuilderApi = {
  buildContextPackMarkdown: (
    rows: Array<Record<string, unknown>>,
    meta?: Record<string, unknown>,
    opts?: { markdownV2?: boolean; maxContentLen?: number; layout?: string },
  ) => string;
  deriveExcerptFromRecord: (
    record: Record<string, unknown>,
    opts?: { maxLen?: number; includeFallbackKeys?: boolean },
  ) => string;
};

const builder = (globalThis as { __pkmContextPackBuilder?: ContextPackBuilderApi }).__pkmContextPackBuilder;

if (!builder) {
  throw new Error('context-pack-builder not initialized');
}

export default builder;
