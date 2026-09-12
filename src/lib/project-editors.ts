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
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";

import { db } from "@/db";
import {
  developerProfiles,
  profileProjects,
  projectContributors,
  projectTeams,
  projects,
  teamMembers,
  teamProjects,
  teams,
} from "@/db/schema";
import { memberName } from "@/lib/member-name";

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

/**
 * Everyone *else* still holding a project, named for a confirm dialog: other
 * members' profile placements, teams (a claim or a showcase placement), and
 * other profile-linked credits.
 *
 * Deleting is the one project write that is not shared by the editor set —
 * it takes the row out from under every other page pointing at it — so the
 * caller refuses while this list is non-empty unless staff are acting.
 * Free-text credits and jam links are not blockers: they have no page of
 * their own to lose. A scrape-minted row (`itchio` with a game id) is its
 * own blocker and is reported separately, since the scraper would mint it
 * again.
 */
export async function projectDeleteBlockers(
  project: { id: string; source: string; sourceGameId: number | null },
  requesterId: string,
): Promise<{ synced: boolean; blockers: string[] }> {
  const synced = project.source === "itchio" && project.sourceGameId != null;

  const [placementOwners, teamClaims, teamPlacements, credited] = await Promise.all([
    db
      .selectDistinct({
        profileId: profileProjects.profileId,
        discordUsername: developerProfiles.discordUsername,
        guildNickname: developerProfiles.guildNickname,
      })
      .from(profileProjects)
      .innerJoin(developerProfiles, eq(profileProjects.profileId, developerProfiles.id))
      .where(
        and(eq(profileProjects.projectId, project.id), ne(profileProjects.profileId, requesterId)),
      ),
    db
      .select({ teamId: teams.id, name: teams.name })
      .from(projectTeams)
      .innerJoin(teams, eq(projectTeams.teamId, teams.id))
      .where(eq(projectTeams.projectId, project.id)),
    db
      .selectDistinct({ teamId: teams.id, name: teams.name })
      .from(teamProjects)
      .innerJoin(teams, eq(teamProjects.teamId, teams.id))
      .where(eq(teamProjects.projectId, project.id)),
    db
      .select({
        profileId: projectContributors.profileId,
        displayName: projectContributors.displayName,
      })
      .from(projectContributors)
      .where(
        and(
          eq(projectContributors.projectId, project.id),
          isNotNull(projectContributors.profileId),
          ne(projectContributors.profileId, requesterId),
        ),
      ),
  ]);

  const blockers: string[] = [];
  for (const owner of placementOwners) {
    blockers.push(`${memberName(owner, "a member")}'s showcase`);
  }
  const teamNames = new Set<string>();
  for (const team of [...teamClaims, ...teamPlacements]) {
    if (teamNames.has(team.teamId)) continue;
    teamNames.add(team.teamId);
    blockers.push(`the team ${team.name}`);
  }
  for (const credit of credited) {
    blockers.push(`${credit.displayName} (credited)`);
  }
  return { synced, blockers };
}
