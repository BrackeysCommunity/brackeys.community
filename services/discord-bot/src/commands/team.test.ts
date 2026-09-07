import { describe, expect, test } from "bun:test";

import { ctx, fakeApi } from "../../test/fake-api.ts";
import { teamInfo } from "./team.ts";

describe("/team", () => {
  test("roster, recruiting state, showcase count, link", async () => {
    const api = fakeApi({
      getTeam: async ({ teamId }: { teamId: string }) => {
        expect(teamId).toBe("cosy-crew");
        return {
          id: "t1",
          slug: "cosy-crew",
          name: "Cosy Crew",
          tagline: "Small games, big hearts",
          bio: null,
          avatarUrl: "https://cdn/team.png",
          websiteUrl: "https://cosy.example",
          itchUrl: null,
          recruiting: true,
          members: [
            { username: "josh", role: "owner", title: null },
            { username: "ana", role: "member", title: "Art" },
          ],
          skills: [{ id: 7, name: "Unity", memberCount: 2 }],
          projects: [{}, {}, {}],
          openPosts: [{ id: 5, title: "Need a composer", type: "hobby", status: "recruiting" }],
        };
      },
    });
    const reply = await teamInfo(api, { team: "cosy-crew" }, ctx);
    const embed = reply.embeds[0]!;
    expect(embed.title).toBe("Cosy Crew");
    expect(embed.url).toBe("https://brackeys.test/teams/cosy-crew");
    expect(embed.description).toBe("*Small games, big hearts*");
    const byName = Object.fromEntries(embed.fields!.map((f) => [f.name, f.value]));
    expect(byName["Roster · 2"]).toBe("josh · owner\nana · Art");
    expect(byName.Recruiting).toBe("Yes · 1 open post");
    expect(byName.Showcase).toBe("3 projects");
    expect(byName.Stack).toBe("Unity");
    expect(byName["Open posts"]).toBe("• [Need a composer](https://brackeys.test/collab/5)");
    expect(byName.Links).toBe("[Website](https://cosy.example)");
    expect(embed.thumbnail).toBe("https://cdn/team.png");
    expect(reply.ephemeral).toBe(true);
  });

  test("site-relative avatar is absolutized against appUrl", async () => {
    const api = fakeApi({
      getTeam: async () => ({
        id: "t1",
        slug: "orange-crew",
        name: "Orange crew",
        tagline: null,
        bio: null,
        avatarUrl: "/images/team-avatars/t1/orange.png",
        websiteUrl: null,
        itchUrl: null,
        recruiting: false,
        members: [],
        skills: [],
        projects: [],
        openPosts: [],
      }),
    });
    const reply = await teamInfo(api, { team: "orange-crew" }, ctx);
    expect(reply.embeds[0]!.thumbnail).toBe(
      "https://brackeys.test/images/team-avatars/t1/orange.png",
    );
  });

  test("unknown team → not_found", async () => {
    const reply = await teamInfo(fakeApi({ getTeam: async () => null }), { team: "nope" }, ctx);
    expect(reply.outcome).toBe("not_found");
  });
});
