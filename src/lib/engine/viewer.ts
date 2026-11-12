import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { engineProjects } from "@/db/schema";

import type { Viewer } from "./release-access";
import type { ReleaseDb } from "./release-audit";
import { releaseViewer } from "./release-upload";

const ANONYMOUS: Viewer = { userId: null, staff: false, teamRole: null, isCreator: false };

/** The caller as the access rules see them for one project: staff, their team role, whether they made it. */
export async function viewerOf(
  userId: string | null,
  projectId: string,
  handle: ReleaseDb = db,
): Promise<Viewer> {
  if (userId === null) return ANONYMOUS;
  const [project] = await handle
    .select({
      projectId: engineProjects.projectId,
      game: engineProjects.game,
      teamId: engineProjects.teamId,
      createdById: engineProjects.createdById,
    })
    .from(engineProjects)
    .where(and(eq(engineProjects.projectId, projectId), isNull(engineProjects.deletedAt)));
  return releaseViewer(
    handle,
    userId,
    project ?? { projectId, game: null, teamId: null, createdById: null },
  );
}
