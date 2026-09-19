import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  buildCollabFeedMessage,
  clearFeedRefusal,
  collabFeedEnabled,
  collabFeedRefused,
  DiscordFeedError,
  editCollabFeedMessage,
  noteFeedRefused,
  postCollabFeedMessage,
  type CollabFeedPost,
} from "@/lib/collab-discord-feed";

/** Status the next Discord write answers with. */
let nextStatus = 200;
vi.mock("@/lib/discord", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/discord")>()),
  discordWriteFetch: async () =>
    new Response(nextStatus === 200 ? JSON.stringify({ id: "message-1" }) : "{}", {
      status: nextStatus,
    }),
}));

function feedPost(overrides: Partial<CollabFeedPost> = {}): CollabFeedPost {
  return {
    id: 42,
    title: "Pixel artist for a PSX horror RPG",
    description: "A short atmospheric horror RPG in the PSX style.",
    type: "hobby",
    status: "recruiting",
    compensationType: null,
    compensationMin: null,
    compensationMax: null,
    currency: "USD",
    projectName: "Cathedral of Wires",
    createdAt: new Date("2026-09-01T10:00:00Z"),
    expiresAt: new Date("2026-10-15T10:00:00Z"),
    roles: ["Artist"],
    skills: ["Blender", "Aseprite"],
    jam: null,
    team: null,
    author: { name: "ada", avatarUrl: null, profilePath: "/profile/ada" },
    imageUrl: null,
    ...overrides,
  };
}

