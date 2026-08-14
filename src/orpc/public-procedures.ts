/**
 * The procedures served by the cacheable public tier at `/api/public/rpc`.
 *
 * Membership means the output is identical for every caller — no session is
 * read, so a response can sit in a shared edge cache. That is a stronger
 * claim than "callable anonymously": `getPost` and `getProfile` also answer
 * anonymous callers, but they mix viewer state into the payload and stay on
 * the private tier until phase 3 splits them.
 *
 * This list is plain strings on purpose. `src/orpc/client.ts` imports it to
 * route calls at the right mount, and it must not drag the router (and its
 * database imports) into the browser bundle. `src/orpc/router/public.ts`
 * builds the actual router, and a test asserts the two never drift.
 */
export const PUBLIC_PROCEDURE_NAMES = [
  // Jam archive — scraped itch.io data, public by nature.
  "listJams",
  "archiveJams",
  "listRecentEntries",
  "getJam",
  "listJamEntries",
  "getJamResults",
  "getJamCommunity",
  "listJamsByHost",
  // Community directory. `getProfile` is the anonymous view; the owner's
  // own extras come from the private `getMyProfile`.
  "listMembers",
  "listAvailableUsers",
  "getProfile",
  // Shared taxonomies — near-static, longest TTLs.
  "listSkills",
  "listCollabRoles",
  // Teams and projects (list/aggregate reads only; the detail pages carry
  // viewer overlays and stay private).
  "listTeams",
  "getTeam",
  "getTeamStats",
  "listUserTeams",
  "listProjectsForGames",
  "getProject",
  // Collab board. `listPosts` is the board's hottest query; its match
  // badge moved to the browser (`getMySkillIds`) so the listing itself is
  // caller-independent.
  "listPosts",
  "getPost",
  "countPostsByType",
  "countPostsForJam",
  "getBoardStats",
  // GitHub contribution calendar — a live GraphQL call per request today.
  "getContributions",
] as const;

export type PublicProcedureName = (typeof PUBLIC_PROCEDURE_NAMES)[number];

const publicNameSet: ReadonlySet<string> = new Set(PUBLIC_PROCEDURE_NAMES);

export function isPublicProcedure(name: string): boolean {
  return publicNameSet.has(name);
}
