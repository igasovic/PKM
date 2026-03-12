'use strict';

const {
  deriveContentHashFromCleanText,
  normalizeCleanTextForHash,
} = require('../../src/libs/content-hash.js');

describe('content hash', () => {
  test('returns null for missing or blank clean_text', () => {
    expect(normalizeCleanTextForHash(null)).toBeNull();
    expect(normalizeCleanTextForHash(undefined)).toBeNull();
    expect(normalizeCleanTextForHash('')).toBeNull();
    expect(normalizeCleanTextForHash('   \n\t')).toBeNull();

    expect(deriveContentHashFromCleanText(null)).toBeNull();
    expect(deriveContentHashFromCleanText('   ')).toBeNull();
  });

  test('derives deterministic sha256 from clean_text bytes', () => {
    expect(deriveContentHashFromCleanText('clean')).toBe(
      '3b066804f6d1d077173cfe4d06002e6a61e6f21c2b2e648417962115f1afcd8e'
    );
  });

  test('treats whitespace-significant clean_text as distinct', () => {
    const a = deriveContentHashFromCleanText('Line 1\nLine 2');
    const b = deriveContentHashFromCleanText('Line 1 Line 2');
    expect(a).not.toBe(b);
  });
});
