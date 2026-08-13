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

/**
 * Reject user-supplied text that trips the filter, naming the field so the
 * form can point at it. Absent values pass — a field nobody filled in isn't
 * a violation.
 */
export function checkProfanity(text: string | null | undefined, fieldName: string): void {
  if (hasProfanity(text)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `${fieldName} contains inappropriate language.`,
    });
  }
}
