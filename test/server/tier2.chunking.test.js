'use strict';

const { chunkTextForTier2 } = require('../../src/server/tier2/chunking.js');

function repeatWords(count, seed) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(`${seed}${i}`);
  }
  return out.join(' ');
}

describe('tier2 chunking', () => {
  test('chunking is deterministic for same input/config', () => {
    const text = [
      '# Intro',
      repeatWords(700, 'a'),
      '',
      '# Body',
      repeatWords(1200, 'b'),
      '',
      '# End',
      repeatWords(800, 'c'),
    ].join('\n');

    const cfg = {
      distill: {
        chunk_target_words: 900,
        chunk_max_words: 1000,
        chunk_overlap_words: 40,
      },
    };

    const first = chunkTextForTier2(text, cfg);
    const second = chunkTextForTier2(text, cfg);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(1);
  });
});
