import { ORPCError } from "@orpc/client";
import { os } from "@orpc/server";
import { eq } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import { sceneDocs } from "@/db/schema";
import { publishSceneRevoke } from "@/lib/canvas-sync-publish";
import { documentName } from "@/lib/canvas/sync-channels";
import { signCanvasToken } from "@/lib/canvas/token";
import { isSceneId } from "@/lib/scene/ids";
import { SCENE_LIMITS } from "@/lib/scene/limits";
import { requireStaff } from "@/orpc/middleware/auth";

/**
 * Hosted scenes, co-edited live through `canvas-sync` as `scene:<id>`. Only
 * staff build games for now, so every procedure here is behind the staff
 * gate; agents (the scene CLI's `--live`, an MCP client) stay on the dev
 * server and get no hosted tokens.
 */

const sceneIdSchema = z
  .string()
  .max(97)
  .refine(isSceneId, "A scene id is <game>.<name>: lowercase letters, digits and dashes.");

const NOT_FOUND = () => new ORPCError("NOT_FOUND", { message: "No such scene." });

async function sceneExists(sceneId: string): Promise<boolean> {
  const [row] = await db
    .select({ sceneId: sceneDocs.sceneId })
    .from(sceneDocs)
    .where(eq(sceneDocs.sceneId, sceneId));
  return row !== undefined;
}

/**
 * A short-lived token for one hosted scene. `formatVersion` is the scene
 * format the caller's engine reads (`SCENE_FORMAT_VERSION`); the service
 * connects a client on another version than the doc read-only.
 */
export const getSceneSyncToken = os
  .use(requireStaff)
  .input(
    z.object({
      sceneId: sceneIdSchema,
      formatVersion: z.number().int().min(1),
      access: z.enum(["read", "write"]).default("write"),
    }),
  )
  .handler(async ({ context, input }) => {
    const secret = process.env.CANVAS_SYNC_SECRET;
    const url = process.env.CANVAS_SYNC_URL;
    if (!secret || !url) {
      throw new ORPCError("PRECONDITION_FAILED", { message: "Live scenes aren't set up here." });
    }
    if (!(await sceneExists(input.sceneId))) throw NOT_FOUND();
    const token = await signCanvasToken(
      {
        c: documentName("scene", input.sceneId),
        u: context.user.id,
        a: input.access,
        k: "scene",
        f: input.formatVersion,
        n: context.user.name || "Member",
      },
      secret,
    );
    return { token, url, access: input.access };
  });

const seedSchema = z
  .record(z.string(), z.unknown())
  .refine((seed) => Number.isInteger(seed.v) && (seed.v as number) >= 1, "A scene needs its `v`.")
  .refine(
    (seed) =>
      new TextEncoder().encode(JSON.stringify(seed)).byteLength <= SCENE_LIMITS.maxSeedBytes,
    "The scene is too large to host.",
  );

/**
 * Creates a hosted scene. The service fills the doc from `seed` the first
 * time anyone opens it (an empty scene of the id's name without one), since
 * the repo's scene files aren't in its image.
 */
export const createHostedScene = os
  .use(requireStaff)
  .input(z.object({ sceneId: sceneIdSchema, seed: seedSchema.optional() }))
  .handler(async ({ context, input }) => {
    const [row] = await db
      .insert(sceneDocs)
      .values({
        sceneId: input.sceneId,
        seed: input.seed ? JSON.stringify(input.seed) : null,
        createdById: context.user.id,
      })
      .onConflictDoNothing()
      .returning({ sceneId: sceneDocs.sceneId });
    if (!row) throw new ORPCError("CONFLICT", { message: "That scene already exists." });
    return { sceneId: row.sceneId };
  });

/** Deletes a hosted scene and closes everyone's sockets on it. */
export const deleteHostedScene = os
  .use(requireStaff)
  .input(z.object({ sceneId: sceneIdSchema }))
  .handler(async ({ input }) => {
    const [row] = await db
      .delete(sceneDocs)
      .where(eq(sceneDocs.sceneId, input.sceneId))
      .returning({ sceneId: sceneDocs.sceneId });
    if (!row) throw NOT_FOUND();
    await publishSceneRevoke(input.sceneId);
    return { sceneId: row.sceneId };
  });
