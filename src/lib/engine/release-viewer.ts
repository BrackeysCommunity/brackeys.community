import { and, eq } from "drizzle-orm";

import { teamMembers } from "@/db/schema";

import { isEngineStaff } from "./projects";
import type { Viewer } from "./release-access";
import type { ReleaseDb } from "./release-audit";

/** The hosted project row the checks read. */
export type ProjectRow = {
  projectId: string;
  game: string | null;
  teamId: string | null;
  createdById: string | null;
};

/** The caller as the access rules see them: staff by their roles, publisher or editor by the project and its team. */
export async function releaseViewer(
  db: ReleaseDb,
  userId: string,
  project: ProjectRow,
): Promise<Viewer> {
  const [staff, membership] = await Promise.all([
    isEngineStaff(userId, db),
    project.teamId === null
      ? Promise.resolve([])
      : db
          .select({ role: teamMembers.role })
          .from(teamMembers)
          .where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, userId)))
          .limit(1),
  ]);
  const role = membership[0]?.role;
  return {
    userId,
    staff,
    teamRole: role === "owner" ? "owner" : role === undefined ? null : "member",
    isCreator: project.createdById === userId,
  };
}
