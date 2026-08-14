/**
 * The procedures served by the cacheable public tier at `/api/public/rpc`.
 *
 * Membership means the output is identical for every caller — no session is
 * read, so a response can sit in a shared edge cache. That is a stronger
 * claim than "callable anonymously": `listComments` and `listReplies` also
 * answer anonymous callers, but they redact per viewer, so they stay
 * private by design.
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
  "countMembersBySkill",
  "listAvailableUsers",
  "getProfile",
  // Shared taxonomies — rarely written, but see their TTLs below.
  "listSkills",
  "listCollabRoles",
  // Teams and projects (list/aggregate reads only; the detail pages carry
  // viewer overlays and stay private).
  "listTeams",
  "countTeamsBySkill",
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
  "countPostsBySkill",
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

/**
 * How many seconds Cloudflare may reuse each public response.
 *
 * Typed as a total `Record`, so adding a procedure above without deciding
 * its staleness budget is a **compile error** rather than a silent
 * inheritance of whatever the catch-all rule happened to say. That
 * inheritance is how a read ends up cached for longer than its own writers
 * can tolerate — see the browser-cache note below.
 *
 * Pick a number by asking "how stale may this look to someone who did not
 * make the change?", not "how often does it change".
 */
export const PUBLIC_EDGE_TTL: Record<PublicProcedureName, number> = {
  // Scraped itch.io data. Nothing in the app writes it, so nobody is
  // waiting to see their own edit land.
  listJams: 300,
  archiveJams: 300,
  listRecentEntries: 300,
  getJam: 300,
  listJamEntries: 300,
  getJamResults: 300,
  listJamsByHost: 300,

  // Member-written. A minute for listings; detail pages are where someone
  // clicks straight through after saving, so they get the shortest budget.
  //
  // `getJamCommunity` moved down here from the scraped block: it used to be
  // pure scrape output, but it now also carries the members who declared
  // they're entering, and that list changes the instant someone clicks the
  // toggle on the same page. At the scraped tier's 300s they'd have watched
  // their own name fail to appear for five minutes.
  getJamCommunity: 60,
  listMembers: 60,
  countMembersBySkill: 60,
  listAvailableUsers: 60,
  getProfile: 30,
  listTeams: 60,
  countTeamsBySkill: 60,
  getTeam: 30,
  listUserTeams: 60,
  getTeamStats: 60,
  listProjectsForGames: 60,
  getProject: 30,

  // The board: the most write-interactive public surface we have. The
  // counters share the posts' budget because they render beside the list
  // and a disagreement between them reads as a bug.
  listPosts: 30,
  getPost: 30,
  countPostsByType: 30,
  countPostsBySkill: 30,
  countPostsForJam: 30,
  getBoardStats: 30,

  // Taxonomies. Rarely edited, but a moderator adds a skill and then goes
  // looking for it in the pickers immediately — and `approveSkillRequest`
  // means a member is waiting on it too. Long TTLs here were a mistake:
  // the people who change this data are the people who check it first.
  listSkills: 300,
  listCollabRoles: 300,

  // A live GitHub GraphQL call per miss; the calendar moves once a day.
  getContributions: 900,
};

/**
 * Nitro `routeRules` for the public tier, one per procedure.
 *
 * **Every entry is `max-age=0` on purpose.** `max-age` governs the
 * *browser's* cache, and a browser serving a stored copy answers a
 * `fetch` without any request leaving the machine — which silently defeats
 * TanStack Query's `invalidateQueries`, the thing the app uses to show a
 * user their own write. `s-maxage` governs Cloudflare, which is where the
 * origin protection actually comes from, so the edge keeps the real TTL and
 * the browser always revalidates. This costs close to nothing: TanStack's
 * own `staleTime` already stops refetch spam.
 *
 * Generated rather than hand-written so `vite.config.ts` cannot drift from
 * the table above.
 */
export function publicCacheRouteRules(): Record<string, { headers: { "cache-control": string } }> {
  return Object.fromEntries(
    PUBLIC_PROCEDURE_NAMES.map((name) => [
      `/api/public/rpc/${name}`,
      { headers: { "cache-control": `public, max-age=0, s-maxage=${PUBLIC_EDGE_TTL[name]}` } },
    ]),
  );
}
