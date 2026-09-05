import { ORPCError } from "@orpc/client";
/**
 * The community's language check for user-supplied text.
 *
 * One matcher, built once: `RegExpMatcher` compiles the whole English
 * dataset at construction, so a copy per router is both duplicated policy
 * and duplicated work. This existed as a private `profanityMatcher` +
 * `checkProfanity` pair in three routers — profile, team and collab — which
 * had already drifted on whether a null value counts as clean. All server
 * callers now import from here; the collab create wizard reuses
 * `hasProfanity` client-side for instant form feedback.
 *
 * **Prose is no longer refused.** Only text that becomes an identifier or
 * the title of a notification still hard-rejects (`checkProfanity`) —
 * handles, URL stubs, team names, project and post titles. Everything a
 * person writes as prose is stored as written and censored at render for
 * viewers who asked for that, via `censorText` and `useCensored`.
 */
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from "obscenity";

const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

/** Whether the text trips the filter. Empty and null are always clean. */
export function hasProfanity(text: string | null | undefined): boolean {
  return text != null && text.length > 0 && matcher.hasMatch(text);
}

/** One run of text: either as written, or the asterisks that replaced a match. */
export interface CensorSegment {
  text: string;
  censored: boolean;
}

/**
 * The text split into runs, with every matched region replaced by
 * asterisks of the same length. Adjacent and overlapping matches merge
 * into one run. Clean text is a single uncensored segment, so a renderer
 * can mark the censored runs without re-deriving where they are.
 *
 * The matcher's transformers see through leetspeak and padding, so the
 * replacement covers `sh1t` and `s h i t` as well as the plain spelling.
 */
export function censorSegments(text: string): CensorSegment[] {
  if (text.length === 0) return [];
  const matches = matcher.getAllMatches(text, true);
  if (matches.length === 0) return [{ text, censored: false }];

  const segments: CensorSegment[] = [];
  let cursor = 0;
  let start = matches[0]!.startIndex;
  let end = matches[0]!.endIndex;
  const flush = () => {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), censored: false });
    segments.push({ text: "*".repeat(end - start + 1), censored: true });
    cursor = end + 1;
  };
  for (const match of matches.slice(1)) {
    if (match.startIndex <= end + 1) {
      end = Math.max(end, match.endIndex);
    } else {
      flush();
      start = match.startIndex;
      end = match.endIndex;
    }
  }
  flush();
  if (cursor < text.length) segments.push({ text: text.slice(cursor), censored: false });
  return segments;
}

/**
 * The text with every matched region replaced by asterisks, preserving
 * length and everything around it. Null, empty and clean text come back
 * untouched — identity, so a caller can hand the result straight to a
 * memo without churning it.
 */
export function censorText<T extends string | null | undefined>(text: T): T {
  if (text == null || text.length === 0) return text;
  const segments = censorSegments(text);
  if (segments.length === 1 && !segments[0]!.censored) return text;
  return segments.map((s) => s.text).join("") as T;
}

/**
 * Reject user-supplied text that trips the filter, naming the field so the
 * form can point at it. Absent values pass — a field nobody filled in isn't
 * a violation.
 *
 * Reserved for identifiers and titles. Prose uses `censorText` instead:
 * refusing a bio is a worse answer than showing it with asterisks.
 */
export function checkProfanity(text: string | null | undefined, fieldName: string): void {
  if (hasProfanity(text)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `${fieldName} contains inappropriate language.`,
    });
  }
}
