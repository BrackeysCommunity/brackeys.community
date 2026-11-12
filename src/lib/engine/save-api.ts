// Signed-in players' saves on the site: the rules every save route and the
// claim run through. Each call takes the caller as the access rules see
// them and throws a `ReleaseError` (the release API's error body) when it
// refuses:
//
//   save-forbidden    401 signed out; 403 the project is hidden, saves
//                     elsewhere, or the player may not play its production release
//   save-too-large    413 over the per-save cap, or `limit: "account-total"`
//                     when the player's saves across every game would pass it
//   save-slot-limit   409 a new slot when the game's slots are full
//   schema            422 not a save file, another game's, or another slot's
//   save-store-failed 429 over the hourly write or read rate
//
// The engine-games flag and the production guard are the routes' to check
// before calling in. Every message a player reads from the API is built
// here, from `limits.ts`, and the wording suite reads them from here.

import type { SaveLimits, SaveSummary } from "@jams/engine";
import { parseSaveFile, SLOT_PATTERN } from "@jams/engine/game";
import type { SceneIssue } from "@jams/engine/scene";
import { and, asc, eq, isNull } from "drizzle-orm";

import {
  engineProjects,
  engineReleaseChannels,
  engineReleaseJamLinks,
  engineReleases,
  engineSaves,
  projects,
  user,
} from "@/db/schema";
import { formatBytes } from "@/lib/format-bytes";
import { SITE } from "@/lib/legal-meta";

import type { GameSaveMode } from "./game-settings";
import { HOST_NO_SITE_SAVES_MESSAGE } from "./host-server";
import {
  SAVE_READS_PER_HOUR,
  SAVE_WRITES_PER_HOUR,
  SITE_SAVE_ACCOUNT_BYTES,
  SITE_SAVE_EXPIRY_DAYS,
  SITE_SAVE_LIMITS,
} from "./limits";
import { siteSaveRefusal } from "./local-saves";
import { canPlay, type GameVisibility, type Viewer } from "./release-access";
import { issueError, ReleaseError, type ReleaseApiError } from "./release-errors";
import type { ReleaseObjectStore } from "./release-storage";
import type { ReleaseTxDb } from "./release-upload";
import { engineSaveKey } from "./storage-keys";

export type SaveApiDeps = {
  db: ReleaseTxDb;
  /** Where save texts live, at `engineSaveKey(user, project, slot)`. */
  store: ReleaseObjectStore;
  /** A fixed-window limiter: true while `key` has made fewer than `limit` calls in the window. */
  rateLimit: (
    bucket: string,
    key: string,
    limit: number,
    windowSeconds: number,
  ) => Promise<boolean>;
  now: () => Date;
};

/** The caller for one project, as `viewerOf` reads them; a null `userId` is signed out. */
export type SaveViewer = Viewer;

/** What `saveAccess` judges: the project's own columns. */
export type SaveProject = {
  projectId: string;
  visibility: GameVisibility;
  teamId: string | null;
  hiddenAt: Date | null;
  saveMode: GameSaveMode;
};

/** The release production plays, or null when nothing is live. */
export type SaveProductionRelease = {
  id: string;
  gameId: string;
  hiddenAt: Date | null;
  collectedAt: Date | null;
  firstPromotedAt: Date | null;
  jamPinned: boolean;
};

/** A game's saves for the play page's host: the rows, the caps, the save menu's sentence and the mode. */
export type SaveList = {
  saves: SaveSummary[];
  limits: SaveLimits;
  describe: string;
  mode: GameSaveMode;
};

export type SavePutResult = { bytes: number };

/** One save on the account, for Settings → Game saves. Dates are ISO strings in UTC. */
export type AccountSave = SaveSummary & {
  gameVersion: number;
  releaseId: string | null;
  writtenAt: string;
  usedAt: string;
};

export type AccountGameSaves = {
  projectId: string;
  /** The game's title as its page shows it. */
  title: string;
  saves: AccountSave[];
};

/** Every game with saves on the account, and the account's total against its cap. */
export type AccountSaves = {
  games: AccountGameSaves[];
  usedBytes: number;
  maxBytes: number;
  expiryDays: number;
};

