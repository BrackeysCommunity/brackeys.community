import { sceneVersionName, type SwapTiming } from "@jams/engine/game";
import {
  checkSceneVersion,
  formatSceneVersion,
  liveCompatKey,
  parseReleaseManifest,
  parseSceneVersion,
  prefabKind,
  sceneKind,
  sceneVersionDataBytes,
  sceneVersionId,
  utf8Bytes,
  type AssetId,
  type ReleaseAsset,
  type ReleaseManifest,
  type SceneVersion,
  type Sha256,
} from "@jams/engine/project";
import type { SceneIssue } from "@jams/engine/scene";
import { and, desc, eq, isNull, max } from "drizzle-orm";

import {
  engineReleaseObjects,
  engineReleases,
  engineReleaseUploads,
  engineSceneVersionFiles,
  engineSceneVersions,
} from "@/db/schema";
import { formatCount } from "@/lib/format-bytes";

import { parseLivePath } from "./frame-route";
import { LIVE_LIMITS, UPLOAD_SESSION_HOURS } from "./limits";
import {
  announceLiveMove,
  channelRelease,
  DEFAULT_SWAP_TIMING,
  lockProject,
  pointScene,
  sceneVersionRemoved,
} from "./live-pointers";
import { checkLiveQuota, usageLines } from "./quota";
import { writeAudit, type Actor, type ReleaseDb } from "./release-audit";
import {
  issueError,
  releaseFilesMissing,
  releaseFileType,
  releaseNotCanonical,
  releaseProjectMismatch,
  releaseRateLimited,
  releaseUploadExpired,
  type ReleaseApiError,
} from "./release-errors";
import {
  actorColumns,
  assertMayUpload,
  heldHashes,
  HOUR_MS,
  liveProject,
  openUpload,
  quotaRefusal,
  readStored,
  refuse,
  resolveDeps,
  servedFrom,
  type Held,
  type ReleaseDeps,
} from "./release-upload";
import { engineReleaseObjectKey } from "./storage-keys";
import { storedUsage, type StoredUsage, type UsageReport } from "./usage";

/** A text of the version the site doesn't hold yet: only JSON texts, since blobs are never missing. */
export type MissingSceneText = { sha256: Sha256; bytes: number };

export type BeginSceneResult = {
  uploadId: string;
  versionId: Sha256;
  /** The existing number when this version is already stored. */
  number: number | null;
  missing: MissingSceneText[];
  /** `checkSceneVersion` against the channel's release, warnings included. */
  issues: SceneIssue[];
  /** Release storage before and after, and today's count. */
  usage: UsageReport;
};

export type CommitSceneResult = {
  versionId: Sha256;
  scene: AssetId;
  number: number;
  created: boolean;
  /** The channel the commit pointed at the version: preview, or none when the upload said so. */
  liveOn: "preview" | null;
};

export type BeginSceneInput = {
  projectId: string;
  /** The canonical `scene-version.json`. */
  version: string;
  channel: "preview" | "none";
  /** The preview move's timing; default `next-load`. */
  timing?: SwapTiming;
  note?: string;
  actor: Actor;
};

const JSON_TYPE = "application/json";

// ─── The refusals a scene version has of its own ────────

function blobNotStored(asset: ReleaseAsset): ReleaseApiError {
  const name = asset.path.slice(asset.path.lastIndexOf("/") + 1);
  return {
    code: "asset-missing",
    message: `Upload ${name} to the project first: the editor does this when you add the file.`,
    hint: "A scene version sends only its texts (the scene, its prefabs and the docs they use); its images, sounds and fonts are the project's own uploads.",
  };
}

function noRelease(channel: "preview" | "none"): ReleaseApiError {
  return channel === "preview"
    ? {
        code: "not-found",
        message: "This game has no release on preview for a live scene to update.",
        hint: "Publish a release first: a live scene replaces one scene of the release a channel plays.",
      }
    : {
        code: "not-found",
        message: "This game has no release for a live scene to update.",
        hint: "Publish a release first: a live scene replaces one scene of a release.",
      };
}

function noteTooLong(chars: number): ReleaseApiError {
  return {
    code: "schema",
    message: `This note is ${formatCount(chars)} characters; a scene version's note is at most ${formatCount(LIVE_LIMITS.noteChars)}.`,
    hint: "Shorten the note.",
  };
}

