import { describe, expect, it } from "vite-plus/test";

import {
  authMiddleware,
  requireAdmin,
  requireAuth,
  requireAuthWithPermissions,
  requireGuildMember,
  requireStaff,
} from "@/orpc/middleware/auth";
import router from "@/orpc/router";

/**
 * Router-wide authorization lockdown. A procedure with no `.use(...)` is
 * anonymous by default, so the security model rests on every procedure
 * carrying the right middleware — this test turns that from a memory
 * exercise into a CI gate. A new procedure fails here until someone
 * consciously adds it to exactly one of the sets below.
 *
 * It proves procedures reject the wrong *caller class* only; owner-or-staff
 * logic inside handlers stays covered by per-router tests.
 */

/**
 * Procedures that intentionally answer anonymous callers. Each entry is a
 * product decision — public community directory, public jam archive, public
 * board — not an omission. This is also the candidate set for the cacheable
 * public tier in docs/plans/02-api-public-private-split.md.
 */
const PUBLIC_PROCEDURES = new Set([
  // Jam archive: scraped itch.io data, public by nature.
  "listJams",
  "archiveJams",
  "listRecentEntries",
  "getJam",
  "listJamEntries",
  "getJamResults",
  "getJamCommunity",
  "listJamsByHost",
  // Public community directory (explicit product decision — see
  // docs/plans/01-admin-surface-hardening.md §"Confirm-intent").
  "listMembers",
  "countMembersBySkill",
  "listAvailableUsers",
  // Public profile/project/team pages; viewer-specific fields degrade
  // to their anonymous shape via authMiddleware.
  "getProfile",
  "getProject",
  "listProjectsForGames",
  "resolveProjectForGame",
  "getTeam",
  "listTeams",
  "countTeamsBySkill",
  "getTeamStats",
  "listUserTeams",
  // Collab board reads.
  "getPost",
  "listPosts",
  "countPostsByType",
  "countPostsBySkill",
  "countPostsForJam",
  "getBoardStats",
  // Shared taxonomies.
  "listSkills",
  "listCollabRoles",
  // Comment threads render for signed-out visitors.
  "listComments",
  "listReplies",
  // GitHub contribution calendar on public profiles.
  "getContributions",
  // Answers {isStaff:false,isAdmin:false} to anonymous callers; gates the
  // /admin route's UX only.
  "getStaffStatus",
]);

/** Procedures that must refuse even a plain authenticated non-staff user. */
const STAFF_PROCEDURES = new Set([
  "banUser",
  "unbanUser",
  "listBans",
  "listSkillRequests",
  "approveSkillRequest",
  "rejectSkillRequest",
  "listVocabulary",
  "createSkill",
  "updateSkill",
  "deleteSkill",
  "featurePost",
  "addCollabRole",
  "updateCollabRole",
  "removeCollabRole",
  "listReports",
  "resolvePostReport",
  "deleteReport",
  "lockThread",
  "listCommentReports",
  "listRecentComments",
  "resolveCommentReport",
]);

const AUTH_REQUIRING = new Set<unknown>([
  requireAuth,
  requireGuildMember,
  requireAuthWithPermissions,
  requireStaff,
  requireAdmin,
]);

const STAFF_REQUIRING = new Set<unknown>([requireStaff, requireAdmin]);

function middlewaresOf(procedure: unknown): readonly unknown[] {
  return (procedure as { "~orpc": { middlewares: readonly unknown[] } })["~orpc"].middlewares;
}

const procedures = Object.entries(router as Record<string, unknown>);

describe("authorization lockdown", () => {
  it("classifies every procedure", () => {
    const names = new Set(procedures.map(([name]) => name));
    for (const name of PUBLIC_PROCEDURES) {
      expect(names, `allowlisted "${name}" is not in the router`).toContain(name);
    }
    for (const name of STAFF_PROCEDURES) {
      expect(names, `staff-listed "${name}" is not in the router`).toContain(name);
    }
  });

  it("public procedures carry no auth-requiring middleware", () => {
    for (const [name, procedure] of procedures) {
      if (!PUBLIC_PROCEDURES.has(name)) continue;
      const gates = middlewaresOf(procedure).filter((m) => AUTH_REQUIRING.has(m));
      expect(gates, `"${name}" is allowlisted as public but requires auth`).toHaveLength(0);
    }
  });

  it("every non-public procedure rejects anonymous callers", () => {
    for (const [name, procedure] of procedures) {
      if (PUBLIC_PROCEDURES.has(name)) continue;
      const gates = middlewaresOf(procedure).filter((m) => AUTH_REQUIRING.has(m));
      expect(
        gates.length,
        `"${name}" has no auth middleware and is not on the public allowlist — ` +
          "an unauthenticated caller would reach its handler",
      ).toBeGreaterThan(0);
    }
  });

  it("staff procedures reject non-staff users, and only listed ones do", () => {
    for (const [name, procedure] of procedures) {
      const staffGated = middlewaresOf(procedure).some((m) => STAFF_REQUIRING.has(m));
      if (STAFF_PROCEDURES.has(name)) {
        expect(staffGated, `"${name}" must use requireStaff or requireAdmin`).toBe(true);
      } else {
        expect(
          staffGated,
          `"${name}" is staff-gated but missing from STAFF_PROCEDURES — add it`,
        ).toBe(false);
      }
    }
  });

  it("anonymous-tolerant middleware only appears on public procedures", () => {
    for (const [name, procedure] of procedures) {
      if (PUBLIC_PROCEDURES.has(name)) continue;
      const soft = middlewaresOf(procedure).includes(authMiddleware);
      expect(
        soft,
        `"${name}" uses authMiddleware (anonymous-tolerant) but is not on the public allowlist`,
      ).toBe(false);
    }
  });
});
