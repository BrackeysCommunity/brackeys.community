import {
  capitalise,
  DEFAULT_SWAP_TIMING,
  sceneVersionName,
  type SwapTiming,
} from "@jams/engine/game";
import {
  parseReleaseManifest,
  sceneVersionFitIssue,
  type AssetId,
  type ReleaseManifest,
  type Sha256,
} from "@jams/engine/project";
import { and, desc, eq, inArray, isNull, lt, ne, notInArray, or, sql, sum } from "drizzle-orm";

import {
  engineProjects,
  engineReleaseAudit,
  engineReleaseChannels,
  engineReleaseFiles,
  engineReleases,
  engineSceneChannels,
  engineSceneVersionFiles,
  engineSceneVersions,
} from "@/db/schema";
import { siteUrl } from "@/env";
import { gamePagePath } from "@/lib/engine/route-paths";
import { formatCount } from "@/lib/format-bytes";
import { releaseDay } from "@/lib/jam-links";

import { RELEASE_GRACE_DAYS } from "./limits";
import { engineLive } from "./live-events";
import { checkLiveChannelQuota, LIVE_KEPT_RULE, quotaAmount } from "./quota";
import { refusalFor, type ReleaseChannel } from "./release-access";
import { writeAudit, type Actor, type ReleaseDb } from "./release-audit";
import { scenesBefore } from "./release-channels";
import { issueError, liveBlocked, type ReleaseApiError } from "./release-errors";
import {
  actorRole,
  liveProject,
  notFound,
  refuse,
  resolveDeps,
  type ReleaseDeps,
} from "./release-upload";
import type { ProjectRow } from "./release-viewer";

export type LiveChannel = ReleaseChannel;

export type ScenePointerMove = {
  projectId: string;
  scene: AssetId;
  channel: LiveChannel;
  /** The version to point at, by number; null takes the pointer off ("Stop"). */
  to: { number: number } | null;
  /** How players get the version. Ignored when `to` is null: players go back at the removed pointer's timing. */
  timing: SwapTiming;
  action: "scene-promote" | "scene-rollback" | "scene-clear";
  actor: Actor;
};

/** Where a pointer was and is, by version number; null is the release's own scene. */
export type ScenePointerMoved = { from: number | null; to: number | null };

/** Why a version can't be pointed at, as `restoreScenePointers` words it. */
export type PointerRefusal =
  | "missing"
  | "collected"
  | "hidden"
  | "blocked"
  | "incompatible"
  | "size";

/** Whether a channel may point at a version, and what it adds to the channel's size. */
export type PointerTargetVerdict =
  | { ok: true; extraBytes: number }
  | {
      ok: false;
      why: PointerRefusal;
      error: ReleaseApiError;
      /** `level-1@3`, or the scene alone when the version doesn't exist. */
      label: string;
      /** The end of "level-1@3 wasn't restored: …". */
      reason: string;
    };

// ─── The refusals ────────────────────────────────────────

export function sceneVersionRemoved(label: string, removedAt: Date | null): ReleaseApiError {
  return {
    code: "release-immutable",
    message: `${label} was removed${removedAt ? ` on ${releaseDay(removedAt)}` : ""}; its files are gone.`,
    hint: `${capitalise(LIVE_KEPT_RULE)}; others go ${formatCount(RELEASE_GRACE_DAYS)} days after publishing. Change the scene and publish it again.`,
  };
}

function sceneVersionHidden(label: string, reason: string | null): ReleaseApiError {
  return {
    code: "release-forbidden",
    message: `${label} is hidden${reason ? `: ${reason}` : "."}`,
    hint: "Hidden scene versions can't go live until staff unhide them.",
  };
}

function releaseTakesNoLive(release: number): ReleaseApiError {
  return {
    code: "live-incompatible",
    message: `v${formatCount(release)} was published before live scenes, so it can't take one.`,
    hint: "Publish a new release, then publish the scene again.",
  };
}

/** The refusal for a version number the scene doesn't have. */
export function noVersion(scene: AssetId, number: number): ReleaseApiError {
  return {
    code: "not-found",
    message: `There is no ${sceneVersionName(scene, number)}.`,
  };
}

