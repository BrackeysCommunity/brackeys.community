/**
 * The collab domain's vocabulary: each facet's value list and its display
 * labels, in one place. The value tuples are the single source for both the
 * TypeScript unions (`@/lib/collab-store` re-exports them) and the router's
 * `z.enum(...)` schemas; the label maps replaced per-component copies that
 * had already drifted into disagreeing spellings.
 *
 * `label` is the long display form, `labelShort` the compact one for cards
 * and dense chips. Uppercase-styled surfaces apply their own casing.
 */

export interface VocabularyEntry<V extends string> {
  value: V;
  label: string;
  labelShort: string;
}

function toMaps<V extends string>(entries: VocabularyEntry<V>[]) {
  return {
    label: Object.fromEntries(entries.map((e) => [e.value, e.label])) as Record<string, string>,
    labelShort: Object.fromEntries(entries.map((e) => [e.value, e.labelShort])) as Record<
      string,
      string
    >,
  };
}

// ── Post type ──────────────────────────────────────────────────────────────

/**
 * v1 ships paid + hobby only. Playtest and mentor are deferred, not
 * deleted — legacy rows can still be on the board, so their labels stay in
 * the vocabulary while the offered values stay out of the tuple.
 */
export const COLLAB_POST_TYPES = ["paid", "hobby"] as const;
export type CollabPostType = (typeof COLLAB_POST_TYPES)[number];

const POST_TYPE_VOCAB: VocabularyEntry<string>[] = [
  { value: "paid", label: "PAID WORK", labelShort: "PAID" },
  { value: "hobby", label: "HOBBY", labelShort: "HOBBY" },
  { value: "playtest", label: "PLAYTEST", labelShort: "PLAYTEST" },
  { value: "mentor", label: "MENTORSHIP", labelShort: "MENTOR" },
];
const postType = toMaps(POST_TYPE_VOCAB);

export function postTypeLabel(value: string): string {
  return postType.label[value] ?? value;
}
export function postTypeLabelShort(value: string): string {
  return postType.labelShort[value] ?? value;
}

// ── Compensation ───────────────────────────────────────────────────────────

export const COLLAB_COMPENSATION_TYPES = ["hourly", "fixed", "rev_share", "negotiable"] as const;
export type CollabCompensationType = (typeof COLLAB_COMPENSATION_TYPES)[number];

export const COMPENSATION_VOCAB: VocabularyEntry<CollabCompensationType>[] = [
  { value: "hourly", label: "Hourly", labelShort: "Hourly" },
  { value: "fixed", label: "Fixed", labelShort: "Fixed" },
  { value: "rev_share", label: "Revenue Share", labelShort: "Rev Share" },
  { value: "negotiable", label: "Negotiable", labelShort: "Negotiable" },
];
const compensation = toMaps(COMPENSATION_VOCAB);

export function compensationLabel(value: string): string {
  return compensation.label[value] ?? value;
}
export function compensationLabelShort(value: string): string {
  return compensation.labelShort[value] ?? value;
}

// ── Experience level ───────────────────────────────────────────────────────

export const COLLAB_EXPERIENCE_LEVELS = ["any", "beginner", "intermediate", "experienced"] as const;
export type CollabExperienceLevel = (typeof COLLAB_EXPERIENCE_LEVELS)[number];

export const EXPERIENCE_VOCAB: VocabularyEntry<CollabExperienceLevel>[] = [
  { value: "any", label: "Any", labelShort: "Any" },
  { value: "beginner", label: "Beginner", labelShort: "Beginner" },
  { value: "intermediate", label: "Intermediate", labelShort: "Intermediate" },
  { value: "experienced", label: "Experienced", labelShort: "Experienced" },
];
const experience = toMaps(EXPERIENCE_VOCAB);

export function experienceLabel(value: string): string {
  return experience.label[value] ?? value;
}

// ── Unspecified readings ───────────────────────────────────────────────────

/**
 * How a post reads when it never said. Platforms, timeline, and
 * experience are optional at post time — a post that skipped them is open
 * to anyone, and the board says so instead of leaving a blank row.
 */
export const UNSPECIFIED_LABEL = "Any";

export function platformsReading(platforms: string[] | null | undefined): string {
  return platforms && platforms.length > 0 ? platforms.join(" · ") : UNSPECIFIED_LABEL;
}

export function projectLengthReading(value: string | null | undefined): string {
  return value || UNSPECIFIED_LABEL;
}

export function experienceReading(value: string | null | undefined): string {
  return value ? experienceLabel(value) : UNSPECIFIED_LABEL;
}

// ── Contact ────────────────────────────────────────────────────────────────

export const COLLAB_CONTACT_TYPES = ["discord_dm", "discord_server", "email", "other"] as const;
export type CollabContactType = (typeof COLLAB_CONTACT_TYPES)[number];

export const CONTACT_VOCAB: VocabularyEntry<CollabContactType>[] = [
  { value: "discord_dm", label: "Discord DM", labelShort: "Discord DM" },
  { value: "discord_server", label: "Discord Server", labelShort: "Server" },
  { value: "email", label: "Email", labelShort: "Email" },
  { value: "other", label: "Other", labelShort: "Other" },
];
const contact = toMaps(CONTACT_VOCAB);

export const CONTACT_TYPE_LABELS: Record<string, string> = contact.label;

// ── Project length ─────────────────────────────────────────────────────────

export const COLLAB_PROJECT_LENGTHS = [
  "<1 week",
  "1-4 weeks",
  "1-3 months",
  "3-6 months",
  "6+ months",
  "ongoing",
] as const;
export type CollabProjectLength = (typeof COLLAB_PROJECT_LENGTHS)[number];
