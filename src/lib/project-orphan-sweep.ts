/**
 * The orphan-project pass of the notifications worker's lifecycle sweep —
 * the collector `projectHasAnchors`'s docstring promised. Same import-graph-
 * neutral shape as `jam-watch-sweep.ts`: relative imports, schema + drizzle
 * only, the caller's own drizzle handle.
 *
 * A manual project is swept when nothing points at it any more and nobody
 * has touched it for the grace window: no profile or team placement, no team
 * claim, no credit of any kind, no jam link. Placement deletion never
 * cascades to the canonical row (other pages may point at it), so a team
 * deleted with a project attached leaves that row behind — this is what
 * turns the leftover into a delay rather than a fixture. Scrape-minted rows
 * are self-anchoring and never qualify; a row with a free-text credit or a
 * jam link is still someone's shipped work and is kept.
 *
 * Idempotent by construction: the predicate is the stamp. Cover objects in
 * the project's storage namespace are not cleaned here — the worker has no
 * object store client — which is a storage leak, not a correctness problem.
 */
import { and, eq, lt, notExists, sql } from "drizzle-orm";

import {
  profileProjects,
  projectContributors,
  projectJamLinks,
  projectTeams,
  projects,
  teamProjects,
} from "../db/schema";

// biome-ignore lint/suspicious/noExplicitAny: drizzle builder shape changes per env
type DbHandle = any;

export const ORPHAN_PROJECT_GRACE_DAYS = 30;

export async function sweepOrphanProjects(db: DbHandle, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - ORPHAN_PROJECT_GRACE_DAYS * 86_400_000);
  const none = (table: { projectId: unknown }) =>
    notExists(
      db
        .select({ one: sql`1` })
        .from(table)
        .where(eq(table.projectId as never, projects.id)),
    );
  const gone = await db
    .delete(projects)
    .where(
      and(
        eq(projects.source, "manual"),
        lt(projects.updatedAt, cutoff),
        none(profileProjects),
        none(teamProjects),
        none(projectTeams),
        none(projectContributors),
        none(projectJamLinks),
      ),
    )
    .returning({ id: projects.id });
  return gone.length;
}
