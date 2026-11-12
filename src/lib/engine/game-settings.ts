import { and, eq, isNull } from "drizzle-orm";

import { db as siteDb } from "@/db";
import { engineProjects } from "@/db/schema";
import { siteOrigin } from "@/env";
import { SITE } from "@/lib/legal-meta";

import { playOrigin } from "./frame-csp";
import { forgetProjectReleases } from "./frame-route";
import { CONNECT_ORIGINS_MAX } from "./limits";
import {
  canDo,
  roleOf,
  visibilityProblem,
  type GameAction,
  type GameRole,
  type GameVisibility,
} from "./release-access";
import { writeAudit, type ReleaseDb } from "./release-audit";
import { ReleaseError, releaseForbidden, type ReleaseApiError } from "./release-errors";
import { releaseViewer, type Actor, type ReleaseTxDb } from "./release-upload";

export type GameSaveMode = "site" | "own" | "none";

export type GameSettingsPatch = {
  visibility?: GameVisibility;
  saveMode?: GameSaveMode;
  connectOrigins?: string[];
  online?: boolean;
};

export type GameSettings = {
  visibility: GameVisibility;
  reviewPending: boolean;
  saveMode: GameSaveMode;
  connectOrigins: string[];
  online: boolean;
};

export type GameSettingsDeps = {
  db?: ReleaseTxDb;
  now?: () => Date;
  /** The site's own origins, which no game may list; default `siteOrigin()` and `playOrigin()`. */
  siteOrigins?: () => readonly string[];
  /** Drops the project's releases from the frame route's cache; default this process's. */
  forget?: (projectId: string) => void;
};

const SETTINGS_INVALID = "game-settings-invalid";

export function connectOriginsTooMany(count: number): ReleaseApiError {
  return {
    code: SETTINGS_INVALID,
    message: `A game can connect to at most ${CONNECT_ORIGINS_MAX} origins; this lists ${count}.`,
    hint: "Remove the ones the game no longer uses, or serve several services from one origin.",
  };
}

export function connectOriginInvalid(value: string): ReleaseApiError {
  return {
    code: SETTINGS_INVALID,
    message: `${value} isn't an https:// or wss:// origin.`,
    hint: "Write the scheme and host only, like https://api.example.com, with no path.",
  };
}

export function connectOriginIsSite(origin: string): ReleaseApiError {
  return {
    code: SETTINGS_INVALID,
    message: `${origin} is ${SITE.name} itself, which a game can't list under Connects to.`,
    hint: `Games reach ${SITE.name} through the play page, never over the network.`,
  };
}

export function ownSavesNeedOrigin(): ReleaseApiError {
  return {
    code: SETTINGS_INVALID,
    message: "A game that saves on its own servers needs at least one origin under Connects to.",
    hint: "Add your save backend's origin, or choose another place for saves.",
  };
}

const hostOf = (origin: string): string | null => {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * The origins a game may list, normalised to `scheme://host[:port]` and
 * deduplicated: at most `CONNECT_ORIGINS_MAX`, each `https:` or `wss:` with
 * no credentials, path, query or fragment, and never a host of the site's
 * own (its pages or its frames, on either scheme).
 */
export function checkConnectOrigins(
  values: readonly string[],
  siteOrigins: readonly string[],
): string[] {
  const own = new Set(siteOrigins.map(hostOf).filter((h): h is string => h !== null));
  const origins: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ReleaseError(connectOriginInvalid(value));
    }
    const bare =
      (url.pathname === "/" || url.pathname === "") &&
      !url.search &&
      !url.hash &&
      !value.endsWith("?") &&
      !value.endsWith("#");
    if (
      (url.protocol !== "https:" && url.protocol !== "wss:") ||
      url.username ||
      url.password ||
      !bare ||
      !url.host
    ) {
      throw new ReleaseError(connectOriginInvalid(value));
    }
    const origin = `${url.protocol}//${url.host.toLowerCase()}`;
    if (own.has(url.host.toLowerCase())) throw new ReleaseError(connectOriginIsSite(origin));
    if (!origins.includes(origin)) origins.push(origin);
  }
  if (origins.length > CONNECT_ORIGINS_MAX) {
    throw new ReleaseError(connectOriginsTooMany(origins.length));
  }
  return origins;
}

const settingsColumns = {
  projectId: engineProjects.projectId,
  game: engineProjects.game,
  teamId: engineProjects.teamId,
  createdById: engineProjects.createdById,
  visibility: engineProjects.visibility,
  reviewRequestedAt: engineProjects.publicReviewRequestedAt,
  approvedAt: engineProjects.publicApprovedAt,
  saveMode: engineProjects.saveMode,
  connectOrigins: engineProjects.connectOrigins,
  online: engineProjects.online,
};

type SettingsRow = {
  projectId: string;
  game: string | null;
  teamId: string | null;
  createdById: string | null;
  visibility: string;
  reviewRequestedAt: Date | null;
  approvedAt: Date | null;
  saveMode: string;
  connectOrigins: string[];
  online: boolean;
};

function notFound(projectId: string): never {
  throw new ReleaseError(
    { code: "not-found", message: `There is no hosted project "${projectId}".` },
    404,
  );
}

async function roleFor(db: ReleaseDb, actor: Actor, row: SettingsRow): Promise<GameRole | "agent"> {
  if (actor.kind === "agent") return "agent";
  if (actor.kind === "staff") return "staff";
  return roleOf(await releaseViewer(db, actor.userId, row), row);
}

function assertMay(role: GameRole | "agent", actions: readonly GameAction[]): void {
  if (!actions.every((action) => canDo(role, action))) {
    throw new ReleaseError(releaseForbidden("role"));
  }
}

