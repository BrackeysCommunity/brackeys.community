import { and, eq, ne, sql } from "drizzle-orm";

import {
  collabPosts,
  type EntryFlagKind,
  imageFlags,
  type ImageOwnerType,
  imageScans,
  projects,
  teams,
} from "../../../../src/db/schema.ts";
import { quarantineImage, quarantineKey } from "../../../../src/lib/image-quarantine.ts";
import { config } from "../config.ts";
import { db } from "../db/client.ts";
import { notify } from "../notify.ts";
import { objectStore, readObject, storage } from "../storage.ts";
import { hashCover } from "./cover.ts";
import { encodeEmbedding } from "./embedding.ts";
import { DETECTOR_VERSION, type ScanContext } from "./entry.ts";
import { NSFW_MODEL, nsfwScore } from "./nsfw.ts";
import { PROBE_VERSION } from "./probe.ts";

/**
 * One member upload (plan 27 phase 3): the object is read straight from the
 * bucket, hashed and scored like a cover, and the verdict lands in
 * `social.image_flags`. No tag signal (uploads have no data.json) and no
 * theft matching in v1.
 *
 * This is the one place a detector acts on its own. An itch cover is
 * someone else's content on someone else's site; an uploaded banner is
 * content *we* host and serve. Above UPLOAD_QUARANTINE_THRESHOLD the image
 * is hidden pending review (image-quarantine.ts) and the uploader is told;
 * between the two thresholds it is flagged and stays live, like an entry.
 * A cleared image — one a human already restored — is never re-quarantined.
 */
export type UploadScanOutcome =
  | { result: "scanned"; score: number | null; flagged: boolean; quarantined: boolean }
  | { result: "gone" | "skipped" };

export async function scanUploadByKey(
  objectKey: string,
  ctx: ScanContext,
): Promise<UploadScanOutcome> {
  const [scan] = await db
    .select({
      status: imageScans.status,
      ownerType: imageScans.ownerType,
      ownerId: imageScans.ownerId,
      uploaderId: imageScans.uploaderId,
    })
    .from(imageScans)
    .where(eq(imageScans.objectKey, objectKey))
    .limit(1);
  if (!scan || scan.status === "purged") return { result: "skipped" };
  if (!storage) {
    console.warn(`[upload] MINIO_* not configured — skipping ${objectKey}`);
    return { result: "skipped" };
  }

  // A quarantined object lives under the prefix; a rescan still reads it.
  const bytes =
    (await readObject(scan.status === "quarantined" ? quarantineKey(objectKey) : objectKey)) ??
    (await readObject(objectKey));
  if (!bytes) {
    // Nothing to judge and nothing to retry: record the visit so the row
    // stops being due, keep whatever status it had.
    await db
      .update(imageScans)
      .set({ detectorVersion: DETECTOR_VERSION, scannedAt: sql`now()` })
      .where(eq(imageScans.objectKey, objectKey));
    return { result: "gone" };
  }

  const phash = await hashCover(bytes);
  const nsfw = ctx.nsfwEnabled ? await nsfwScore(bytes) : null;
  await db
    .update(imageScans)
    .set({
      phash,
      nsfwScore: nsfw?.score ?? null,
      embedding: nsfw?.embedding ? encodeEmbedding(nsfw.embedding) : null,
      embeddingModel: nsfw?.embedding ? NSFW_MODEL : null,
      detectorVersion: DETECTOR_VERSION,
      scannedAt: sql`now()`,
      ...(scan.status === "pending" ? { status: "scanned" as const } : {}),
    })
    .where(eq(imageScans.objectKey, objectKey));

  const score = nsfw?.score ?? null;
  const overFlag = score != null && score >= config.NSFW_THRESHOLD;
  const overQuarantine = score != null && score >= config.UPLOAD_QUARANTINE_THRESHOLD;
  let quarantined = scan.status === "quarantined";

  if (overQuarantine && !quarantined && scan.status !== "cleared") {
    const refs = await quarantineImage(db, objectStore, objectKey);
    quarantined = refs != null;
  }

  if (overFlag) {
    const written = await upsertOpenFlag({
      objectKey,
      ownerType: scan.ownerType,
      ownerId: scan.ownerId,
      uploaderId: scan.uploaderId,
      kind: "nsfw",
      score: score!,
      evidence: {
        detectorVersion: DETECTOR_VERSION,
        model: NSFW_MODEL,
        scorer: PROBE_VERSION,
        nsfwScore: score,
        quarantined,
        quarantineThreshold: config.UPLOAD_QUARANTINE_THRESHOLD,
      },
    });
    if (written === "opened" && quarantined && scan.uploaderId) {
      await notifyUploader(scan.uploaderId, objectKey, scan.ownerType, scan.ownerId);
    }
    return { result: "scanned", score, flagged: written !== "ruled", quarantined };
  }

  // Below threshold with a real verdict: an open auto flag from an older
  // scan is stale. A quarantined image stays quarantined — the human who
  // gets to restore it should see the newer score, not find it silently
  // back on the page.
  if (nsfw != null && !quarantined) {
    await db
      .delete(imageFlags)
      .where(
        and(
          eq(imageFlags.objectKey, objectKey),
          eq(imageFlags.status, "open"),
          eq(imageFlags.source, "auto"),
          eq(imageFlags.kind, "nsfw"),
        ),
      );
  }
  return { result: "scanned", score, flagged: false, quarantined };
}

