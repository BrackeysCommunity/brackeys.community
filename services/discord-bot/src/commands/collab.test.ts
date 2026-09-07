import { describe, expect, test } from "bun:test";

import { ctx, fakeApi, jam } from "../../test/fake-api.ts";
import { collabBrowse, collabBrowsePage, collabPost, collabStats } from "./collab.ts";
import { decodeCustomId } from "./custom-id.ts";

const post = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  authorId: "u1",
  type: "paid",
  jamId: null,
  teamId: null,
  projectId: null,
  title: `Post ${id}`,
  description: "Looking for a composer for a cosy farming game.",
  projectName: null,
  compensation: null,
  compensationType: "hourly",
  compensationMin: 25,
  compensationMax: 50,
  teamSize: null,
  projectLength: null,
  platforms: null,
  experience: null,
  experienceLevel: null,
  portfolioUrl: null,
  isIndividual: true,
  status: "recruiting",
  featuredAt: null,
  expiresAt: null,
  expiryNotifiedAt: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: null,
  hasContact: true,
  primaryImageUrl: null,
  jam: null,
  team: { id: "t1", slug: "cosy-crew", name: "Cosy Crew", avatarUrl: null },
  project: null,
  skills: [
    { id: 7, name: "Unity" },
    { id: 8, name: "FMOD" },
    { id: 9, name: "Ableton" },
    { id: 10, name: "Reaper" },
  ],
  ...over,
});

describe("/collab browse", () => {
  test("header counts and rows come from the same facets, open posts only", async () => {
    const seen: Record<string, unknown>[] = [];
    const api = fakeApi({
      listPosts: async (input: Record<string, unknown>) => {
        seen.push({ list: input });
        return { posts: [post(1), post(2)], total: 2 };
      },
      countPostsByType: async (input: Record<string, unknown>) => {
        seen.push({ count: input });
        return { paid: 2, hobby: 5, all: 7 };
      },
    });
    const reply = await collabBrowse(api, { type: "paid", skillId: 7, search: "cosy" }, ctx);

    const facets = {
      status: "recruiting",
      skillIds: [7],
      roleIds: undefined,
      jamId: undefined,
      search: "cosy",
    };
    expect(seen[0]).toEqual({ list: { ...facets, type: "paid", limit: 10, offset: 0 } });
    expect(seen[1]).toEqual({ count: facets });

    const embed = reply.embeds[0]!;
    expect(embed.description).toContain("**2 open posts** · 7 across all types");
    expect(embed.description).toContain("Filters: paid · skill Unity · “cosy”");
    expect(embed.description).toContain(
      "**[Post 1](https://brackeys.test/collab/1)** · PAID · $25 - $50 /hr · [Cosy Crew](https://brackeys.test/teams/cosy-crew) · Unity, FMOD, Ableton, +1 · <t:1788220800:R>",
    );
    expect(reply.ephemeral).toBe(true);
    // One page of results: no pager at all. Both ends would clamp to page 0
    // and Discord rejects a message carrying two identical custom_ids.
    expect(reply.buttons.map((b) => b.kind)).toEqual(["link"]);
  });

  test("a multi-page result pages with distinct custom_ids", async () => {
    const api = fakeApi({
      listPosts: async () => ({ posts: [post(1), post(2)], total: 24 }),
      countPostsByType: async () => ({ paid: 24, hobby: 0, all: 24 }),
    });
    const reply = await collabBrowse(api, { type: "paid", skillId: 7, search: "cosy" }, ctx);
    const pages = reply.buttons.filter(
      (b): b is { kind: "page"; label: string; customId: string; disabled?: boolean } =>
        b.kind === "page",
    );
    expect(pages).toHaveLength(2);
    expect(pages[0]!.disabled).toBe(true);
    expect(pages[1]!.disabled).toBe(false);
    expect(pages[0]!.customId).not.toBe(pages[1]!.customId);
    expect(decodeCustomId(pages[1]!.customId)).toEqual({
      kind: "collab_browse",
      type: "paid",
      skillId: 7,
      roleId: undefined,
      jamId: undefined,
      page: 1,
      search: "cosy",
    });
  });

  test("an empty result echoes the filters back, with names resolved where the memo knows them", async () => {
    const api = fakeApi({
      listPosts: async () => ({ posts: [], total: 0 }),
      countPostsByType: async () => ({ paid: 0, hobby: 0, all: 0 }),
      getJam: async () => ({ jam: jam(), trackedEntries: 0, hasResults: false }),
    });
    const reply = await collabBrowse(
      api,
      { roleId: 3, skillId: 999, jam: "brackeys-14", share: true },
      ctx,
    );
    const embed = reply.embeds[0]!;
    expect(embed.description).toContain(
      "Filters: skill #999 · role Composer · jam Brackeys Game Jam 2026.1",
    );
    expect(embed.description).toContain("Nothing open matches those filters.");
    expect(reply.ephemeral).toBe(false);
    expect(reply.outcome).toBe("hit");
  });

  test("a page turn from a button paginates with the encoded facets", async () => {
    const seen: Record<string, unknown>[] = [];
    const api = fakeApi({
      listPosts: async (input: Record<string, unknown>) => {
        seen.push(input);
        return { posts: [post(31)], total: 31 };
      },
      countPostsByType: async () => ({ paid: 10, hobby: 21, all: 31 }),
    });
    const reply = await collabBrowsePage(
      api,
      { kind: "collab_browse", page: 3, search: "" },
      ctx,
      false,
    );
    expect(seen[0]).toMatchObject({ offset: 30, limit: 10, type: undefined });
    expect(reply.embeds[0]?.footer).toBe("Page 4/4");
    expect(reply.embeds[0]?.description).toContain("**31 open posts** · 21 hobby · 10 paid");
    expect(reply.buttons[1]).toMatchObject({ disabled: true });
    expect(reply.ephemeral).toBe(false);
  });
});

