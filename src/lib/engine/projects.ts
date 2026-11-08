import { ID_PATTERN } from "@jams/engine/scene";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { engineProjects } from "@/db/schema";
import { isStaffMember } from "@/lib/discord";
import { isServerFlagEnabled } from "@/lib/posthog-server";
import { resolveUserRoles } from "@/lib/staff-roles";

export const isEngineProjectId = (id: unknown): id is string =>
  typeof id === "string" && ID_PATTERN.test(id);

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
export async function isEngineStaff(userId: string): Promise<boolean> {
  return isStaffMember(await resolveUserRoles(userId));
}
