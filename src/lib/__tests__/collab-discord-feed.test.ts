import { describe, expect, it } from "vite-plus/test";

import { buildCollabFeedMessage, type CollabFeedPost } from "@/lib/collab-discord-feed";

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

  it("greys a closed post and says so, so a stale message can't recruit", () => {
    const [embed] = buildCollabFeedMessage(feedPost({ status: "party_full" })).embeds;
    expect(embed.color).toBe(0x4b5563);
    expect(embed.fields.find((f) => f.name === "Status")?.value).toBe("No longer recruiting");
  });
});
