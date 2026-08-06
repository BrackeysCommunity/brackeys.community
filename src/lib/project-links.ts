/**
 * How a project turns into a `/projects/$projectSlug` link, and how its
 * kind turns into words.
 *
 * Mirrors `profile-links.ts` / `team-links.ts` for the link half. The label
 * and CTA halves live here too because every surface that shows a project
 * needs them — a card, a hero, a chip — and "PLAY" hardcoded on a tile that
 * turns out to be a sample pack is exactly the games-first bias the entity
 * was designed to avoid.
 */
import type { ProjectType } from "@/db/schema";
// Taxonomy, not `lib/projects` — that module opens the database, and this
// one is imported by a route (so, by every page).
import { projectTypeFromClassification } from "@/lib/project-taxonomy";

interface ProjectLinkTarget {
  id: string;
  slug?: string | null;
}

/** The `$projectSlug` path segment for a project. */
export function projectSlug(project: ProjectLinkTarget): string {
  // `||` not `??`: an empty slug is not a handle.
  return project.slug || project.id;
}

/** Route params object for TanStack Router's `to="/projects/$projectSlug"`. */
export function projectLinkParams(project: ProjectLinkTarget) {
  return { projectSlug: projectSlug(project) };
}

/**
 * Micro-label voice for a project's kind.
 *
 * The raw itch `classification` is more specific than our curated type where
 * we have it ("ASSET PACK" beats "ASSETS", "SOUNDTRACK" beats "AUDIO"), so it
 * wins when it maps to the same kind — a provider value that disagrees with
 * an owner-edited type is the owner's call to keep.
 */
const TYPE_LABEL: Record<ProjectType, string> = {
  game: "GAME",
  tool: "TOOL",
  assets: "ASSETS",
  audio: "AUDIO",
  app: "APP",
  web: "WEBSITE",
  other: "PROJECT",
};

const CLASSIFICATION_LABEL: Record<string, string> = {
  asset: "ASSET PACK",
  soundtrack: "SOUNDTRACK",
  game_mod: "GAME MOD",
  physical_game: "PHYSICAL GAME",
  comic: "COMIC",
  book: "BOOK",
};

export function projectTypeLabel(project: {
  type: string;
  classification?: string | null;
}): string {
  const classification = project.classification?.trim().toLowerCase();
  if (classification) {
    const label = CLASSIFICATION_LABEL[classification];
    // Only when the provider value still describes the same kind — an owner
    // who retyped an "asset" as a tool shouldn't be overruled by the label.
    if (label && projectTypeFromClassification(classification) === project.type) return label;
  }
  return TYPE_LABEL[project.type as ProjectType] ?? "PROJECT";
}

/**
 * What the hero's primary button should say.
 *
 * `embedType: 'html'` is itch's "playable in the browser" signal, which is
 * the only case where the CTA can promise something better than a download.
 */
const TYPE_CTA: Record<ProjectType, string> = {
  game: "PLAY ON ITCH.IO",
  tool: "DOWNLOAD",
  app: "DOWNLOAD",
  assets: "GET THE PACK",
  audio: "LISTEN",
  web: "VISIT SITE",
  other: "VIEW PROJECT",
};

export function projectCtaLabel(project: {
  type: string;
  embedType?: string | null;
  url?: string | null;
}): string {
  if (project.type === "game" && project.embedType?.toLowerCase() === "html") {
    return "PLAY IN BROWSER";
  }
  return TYPE_CTA[project.type as ProjectType] ?? "VIEW PROJECT";
}

/**
 * Hero badge for a project that isn't finished. `released` gets nothing —
 * a badge saying a shipped thing shipped is noise.
 *
 * itch's vocabulary, adopted verbatim rather than reinvented: it's a good
 * neutral set, and a website or a library wants "in development" too.
 */
const RELEASE_STATUS_LABEL: Record<string, string> = {
  in_development: "IN DEVELOPMENT",
  on_hold: "ON HOLD",
  canceled: "CANCELED",
  prototype: "PROTOTYPE",
};

export function releaseStatusLabel(releaseStatus: string | null | undefined): string | null {
  if (!releaseStatus) return null;
  return RELEASE_STATUS_LABEL[releaseStatus.trim().toLowerCase()] ?? null;
}