/** The refusal for a live scene on a channel that plays no release: one is published to preview, and promoted to production. */
export function noChannelRelease(channel: LiveChannel): ReleaseApiError {
  return {
    code: "not-found",
    message: `This game has no release on ${channel} for a live scene to update.`,
    hint: `${channel === "preview" ? "Publish a release" : "Promote a release to production"} first: a live scene replaces one scene of the release a channel plays.`,
  };
}

// ─── The rule, pure ──────────────────────────────────────

/** A scene version as the rule reads it. */
export type PointerTargetVersion = {
  scene: AssetId;
  number: number;
  /** Canonical `scene-version.json`; null once collected. */
  descriptor: string | null;
  compatKey: string;
  collectedAt: Date | null;
  hiddenAt: Date | null;
  hiddenReason: string | null;
  blockedAt: Date | null;
  blockedBy: string | null;
  blockReason: string | null;
  reportsOk: number;
  reportsFailed: number;
};

/** The channel's release as the rule reads it. */
export type PointerTargetRelease = {
  version: number;
  /** Canonical `release.json`; null once collected. */
  manifest: string | null;
  liveCompatKey: string;
  totalBytes: number;
};

export type PointerTargetFacts = {
  channel: LiveChannel;
  scene: AssetId;
  /** Null when the project has no such version. */
  version: PointerTargetVersion | null;
  release: PointerTargetRelease;
  /** The version's files the release doesn't list, blobs included. */
  extraBytes: number;
  /** Every other scene pointer's `extra_bytes` on the channel. */
  otherExtraBytes: number;
};

/** Bytes of `files` whose hash `listed` (the release's files) doesn't hold, each hash once. */
export function extraBytesOf(
  files: readonly { sha256: string; bytes: number }[],
  listed: ReadonlySet<string>,
): number {
  const seen = new Set<string>();
  let total = 0;
  for (const f of files) {
    if (listed.has(f.sha256) || seen.has(f.sha256)) continue;
    seen.add(f.sha256);
    total += f.bytes;
  }
  return total;
}

const blockedError = (v: PointerTargetVersion): ReleaseApiError =>
  liveBlocked(v, {
    by: v.blockedBy,
    reason: v.blockReason,
    reports: { ok: v.reportsOk, failed: v.reportsFailed },
  });

/**
 * Why a scene version doesn't fit a release, or null when it does, as the
 * release API's refusal of `sceneVersionFitIssue`'s answer (the rule the
 * editor's Keep list reads too). Moves and the version's detail both ask this.
 */
export function sceneVersionMisfit(
  v: Pick<PointerTargetVersion, "scene" | "number" | "compatKey"> & { descriptor: string },
  release: Pick<PointerTargetRelease, "version" | "manifest" | "liveCompatKey">,
): ReleaseApiError | null {
  const label = sceneVersionName(v.scene, v.number);
  const releaseName = `v${formatCount(release.version)}`;
  if (release.manifest === null) return releaseTakesNoLive(release.version);
  const misfit = sceneVersionFitIssue(
    { manifest: release.manifest, liveCompatKey: release.liveCompatKey },
    { descriptor: v.descriptor, compatKey: v.compatKey },
    { names: { version: label, release: releaseName } },
  );
  if (misfit === null) return null;
  switch (misfit.on) {
    case "release":
      return releaseTakesNoLive(release.version);
    case "version":
      return misfit.issue
        ? issueError(misfit.issue)
        : { code: "schema", message: `${label} isn't a scene version.` };
    case "compat":
      return {
        code: "live-incompatible",
        message: `${label} was built for another release than ${releaseName}.`,
        hint: "Publish the scene again from the project as the release has it.",
      };
  }
}

/**
 * The pure half of `checkPointerTarget`: the version exists and isn't
 * collected, hidden or blocked, fits the release (`sceneVersionMisfit`),
 * and the release's size plus every pointer's extra bytes stays within a
 * release's size.
 */