describe("buildCollabFeedMessage", () => {
  it("links the embed title home and keeps the author's byline", () => {
    const [embed] = buildCollabFeedMessage(feedPost()).embeds;
    expect(embed.title).toBe("Pixel artist for a PSX horror RPG");
    expect(embed.url).toMatch(/\/collab\/42$/);
    expect(embed.author?.name).toBe("ada");
    expect(embed.author?.url).toMatch(/\/profile\/ada$/);
  });

  it("bylines a team post to the team page, not to whoever pressed the button", () => {
    const [embed] = buildCollabFeedMessage(
      feedPost({
        team: { id: "team-1", name: "Wirecraft", slug: "wirecraft", avatarUrl: null },
      }),
    ).embeds;
    expect(embed.author?.name).toBe("Wirecraft");
    expect(embed.author?.url).toMatch(/\/teams\/wirecraft$/);
  });

  it("never lets a post body mention anyone", () => {
    const payload = buildCollabFeedMessage(feedPost({ description: "@everyone please apply" }));
    expect(payload.allowed_mentions).toEqual({ parse: [] });
  });

  it("truncates a body past Discord's budget instead of being rejected", () => {
    const [embed] = buildCollabFeedMessage(feedPost({ description: "x".repeat(2000) })).embeds;
    expect(embed.description.length).toBeLessThanOrEqual(480);
    expect(embed.description.endsWith("…")).toBe(true);
  });

  it("renders the rate when the post has one, and the type when it doesn't", () => {
    const paid = buildCollabFeedMessage(
      feedPost({
        type: "paid",
        compensationType: "hourly",
        compensationMin: 25,
        compensationMax: 50,
      }),
    ).embeds[0];
    expect(paid.fields.find((f) => f.name === "Terms")?.value).toContain("25");

    const hobby = buildCollabFeedMessage(feedPost()).embeds[0];
    expect(hobby.fields.find((f) => f.name === "Terms")?.value).toBe("Hobby / unpaid");
  });

  it("carries the jam as a link when the post names one", () => {
    const [embed] = buildCollabFeedMessage(
      feedPost({ jam: { jamId: 7, title: "Brackeys Jam 2026.2", slug: "brackeys-jam-2026-2" } }),
    ).embeds;
    const jam = embed.fields.find((f) => f.name === "Jam");
    expect(jam?.value).toContain("Brackeys Jam 2026.2");
    expect(jam?.value).toContain("/jams/brackeys-jam-2026-2");
  });

  it("dates the closing line with a Discord timestamp, so the message ages itself", () => {
    const [embed] = buildCollabFeedMessage(feedPost()).embeds;
    expect(embed.fields.find((f) => f.name === "Closes")?.value).toBe("<t:1792058400:R>");
  });

  it("absolutizes a stored image path — a relative one fails the whole message", () => {
    const [embed] = buildCollabFeedMessage(
      feedPost({ imageUrl: "/images/collab/42/a.png" }),
    ).embeds;
    expect(embed.thumbnail?.url).toMatch(/^https?:\/\/.+\/images\/collab\/42\/a\.png$/);
  });

  it("absolutizes the byline avatar too, team or person", () => {
    const team = buildCollabFeedMessage(
      feedPost({
        team: { id: "t", name: "Wirecraft", slug: "wirecraft", avatarUrl: "/images/team/w.png" },
      }),
    ).embeds[0];
    expect(team.author?.icon_url).toMatch(/^https?:\/\/.+\/images\/team\/w\.png$/);

    const cdn = buildCollabFeedMessage(
      feedPost({
        author: {
          name: "ada",
          avatarUrl: "https://cdn.discordapp.com/avatars/1/a.png",
          profilePath: "/profile/ada",
        },
      }),
    ).embeds[0];
    expect(cdn.author?.icon_url).toBe("https://cdn.discordapp.com/avatars/1/a.png");
  });

  it("drops an image URL it can't make sense of rather than losing the message", () => {
    const [embed] = buildCollabFeedMessage(
      feedPost({ imageUrl: "data:image/png;base64,AAAA" }),
    ).embeds;
    expect(embed.thumbnail).toBeUndefined();
  });

  it("puts an apply button under the embed, pointing at the post", () => {
    const [row] = buildCollabFeedMessage(feedPost()).components;
    expect(row.type).toBe(1);
    const [apply] = row.components;
    expect(apply).toMatchObject({ type: 2, style: 5, label: "Apply on Brackeys" });
    expect(apply.url).toMatch(/\/collab\/42$/);
  });

  it("offers the jam alongside it only when the post names one", () => {
    const plain = buildCollabFeedMessage(feedPost()).components[0].components;
    expect(plain.map((b) => b.label)).toEqual(["Apply on Brackeys", "All open posts"]);

    const withJam = buildCollabFeedMessage(
      feedPost({ jam: { jamId: 7, title: "Brackeys Game Jam 2026.2", slug: "bjam" } }),
    ).components[0].components;
    expect(withJam.map((b) => b.label)).toEqual([
      "Apply on Brackeys",
      "Jam: Brackeys Game Jam 2026.2",
      "All open posts",
    ]);
    expect(withJam[1].url).toMatch(/\/jams\/bjam$/);
  });

  it("stops a closed post's button from saying apply", () => {
    const [row] = buildCollabFeedMessage(feedPost({ status: "party_full" })).components;
    expect(row.components[0].label).toBe("View the post");
  });

  it("keeps every button inside Discord's limits", () => {
    const [row] = buildCollabFeedMessage(
      feedPost({ jam: { jamId: 7, title: "J".repeat(200), slug: "long" } }),
    ).components;
    expect(row.components.length).toBeLessThanOrEqual(5);
    for (const button of row.components) {
      expect(button.label.length).toBeLessThanOrEqual(80);
      // Discord validates button URLs as http(s) — an app link is refused.
      expect(button.url).toMatch(/^https?:\/\//);
    }
  });

  it("greys a closed post and says so, so a stale message can't recruit", () => {
    const [embed] = buildCollabFeedMessage(feedPost({ status: "party_full" })).embeds;
    expect(embed.color).toBe(0x4b5563);
    expect(embed.fields.find((f) => f.name === "Status")?.value).toBe("No longer recruiting");
  });
});

describe("a refused mirror", () => {
  const config = { channelId: "9001", guildId: "7", botToken: "bot-token" };
  const payload = buildCollabFeedMessage(feedPost());

  beforeEach(() => {
    nextStatus = 200;
    clearFeedRefusal();
    process.env.DISCORD_COLLAB_CHANNEL_ID = "9001";
    process.env.DISCORD_GUILD_ID = "7";
    process.env.DISCORD_BOT_TOKEN = "bot-token";
  });

  it("hides the feed after a 403 and shows it again once a post lands", async () => {
    nextStatus = 403;
    await expect(postCollabFeedMessage(config, payload)).rejects.toBeInstanceOf(DiscordFeedError);
    expect(collabFeedRefused()).toBe(true);
    expect(collabFeedEnabled()).toBe(false);

    nextStatus = 200;
    await postCollabFeedMessage(config, payload);
    expect(collabFeedRefused()).toBe(false);
    expect(collabFeedEnabled()).toBe(true);
  });

  it("clears on a successful edit too", async () => {
    noteFeedRefused();
    await editCollabFeedMessage(config, "9001", "message-1", payload);
    expect(collabFeedRefused()).toBe(false);
  });

  it("forgets the refusal once the window has passed, so a grant needs no deploy", () => {
    noteFeedRefused(1_000);
    expect(collabFeedRefused(1_000 + 14 * 60_000)).toBe(true);
    expect(collabFeedRefused(1_000 + 16 * 60_000)).toBe(false);
  });

  it("keeps the feed for failures that aren't about permission", async () => {
    nextStatus = 500;
    await expect(postCollabFeedMessage(config, payload)).rejects.toBeInstanceOf(DiscordFeedError);
    expect(collabFeedRefused()).toBe(false);
  });
});
