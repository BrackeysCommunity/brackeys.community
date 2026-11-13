// Who may play and do what with a hosted game, as pure functions over a
// viewer. Every transport (procedures, HTTP routes, the frame route, the
// zip route, the CLI) asks these and never re-derives them.

import { releaseForbidden, type ReleaseApiError } from "./release-errors";

export type ReleaseChannel = "preview" | "production";

export type GameVisibility = "private" | "team" | "unlisted" | "public";

export type Viewer = {
  userId: string | null;
  staff: boolean;
  /** Membership of the engine project's team, if it has one. */
  teamRole: "owner" | "member" | null;
  isCreator: boolean;
};

export type GameRole = "staff" | "publisher" | "editor" | "player";

export const GAME_ACTIONS = [
  "upload",
  "promote-preview",
  "promote-production",
  "rollback-preview",
  "rollback-production",
  "visibility",
  "jam-link",
  "settings",
  "hide",
  "approve-public",
  "download-zip",
  "live-publish",
  "live-move-preview",
  "live-move-production",
  "live-block",
  "live-hide",
] as const;

export type GameAction = (typeof GAME_ACTIONS)[number];

export type PlayRefusal = "hidden" | "collected" | "forbidden" | "not-found";

/**
 * Publishers are the project's creator and, for a team project, its team's
 * owners; editors are its team's other members. A signed-out viewer is a
 * player whatever else the caller filled in.
 */
export function roleOf(viewer: Viewer, project: { teamId: string | null }): GameRole {
  if (viewer.userId === null) return "player";
  if (viewer.staff) return "staff";
  if (viewer.isCreator) return "publisher";
  if (project.teamId === null) return "player";
  if (viewer.teamRole === "owner") return "publisher";
  if (viewer.teamRole === "member") return "editor";
  return "player";
}

const EDITORS: readonly (GameRole | "agent")[] = ["staff", "publisher", "editor", "agent"];
const PUBLISHERS: readonly (GameRole | "agent")[] = ["staff", "publisher"];
const TEAM: readonly (GameRole | "agent")[] = ["staff", "publisher", "editor"];

const ALLOWED: Readonly<Record<GameAction, readonly (GameRole | "agent")[]>> = {
  upload: EDITORS,
  "promote-preview": EDITORS,
  "rollback-preview": EDITORS,
  "promote-production": PUBLISHERS,
  "rollback-production": PUBLISHERS,
  visibility: PUBLISHERS,
  "jam-link": PUBLISHERS,
  settings: PUBLISHERS,
  "download-zip": TEAM,
  hide: ["staff"],
  "approve-public": ["staff"],
  "live-publish": EDITORS,
  "live-move-preview": EDITORS,
  "live-move-production": PUBLISHERS,
  "live-block": TEAM,
  "live-hide": ["staff"],
};

/** The channels whose pointers name a scene version. */
export type VersionTarget = { pointedOn: readonly ReleaseChannel[] };

/**
 * Whether blocking a version is production's business: production points at
 * it, or the caller didn't say (the stricter answer).
 */
function blocksProduction(target: VersionTarget | undefined): boolean {
  return target === undefined || target.pointedOn.includes("production");
}

/**
 * The role table. An agent token (write access) uploads, publishes scene
 * versions and moves `preview` only. `live-block` on a version production
 * points at needs a publisher; on any other version, an editor.
 */
export function canDo(
  role: GameRole | "agent",
  action: GameAction,
  target?: VersionTarget,
): boolean {
  if (action === "live-block" && blocksProduction(target)) {
    return PUBLISHERS.includes(role);
  }
  return ALLOWED[action].includes(role);
}

const PRODUCTION_MOVES: ReadonlySet<GameAction> = new Set([
  "promote-production",
  "rollback-production",
  "live-move-production",
]);

/**
 * Why this role can't do this, or null when it may. An agent token refused
 * something on production is sent to the game's page (`gameUrl`), where a
 * person moves it; every other refusal names the role it needs.
 */
export function refusalFor(
  role: GameRole | "agent",
  action: GameAction,
  options: { gameUrl?: string; target?: VersionTarget } = {},
): ReleaseApiError | null {
  if (canDo(role, action, options.target)) return null;
  const onProduction =
    PRODUCTION_MOVES.has(action) || (action === "live-block" && blocksProduction(options.target));
  return role === "agent" && onProduction
    ? releaseForbidden("agent-production", options.gameUrl)
    : releaseForbidden("role");
}

/**
 * Whether this viewer may play this release. Hidden and collected come
 * first, for everyone. A release only ever on preview (never promoted, not
 * a jam version) is for the project's team, or a personal project's
 * publishers, whatever the visibility; anyone else is told it doesn't
 * exist. Production, jam and once-live releases follow the visibility.
 */
export function canPlay(
  viewer: Viewer,
  project: { visibility: GameVisibility; teamId: string | null; hiddenAt: Date | null },
  release: {
    hiddenAt: Date | null;
    collectedAt: Date | null;
    firstPromotedAt: Date | null;
    jamPinned: boolean;
  },
): { ok: true } | { ok: false; reason: PlayRefusal } {
  if (project.hiddenAt !== null || release.hiddenAt !== null) {
    return { ok: false, reason: "hidden" };
  }
  if (release.collectedAt !== null) return { ok: false, reason: "collected" };

  const role = roleOf(viewer, project);
  const previewOnly = release.firstPromotedAt === null && !release.jamPinned;
  if (previewOnly) return role === "player" ? { ok: false, reason: "not-found" } : { ok: true };

  switch (project.visibility) {
    case "unlisted":
    case "public":
      return { ok: true };
    case "team":
      return role === "player" ? { ok: false, reason: "forbidden" } : { ok: true };
    case "private":
      return role === "staff" || role === "publisher"
        ? { ok: true }
        : { ok: false, reason: "forbidden" };
  }
}

/** Why a project can't take this visibility, or null: `team` needs a team. */
export function visibilityProblem(
  visibility: GameVisibility,
  project: { teamId: string | null },
): ReleaseApiError | null {
  return visibility === "team" && project.teamId === null
    ? releaseForbidden("team-personal")
    : null;
}