/**
 * Same contract as the entry flag upsert: a resolved flag of this kind on
 * this key makes the detector stand down; an open one is refreshed rather
 * than duplicated. Distinguishes a fresh open from a refresh so the
 * uploader is notified once, not on every rescan.
 */
async function upsertOpenFlag(flag: {
  objectKey: string;
  ownerType: ImageOwnerType;
  ownerId: string;
  uploaderId: string | null;
  kind: EntryFlagKind;
  score: number;
  evidence: Record<string, unknown>;
}): Promise<"opened" | "refreshed" | "ruled"> {
  const [ruled] = await db
    .select({ id: imageFlags.id })
    .from(imageFlags)
    .where(
      and(
        eq(imageFlags.objectKey, flag.objectKey),
        eq(imageFlags.kind, flag.kind),
        ne(imageFlags.status, "open"),
      ),
    )
    .limit(1);
  if (ruled) return "ruled";

  const inserted = await db
    .insert(imageFlags)
    .values({
      objectKey: flag.objectKey,
      ownerType: flag.ownerType,
      ownerId: flag.ownerId,
      uploaderId: flag.uploaderId,
      kind: flag.kind,
      source: "auto",
      score: flag.score,
      evidence: flag.evidence,
    })
    .onConflictDoUpdate({
      target: [imageFlags.objectKey, imageFlags.kind],
      targetWhere: sql`status = 'open'`,
      set: { score: flag.score, evidence: flag.evidence },
    })
    .returning({ inserted: sql<boolean>`(xmax = 0)` });
  return inserted[0]?.inserted ? "opened" : "refreshed";
}

/** The page the image was on, for the uploader's notice. */
async function describeOwner(
  ownerType: ImageOwnerType,
  ownerId: string,
): Promise<{ label: string; url: string | null }> {
  switch (ownerType) {
    case "team_avatar":
    case "team_banner":
    case "team_project_image": {
      const [team] = await db
        .select({ name: teams.name, slug: teams.slug })
        .from(teams)
        .where(eq(teams.id, ownerId))
        .limit(1);
      return team
        ? { label: team.name, url: `/teams/${team.slug}` }
        : { label: "a team", url: null };
    }
    case "collab_post_image": {
      const [post] = await db
        .select({ title: collabPosts.title })
        .from(collabPosts)
        .where(eq(collabPosts.id, Number(ownerId)))
        .limit(1);
      return post
        ? { label: `"${post.title}"`, url: `/collab/${ownerId}` }
        : { label: "a collab post", url: null };
    }
    case "project_cover": {
      const [project] = await db
        .select({ title: projects.title, slug: projects.slug })
        .from(projects)
        .where(eq(projects.id, ownerId))
        .limit(1);
      return project
        ? { label: project.title, url: `/projects/${project.slug}` }
        : { label: "a project", url: null };
    }
    case "profile_project_image":
      return { label: "your profile", url: "/profile" };
  }
}

async function notifyUploader(
  uploaderId: string,
  objectKey: string,
  ownerType: ImageOwnerType,
  ownerId: string,
): Promise<void> {
  const owner = await describeOwner(ownerType, ownerId);
  await notify({
    userId: uploaderId,
    type: "image_quarantined",
    entityType: "stored_image",
    entityId: objectKey,
    data: { objectKey, ownerType, ownerId, ownerLabel: owner.label, ownerUrl: owner.url },
  });
}