export function pointerTargetVerdict(facts: PointerTargetFacts): PointerTargetVerdict {
  const { version: v, release, channel } = facts;
  if (!v)
    return {
      ok: false,
      why: "missing",
      label: facts.scene,
      reason: "that version no longer exists",
      error: { code: "not-found", message: `${facts.scene} has no such version.` },
    };
  const label = sceneVersionName(v.scene, v.number);
  const no = (why: PointerRefusal, error: ReleaseApiError, reason: string) =>
    ({ ok: false, why, error, label, reason }) as const;

  if (v.collectedAt || v.descriptor === null)
    return no(
      "collected",
      sceneVersionRemoved(label, v.collectedAt),
      v.collectedAt ? `it was removed on ${releaseDay(v.collectedAt)}` : "it was removed",
    );
  if (v.hiddenAt)
    return no("hidden", sceneVersionHidden(label, v.hiddenReason), "staff have hidden it");
  if (v.blockedAt) return no("blocked", blockedError(v), "it's blocked");

  const misfit = sceneVersionMisfit({ ...v, descriptor: v.descriptor }, release);
  if (misfit) return no("incompatible", misfit, `it doesn't fit v${formatCount(release.version)}`);

  const size = checkLiveChannelQuota(
    channel,
    release.totalBytes + facts.otherExtraBytes + facts.extraBytes,
  );
  if (!size.ok)
    return no(
      "size",
      {
        code: "quota-exceeded",
        message: size.message,
        hint: size.hint,
        limit: size.limit,
        used: size.used,
        max: size.max,
      },
      `it would take ${channel} past ${quotaAmount("releaseBytes", size.max)}`,
    );
  return { ok: true, extraBytes: facts.extraBytes };
}

// ─── Reading the facts ───────────────────────────────────

const releaseColumns = {
  id: engineReleases.id,
  version: engineReleases.version,
  manifest: engineReleases.manifest,
  liveCompatKey: engineReleases.liveCompatKey,
  totalBytes: engineReleases.totalBytes,
};

/** A channel's release as the live reads use it, its manifest read. */
export type ChannelRelease = {
  id: Sha256;
  version: number;
  manifestText: string;
  manifest: ReleaseManifest;
  liveCompatKey: string;
  totalBytes: number;
  /** The channel's `live_rev`. */
  rev: number;
};

/** The release `channel` plays, unless it was collected or its manifest is gone; null when there is none. */
export async function channelRelease(
  db: Pick<ReleaseDb, "select">,
  projectId: string,
  channel: LiveChannel,
): Promise<ChannelRelease | null> {
  const [row] = await db
    .select({ ...releaseColumns, rev: engineReleaseChannels.liveRev })
    .from(engineReleaseChannels)
    .innerJoin(engineReleases, eq(engineReleases.id, engineReleaseChannels.releaseId))
    .where(
      and(
        eq(engineReleaseChannels.projectId, projectId),
        eq(engineReleaseChannels.channel, channel),
        isNull(engineReleases.collectedAt),
      ),
    );
  const parsed = row?.manifest ? parseReleaseManifest(row.manifest) : null;
  if (!row?.manifest || !parsed?.ok) return null;
  return { ...row, manifestText: row.manifest, manifest: parsed.manifest };
}

async function releaseById(
  db: ReleaseDb,
  projectId: string,
  id: string,
): Promise<(PointerTargetRelease & { id: string }) | null> {
  const [row] = await db
    .select(releaseColumns)
    .from(engineReleases)
    .where(and(eq(engineReleases.id, id), eq(engineReleases.projectId, projectId)));
  return row ?? null;
}

const versionColumns = {
  id: engineSceneVersions.id,
  scene: engineSceneVersions.sceneId,
  number: engineSceneVersions.number,
  descriptor: engineSceneVersions.descriptor,
  compatKey: engineSceneVersions.compatKey,
  collectedAt: engineSceneVersions.collectedAt,
  hiddenAt: engineSceneVersions.hiddenAt,
  hiddenReason: engineSceneVersions.hiddenReason,
  blockedAt: engineSceneVersions.blockedAt,
  blockedBy: engineSceneVersions.blockedBy,
  blockReason: engineSceneVersions.blockReason,
  reportsOk: engineSceneVersions.reportsOk,
  reportsFailed: engineSceneVersions.reportsFailed,
};

