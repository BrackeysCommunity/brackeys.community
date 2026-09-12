import type { client } from "@/orpc/client";

/**
 * What the project page renders: `getProject`'s anonymous payload plus the
 * one viewer-dependent bit, which the route composes on from
 * `getProjectViewerState`. For an editor of an *unpublished* project the
 * payload itself comes from that companion instead — same shape either way.
 */
export type ProjectDetail = NonNullable<Awaited<ReturnType<typeof client.getProject>>> & {
  viewerCanEdit: boolean;
  /** The creator's alone, and never for a synced row — see `deleteProject`. */
  viewerCanDelete: boolean;
  /** Who else still holds the row, named for the danger zone's refusal. */
  deleteBlockers: string[];
};

export type ProjectRow = ProjectDetail["project"];
export type ProjectContributor = ProjectDetail["contributors"][number];
export type ProjectTeamClaim = ProjectDetail["teams"][number];
export type ProjectJamAppearance = ProjectDetail["jamRecord"][number];
