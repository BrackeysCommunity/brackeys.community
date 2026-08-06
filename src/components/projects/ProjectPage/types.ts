import type { client } from "@/orpc/client";

/** `getProject`'s payload for a project the viewer is allowed to see. */
export type ProjectDetail = NonNullable<Awaited<ReturnType<typeof client.getProject>>>;

export type ProjectRow = ProjectDetail["project"];
export type ProjectContributor = ProjectDetail["contributors"][number];
export type ProjectTeamClaim = ProjectDetail["teams"][number];
export type ProjectJamAppearance = ProjectDetail["jamRecord"][number];