// ─── Reading what a version is checked against ──────────

type TargetRelease = { id: string; version: number; manifest: ReleaseManifest };

/**
 * The release a scene version is checked against: the one preview plays,
 * or with `none` the one production plays, else the newest kept one.
 */
async function targetRelease(
  db: ReleaseDb,
  projectId: string,
  channel: "preview" | "none",
): Promise<TargetRelease> {
  const onChannel = await channelRelease(
    db,
    projectId,
    channel === "preview" ? "preview" : "production",
  );
  if (onChannel) return onChannel;
  if (channel === "none") {
    const [row] = await db
      .select({
        id: engineReleases.id,
        version: engineReleases.version,
        manifest: engineReleases.manifest,
      })
      .from(engineReleases)
      .where(and(eq(engineReleases.projectId, projectId), isNull(engineReleases.collectedAt)))
      .orderBy(desc(engineReleases.version))
      .limit(1);
    const parsed = row?.manifest ? parseReleaseManifest(row.manifest) : null;
    if (row && parsed?.ok) return { id: row.id, version: row.version, manifest: parsed.manifest };
  }
  return refuse(noRelease(channel), 404);
}

async function storedVersion(db: ReleaseDb, projectId: string, id: string) {
  const [row] = await db
    .select({
      sceneId: engineSceneVersions.sceneId,
      number: engineSceneVersions.number,
      collectedAt: engineSceneVersions.collectedAt,
      hiddenAt: engineSceneVersions.hiddenAt,
      hiddenReason: engineSceneVersions.hiddenReason,
      blockedAt: engineSceneVersions.blockedAt,
      blockReason: engineSceneVersions.blockReason,
    })
    .from(engineSceneVersions)
    .where(and(eq(engineSceneVersions.id, id), eq(engineSceneVersions.projectId, projectId)));
  return row ?? null;
}

/** The number the scene's next version takes. */
async function nextNumber(db: ReleaseDb, projectId: string, scene: AssetId): Promise<number> {
  const [top] = await db
    .select({ number: max(engineSceneVersions.number) })
    .from(engineSceneVersions)
    .where(
      and(eq(engineSceneVersions.projectId, projectId), eq(engineSceneVersions.sceneId, scene)),
    );
  return (top?.number ?? 0) + 1;
}

const parsedVersion = (text: string): SceneVersion => {
  const parsed = parseSceneVersion(text);
  if (!parsed.ok) {
    const [issue] = parsed.issues;
    return refuse(
      issue
        ? issueError(issue)
        : { code: "schema", message: "This scene-version.json isn't a scene version." },
    );
  }
  return parsed.version;
};

/** The first error among `issues` refuses, with its code. */
function refuseErrors(issues: readonly SceneIssue[]): void {
  const error = issues.find((i) => i.severity === "error");
  if (error) refuse(issueError(error));
}

// ─── What a version lists ───────────────────────────────

type VersionFile = {
  sha256: Sha256;
  bytes: number;
  role: "version" | "scene" | "prefab" | "doc" | "blob";
  ext: string;
  storage: "doc" | "blob";
};

const roleOf = (asset: ReleaseAsset): VersionFile["role"] =>
  asset.storage === "blob"
    ? "blob"
    : asset.kind === prefabKind.kind
      ? "prefab"
      : asset.kind === sceneKind.kind
        ? "scene"
        : "doc";

/** The extension a version's blob is served under: its own, as its `live/` file names it. */
const extOf = (asset: ReleaseAsset) => parseLivePath(asset.file)?.ext ?? "";

/**
 * Every file a version lists, once per hash: the version file itself, then
 * its assets (scenes, prefabs, other docs such as materials and tables, and
 * blobs).
 */
function versionFiles(version: SceneVersion, id: Sha256, text: string): VersionFile[] {
  const out: VersionFile[] = [
    { sha256: id, bytes: utf8Bytes(text), role: "version", ext: ".json", storage: "doc" },
  ];
  const seen = new Set<string>([id]);
  for (const assetId of Object.keys(version.assets).sort()) {
    const asset = version.assets[assetId]!;
    if (seen.has(asset.sha256)) continue;
    seen.add(asset.sha256);
    out.push({
      sha256: asset.sha256,
      bytes: asset.bytes,
      role: roleOf(asset),
      ext: asset.storage === "blob" ? extOf(asset) : ".json",
      storage: asset.storage,
    });
  }
  return out;
}