/**
 * The one rule for pointing a channel at a version: it fits the channel's
 * release (`checkSceneVersion`), isn't collected, hidden or blocked, and
 * keeps the channel within its size (the release's bytes plus every
 * pointer's extra bytes). Every move calls it. `release` checks against
 * that release instead of the one the channel names now, as a release
 * move does before the channel names it.
 */
export async function checkPointerTarget(
  tx: ReleaseDb,
  input: {
    projectId: string;
    channel: LiveChannel;
    scene: AssetId;
    versionId: string;
    release?: string;
  },
): Promise<PointerTargetVerdict> {
  const { projectId, channel, scene } = input;
  const release =
    input.release === undefined
      ? await channelRelease(tx, projectId, channel).then(
          (r) => r && { ...r, manifest: r.manifestText },
        )
      : await releaseById(tx, projectId, input.release);
  if (!release) return refuse(noChannelRelease(channel), 404);

  const [version] = await tx
    .select(versionColumns)
    .from(engineSceneVersions)
    .where(
      and(
        eq(engineSceneVersions.id, input.versionId),
        eq(engineSceneVersions.projectId, projectId),
        eq(engineSceneVersions.sceneId, scene),
      ),
    );
  const files = version
    ? await tx
        .select({ sha256: engineSceneVersionFiles.sha256, bytes: engineSceneVersionFiles.bytes })
        .from(engineSceneVersionFiles)
        .where(eq(engineSceneVersionFiles.versionId, version.id))
    : [];
  const listed =
    files.length === 0
      ? []
      : await tx
          .select({ sha256: engineReleaseFiles.sha256 })
          .from(engineReleaseFiles)
          .where(
            and(
              eq(engineReleaseFiles.releaseId, release.id),
              inArray(
                engineReleaseFiles.sha256,
                files.map((f) => f.sha256),
              ),
            ),
          );
  const [others] = await tx
    .select({ bytes: sum(engineSceneChannels.extraBytes) })
    .from(engineSceneChannels)
    .where(
      and(
        eq(engineSceneChannels.projectId, projectId),
        eq(engineSceneChannels.channel, channel),
        ne(engineSceneChannels.sceneId, scene),
      ),
    );
  return pointerTargetVerdict({
    channel,
    scene,
    version: version ?? null,
    release,
    extraBytes: extraBytesOf(files, new Set(listed.map((r) => r.sha256))),
    otherExtraBytes: Number(others?.bytes ?? 0),
  });
}

// ─── Moving one pointer ─────────────────────────────────

/** Locks the project row, so pointer moves, commits and moderation on one project run one at a time. */
export async function lockProject(tx: ReleaseDb, projectId: string): Promise<void> {
  await tx
    .select({ projectId: engineProjects.projectId })
    .from(engineProjects)
    .where(eq(engineProjects.projectId, projectId))
    .for("update");
}

/** Refuses a move the caller's role can't make on `channel`: an agent on production is sent to the game's page. */
async function assertMayMoveScene(
  deps: ReleaseDeps,
  db: ReleaseDb,
  actor: Actor,
  project: ProjectRow,
  channel: LiveChannel,
): Promise<void> {
  const refusal = refusalFor(await actorRole(deps, db, actor, project), `live-move-${channel}`, {
    gameUrl: siteUrl(gamePagePath(project.projectId)),
  });
  if (refusal) refuse(refusal);
}

/** Tells open play pages the channel moved. Best effort: a page that misses it finds the move on its next poll. */
export async function announceLiveMove(
  projectId: string,
  channel: LiveChannel,
  rev: number,
): Promise<void> {
  await engineLive.announce({ projectId, channel, rev }).catch(() => undefined);
}

const pointerWhere = (projectId: string, channel: LiveChannel, scene: AssetId) =>
  and(
    eq(engineSceneChannels.projectId, projectId),
    eq(engineSceneChannels.channel, channel),
    eq(engineSceneChannels.sceneId, scene),
  );

/**
 * Inside the caller's transaction, which holds the project's lock: stores
 * `rev` (the move's audit id) as the channels' `live_rev`, never lowering
 * it, since play pages ignore a rev at or below one they've seen.
 */
