/**
 * App-side cleanup for better-auth's `deleteUser` flow.
 *
 * better-auth deletes the `user` row itself, which cascades the auth tables
 * (sessions, accounts), notifications, and collab content. What it cannot
 * reach is `developer_profiles` — that table has no FK to `user` — so we
 * remove it here, which in turn cascades skills, skill requests, URL stubs,
 * profile projects, and linked accounts (including stored itch.io tokens).
 *
 * Moderation records (hammer schema) are keyed by Discord snowflake with no
 * FK onto `developer_profiles`, so self-serve deletion never touches them:
 * infraction and ban history stays with the guild while the profile row
 * disappears entirely.
 *
 * **What survives, and why.** Canonical projects are shared entities: other
 * contributors' pages, teams' showcases, and jam backlinks point at them.
 * So deletion reaches the user's *placements* (their own surface rows) and
 * stops there:
 *
 * - `project.projects` — untouched. `profile_projects.project_id` is
 *   `ON DELETE SET NULL` in the other direction, so removing a placement
 *   never reaches the project. An orphaned project is a periodic sweep's
 *   problem, not this flow's.
 * - `project.project_contributors` — the *credit* survives with its
 *   `display_name`; only the live link dies, via `profile_id ON DELETE SET
 *   NULL`. Nothing below deletes these rows, and nothing should: a shipped
 *   credit is history, and the person's name on it is what makes the
 *   project page true.
 * - MinIO objects — the loop below deletes the user's own uploads, which is
 *   safe precisely because a canonical row never references a user-scoped
 *   key (it carries a provider CDN URL, or its own project-scoped upload).
 *   Game saves are the user's alone: their objects go here, their
 *   `engine_saves` rows with the user row's cascade.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  canvasDocVersions,
  canvases,
  canvasMembers,
  comments,
  developerProfiles,
  engineSaves,
  profileProjects,
} from "@/db/schema";
import { env } from "@/env";
import { emitCanvasEvent } from "@/lib/canvas-events";
import { publishCanvasRevoke } from "@/lib/canvas-sync-publish";
import { purgeGuildMemberCache } from "@/lib/discord";
import { engineSaveKey, engineSavesPrefixOf } from "@/lib/engine/storage-keys";
import {
  getMinioClient,
  isMissingObject,
  removeProfileProjectImageFromStorage,
} from "@/lib/profile-project-image-storage";

/** The bucket calls removing a player's saves needs. A missing object is not an error. */
export type SaveObjectStore = {
  list(prefix: string): Promise<string[]>;
  remove(key: string): Promise<void>;
};

/** The site's bucket, or null when none is configured (then there are no save objects). */
function minioSaveObjectStore(): SaveObjectStore | null {
  const bucket = env.MINIO_BUCKET;
  if (!bucket) return null;
  return {
    async list(prefix) {
      const keys: string[] = [];
      for await (const item of getMinioClient().listObjectsV2(bucket, prefix, true)) {
        if (item.name) keys.push(item.name);
      }
      return keys;
    },
    async remove(key) {
      try {
        await getMinioClient().removeObject(bucket, key);
      } catch (error) {
        if (!isMissingObject(error)) throw error;
      }
    },
  };
}

