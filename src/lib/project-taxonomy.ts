/**
 * Pure project vocabulary: kind mapping, slugs, date preference.
 *
 * Split out from `lib/projects.ts` because **this half runs in the
 * browser**. `project-links.ts` needs the classification mapping to label a
 * project, `project-links` is imported by the `/projects/$projectSlug`
 * route, and `routeTree.gen.ts` imports every route module eagerly — so a
 * single runtime import of `@/db` from here drags `drizzle-orm/node-postgres`
 * into the client bundle on *every* page. (It fails loudly: `Buffer is not
 * defined`.) Nothing in this file may import `@/db` other than as a type.
 *
 * The type import below is relative rather than aliased because
 * `project-sync.ts` imports this module and is itself imported by the
 * `itchio-library-sync` service, which resolves neither the app's `@/` alias
 * nor a bundler.
 */
import type { ProjectType } from "../db/schema";

/**
 * Placement type (`user.profile_project_type`) → canonical type.
 *
 * `jam` is the interesting one: it was never a kind of artifact, it was
 * provenance wearing a type's clothes. A jam entry is a game unless its
 * owner says otherwise, and the jam appearance itself is recorded as a jam
 * *record*.
 */
const PLACEMENT_TYPE_MAP: Record<string, ProjectType> = {
  jam: "game",
  game: "game",
  audio: "audio",
  tool: "tool",
  app: "app",
};

export function projectTypeFromPlacement(placementType: string | null | undefined): ProjectType {
  return PLACEMENT_TYPE_MAP[placementType ?? ""] ?? "game";
}

/**
 * itch's raw `classification` → our curated type.
 *
 * The provider list: `game`, `asset`, `game_mod`, `physical_game`,
 * `soundtrack`, `tool`, `comic`, `book`, `other`. Anything that isn't
 * software we distribute a kind for lands in `other` rather than being
 * mislabelled a game.
 */
const CLASSIFICATION_MAP: Record<string, ProjectType> = {
  game: "game",
  tool: "tool",
  asset: "assets",
  soundtrack: "audio",
  game_mod: "other",
  physical_game: "other",
  comic: "other",
  book: "other",
  other: "other",
};

export function projectTypeFromClassification(
  classification: string | null | undefined,
): ProjectType | null {
  if (!classification) return null;
  return CLASSIFICATION_MAP[classification.trim().toLowerCase()] ?? null;
}

/**
 * The kinds a member can pick when adding a project by hand.
 *
 * The canonical vocabulary minus nothing — every kind is pickable, which is
 * the point: before this list existed, "add an asset pack" meant choosing
 * between GAME, AUDIO, TOOL and APP, and a website was a mistyped app.
 * `satisfies` is the drift guard — a kind the schema doesn't know isn't a
 * kind. (The list is duplicated from `PROJECT_TYPES` rather than imported:
 * importing a *value* from `@/db/schema` drags `drizzle-orm/node-postgres`
 * into the browser bundle, which is the trap this whole module exists to
 * avoid.)
 */
export const MANUAL_PROJECT_TYPES = [
  "game",
  "tool",
  "assets",
  "audio",
  "app",
  "web",
  "other",
] as const satisfies readonly ProjectType[];

export type ManualProjectType = (typeof MANUAL_PROJECT_TYPES)[number];

/**
 * itch's `release_status` vocabulary, adopted verbatim rather than
 * reinvented — it's a good neutral set, and a website or a library wants
 * "in development" too. Provider-owned for imports; owner-editable on a
 * manual project.
 */
export const RELEASE_STATUSES = [
  "released",
  "in_development",
  "on_hold",
  "canceled",
  "prototype",
] as const;

export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

/** Longest slug we'll generate from a title, before any collision suffix. */
const SLUG_MAX_LENGTH = 60;

/**
 * Title → URL segment. Same shape as team slugs: lowercase, alphanumerics
 * and single hyphens, no leading or trailing separator.
 *
 * Returns `"project"` for a title that reduces to nothing (an emoji-only
 * name, or CJK text, both of which exist in the scraped corpus) — the
 * collision suffix is what keeps those distinct.
 */
export function slugifyProjectTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    // Strip combining marks so "Pokémon" becomes "pokemon" rather than
    // losing the letter entirely.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
  return slug.length > 0 ? slug : "project";
}

/**
 * The best honest ship date available, in preference order.
 *
 * Never `createdAt`: that's when the row landed in our database, not when
 * anything shipped.
 */
export function pickReleasedAt(candidates: (Date | null | undefined)[]): Date | null {
  for (const candidate of candidates) {
    if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) return candidate;
  }
  return null;
}