type SlotInput = { viewer: SaveViewer; projectId: string; slot: string };

// ─── The words ───────────────────────────────────────────

const site = SITE.name;

/** The bucket each game's writes count in, per player. */
export const saveWriteBucket = (projectId: string): string => `engine-save-write:${projectId}`;
/** The bucket every read and list counts in, per player. */
export const SAVE_READ_BUCKET = "engine-save-read";
const HOUR_SECONDS = 3_600;

/** The longest title a save's meta may carry. */
export const SAVE_TITLE_MAX = 80;

/** What a signed-in player's save menu says on the play page. */
export const SIGNED_IN_SAVES_DESCRIBE = `Saved to your ${site} account: up to ${SITE_SAVE_LIMITS.maxSlots} saves of ${formatBytes(SITE_SAVE_LIMITS.maxBytes)} for this game. Saves you don't use for ${SITE_SAVE_EXPIRY_DAYS} days are deleted.`;

export function saveSignedOut(): ReleaseApiError {
  return { code: "save-forbidden", message: `Sign in to save to your ${site} account.` };
}

export function saveNotSite(): ReleaseApiError {
  return {
    code: "save-forbidden",
    message: HOST_NO_SITE_SAVES_MESSAGE,
    hint: "Its publisher set it to save on its own servers or not at all.",
  };
}

/** The project is missing or hidden, has no production release, or this player may not play it. */
export function saveUnplayable(): ReleaseApiError {
  return {
    code: "save-forbidden",
    message: `This game can't save to your ${site} account right now.`,
    hint: "Saves go with the game's production release, and there is none this account can play.",
  };
}

export function saveWritesRateLimited(): ReleaseApiError {
  return {
    code: "save-store-failed",
    message: "You're saving very often. Try again in a few minutes.",
  };
}

export function saveReadsRateLimited(): ReleaseApiError {
  return {
    code: "save-store-failed",
    message: "You're loading saves very often. Try again in a few minutes.",
  };
}

export function saveAccountFull(usedBytes: number): ReleaseApiError {
  return {
    code: "save-too-large",
    message: `Your saves on ${site} have reached ${formatBytes(SITE_SAVE_ACCOUNT_BYTES)} across all games.`,
    hint: "Delete saves from games you no longer play in Settings → Game saves.",
    limit: "account-total",
    used: usedBytes,
    max: SITE_SAVE_ACCOUNT_BYTES,
  };
}

export function saveNotASaveFile(issue: SceneIssue): ReleaseApiError {
  return {
    code: "schema",
    message: `This isn't a save file: ${issue.message}.`,
    ...(issue.hint !== undefined ? { hint: issue.hint } : {}),
  };
}

export function saveOtherGame(got: string, want: string): ReleaseApiError {
  return {
    code: "schema",
    message: `This save is for the game "${got}", not "${want}".`,
    hint: "Saves upload to the project whose production release plays that game.",
  };
}

export function saveOtherSlot(got: string, want: string): ReleaseApiError {
  return {
    code: "schema",
    message: `This save names the slot "${got}", not "${want}".`,
    hint: "Upload a save to the slot it names.",
  };
}

export function saveBadSlot(slot: string): ReleaseApiError {
  return {
    code: "schema",
    message: `"${slot}" isn't a save slot.`,
    hint: "A slot is lowercase letters, digits and dashes, 1–32 characters, starting with a letter or digit.",
  };
}

export function saveTitleTooLong(length: number): ReleaseApiError {
  return {
    code: "schema",
    message: `This save's title is ${length} characters; ${site} keeps titles of up to ${SAVE_TITLE_MAX}.`,
  };
}

const STATUS = {
  signedOut: 401,
  forbidden: 403,
  slotLimit: 409,
  tooLarge: 413,
  schema: 422,
  rate: 429,
} as const;

function refuse(body: ReleaseApiError, status: number): never {
  throw new ReleaseError(body, status);
}