export async function setLiveRev(
  tx: ReleaseDb,
  projectId: string,
  channels: readonly LiveChannel[],
  rev: number,
): Promise<void> {
  if (channels.length === 0) return;
  await tx
    .update(engineReleaseChannels)
    .set({ liveRev: sql`greatest(${engineReleaseChannels.liveRev}, ${rev})` })
    .where(
      and(
        eq(engineReleaseChannels.projectId, projectId),
        inArray(engineReleaseChannels.channel, [...channels]),
      ),
    );
}

/** What a pointer move did: `rev` is its audit id, the channel's new `live_rev`, or null when nothing moved. */
export type ScenePointerResult = ScenePointerMoved & { rev: number | null };

/**
 * Inside the caller's transaction, which holds the project's lock: moves
 * one scene's pointer, after `checkPointerTarget` for a version, writes
 * one audit row with the timing players get in its `detail` (a removed
 * pointer's own, when it goes back to the release's scene), and stores that row's id
 * as the channel's `live_rev`. A pointer already on that version with that
 * timing is left as it is, with no row. The caller announces `rev`.
 */
export async function pointScene(
  tx: ReleaseDb,
  move: ScenePointerMove & { at: Date },
): Promise<ScenePointerResult> {
  const { projectId, scene, channel, actor, at } = move;
  const [current] = await tx
    .select({
      versionId: engineSceneChannels.versionId,
      timing: engineSceneChannels.timing,
      number: engineSceneVersions.number,
    })
    .from(engineSceneChannels)
    .innerJoin(engineSceneVersions, eq(engineSceneVersions.id, engineSceneChannels.versionId))
    .where(pointerWhere(projectId, channel, scene))
    .for("update");
  const from = current?.number ?? null;
  const release = await channelRelease(tx, projectId, channel);

  let versionId: string | null = null;
  let timing = move.timing;
  if (move.to === null) {
    if (!current) return { from, to: null, rev: null };
    timing = current.timing as SwapTiming;
    await tx.delete(engineSceneChannels).where(pointerWhere(projectId, channel, scene));
  } else {
    const [target] = await tx
      .select({ id: engineSceneVersions.id })
      .from(engineSceneVersions)
      .where(
        and(
          eq(engineSceneVersions.projectId, projectId),
          eq(engineSceneVersions.sceneId, scene),
          eq(engineSceneVersions.number, move.to.number),
        ),
      );
    if (!target) return refuse(noVersion(scene, move.to.number), 404);
    versionId = target.id;
    if (current?.versionId === versionId && current.timing === timing)
      return { from, to: move.to.number, rev: null };
    const verdict = await checkPointerTarget(tx, { projectId, channel, scene, versionId });
    if (!verdict.ok) return refuse(verdict.error);
    // A timing-only change keeps `updated_at`: the breaker's window runs from when the version went live.
    const stamp = { updatedById: actor.userId, updatedAt: at };
    const set = { versionId, timing, extraBytes: verdict.extraBytes };
    await tx
      .insert(engineSceneChannels)
      .values({ projectId, channel, sceneId: scene, ...set, ...stamp })
      .onConflictDoUpdate({
        target: [
          engineSceneChannels.projectId,
          engineSceneChannels.channel,
          engineSceneChannels.sceneId,
        ],
        set: current?.versionId === versionId ? set : { ...set, ...stamp },
      });
  }

  const to = move.to?.number ?? null;
  const rev = await writeAudit(tx, {
    projectId,
    actor,
    action: move.action,
    channel,
    releaseId: release?.id ?? null,
    sceneId: scene,
    sceneVersionId: versionId ?? current?.versionId ?? null,
    detail: { from, to, timing },
    at,
  });
  await setLiveRev(tx, projectId, [channel], rev);
  return { from, to, rev };
}

const SCENE_MOVES = ["scene-promote", "scene-rollback", "scene-clear"] as const;

/** Audit rows `previousPointer` reads at a time, newest first. */
const HISTORY_PAGE = 20;

/** A version the audit log names that has since been deleted. */
const GONE = Symbol("gone");

