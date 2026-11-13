/** `n` with its noun, singular only at one: `1 error`, `3 errors`, `2 entities`. */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;