describe("/collab post", () => {
  test("one embed with the author, roles, and the primary image", async () => {
    const api = fakeApi({
      getPost: async ({ postId }: { postId: number }) => ({
        ...post(postId, {
          team: null,
          jam: { jamId: 1, slug: "brackeys-14", title: "Brackeys Game Jam 2026.1" },
        }),
        roles: [{ id: 3, name: "Composer", category: null }],
        images: [{ url: "/images/collab/12/shot.png" }],
        responseCount: 4,
        author: {
          id: "u1",
          guildNickname: "Josh",
          discordUsername: "joshe",
          avatarUrl: null,
          urlStub: "josh",
          skills: [],
        },
      }),
    });
    const reply = await collabPost(api, { id: 12 }, ctx);
    const embed = reply.embeds[0]!;
    expect(embed.title).toBe("Post 12");
    expect(embed.url).toBe("https://brackeys.test/collab/12");
    expect(embed.author).toEqual({
      name: "Josh",
      url: "https://brackeys.test/profile/josh",
      iconUrl: undefined,
    });
    expect(embed.image).toBe("https://brackeys.test/images/collab/12/shot.png");
    expect(embed.fields?.map((f) => f.name)).toEqual([
      "Type",
      "Compensation",
      "Status",
      "Roles wanted",
      "Skills",
      "Jam",
      "Posted",
      "Responses",
    ]);
    expect(embed.fields?.find((f) => f.name === "Jam")?.value).toBe(
      "[Brackeys Game Jam 2026.1](https://brackeys.test/jams/brackeys-14)",
    );
  });

  test("a missing post is not_found", async () => {
    const reply = await collabPost(fakeApi({ getPost: async () => null }), { id: 99 }, ctx);
    expect(reply.outcome).toBe("not_found");
    expect(reply.content).toContain("#99");
  });
});

describe("/collab stats", () => {
  test("board and team stats in one embed", async () => {
    const api = fakeApi({
      getBoardStats: async () => ({
        open: { paid: 4, hobby: 8, all: 12 },
        topSkills: [{ id: 7, name: "Unity", count: 5 }],
        topRoles: [],
        newThisWeek: 3,
      }),
      getTeamStats: async () => ({ active: 40, recruiting: 9 }),
    });
    const reply = await collabStats(api, {}, ctx);
    const fields = reply.embeds[0]!.fields!;
    expect(fields[0]!.value).toBe("**12** · 8 hobby · 4 paid");
    expect(fields[2]!.value).toBe("**40** active · 9 recruiting");
    expect(fields[3]!.value).toBe("Unity (5)");
    expect(fields[4]!.value).toBe("—");
  });
});