/** `saveObjects` defaults to the site's bucket; `null` means there are no save objects. */
export async function cleanupUserData(
  userId: string,
  opts: { saveObjects?: SaveObjectStore | null } = {},
): Promise<void> {
  await removeSaveObjects(
    userId,
    opts.saveObjects === undefined ? minioSaveObjectStore() : opts.saveObjects,
  );

  const [profile] = await db
    .select({ discordId: developerProfiles.discordId })
    .from(developerProfiles)
    .where(eq(developerProfiles.id, userId))
    .limit(1);
  if (!profile) return;

  // Uploaded project images live in MinIO, outside any DB cascade. Collect
  // keys before the rows disappear; removal failures are logged, not fatal —
  // an orphaned object must not block the account deletion itself.
  const projectImages = await db
    .select({ imageKey: profileProjects.imageKey })
    .from(profileProjects)
    .where(eq(profileProjects.profileId, userId));
  for (const { imageKey } of projectImages) {
    if (imageKey) await removeProfileProjectImageFromStorage(imageKey).catch(console.error);
  }

  // Redact the user's comments while `author_id` still points at them —
  // better-auth's user-row delete fires the set-null FK right after this
  // hook, and the rows become unfindable by author. Tombstoned chains
  // survive (replies keep rendering under "Deleted User"); COALESCE keeps
  // the original timestamp/attribution on comments already deleted.
  await db
    .update(comments)
    .set({ content: "", deletedAt: sql`COALESCE(${comments.deletedAt}, now())` })
    .where(eq(comments.authorId, userId));

  // Personal canvases go with their owner (docs and memberships cascade);
  // team canvases stay with the team, their `owner_id` nulled by the FK.
  // Versions are keyed polymorphically, so they're removed by hand.
  const personalCanvases = await db
    .select({ id: canvases.id, deletedAt: canvases.deletedAt })
    .from(canvases)
    .where(and(eq(canvases.ownerId, userId), isNull(canvases.teamId)));
  if (personalCanvases.length > 0) {
    await db.delete(canvasDocVersions).where(
      and(
        eq(canvasDocVersions.docKind, "canvas"),
        inArray(
          canvasDocVersions.docId,
          personalCanvases.map((c) => c.id),
        ),
      ),
    );
  }
  await db.delete(canvases).where(and(eq(canvases.ownerId, userId), isNull(canvases.teamId)));
  const left = await leaveSharedCanvases(userId);
  // One already in Recently deleted was announced when it was deleted.
  for (const { id } of personalCanvases.filter((c) => !c.deletedAt)) {
    await emitCanvasEvent({
      type: "deleted",
      canvasId: id,
      scope: { kind: "personal", ownerId: userId },
    });
  }
  for (const canvas of left) {
    await emitCanvasEvent({
      type: "member_removed",
      canvasId: canvas.id,
      scope: { kind: "personal", ownerId: canvas.ownerId },
      userId,
    });
  }
  void publishCanvasRevoke({ userId });

  await db.delete(developerProfiles).where(eq(developerProfiles.id, userId));

  if (profile.discordId) await purgeGuildMemberCache(profile.discordId);
}

/**
 * Deletes the player's save objects while their `engine_saves` rows still
 * name them; the rows go with the user row's cascade. The prefix sweep
 * catches objects no row names (a write whose row never landed). Like the
 * project images, a failure is logged and the account deletion goes on.
 */
async function removeSaveObjects(userId: string, store: SaveObjectStore | null): Promise<void> {
  if (!store) return;
  const keys = new Set<string>();
  try {
    const rows = await db
      .select({ projectId: engineSaves.projectId, slot: engineSaves.slot })
      .from(engineSaves)
      .where(eq(engineSaves.userId, userId));
    for (const { projectId, slot } of rows) keys.add(engineSaveKey(userId, projectId, slot));
  } catch (error) {
    console.error(error);
  }
  for (const key of keys) await store.remove(key).catch(console.error);
  try {
    for (const key of await store.list(engineSavesPrefixOf(userId))) {
      if (!keys.has(key)) await store.remove(key).catch(console.error);
    }
  } catch (error) {
    console.error(error);
  }
}

/**
 * Removes the user from canvases others shared with them, returning those
 * canvases. The user row's cascade would do the delete a moment later, but
 * only after the access change could be announced.
 */
async function leaveSharedCanvases(
  userId: string,
): Promise<{ id: string; ownerId: string | null }[]> {
  const memberships = await db
    .select({ canvasId: canvasMembers.canvasId })
    .from(canvasMembers)
    .where(eq(canvasMembers.userId, userId));
  if (memberships.length === 0) return [];
  const shared = await db
    .select({ id: canvases.id, ownerId: canvases.ownerId })
    .from(canvases)
    .where(
      inArray(
        canvases.id,
        memberships.map((m) => m.canvasId),
      ),
    );
  await db.delete(canvasMembers).where(eq(canvasMembers.userId, userId));
  return shared;
}
