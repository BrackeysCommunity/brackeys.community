import {
  countPostsByType,
  countPostsForJam,
  getBoardStats,
  getPost,
  listCollabRoles,
  listPosts,
} from "./collab";
import { getContributions } from "./github";
import {
  archiveJams,
  getJam,
  getJamCommunity,
  getJamResults,
  listJamEntries,
  listJams,
  listJamsByHost,
  listRecentEntries,
} from "./jam";
import { listMembers } from "./member";
import { getProfile, listAvailableUsers, listSkills } from "./profile";
import { getProject, listProjectsForGames } from "./project";
import { getTeam, getTeamStats, listTeams, listUserTeams } from "./team";

/**
 * The cacheable public tier, mounted at `/api/public/rpc`
 * (`src/routes/api.public.rpc.$.ts`).
 *
 * These are the *same procedure instances* the root router exports, not
 * copies — a change to a handler cannot apply to one tier and miss the
 * other. Flat, with the same keys as the root router, which is what lets
 * the client facade in `src/orpc/client.ts` swap mounts without touching a
 * single call site or query key.
 *
 * Two rules govern membership, both enforced by
 * `__tests__/public-router.test.ts`:
 *
 * 1. No auth middleware. The mount also hands each procedure an empty
 *    `Headers`, so a procedure that later grew a session lookup would still
 *    see an anonymous caller — but the real guarantee is that it has none.
 * 2. `.route({ method: "GET" })`, which `StrictGetMethodPlugin` requires
 *    before it will serve a procedure over GET.
 *
 * `resolveProjectForGame` is deliberately absent: it mints a project row on
 * first read, and a side effect behind a cacheable GET is a side effect that
 * silently stops happening.
 */
export const publicRouter = {
  listJams,
  archiveJams,
  listRecentEntries,
  getJam,
  listJamEntries,
  getJamResults,
  getJamCommunity,
  listJamsByHost,
  listMembers,
  listAvailableUsers,
  getProfile,
  listSkills,
  listCollabRoles,
  listTeams,
  getTeam,
  getTeamStats,
  listUserTeams,
  listProjectsForGames,
  getProject,
  listPosts,
  getPost,
  countPostsByType,
  countPostsForJam,
  getBoardStats,
  getContributions,
};

export default publicRouter;
