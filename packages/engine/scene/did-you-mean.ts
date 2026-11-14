export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur.push(Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** The nearest candidate within `max(1, floor(len / 3))` edits, case-insensitive. */
export function closest(word: string, candidates: readonly string[]): string | undefined {
  const limit = Math.max(1, Math.floor(word.length / 3));
  const lower = word.toLowerCase();
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const d = levenshtein(lower, candidate.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return bestDistance <= limit ? best : undefined;
}

/** `; did you mean "x"?` for a guess, else "": for a message whose fix uses the guess too. */
export const meantText = (guess: string | undefined): string =>
  guess ? `; did you mean "${guess}"?` : "";

/** `; did you mean "x"?` for the `closest` candidate other than `word` itself, else "". */
export function didYouMean(word: string, candidates: readonly string[]): string {
  return meantText(
    closest(
      word,
      candidates.filter((c) => c !== word),
    ),
  );
}