/** A site cap's refusal from the host's shared check, as the API's error with its numbers. */
function capError(issue: SceneIssue): ReleaseApiError {
  const detail = (issue.detail ?? {}) as Record<string, unknown>;
  const used = detail.bytes ?? detail.slots;
  const max = detail.maxBytes ?? detail.maxSlots;
  return {
    ...issueError(issue),
    ...(typeof used === "number" ? { used } : {}),
    ...(typeof max === "number" ? { max } : {}),
  };
}

// ─── Access ──────────────────────────────────────────────

/**
 * Who may save to a project, the one check every save route and the claim
 * call: signed in, the project not hidden, its save mode `site`, and the
 * player able to play its production release. Null when they may.
 */
export function saveAccess(
  viewer: SaveViewer,
  project: SaveProject,
  production: SaveProductionRelease | null,
): ReleaseError | null {
  if (viewer.userId === null) return new ReleaseError(saveSignedOut(), STATUS.signedOut);
  if (project.hiddenAt !== null) return new ReleaseError(saveUnplayable(), STATUS.forbidden);
  if (project.saveMode !== "site") return new ReleaseError(saveNotSite(), STATUS.forbidden);
  if (production === null) return new ReleaseError(saveUnplayable(), STATUS.forbidden);
  const play = canPlay(viewer, project, production);
  return play.ok ? null : new ReleaseError(saveUnplayable(), STATUS.forbidden);
}

/** A live project as `saveAccess` judges it, with its title, and its production release; null when it doesn't exist. */
export async function loadSaveTarget(
  db: Pick<ReleaseTxDb, "select">,
  projectId: string,
): Promise<{
  project: SaveProject & { title: string };
  production: SaveProductionRelease | null;
} | null> {
  const [row] = await db
    .select({
      projectId: engineProjects.projectId,
      name: engineProjects.name,
      showcaseTitle: projects.title,
      visibility: engineProjects.visibility,
      teamId: engineProjects.teamId,
      hiddenAt: engineProjects.hiddenAt,
      saveMode: engineProjects.saveMode,
    })
    .from(engineProjects)
    .leftJoin(projects, eq(projects.id, engineProjects.showcaseProjectId))
    .where(and(eq(engineProjects.projectId, projectId), isNull(engineProjects.deletedAt)))
    .limit(1);
  if (!row) return null;
  const project = {
    projectId: row.projectId,
    title: row.showcaseTitle ?? row.name,
    visibility: row.visibility as GameVisibility,
    teamId: row.teamId,
    hiddenAt: row.hiddenAt,
    saveMode: row.saveMode as GameSaveMode,
  };

  const [release] = await db
    .select({
      id: engineReleases.id,
      gameId: engineReleases.gameId,
      hiddenAt: engineReleases.hiddenAt,
      collectedAt: engineReleases.collectedAt,
      firstPromotedAt: engineReleases.firstPromotedAt,
    })
    .from(engineReleaseChannels)
    .innerJoin(engineReleases, eq(engineReleases.id, engineReleaseChannels.releaseId))
    .where(
      and(
        eq(engineReleaseChannels.projectId, projectId),
        eq(engineReleaseChannels.channel, "production"),
      ),
    )
    .limit(1);
  if (!release) return { project, production: null };
  const [pin] = await db
    .select({ jamId: engineReleaseJamLinks.jamId })
    .from(engineReleaseJamLinks)
    .where(eq(engineReleaseJamLinks.releaseId, release.id))
    .limit(1);
  return { project, production: { ...release, jamPinned: pin !== undefined } };
}

function signedInUser(viewer: SaveViewer): string {
  if (viewer.userId === null) refuse(saveSignedOut(), STATUS.signedOut);
  return viewer.userId;
}

async function countRead(deps: SaveApiDeps, userId: string): Promise<void> {
  const ok = await deps.rateLimit(SAVE_READ_BUCKET, userId, SAVE_READS_PER_HOUR, HOUR_SECONDS);
  if (!ok) refuse(saveReadsRateLimited(), STATUS.rate);
}

const slotKey = (userId: string, projectId: string, slot: string) =>
  and(
    eq(engineSaves.userId, userId),
    eq(engineSaves.projectId, projectId),
    eq(engineSaves.slot, slot),
  );

