/** Makes a new entity key. Keys are generated, never names, so two creates with one name stay two entities. */
export type KeyGen = () => string;

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** 12 base-36 characters from `crypto.getRandomValues`, about 62 bits. */
export const randomKey: KeyGen = () => {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % 36];
  return out;
};

/** A deterministic key generator for tests and seeded runs: `<prefix><n>`, counting from 0. */
export function sequentialKeys(prefix = "k"): KeyGen {
  let n = 0;
  return () => `${prefix}${(n++).toString(36).padStart(4, "0")}`;
}
