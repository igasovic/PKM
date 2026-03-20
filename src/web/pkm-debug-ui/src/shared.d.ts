declare module '@shared/context-pack-builder.js' {
  export {};
}

declare module '@shared/context-pack-builder-core.js' {
  export {};
}

declare global {
  interface Window {
    __pkmContextPackBuilder?: {
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
  }
}
