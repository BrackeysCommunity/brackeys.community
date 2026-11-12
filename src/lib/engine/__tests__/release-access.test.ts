import { describe, expect, test } from "vite-plus/test";

import {
  canDo,
  canPlay,
  GAME_ACTIONS,
  roleOf,
  visibilityProblem,
  type GameAction,
  type GameRole,
  type GameVisibility,
  type Viewer,
} from "../release-access";

const TEAM = { teamId: "team-1" };
const PERSONAL = { teamId: null };

const signedOut: Viewer = { userId: null, staff: false, teamRole: null, isCreator: false };
const stranger: Viewer = { userId: "u-stranger", staff: false, teamRole: null, isCreator: false };
const staff: Viewer = { userId: "u-staff", staff: true, teamRole: null, isCreator: false };
const creator: Viewer = { userId: "u-creator", staff: false, teamRole: null, isCreator: true };
const owner: Viewer = { userId: "u-owner", staff: false, teamRole: "owner", isCreator: false };
const member: Viewer = { userId: "u-member", staff: false, teamRole: "member", isCreator: false };

describe("roleOf", () => {
  test.each<[string, Viewer, { teamId: string | null }, GameRole]>([
    ["staff", staff, TEAM, "staff"],
    ["staff who is also a member", { ...member, staff: true }, TEAM, "staff"],
    ["the creator of a team project", creator, TEAM, "publisher"],
    ["the creator of a personal project", creator, PERSONAL, "publisher"],
    ["a team owner", owner, TEAM, "publisher"],
    ["a team member", member, TEAM, "editor"],
    ["the creator who is a member", { ...member, isCreator: true }, TEAM, "publisher"],
    ["a stranger", stranger, TEAM, "player"],
    ["signed out", signedOut, TEAM, "player"],
    ["a team role on a personal project", owner, PERSONAL, "player"],
    ["signed out with stray flags", { ...owner, userId: null, isCreator: true }, TEAM, "player"],
  ])("%s", (_name, viewer, project, role) => {
    expect(roleOf(viewer, project)).toBe(role);
  });
});

describe("canDo", () => {
  const Y = true;
  const N = false;
  // staff, publisher, editor, agent, player
  const TABLE: Record<GameAction, [boolean, boolean, boolean, boolean, boolean]> = {
    upload: [Y, Y, Y, Y, N],
    "promote-preview": [Y, Y, Y, Y, N],
    "rollback-preview": [Y, Y, Y, Y, N],
    "promote-production": [Y, Y, N, N, N],
    "rollback-production": [Y, Y, N, N, N],
    visibility: [Y, Y, N, N, N],
    "jam-link": [Y, Y, N, N, N],
    settings: [Y, Y, N, N, N],
    "download-zip": [Y, Y, Y, N, N],
    hide: [Y, N, N, N, N],
    "approve-public": [Y, N, N, N, N],
  };
  const ROLES = ["staff", "publisher", "editor", "agent", "player"] as const;

  test("the table names every action", () => {
    expect(Object.keys(TABLE).sort()).toEqual([...GAME_ACTIONS].sort());
  });

  for (const action of GAME_ACTIONS) {
    ROLES.forEach((role, i) => {
      const allowed = TABLE[action][i];
      test(`${role} ${allowed ? "may" : "may not"} ${action}`, () => {
        expect(canDo(role, action)).toBe(allowed);
      });
    });
  }

  test("an agent may only upload and move or roll back preview", () => {
    expect(GAME_ACTIONS.filter((a) => canDo("agent", a)).sort()).toEqual(
      ["promote-preview", "rollback-preview", "upload"].sort(),
    );
  });
});

