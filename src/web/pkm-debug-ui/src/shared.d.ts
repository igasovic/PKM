declare module '@shared/context-pack-builder.js' {
  const value: {
    buildContextPackMarkdown: (
      rows: Array<Record<string, unknown>>,
      meta?: Record<string, unknown>,
      opts?: { markdownV2?: boolean; maxContentLen?: number },
    ) => string;
    deriveExcerptFromRecord: (record: Record<string, unknown>, opts?: { maxLen?: number; includeFallbackKeys?: boolean }) => string;
    escapeMarkdownV2: (value: unknown) => string;
    normWS: (s: unknown) => string;
    snip: (value: unknown, maxLen: number) => string;
    toContextPackItem: (record: Record<string, unknown>, opts?: { maxContentLen?: number }) => Record<string, unknown>;
  };
  export default value;
}