const docAssets = (version: SceneVersion) =>
  Object.values(version.assets).filter((a) => a.storage === "doc");

/** Usage before this version and with it stored: what it adds to release storage, and one more today. */
function liveUsageReport(stored: StoredUsage, addsBytes: number, adds: boolean): UsageReport {
  return {
    before: usageLines(stored),
    after: usageLines({
      ...stored,
      releaseStorageBytes: stored.releaseStorageBytes + addsBytes,
      liveToday: stored.liveToday + (adds ? 1 : 0),
    }),
  };
}

// ─── begin ───────────────────────────────────────────────

/** Whose hourly begins a publish counts against: an agent token's own, else its person's. */
const beginBucket = (actor: Actor): string =>
  actor.kind === "agent" && actor.agentTokenId ? `token:${actor.agentTokenId}` : actor.userId;

/**
 * Checks a scene version against its channel's release and every quota,
 * stores the upload and lists the texts the site doesn't hold yet. The
 * texts then go up through `putReleaseFile`, as a release's files do. In
 * order: the caller may publish, the hourly begin limit (per person, or per
 * agent token) and the note; the version's size, parse, canonical text and
 * id; its project and game; whether the project already holds it (a
 * removed one is refused) and, for a new one, the day's versions; the
 * compatibility rules against the target release (all but the carried
 * references, which need the texts); every blob stored for the project;
 * then the data cap and release storage. A version already stored answers
 * its number and adds nothing to the day. The caller has checked the
 * production guard, `engine-games-enabled` and staff.
 */
export async function beginSceneVersion(
  deps: ReleaseDeps,
  input: BeginSceneInput,
): Promise<BeginSceneResult> {
  const { db, now, rateLimit } = resolveDeps(deps);
  const { projectId, actor } = input;
  const at = now();

  // 1. Who, how often, the note.
  const project = await liveProject(db, projectId);
  await assertMayUpload(deps, db, actor, project, "live-publish");
  if (!(await rateLimit("engine-live-begin", beginBucket(actor), LIVE_LIMITS.beginsPerHour, 3600)))
    refuse(releaseRateLimited("scene-begins"));
  if (input.note !== undefined && [...input.note].length > LIVE_LIMITS.noteChars)
    refuse(noteTooLong([...input.note].length));

  // 2. The version file: size, parse, canonical text, id.
  const stored = await storedUsage(db, projectId, at);
  const versionBytes = utf8Bytes(input.version);
  const fits = checkLiveQuota(stored, { dataBytes: versionBytes, addsBytes: 0, today: null });
  if (!fits.ok) quotaRefusal(fits);
  const version = parsedVersion(input.version);
  if (formatSceneVersion(version) !== input.version) refuse(releaseNotCanonical("scene-version"));
  const versionId = await sceneVersionId(version);

  // 3. Its project and game.
  if (version.project !== projectId)
    refuse(releaseProjectMismatch("project", projectId, version.project, "scene-version"));
  if (project.game !== null && version.compat.game.id !== project.game)
    refuse(releaseProjectMismatch("game", projectId, version.compat.game.id, "scene-version"));

  // 4. What the project already holds; a new version must fit the day's count.
  const existing = await storedVersion(db, projectId, versionId);
  if (existing?.collectedAt)
    refuse(
      sceneVersionRemoved(sceneVersionName(version.scene, existing.number), existing.collectedAt),
    );
  const today = existing ? null : stored.liveToday;
  const day = checkLiveQuota(stored, { dataBytes: 0, addsBytes: 0, today });
  if (!day.ok) quotaRefusal(day);

  // 5. The target release's rules, but the carried references.
  const release = await targetRelease(db, projectId, input.channel);
  const number = existing?.number ?? (await nextNumber(db, projectId, version.scene));
  const issues = checkSceneVersion(release.manifest, version, undefined, {
    names: { version: sceneVersionName(version.scene, number), release: `v${release.version}` },
  });
  refuseErrors(issues);

  // 6. Every blob stored for the project, under a name the site serves.
  const files = versionFiles(version, versionId, input.version);
  const held = await heldHashes(
    db,
    projectId,
    files.map((f) => f.sha256),
  );
  for (const asset of Object.values(version.assets)) {
    if (asset.storage !== "blob") continue;
    if (!servedFrom(held, asset.sha256)) refuse(blobNotStored(asset));
    if (parseLivePath(asset.file) === null) refuse(releaseFileType(asset.path));
  }

  // 7. The data cap and release storage.
  const missing = docAssets(version)
    .filter((a, i, all) => all.findIndex((b) => b.sha256 === a.sha256) === i)
    .filter((a) => !held.objects.has(a.sha256))
    .map((a) => ({ path: a.file, sha256: a.sha256, bytes: a.bytes }));
  const addsBytes =
    missing.reduce((n, f) => n + f.bytes, 0) + (held.objects.has(versionId) ? 0 : versionBytes);
  const quota = checkLiveQuota(stored, {
    dataBytes: sceneVersionDataBytes(input.version, version),
    addsBytes,
    today,
  });
  if (!quota.ok) quotaRefusal(quota);

  // 8. The upload.
  const [upload] = await db
    .insert(engineReleaseUploads)
    .values({
      projectId,
      manifest: input.version,
      releaseId: versionId,
      missing: existing ? [] : missing,
      channel: input.channel,
      ...actorColumns(actor),
      createdAt: at,
      expiresAt: new Date(at.getTime() + UPLOAD_SESSION_HOURS * HOUR_MS),
      kind: "scene",
      sceneId: version.scene,
      timing: input.timing ?? DEFAULT_SWAP_TIMING,
      ...(input.note !== undefined ? { note: input.note } : {}),
    })
    .returning({ id: engineReleaseUploads.id });
  if (!upload) throw new Error("the upload row wasn't written");

  return {
    uploadId: upload.id,
    versionId,
    number: existing?.number ?? null,
    missing: (existing ? [] : missing).map(({ sha256, bytes }) => ({ sha256, bytes })),
    issues,
    usage: existing ? liveUsageReport(stored, 0, false) : liveUsageReport(stored, addsBytes, true),
  };
}