describe("canPlay", () => {
  const live = {
    hiddenAt: null,
    collectedAt: null,
    firstPromotedAt: new Date(0),
    jamPinned: false,
  };
  const jam = { ...live, firstPromotedAt: null, jamPinned: true };
  const previewOnly = { ...live, firstPromotedAt: null };
  const project = (visibility: GameVisibility, teamId: string | null = "team-1") => ({
    visibility,
    teamId,
    hiddenAt: null,
  });

  const VIEWERS: [string, Viewer][] = [
    ["staff", staff],
    ["creator", creator],
    ["owner", owner],
    ["member", member],
    ["stranger", stranger],
    ["signed out", signedOut],
  ];

  // Who plays production, jam and once-live versions under each visibility.
  const AUDIENCE: Record<GameVisibility, string[]> = {
    private: ["staff", "creator", "owner"],
    team: ["staff", "creator", "owner", "member"],
    unlisted: ["staff", "creator", "owner", "member", "stranger", "signed out"],
    public: ["staff", "creator", "owner", "member", "stranger", "signed out"],
  };

  for (const visibility of ["private", "team", "unlisted", "public"] as const) {
    for (const [kind, release] of [
      ["production", live],
      ["jam-pinned", jam],
    ] as const) {
      for (const [name, viewer] of VIEWERS) {
        const allowed = AUDIENCE[visibility].includes(name);
        test(`${visibility} ${kind}: ${name} ${allowed ? "plays" : "is refused"}`, () => {
          expect(canPlay(viewer, project(visibility), release)).toEqual(
            allowed ? { ok: true } : { ok: false, reason: "forbidden" },
          );
        });
      }
    }
  }

  test("a release that was once live and is now off production plays like production", () => {
    const formerlyLive = { ...live, firstPromotedAt: new Date(1_000) };
    expect(canPlay(stranger, project("public"), formerlyLive)).toEqual({ ok: true });
    expect(canPlay(stranger, project("private"), formerlyLive)).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  test("a jam version plays for anyone under unlisted, though never promoted", () => {
    expect(canPlay(signedOut, project("unlisted"), jam)).toEqual({ ok: true });
    expect(canPlay(stranger, project("unlisted"), jam)).toEqual({ ok: true });
  });

  describe("preview-only versions", () => {
    for (const visibility of ["private", "team", "unlisted", "public"] as const) {
      test(`team project, ${visibility}: the team and staff only`, () => {
        for (const v of [staff, creator, owner, member]) {
          expect(canPlay(v, project(visibility), previewOnly)).toEqual({ ok: true });
        }
        for (const v of [stranger, signedOut]) {
          expect(canPlay(v, project(visibility), previewOnly)).toEqual({
            ok: false,
            reason: "not-found",
          });
        }
      });

      test(`personal project, ${visibility}: its publishers and staff only`, () => {
        const p = project(visibility, null);
        expect(canPlay(creator, p, previewOnly)).toEqual({ ok: true });
        expect(canPlay(staff, p, previewOnly)).toEqual({ ok: true });
        for (const v of [owner, member, stranger, signedOut]) {
          expect(canPlay(v, p, previewOnly)).toEqual({ ok: false, reason: "not-found" });
        }
      });
    }
  });

  describe("hidden and collected come first", () => {
    const everyone = VIEWERS.map(([, v]) => v);

    test("a hidden project refuses everyone, staff included", () => {
      for (const v of everyone) {
        expect(canPlay(v, { ...project("public"), hiddenAt: new Date() }, live)).toEqual({
          ok: false,
          reason: "hidden",
        });
      }
    });

    test("a hidden release refuses everyone", () => {
      for (const v of everyone) {
        expect(canPlay(v, project("public"), { ...live, hiddenAt: new Date() })).toEqual({
          ok: false,
          reason: "hidden",
        });
      }
    });

    test("a collected release refuses everyone, before visibility and preview", () => {
      for (const v of everyone) {
        for (const r of [live, previewOnly]) {
          expect(canPlay(v, project("private"), { ...r, collectedAt: new Date() })).toEqual({
            ok: false,
            reason: "collected",
          });
        }
      }
    });

    test("hidden wins over collected", () => {
      expect(
        canPlay(staff, project("public"), {
          ...live,
          hiddenAt: new Date(),
          collectedAt: new Date(),
        }),
      ).toEqual({ ok: false, reason: "hidden" });
    });
  });
});

describe("visibilityProblem", () => {
  test("team on a personal project is refused", () => {
    expect(visibilityProblem("team", PERSONAL)).toEqual({
      code: "release-forbidden",
      message: "Only a team's game can be team-only.",
      hint: "Move the project to a team first, or pick another visibility.",
    });
  });

  test("every other combination is fine", () => {
    for (const v of ["private", "team", "unlisted", "public"] as const) {
      expect(visibilityProblem(v, TEAM)).toBeNull();
      if (v !== "team") expect(visibilityProblem(v, PERSONAL)).toBeNull();
    }
  });
});
