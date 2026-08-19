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
import {
  RegExpMatcher,
  TextCensor,
  asteriskCensorStrategy,
  englishDataset,
  englishRecommendedTransformers,
} from "obscenity";

const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

const censor = new TextCensor().setStrategy(asteriskCensorStrategy());

/** Whether the text trips the filter. Empty and null are always clean. */
export function hasProfanity(text: string | null | undefined): boolean {
  return text != null && text.length > 0 && matcher.hasMatch(text);
}

/**
 * The text with every matched region replaced by asterisks, preserving
 * length and everything around it. Null, empty and clean text come back
 * untouched — identity, so a caller can hand the result straight to a
 * memo without churning it.
 *
 * The matcher's transformers see through leetspeak and padding, so the
 * replacement covers `sh1t` and `s h i t` as well as the plain spelling.
 */
export function censorText<T extends string | null | undefined>(text: T): T {
  if (text == null || text.length === 0) return text;
  const matches = matcher.getAllMatches(text, true);
  if (matches.length === 0) return text;
  return censor.applyTo(text, matches) as T;
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