const summaryOf = (row: {
  slot: string;
  meta: SaveSummary["meta"];
  bytes: number;
}): SaveSummary => ({ slot: row.slot, meta: row.meta, bytes: row.bytes });

// ─── The calls ───────────────────────────────────────────

/**
 * A game's saves; bumps every listed row's `used_at`. A game that saves
 * elsewhere still lists what the account kept from before, with its mode.
 */
export async function listSaves(
  deps: SaveApiDeps,
  input: { viewer: SaveViewer; projectId: string },
): Promise<SaveList> {
  const userId = signedInUser(input.viewer);
  const target = await loadSaveTarget(deps.db, input.projectId);
  if (!target) refuse(saveUnplayable(), STATUS.forbidden);
  await countRead(deps, userId);

  const rows = await deps.db
    .update(engineSaves)
    .set({ usedAt: deps.now() })
    .where(and(eq(engineSaves.userId, userId), eq(engineSaves.projectId, input.projectId)))
    .returning({ slot: engineSaves.slot, meta: engineSaves.meta, bytes: engineSaves.bytes });
  const mode = target.project.saveMode;
  return {
    saves: rows.map(summaryOf).sort((a, b) => a.slot.localeCompare(b.slot)),
    limits: { maxBytes: SITE_SAVE_LIMITS.maxBytes, maxSlots: SITE_SAVE_LIMITS.maxSlots },
    describe: mode === "site" ? SIGNED_IN_SAVES_DESCRIBE : HOST_NO_SITE_SAVES_MESSAGE,
    mode,
  };
}

/**
 * One save's text, or null when the slot is empty; bumps its `used_at`. A
 * player reads their own saves whatever the game's state, so Settings can
 * download them.
 */
export async function readSave(deps: SaveApiDeps, input: SlotInput): Promise<string | null> {
  const userId = signedInUser(input.viewer);
  await countRead(deps, userId);
  if (!SLOT_PATTERN.test(input.slot)) return null;

  const [row] = await deps.db
    .update(engineSaves)
    .set({ usedAt: deps.now() })
    .where(slotKey(userId, input.projectId, input.slot))
    .returning({ slot: engineSaves.slot });
  if (!row) return null;
  const stream = await deps.store.stream(engineSaveKey(userId, input.projectId, input.slot));
  return stream ? await new Response(stream).text() : null;
}

/** Writes a save after every check in order; the object, then the row (`written_at = used_at = now`). */
export async function putSave(
  deps: SaveApiDeps,
  input: SlotInput & { text: string },
): Promise<SavePutResult> {
  const { viewer, projectId, slot, text } = input;
  const userId = signedInUser(viewer);

  const target = await loadSaveTarget(deps.db, projectId);
  if (!target) refuse(saveUnplayable(), STATUS.forbidden);
  const access = saveAccess(viewer, target.project, target.production);
  if (access) throw access;
  const production = target.production;
  if (!production) refuse(saveUnplayable(), STATUS.forbidden);

  if (!SLOT_PATTERN.test(slot)) refuse(saveBadSlot(slot), STATUS.schema);

  const allowed = await deps.rateLimit(
    saveWriteBucket(projectId),
    userId,
    SAVE_WRITES_PER_HOUR,
    HOUR_SECONDS,
  );
  if (!allowed) refuse(saveWritesRateLimited(), STATUS.rate);

  // Size alone: with no slots held the count can't refuse.
  const tooLarge = await siteSaveRefusal({ slot, text }, async () => []);
  if (tooLarge) refuse(capError(tooLarge), STATUS.tooLarge);

  const parsed = parseSaveFile(text);
  if (!parsed.ok) {
    const [issue] = parsed.issues;
    refuse(
      issue ? saveNotASaveFile(issue) : { code: "schema", message: "This isn't a save file." },
      STATUS.schema,
    );
  }
  const file = parsed.file;
  if (file.game !== production.gameId) {
    refuse(saveOtherGame(file.game, production.gameId), STATUS.schema);
  }
  if (file.slot !== slot) refuse(saveOtherSlot(file.slot, slot), STATUS.schema);
  const titleLength = file.meta.title?.length ?? 0;
  if (titleLength > SAVE_TITLE_MAX) refuse(saveTitleTooLong(titleLength), STATUS.schema);

  const bytes = new TextEncoder().encode(text);
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    // One player's writes take turns, so two can't both fit under the total.
    const [account] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for("no key update");
    if (!account) refuse(saveSignedOut(), STATUS.signedOut);

    const held = await tx
      .select({
        projectId: engineSaves.projectId,
        slot: engineSaves.slot,
        bytes: engineSaves.bytes,
      })
      .from(engineSaves)
      .where(eq(engineSaves.userId, userId));
    const slots = held.filter((r) => r.projectId === projectId).map((r) => r.slot);
    const full = await siteSaveRefusal({ slot, text }, async () => slots);
    if (full) refuse(capError(full), STATUS.slotLimit);

    const others = held
      .filter((r) => !(r.projectId === projectId && r.slot === slot))
      .reduce((sum, r) => sum + r.bytes, 0);
    if (others + bytes.byteLength > SITE_SAVE_ACCOUNT_BYTES) {
      refuse(saveAccountFull(others), STATUS.tooLarge);
    }

    await deps.store.put(engineSaveKey(userId, projectId, slot), bytes, "application/json");
    const row = {
      bytes: bytes.byteLength,
      gameVersion: file.gameVersion,
      releaseId: file.release,
      meta: file.meta,
      writtenAt: now,
      usedAt: now,
    };
    await tx
      .insert(engineSaves)
      .values({ userId, projectId, slot, ...row })
      .onConflictDoUpdate({
        target: [engineSaves.userId, engineSaves.projectId, engineSaves.slot],
        set: row,
      });
  });
  return { bytes: bytes.byteLength };
}

