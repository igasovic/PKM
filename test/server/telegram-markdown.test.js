'use strict';

const {
  mdv2,
  bold,
  parens,
  brackets,
  arrow,
  nl,
  joinLines,
  finalizeMarkdownV2,
} = require('../../src/libs/telegram-markdown.js');

describe('telegram-markdown helpers', () => {
  test('mdv2 escapes reserved MarkdownV2 characters', () => {
    expect(mdv2('a>b (c)')).toBe('a\\>b \\(c\\)');
  });

  test('parens and brackets build escaped wrappers', () => {
    expect(parens('dry run')).toBe('\\(dry run\\)');
    expect(brackets('M')).toBe('\\[M\\]');
  });

  test('arrow helper escapes separator token', () => {
    expect(arrow('left', 'right')).toBe('left \\-\\> right');
  });

  test('bold helper escapes inner content', () => {
    expect(bold('Tier_2')).toBe('*Tier\\_2*');
  });

  test('newline and joinLines compose stable output', () => {
    expect(nl(2)).toBe('\n\n');
    expect(joinLines(['a', '', 'b'], { trimTrailing: true })).toBe('a\n\nb');
  });

  test('finalizeMarkdownV2 truncates safely', () => {
    const input = `1234567890123456789012345678901\\X`;
    expect(finalizeMarkdownV2(input, { maxLen: 32 })).toBe('1234567890123456789012345678901…');
  });
});
