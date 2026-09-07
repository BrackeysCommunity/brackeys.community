import { describe, expect, test } from "bun:test";

import { ctx, fakeApi } from "../../test/fake-api.ts";
import { PROFILE_CONTEXT_MENU, runInvocation } from "./dispatch.ts";
import { memberByDiscordId, memberByName } from "./member.ts";

const profileResult = {
  profile: {
    id: "u1",
    discordId: "200000000000000001",
    discordUsername: "joshe",
    guildNickname: "Josh",
    avatarUrl: "https://cdn/avatar.png",
    tagline: "Makes small games",
    bio: "Hello.",
    githubUrl: "https://github.com/joshe",
    twitterUrl: null,
    websiteUrl: null,
    availableForWork: true,
    availability: "part-time",
    rateType: "hourly",
    rateMin: 40,
    rateMax: null,
    timezone: "Europe/Madrid",
    location: "Lisbon-ish",
  },
  skills: [{ id: 7, name: "Unity" }],
  roles: [{ id: 3, name: "Composer" }],
  projects: [{}, {}],
  credits: [{}],
  urlStub: "josh",
  linkedAccounts: [],
  wallNotesCount: 0,
  collabsCount: 5,
};

const teams = [{ id: "t1", slug: "cosy-crew", name: "Cosy Crew", avatarUrl: null, role: "owner" }];

describe("/member", () => {
  test("a mention of someone with no site account answers ephemerally with the sign-in link", async () => {
    const api = fakeApi({ getProfileByDiscordId: async () => null });
    const reply = await memberByDiscordId(api, { discordId: "200000000000000009" }, ctx);
    expect(reply.outcome).toBe("not_found");
    expect(reply.ephemeral).toBe(true);
    expect(reply.content).toContain("isn't on brackeys.dev yet");
    expect(reply.content).toContain("https://brackeys.test");
    expect(reply.embeds).toEqual([]);
  });

  test("renders the profile with roles, skills, availability, shipped count, teams", async () => {
    const api = fakeApi({
      getProfileByDiscordId: async ({ discordId }: { discordId: string }) => {
        expect(discordId).toBe("200000000000000001");
        return profileResult;
      },
      listUserTeams: async () => teams,
    });
    const reply = await memberByDiscordId(api, { discordId: "200000000000000001" }, ctx);
    const embed = reply.embeds[0]!;
    expect(embed.author).toEqual({
      name: "Josh",
      url: "https://brackeys.test/profile/josh",
      iconUrl: "https://cdn/avatar.png",
    });
    expect(embed.title).toBe("Makes small games");
    expect(embed.thumbnail).toBe("https://cdn/avatar.png");
    const byName = Object.fromEntries(embed.fields!.map((f) => [f.name, f.value]));
    expect(byName.Roles).toBe("Composer");
    expect(byName.Skills).toBe("Unity");
    expect(byName.Availability).toBe("Open to work · part-time · $40+ /hr");
    expect(byName.Where).toBe("Lisbon-ish · Europe/Madrid");
    expect(byName.Shipped).toBe("3 projects");
    expect(byName.Teams).toBe("[Cosy Crew](https://brackeys.test/teams/cosy-crew)");
    expect(byName.Links).toBe("[GitHub](https://github.com/joshe)");
    expect(reply.buttons).toEqual([
      { kind: "link", label: "Open profile", url: "https://brackeys.test/profile/josh" },
    ]);
  });

  test("the context-menu command and the slash command render byte-identical embeds", async () => {
    const api = fakeApi({
      getProfileByDiscordId: async () => profileResult,
      listUserTeams: async () => teams,
    });
    const slash = await runInvocation(
      api,
      { command: "member", options: {}, targetUserId: "200000000000000001" },
      ctx,
    );
    const menu = await runInvocation(
      api,
      { command: PROFILE_CONTEXT_MENU, options: {}, targetUserId: "200000000000000001" },
      ctx,
    );
    expect(JSON.stringify(menu.embeds)).toBe(JSON.stringify(slash.embeds));
    expect(menu.ephemeral).toBe(true);
  });

  test("by name: an exact match wins, several partials ask which", async () => {
    const members = [
      { id: "u1", guildNickname: "Josh", discordUsername: "joshe", urlStub: "josh" },
      { id: "u2", guildNickname: "Joshua", discordUsername: "joshua", urlStub: null },
    ];
    const api = fakeApi({
      listMembers: async ({ search }: { search: string }) => ({
        members: members.filter((m) =>
          m.guildNickname.toLowerCase().includes(search.toLowerCase()),
        ),
        total: 2,
      }),
      getProfile: async ({ userId }: { userId: string }) =>
        userId === "u1" ? profileResult : null,
      listUserTeams: async () => [],
    });
    const exact = await memberByName(api, { name: "josh" }, ctx);
    expect(exact.embeds[0]?.author?.name).toBe("Josh");

    const ambiguous = await memberByName(api, { name: "jos" }, ctx);
    expect(ambiguous.embeds).toEqual([]);
    expect(ambiguous.content).toContain("did you mean");
    expect(ambiguous.content).toContain("[Joshua](https://brackeys.test/profile/u2)");

    const none = await memberByName(api, { name: "zed" }, ctx);
    expect(none.outcome).toBe("not_found");
  });

  test("a mention and a name together is refused", async () => {
    const reply = await runInvocation(
      fakeApi({}),
      { command: "member", options: { name: "x" }, targetUserId: "1" },
      ctx,
    );
    expect(reply.content).toContain("Pick one");
  });
});