/** Deletes a save's object, then its row; an empty slot is not an error. */
export async function removeSave(deps: SaveApiDeps, input: SlotInput): Promise<void> {
  const userId = signedInUser(input.viewer);
  if (!SLOT_PATTERN.test(input.slot)) return;
  await deps.store.remove(engineSaveKey(userId, input.projectId, input.slot));
  await deps.db.delete(engineSaves).where(slotKey(userId, input.projectId, input.slot));
}

/**
 * Every game's saves on the signed-in account, by title, a deleted
 * project's included until it is purged, since they count in the total.
 * Listing here doesn't count as using a save.
 */
export async function listAccountSaves(
  deps: SaveApiDeps,
  input: { userId: string },
): Promise<AccountSaves> {
  await countRead(deps, input.userId);
  const rows = await deps.db
    .select({
      projectId: engineSaves.projectId,
      slot: engineSaves.slot,
      bytes: engineSaves.bytes,
      meta: engineSaves.meta,
      gameVersion: engineSaves.gameVersion,
      releaseId: engineSaves.releaseId,
      writtenAt: engineSaves.writtenAt,
      usedAt: engineSaves.usedAt,
      name: engineProjects.name,
      showcaseTitle: projects.title,
    })
    .from(engineSaves)
    .innerJoin(engineProjects, eq(engineProjects.projectId, engineSaves.projectId))
    .leftJoin(projects, eq(projects.id, engineProjects.showcaseProjectId))
    .where(eq(engineSaves.userId, input.userId))
    .orderBy(asc(engineSaves.projectId), asc(engineSaves.slot));

  const games = new Map<string, AccountGameSaves>();
  let usedBytes = 0;
  for (const row of rows) {
    usedBytes += row.bytes;
    let game = games.get(row.projectId);
    if (!game) {
      game = { projectId: row.projectId, title: row.showcaseTitle ?? row.name, saves: [] };
      games.set(row.projectId, game);
    }
    game.saves.push({
      ...summaryOf(row),
      gameVersion: row.gameVersion,
      releaseId: row.releaseId,
      writtenAt: row.writtenAt.toISOString(),
      usedAt: row.usedAt.toISOString(),
    });
  }
  return {
    games: [...games.values()].sort(
      (a, b) => a.title.localeCompare(b.title) || a.projectId.localeCompare(b.projectId),
    ),
    usedBytes,
    maxBytes: SITE_SAVE_ACCOUNT_BYTES,
    expiryDays: SITE_SAVE_EXPIRY_DAYS,
  };
}
