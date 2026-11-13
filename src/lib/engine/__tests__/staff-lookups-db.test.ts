import { beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { engineProjects } from "@/db/schema";
import { resolveUserRoles } from "@/lib/staff-roles";
import { createTestDb, seedUser, type TestDb } from "@/test/db";

import { isEngineStaff } from "../projects";
import type { ReleaseDb } from "../release-audit";
import { releaseViewer } from "../release-viewer";
import { viewerOf } from "../viewer";

// The site's own `db` is left real but pointed at a closed port, so a
// lookup that falls back to it fails instead of reading the handle's rows.
vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nobody@127.0.0.1:9/unreachable";
});

const PROJECT = "staff-lookups";

let handle: TestDb;
const asReleaseDb = () => handle as unknown as ReleaseDb;

beforeAll(async () => {
  handle = await createTestDb();
  await seedUser(handle, "staffer", { guildRoles: ["Staff"] });
  await seedUser(handle, "player", { guildRoles: [] });
  await handle.insert(engineProjects).values({
    projectId: PROJECT,
    name: "Staff Lookups",
    game: "lookup-game",
    createdById: "player",
    visibility: "public",
  });
});

describe("staff lookups on an injected handle", () => {
  it("reads roles and the staff gate from the handle", async () => {
    expect(await resolveUserRoles("staffer", asReleaseDb())).toEqual(["Staff"]);
    expect(await resolveUserRoles("nobody", asReleaseDb())).toBeNull();
    expect(await isEngineStaff("staffer", asReleaseDb())).toBe(true);
    expect(await isEngineStaff("player", asReleaseDb())).toBe(false);
  });

  it("sees a staff member only the handle holds through viewerOf", async () => {
    expect(await viewerOf("staffer", PROJECT, asReleaseDb())).toEqual({
      userId: "staffer",
      staff: true,
      teamRole: null,
      isCreator: false,
    });
    expect(await viewerOf("player", PROJECT, asReleaseDb())).toEqual({
      userId: "player",
      staff: false,
      teamRole: null,
      isCreator: true,
    });
  });

  it("sees a staff member only the handle holds through releaseViewer", async () => {
    const project = {
      projectId: PROJECT,
      game: "lookup-game",
      teamId: null,
      createdById: "player",
    };
    const viewer = await releaseViewer(asReleaseDb(), "staffer", project);
    expect(viewer.staff).toBe(true);
  });

  it("still defaults to the site's db when no handle is given", async () => {
    await expect(resolveUserRoles("staffer")).rejects.toThrow();
  });
});
