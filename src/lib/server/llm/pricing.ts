// Model prices in US$ per million tokens (Anthropic first-party rates).
// Used for the FirulAI spend caps — keep in step with the models in use.
// Unknown models are charged at the most expensive known row, so a cap is
// never under-counted.

interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number; // 5-minute cache writes = 1.25 × input
}

const PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

const FALLBACK: Price = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };

/** Cost in millionths of a US dollar (US$1/M tokens = 1 micro-US$ per token). */
export function costMicroUsd(
  model: string,
  t: { uncachedInput: number; output: number; cacheRead: number; cacheWrite: number }
): number {
  const p = PRICES[model] ?? FALLBACK;
  return Math.ceil(
    t.uncachedInput * p.input + t.output * p.output + t.cacheRead * p.cacheRead + t.cacheWrite * p.cacheWrite
  );
}
