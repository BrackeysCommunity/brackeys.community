import type { ModelId, Usage } from "./types.ts";

/** USD per million tokens. */
export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * First-party list prices, cache writes at the five-minute rate. Haiku's
 * dearer rate past 100,000 input tokens is never reached: maxInputChars keeps
 * every prompt far below it.
 */
export const PRICES: Record<ModelId, Price> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-5-5": { input: 2.0, output: 10.0, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4.0, output: 20.0, cacheRead: 0.2, cacheWrite: 5.0 },
};

/** A USD-per-million price is micro-dollars per token; a thousandth of that is exact in integers. */
const nanos = (usdPerMillion: number) => Math.round(usdPerMillion * 1_000);

/** Integer micro-dollars for one call, rounded up, so a ledger never undercounts. */
export function costMicros(model: ModelId, u: Usage): number {
  const p = PRICES[model];
  const total =
    u.input * nanos(p.input) +
    u.output * nanos(p.output) +
    u.cacheRead * nanos(p.cacheRead) +
    u.cacheWrite * nanos(p.cacheWrite);
  return Math.ceil(total / 1_000);
}

/** structural: fewer characters a token than any tokenizer gives prose, so the estimate stays above. */
const CHARS_PER_TOKEN_FLOOR = 3;

/**
 * What a call can cost at most: every input token at the dearer of the input
 * and cache-write prices, and the whole output allowance.
 */
export function upperMicros(model: ModelId, inputChars: number, maxTokens: number): number {
  const p = PRICES[model];
  const input = Math.ceil(inputChars / CHARS_PER_TOKEN_FLOOR);
  const total = input * Math.max(nanos(p.input), nanos(p.cacheWrite)) + maxTokens * nanos(p.output);
  return Math.ceil(total / 1_000);
}
