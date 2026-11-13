import { isSha256 } from "@jams/engine/project";
import { ID_PATTERN } from "@jams/engine/scene";
import { and, eq, isNull } from "drizzle-orm";
import * as z from "zod";

import { db } from "@/db";
import { engineProjects } from "@/db/schema";
import { isStaffMember } from "@/lib/discord";
import { isServerFlagEnabled } from "@/lib/posthog-server";
import { resolveUserRoles, type RolesDb } from "@/lib/staff-roles";

export const isEngineProjectId = (id: unknown): id is string =>
  typeof id === "string" && ID_PATTERN.test(id);

/** A project id in a procedure's input. */
export const engineProjectIdInput = z
  .string()
  .refine(isEngineProjectId, "A project id is lowercase letters, digits and dashes.");

/** A scene id in a procedure's input. */
export const sceneIdInput = z
  .string()
  .regex(ID_PATTERN, "A scene id is lowercase letters, digits and dashes.");

/** A content hash, release id or scene version id in a procedure's input. */
export const sha256Input = z.string().refine(isSha256, "A SHA-256 is 64 lowercase hex digits.");

/** A release's or scene version's number. */
export const versionNumberInput = z.number().int().min(1);

/** The reason staff give for a hide, a block or a report's resolution. */
export const moderationReasonInput = z.string().trim().min(1).max(500);

/** A hosted project that hasn't been deleted, or null. */
export async function liveEngineProject(
  projectId: string,
): Promise<{ projectId: string; name: string; layout: number } | null> {
  if (!isEngineProjectId(projectId)) return null;
  const [row] = await db
    .select({
      projectId: engineProjects.projectId,
      name: engineProjects.name,
      layout: engineProjects.layout,
    })
    .from(engineProjects)
    .where(and(eq(engineProjects.projectId, projectId), isNull(engineProjects.deletedAt)));
  return row ?? null;
}

/** The server half of the `engine-projects` flag. */
export function engineProjectsEnabled(userId: string): Promise<boolean> {
  return isServerFlagEnabled("engine-projects", userId);
}

/** The staff gate for callers outside the oRPC chain (routes, agent exchanges): `requireStaff`'s predicate. */
export async function isEngineStaff(userId: string, handle: RolesDb = db): Promise<boolean> {
  return isStaffMember(await resolveUserRoles(userId, handle));
}