/**
 * The version a scene's pointer on the channel named before the last move
 * that changed it, from the audit log: a number, or null for the release's
 * own scene. A move is either a scene move (its `detail.from`) or a
 * release move that cleared or restored it (the channel's scenes before
 * it). A move that left the pointer where it was, such as a timing-only
 * change or a release rollback putting back the version it cleared, is
 * passed over. Rolling back twice returns to where it started. A version
 * the log names that no longer exists can't be gone back to, so the walk
 * carries on past it to the one before.
 */
async function previousPointer(
  tx: ReleaseDb,
  projectId: string,
  channel: LiveChannel,
  scene: AssetId,
): Promise<number | null> {
  const nothing = () => notFound(`${scene} has no earlier version on ${channel} to go back to.`);
  // What the log names a version by: its id (a release move's scenes) or its number (a scene move's `from`).
  type Named = { id: string } | { number: number } | null;
  const resolver = async (names: readonly Named[]) => {
    const ids = names.flatMap((n) => (n && "id" in n ? [n.id] : []));
    const numbers = names.flatMap((n) => (n && "number" in n ? [n.number] : []));
    const found =
      ids.length + numbers.length === 0
        ? []
        : await tx
            .select({ id: engineSceneVersions.id, number: engineSceneVersions.number })
            .from(engineSceneVersions)
            .where(
              and(
                eq(engineSceneVersions.projectId, projectId),
                eq(engineSceneVersions.sceneId, scene),
                or(
                  ids.length ? inArray(engineSceneVersions.id, ids) : undefined,
                  numbers.length ? inArray(engineSceneVersions.number, numbers) : undefined,
                ),
              ),
            );
    const byId = new Map(found.map((v) => [v.id, v.number]));
    const existing = new Set(found.map((v) => v.number));
    return (n: Named): number | null | typeof GONE =>
      n === null
        ? null
        : "id" in n
          ? (byId.get(n.id) ?? GONE)
          : existing.has(n.number)
            ? n.number
            : GONE;
  };
  const [current] = await tx
    .select({ versionId: engineSceneChannels.versionId })
    .from(engineSceneChannels)
    .where(pointerWhere(projectId, channel, scene));
  const currentName: Named = current ? { id: current.versionId } : null;
  // What the pointer named after the row being read: walking back, each move's "before".
  let after = (await resolver([currentName]))(currentName);

  const detail = engineReleaseAudit.detail;
  const touchesScene = or(
    and(
      eq(engineReleaseAudit.sceneId, scene),
      inArray(engineReleaseAudit.action, [...SCENE_MOVES]),
    ),
    and(
      inArray(engineReleaseAudit.action, ["promote", "rollback"]),
      sql`(jsonb_exists(${detail} -> 'scenes', ${scene}) or jsonb_exists(${detail} -> 'restored', ${scene}))`,
    ),
  );
  const beforeRow = (row: { action: string; detail: unknown }): Named => {
    if ((SCENE_MOVES as readonly string[]).includes(row.action)) {
      const from = (row.detail as { from?: unknown } | null)?.from;
      return typeof from === "number" ? { number: from } : null;
    }
    const versionId = scenesBefore(row.detail)[scene];
    return versionId === undefined ? null : { id: versionId };
  };
  let olderThan: number | null = null;
  for (;;) {
    const rows = await tx
      .select({ id: engineReleaseAudit.id, action: engineReleaseAudit.action, detail })
      .from(engineReleaseAudit)
      .where(
        and(
          eq(engineReleaseAudit.projectId, projectId),
          eq(engineReleaseAudit.channel, channel),
          touchesScene,
          olderThan === null ? undefined : lt(engineReleaseAudit.id, olderThan),
        ),
      )
      .orderBy(desc(engineReleaseAudit.id))
      .limit(HISTORY_PAGE);
    const names = rows.map(beforeRow);
    const resolve = await resolver(names);
    for (const name of names) {
      const before = resolve(name);
      if (before !== GONE && before !== after) return before;
      after = before;
    }
    if (rows.length < HISTORY_PAGE) return nothing();
    olderThan = rows.at(-1)!.id;
  }
}

