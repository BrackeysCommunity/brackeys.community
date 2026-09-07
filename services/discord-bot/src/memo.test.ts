import { describe, expect, test } from "bun:test";

import { fakeApi, jam } from "../test/fake-api.ts";
import { CHOICES_MAX, createMemo } from "./memo.ts";

describe("memo", () => {
  test("a cold memo answers with nothing rather than reaching for the API", () => {
    const memo = createMemo(fakeApi({}), { hostName: "Brackeys" });
    expect(memo.jamChoices("brack")).toEqual([]);
    expect(memo.skillChoices("")).toEqual([]);
    expect(memo.teamChoices("x")).toEqual([]);
  });

  test("a failed refresh is logged, not thrown", async () => {
    const lines: string[] = [];
    const memo = createMemo(fakeApi({}), { hostName: "Brackeys", log: (l) => lines.push(l) });
    await memo.refreshJams();
    expect(lines.some((l) => l.includes("jams refresh failed"))).toBe(true);
  });

  test("jam choices: prefix matches first, then the host's jams, capped at 25", async () => {
    const jams = Array.from({ length: 40 }, (_, i) =>
      jam({
        jamId: i + 1,
        slug: `jam-${i + 1}`,
        title: i === 5 ? "Brackeys Game Jam" : i === 9 ? "Not Brackeys" : `Jam ${i + 1}`,
        hosts: [{ name: i === 5 ? "Brackeys" : "Someone" }],
        joinedCount: i,
      }),
    );
    const memo = createMemo(fakeApi({ listJams: async () => ({ jams, trackedTotal: 40 }) }), {
      hostName: "Brackeys",
    });
    await memo.refreshJams();

    expect(memo.jamChoices("").length).toBe(CHOICES_MAX);
    expect(memo.jamChoices("")[0]).toEqual({ name: "Brackeys Game Jam", value: "jam-6" });
    expect(memo.jamChoices("brack").map((c) => c.value)).toEqual(["jam-6", "jam-10"]);
    expect(memo.jamChoices("jam 1").map((c) => c.value)).toContain("jam-1");
  });

  test("skills and roles autocomplete by id, and resolve names back", async () => {
    const memo = createMemo(
      fakeApi({
        listSkills: async () => [
          { id: 7, name: "Unity", category: null },
          { id: 8, name: "Unreal", category: null },
        ],
        listCollabRoles: async () => [{ id: 3, name: "Composer", category: null }],
      }),
      { hostName: "Brackeys" },
    );
    await memo.refreshTaxonomy();
    expect(memo.skillChoices("un")).toEqual([
      { name: "Unity", value: 7 },
      { name: "Unreal", value: 8 },
    ]);
    expect(memo.roleChoices("comp")).toEqual([{ name: "Composer", value: 3 }]);
    expect(memo.skillName(7)).toBe("Unity");
    expect(memo.roleName(99)).toBeUndefined();
  });

  test("teams page through listTeams until the total is reached", async () => {
    const calls: number[] = [];
    const memo = createMemo(
      fakeApi({
        listTeams: async ({ offset }: { offset: number }) => {
          calls.push(offset);
          const teams = Array.from({ length: offset === 0 ? 50 : 10 }, (_, i) => ({
            id: `t${offset + i}`,
            slug: `team-${offset + i}`,
            name: `Team ${offset + i}`,
            recruiting: i % 2 === 0,
          }));
          return { teams, total: 60 };
        },
      }),
      { hostName: "Brackeys" },
    );
    await memo.refreshTeams();
    expect(calls).toEqual([0, 50]);
    expect(memo.sizes().teams).toBe(60);
    expect(memo.teamChoices("team 5")[0]).toEqual({ name: "Team 5", value: "team-5" });
  });
});