// ─── commit ──────────────────────────────────────────────

/** The carried doc texts by hash, read back from the store; a text it doesn't hold is left out. */
async function carriedTexts(
  deps: ReleaseDeps,
  version: SceneVersion,
  held: Held,
): Promise<Map<Sha256, string>> {
  const texts = new Map<Sha256, string>();
  const decoder = new TextDecoder();
  for (const asset of docAssets(version)) {
    if (texts.has(asset.sha256)) continue;
    const object = held.objects.get(asset.sha256);
    const body = object ? await readStored(deps.store, object.storageKey, null) : null;
    if (body) texts.set(asset.sha256, decoder.decode(body));
  }
  return texts;
}

/**
 * Records the version once its texts have arrived, numbered per scene, and
 * moves preview to it unless the upload said not to. Before the lock: the
 * upload is open, every missing text arrived, and the version passes every
 * compatibility rule with its texts against the target release; the
 * version file is stored as an object. Under the project row's lock (the
 * collector's): every file still stored, the version and its file rows,
 * the `scene-create` audit, preview's pointer, and the upload marked
 * committed; then the move is announced. The same version committed again
 * answers its number with `created: false`.
 */
export async function commitSceneVersion(
  deps: ReleaseDeps,
  input: { uploadId: string; actor: Actor },
): Promise<CommitSceneResult> {
  const { db, now } = resolveDeps(deps);
  const { actor } = input;
  const upload = await openUpload(deps, db, input.uploadId, actor, "scene");
  const { projectId } = upload;
  const versionId = upload.releaseId;
  const channel = upload.channel === "preview" ? "preview" : "none";
  const version = parsedVersion(upload.manifest);
  const answer = (number: number, created: boolean): CommitSceneResult => ({
    versionId,
    scene: version.scene,
    number,
    created,
    liveOn: channel === "preview" ? "preview" : null,
  });

  if (upload.committedAt) {
    const existing = await storedVersion(db, projectId, versionId);
    if (existing) return answer(existing.number, false);
  }
  const at = now();
  if (upload.expiresAt.getTime() <= at.getTime()) refuse(releaseUploadExpired());

  const files = versionFiles(version, versionId, upload.manifest);
  const held = await heldHashes(
    db,
    projectId,
    files.map((f) => f.sha256),
  );
  const absent = upload.missing.filter((f) => !held.objects.has(f.sha256)).length;
  if (absent > 0) refuse(releaseFilesMissing(absent));

  const release = await targetRelease(db, projectId, channel);
  const before = await storedVersion(db, projectId, versionId);
  if (before?.collectedAt)
    refuse(sceneVersionRemoved(sceneVersionName(version.scene, before.number), before.collectedAt));
  const texts = await carriedTexts(deps, version, held);
  refuseErrors(
    checkSceneVersion(release.manifest, version, texts, {
      names: {
        version: sceneVersionName(
          version.scene,
          before?.number ?? (await nextNumber(db, projectId, version.scene)),
        ),
        release: `v${release.version}`,
      },
    }),
  );

  if (!held.objects.has(versionId)) {
    const storageKey = engineReleaseObjectKey(projectId, versionId);
    const body = new TextEncoder().encode(upload.manifest);
    await deps.store.put(storageKey, body, JSON_TYPE);
    await db
      .insert(engineReleaseObjects)
      .values({
        projectId,
        sha256: versionId,
        bytes: body.byteLength,
        contentType: JSON_TYPE,
        storageKey,
      })
      .onConflictDoNothing();
  }
  const compatKey = await liveCompatKey(version.compat);
  const dataBytes = sceneVersionDataBytes(upload.manifest, version);
  const sceneDoc = version.assets[version.scene];
  if (!sceneDoc) return refuse(releaseFilesMissing(1));

  const result = await db.transaction(async (tx) => {
    await lockProject(tx, projectId);

    // The collector may have removed an object since it was counted, under this same lock.
    const stillHeld = await heldHashes(
      tx,
      projectId,
      files.map((f) => f.sha256),
    );
    const gone = files.filter((f) =>
      f.storage === "doc" ? !stillHeld.objects.has(f.sha256) : !servedFrom(stillHeld, f.sha256),
    ).length;
    if (gone > 0) refuse(releaseFilesMissing(gone));

    const existing = await storedVersion(tx, projectId, versionId);
    if (existing?.collectedAt)
      refuse(
        sceneVersionRemoved(sceneVersionName(version.scene, existing.number), existing.collectedAt),
      );
    let number = existing?.number ?? 0;
    if (!existing) {
      // Concurrent publishes each passed begin's quotas; the lock lets only those that still fit through.
      const stored = await storedUsage(tx, projectId, at);
      const quota = checkLiveQuota(stored, { dataBytes, addsBytes: 0, today: stored.liveToday });
      if (!quota.ok) quotaRefusal(quota);
      number = await nextNumber(tx, projectId, version.scene);
      await tx.insert(engineSceneVersions).values({
        id: versionId,
        projectId,
        sceneId: version.scene,
        number,
        descriptor: upload.manifest,
        compatKey,
        baseReleaseId: version.base,
        physics: version.entry.physics,
        sceneHash: sceneDoc.sha256,
        dataBytes,
        note: upload.note,
        createdById: actor.userId,
        agentTokenId: actor.kind === "agent" ? (actor.agentTokenId ?? null) : null,
        createdAt: at,
      });
      await tx.insert(engineSceneVersionFiles).values(
        files.map((f) => ({
          versionId,
          projectId,
          sha256: f.sha256,
          bytes: f.bytes,
          role: f.role,
          ext: f.ext,
          source:
            f.storage === "doc" ? ("release" as const) : servedFrom(stillHeld, f.sha256)!.source,
        })),
      );
      await writeAudit(tx, {
        projectId,
        actor,
        action: "scene-create",
        sceneId: version.scene,
        sceneVersionId: versionId,
        detail: { number },
        at,
      });
    }
    const rev =
      channel === "preview"
        ? (
            await pointScene(tx, {
              projectId,
              scene: version.scene,
              channel: "preview",
              to: { number },
              timing: (upload.timing as SwapTiming | null) ?? DEFAULT_SWAP_TIMING,
              action: "scene-promote",
              actor,
              at,
            })
          ).rev
        : null;
    await tx
      .update(engineReleaseUploads)
      .set({ committedAt: at })
      .where(eq(engineReleaseUploads.id, upload.id));
    return { number, created: !existing, rev };
  });

  if (result.rev !== null) await announceLiveMove(projectId, "preview", result.rev);
  return answer(result.number, result.created);
}
