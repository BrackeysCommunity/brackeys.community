/** `n` with its noun, singular only at one: `1 error`, `3 errors`, `2 entities`; `format` writes the count. */
export const plural = (
  n: number,
  one: string,
  many = `${one}s`,
  format: (n: number) => string = String,
): string => `${format(n)} ${n === 1 ? one : many}`;