const settingsOf = (row: SettingsRow): GameSettings => ({
  visibility: row.visibility as GameVisibility,
  reviewPending: row.reviewRequestedAt !== null && row.approvedAt === null,
  saveMode: row.saveMode as GameSaveMode,
  connectOrigins: [...row.connectOrigins],
  online: row.online,
});

/** The game's settings as `setGameSettings` answers with them, for the people who may change them. */
export async function readGameSettings(
  input: { projectId: string; actor: Actor },
  handle: ReleaseDb = siteDb as unknown as ReleaseDb,
): Promise<GameSettings> {
  const [row] = await handle
    .select(settingsColumns)
    .from(engineProjects)
    .where(and(eq(engineProjects.projectId, input.projectId), isNull(engineProjects.deletedAt)));
  if (!row) notFound(input.projectId);
  assertMay(await roleFor(handle, input.actor, row), ["settings"]);
  return settingsOf(row);
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * A publisher's settings change, in one transaction with its audit rows:
 * `visibility` for a visibility or review change, `settings` for the rest,
 * each with the values before and after. A first `public` stays `unlisted`
 * and asks staff for the one-time review; once approved, `public` is
 * immediate. Choosing anything else while that review waits withdraws it.
 */
export async function setGameSettings(
  input: { projectId: string; patch: GameSettingsPatch; actor: Actor },
  deps: GameSettingsDeps = {},
): Promise<GameSettings> {
  const db = deps.db ?? (siteDb as unknown as ReleaseTxDb);
  const now = deps.now ?? (() => new Date());
  const siteOrigins = deps.siteOrigins ?? (() => [siteOrigin(), playOrigin()]);
  const forget = deps.forget ?? forgetProjectReleases;
  const { projectId, patch, actor } = input;

  const live = and(eq(engineProjects.projectId, projectId), isNull(engineProjects.deletedAt));
  // The role reads staff roles outside this handle, so it is settled before the row is locked.
  const [current] = await db.select(settingsColumns).from(engineProjects).where(live);
  if (!current) notFound(projectId);
  const touchesSettings =
    patch.saveMode !== undefined ||
    patch.connectOrigins !== undefined ||
    patch.online !== undefined;
  assertMay(await roleFor(db, actor, current), [
    ...(patch.visibility !== undefined ? (["visibility"] as const) : []),
    ...(touchesSettings || patch.visibility === undefined ? (["settings"] as const) : []),
  ]);

  const { settings, changed } = await db.transaction(async (tx) => {
    const [row] = await tx.select(settingsColumns).from(engineProjects).where(live).for("update");
    if (!row) notFound(projectId);

    const before = settingsOf(row);
    let visibility = before.visibility;
    let reviewRequestedAt = row.reviewRequestedAt;
    if (patch.visibility !== undefined) {
      const problem = visibilityProblem(patch.visibility, row);
      if (problem) throw new ReleaseError(problem);
      if (patch.visibility === "public" && row.approvedAt === null) {
        visibility = "unlisted";
        reviewRequestedAt = row.reviewRequestedAt ?? now();
      } else {
        visibility = patch.visibility;
        if (patch.visibility !== "public" && before.reviewPending) reviewRequestedAt = null;
      }
    }

    const connectOrigins =
      patch.connectOrigins !== undefined
        ? checkConnectOrigins(patch.connectOrigins, siteOrigins())
        : before.connectOrigins;
    const saveMode = patch.saveMode ?? before.saveMode;
    const online = patch.online ?? before.online;
    if (saveMode === "own" && connectOrigins.length === 0) {
      throw new ReleaseError(ownSavesNeedOrigin());
    }

    const after: GameSettings = {
      visibility,
      reviewPending: reviewRequestedAt !== null && row.approvedAt === null,
      saveMode,
      connectOrigins,
      online,
    };
    const visibilityChanged =
      after.visibility !== before.visibility || reviewRequestedAt !== row.reviewRequestedAt;
    const settingsBefore: Record<string, unknown> = {};
    const settingsAfter: Record<string, unknown> = {};
    if (after.saveMode !== before.saveMode) {
      settingsBefore.saveMode = before.saveMode;
      settingsAfter.saveMode = after.saveMode;
    }
    if (!sameList(after.connectOrigins, before.connectOrigins)) {
      settingsBefore.connectOrigins = before.connectOrigins;
      settingsAfter.connectOrigins = after.connectOrigins;
    }
    if (after.online !== before.online) {
      settingsBefore.online = before.online;
      settingsAfter.online = after.online;
    }
    const settingsChanged = Object.keys(settingsAfter).length > 0;
    if (!visibilityChanged && !settingsChanged) return { settings: before, changed: false };

    await tx
      .update(engineProjects)
      .set({
        visibility,
        publicReviewRequestedAt: reviewRequestedAt,
        saveMode,
        connectOrigins,
        online,
        updatedAt: now(),
      })
      .where(eq(engineProjects.projectId, projectId));
    if (visibilityChanged) {
      await writeAudit(tx, {
        projectId,
        actor,
        action: "visibility",
        at: now(),
        detail: {
          requested: patch.visibility,
          before: { visibility: before.visibility, reviewPending: before.reviewPending },
          after: { visibility: after.visibility, reviewPending: after.reviewPending },
        },
      });
    }
    if (settingsChanged) {
      await writeAudit(tx, {
        projectId,
        actor,
        action: "settings",
        at: now(),
        detail: { before: settingsBefore, after: settingsAfter },
      });
    }
    return { settings: after, changed: true };
  });

  // Visibility and connect origins shape what the frame route serves and its CSP.
  if (changed) forget(projectId);
  return settings;
}