/**
 * Moves one scene's pointer on a channel, audits it, sets the channel's
 * `live_rev` and announces it. Preview takes editors and agent tokens;
 * production a person with the publisher role. `to: "previous"` (a
 * rollback without a version) goes back to what the audit log says the
 * pointer named before the last move that changed it, or off when it
 * named none.
 */
export async function moveScenePointer(
  deps: ReleaseDeps,
  input: Omit<ScenePointerMove, "to"> & { to: ScenePointerMove["to"] | "previous" },
): Promise<ScenePointerMoved> {
  const { db, now } = resolveDeps(deps);
  const { projectId, channel, scene } = input;
  const project = await liveProject(db, projectId);
  await assertMayMoveScene(deps, db, input.actor, project, channel);
  const result = await db.transaction(async (tx) => {
    await lockProject(tx, projectId);
    let to = input.to;
    if (to === "previous") {
      const previous = await previousPointer(tx, projectId, channel, scene);
      to = previous === null ? null : { number: previous };
    }
    return pointScene(tx, { ...input, to, at: now() });
  });
  if (result.rev !== null) await announceLiveMove(projectId, channel, result.rev);
  return { from: result.from, to: result.to };
}

// ─── When a channel's release moves ─────────────────────

/**
 * Inside a release promote's transaction: drops the channel's scene
 * pointers but the kept ones, and answers what was cleared (scene →
 * version id) for the audit row's `detail.scenes`. The caller checks each
 * kept one against the new release with `checkPointerTarget` and stores
 * the extra bytes it answers.
 */
export async function resetScenePointers(
  tx: ReleaseDb,
  input: { projectId: string; channel: string; release: string; keep: readonly AssetId[] },
): Promise<Readonly<Record<AssetId, string>>> {
  const onChannel = and(
    eq(engineSceneChannels.projectId, input.projectId),
    eq(engineSceneChannels.channel, input.channel),
  );
  const cleared = await tx
    .delete(engineSceneChannels)
    .where(
      input.keep.length === 0
        ? onChannel
        : and(onChannel, notInArray(engineSceneChannels.sceneId, [...input.keep])),
    )
    .returning({ scene: engineSceneChannels.sceneId, versionId: engineSceneChannels.versionId });
  return Object.fromEntries(
    cleared.sort((a, b) => (a.scene < b.scene ? -1 : 1)).map((r) => [r.scene, r.versionId]),
  );
}

/**
 * Inside a release rollback's transaction: puts back the pointers the
 * undone move cleared (with `next-load`), checked against the release the
 * channel returns to, and skips those that no longer fit with the reason:
 * "level-1@3 wasn't restored: it was removed on 2 Dec 2026".
 */
export async function restoreScenePointers(
  tx: ReleaseDb,
  input: {
    projectId: string;
    channel: string;
    release: string;
    scenes: Readonly<Record<AssetId, string>>;
    /** The rollback's actor and clock, stamped on each restored pointer. */
    actor?: Actor;
    at?: Date;
  },
): Promise<{ restored: AssetId[]; skipped: { scene: AssetId; reason: string }[] }> {
  const channel = input.channel as LiveChannel;
  const at = input.at ?? new Date();
  const restored: AssetId[] = [];
  const skipped: { scene: AssetId; reason: string }[] = [];
  for (const scene of Object.keys(input.scenes).sort()) {
    const versionId = input.scenes[scene]!;
    const verdict = await checkPointerTarget(tx, {
      projectId: input.projectId,
      channel,
      scene,
      versionId,
      release: input.release,
    });
    if (!verdict.ok) {
      skipped.push({ scene, reason: `${verdict.label} wasn't restored: ${verdict.reason}` });
      continue;
    }
    const set = {
      versionId,
      timing: DEFAULT_SWAP_TIMING,
      extraBytes: verdict.extraBytes,
      updatedById: input.actor?.userId ?? null,
      updatedAt: at,
    };
    await tx
      .insert(engineSceneChannels)
      .values({ projectId: input.projectId, channel, sceneId: scene, ...set })
      .onConflictDoUpdate({
        target: [
          engineSceneChannels.projectId,
          engineSceneChannels.channel,
          engineSceneChannels.sceneId,
        ],
        set,
      });
    restored.push(scene);
  }
  return { restored, skipped };
}
