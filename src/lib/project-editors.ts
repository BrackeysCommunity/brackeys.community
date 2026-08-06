/**
 * Who may edit a canonical project (the plan's §1.3 rule), in one place.
 *
 * Deliberately *not* "the owner": a project is shared by everyone who made
 * it, so the editor set is the union of
 *
 * - `createdBy` — whoever typed the row in (or whose import minted it);
 * - contributors with a live `profileId` — the people credited on it;
 * - members of any team that claims it via `project_teams`.
 *
 * A scrape-minted project has none of those by construction, which is the
 * feature: nobody can edit a stranger's game page until they claim it.
 *
 * Server only — it opens the database.
 */
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { projectContributors, projectTeams, projects, teamMembers } from "@/db/schema";

/**
 * The editor check, given a project row and the teams already known to claim
 * it. `getProject` loads those anyway, so the page's own check costs it
 * nothing extra.
 */
export async function canEditProject(
  project: { id: string; createdBy: string | null },
  viewerId: string,
  teamRows: { teamId: string }[],
): Promise<boolean> {
  if (project.createdBy === viewerId) return true;

  const [credited] = await db
    .select({ id: projectContributors.id })
    .from(projectContributors)
    .where(
      and(
        eq(projectContributors.projectId, project.id),
        eq(projectContributors.profileId, viewerId),
      ),
    )
    .limit(1);
  if (credited) return true;

  if (teamRows.length === 0) return false;
  const [member] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(
      and(
        inArray(
          teamMembers.teamId,
          teamRows.map((row) => row.teamId),
        ),
        eq(teamMembers.userId, viewerId),
      ),
    )
    .limit(1);
  return member != null;
}

/**
 * Load a project and answer the editor question in one go, for the write
 * paths that start from an id rather than from a loaded page.
 *
 * Returns `null` when there is no such project, so callers can tell "gone"
 * from "not yours".
 */
export async function loadProjectForEditor(
  projectId: string,
  viewerId: string,
): Promise<{ project: typeof projects.$inferSelect; canEdit: boolean } | null> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return null;

  const teamRows = await db
    .select({ teamId: projectTeams.teamId })
    .from(projectTeams)
    .where(eq(projectTeams.projectId, projectId));

  return { project, canEdit: await canEditProject(project, viewerId, teamRows) };
}
