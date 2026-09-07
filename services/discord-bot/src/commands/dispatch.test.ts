import { describe, expect, test } from "bun:test";

import { ctx, fakeApi } from "../../test/fake-api.ts";
import { PROFILE_CONTEXT_MENU, replyVisibility, runInvocation } from "./dispatch.ts";
import { buildManifest } from "./manifest.ts";

describe("visibility", () => {
  test("/jam now is public; everything else is ephemeral unless shared", () => {
    expect(replyVisibility({ command: "jam", subcommand: "now", options: {} })).toBe("public");
    expect(replyVisibility({ command: "jam", subcommand: "info", options: {} })).toBe("ephemeral");
    expect(replyVisibility({ command: "jam", subcommand: "info", options: { share: true } })).toBe(
      "public",
    );
    expect(
      replyVisibility({ command: "collab", subcommand: "browse", options: { share: true } }),
    ).toBe("public");
    expect(replyVisibility({ command: "ping", options: { share: true } })).toBe("ephemeral");
    expect(replyVisibility({ command: PROFILE_CONTEXT_MENU, options: {} })).toBe("ephemeral");
  });
});

describe("dispatch", () => {
  test("an unknown command answers a line rather than throwing", async () => {
    const reply = await runInvocation(fakeApi({}), { command: "nope", options: {} }, ctx);
    expect(reply.ephemeral).toBe(true);
    expect(reply.content).toContain("isn't wired up");
  });

  test("an unknown sort falls back to the default", async () => {
    const seen: string[] = [];
    const api = fakeApi({
      getJam: async () => ({
        jam: { jamId: 1, slug: "s", title: "T", startsAt: null, endsAt: null, votingEndsAt: null },
        trackedEntries: 0,
        hasResults: false,
      }),
      listJamEntries: async (input: { sortBy: string }) => {
        seen.push(input.sortBy);
        return { entries: [], total: 0 };
      },
    });
    await runInvocation(
      api,
      { command: "jam", subcommand: "entries", options: { jam: "s", sort: "sideways" } },
      ctx,
    );
    expect(seen).toEqual(["rank"]);
  });

  test("/ping reports the round trip", async () => {
    const reply = await runInvocation(
      fakeApi({
        getBoardStats: async () => ({
          open: { all: 3, paid: 1, hobby: 2 },
          topSkills: [],
          topRoles: [],
          newThisWeek: 0,
        }),
      }),
      { command: "ping", options: {} },
      ctx,
    );
    expect(reply.embeds[0]?.description).toMatch(
      /answered in \*\*\d+ ms\*\* · 3 open collab posts/,
    );
  });
});

describe("manifest", () => {
  const manifest = buildManifest();

  test("every option the dispatcher reads exists under the name it reads", () => {
    const names = new Set(manifest.map((c) => c.name));
    expect(names).toEqual(
      new Set(["jam", "collab", "member", "team", "ping", PROFILE_CONTEXT_MENU]),
    );
    const jam = manifest.find((c) => c.name === "jam")!;
    expect(jam.options?.map((o) => o.name)).toEqual(["now", "info", "entries", "results"]);
  });

  test("respects the platform's shape limits", () => {
    expect(manifest.length).toBeLessThanOrEqual(100);
    for (const command of manifest) {
      if (command.type === 2) continue; // user context menu: display name, not a slash name
      expect(command.name).toMatch(/^[a-z0-9-]{1,32}$/);
      expect(command.options?.length ?? 0).toBeLessThanOrEqual(25);
      for (const option of command.options ?? []) {
        expect(option.name).toMatch(/^[a-z0-9-]{1,32}$/);
        expect(option.description.length).toBeLessThanOrEqual(100);
        if ("options" in option) expect(option.options?.length ?? 0).toBeLessThanOrEqual(25);
      }
    }
  });

  test("free-text search options are capped so a custom_id can carry them", () => {
    const stringOpts =
      JSON.stringify(manifest).match(/"name":"search"[^}]*"max_length":(\d+)/g) ?? [];
    expect(stringOpts.length).toBe(2);
    for (const m of stringOpts) expect(Number(m.match(/(\d+)$/)![1])).toBe(30);
  });
});
