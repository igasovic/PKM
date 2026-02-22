export interface TokenEstimate {
  chars: number;
  tokens: number;
  method: 'heuristic';
}

export function estimateTokens(text: string): TokenEstimate {
  const chars = String(text || '').length;
  const tokens = Math.ceil(chars / 4);
  return { chars, tokens, method: 'heuristic' };
}
