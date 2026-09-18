import { describe, expect, it, vi } from "vite-plus/test";

import { componentEmbed } from "@/lib/discord-embed";
import {
  collabLinkPreview,
  type CollabPreviewSource,
  jamLinkPreview,
  type JamPreviewSource,
} from "@/lib/discord-link-preview";

const ORIGIN = "https://brackeys.community";

vi.mock("@/env", () => ({
  env: { VITE_CF_IMAGES: "1" },
  siteOrigin: () => ORIGIN,
  siteUrl: (path: string) =>
    /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//") ? path : `${ORIGIN}${path}`,
}));

const NOW = new Date("2026-09-17T12:00:00Z");

function jam(overrides: Partial<JamPreviewSource> = {}): JamPreviewSource {
  return {
    slug: "brackeys-game-jam-2026-1",
    title: "Brackeys Game Jam 2026.1",
    bannerUrl: "https://img.itch.zone/aW1nLzI5MTE1MDQwLnBuZw==/original/8ZTMSe.png",
    themeColor: "#222034",
    startsAt: "2026-09-14T19:00:00Z",
    endsAt: "2026-09-21T19:00:00Z",
    votingEndsAt: "2026-09-28T19:00:00Z",
    hosts: [{ name: "Brackeys" }],
    ...overrides,
  };
}

function post(overrides: Partial<CollabPreviewSource> = {}): CollabPreviewSource {
  return {
    id: 412,
    title: "Pixel artist for a co-op roguelite",
    status: "recruiting",
    type: "paid",
    compensationType: "hourly",
    compensationMin: 25,
    compensationMax: 50,
    currency: "USD",
    responseCount: 6,
    roles: [{ name: "2D Artist" }, { name: "Animator" }],
    images: [{ url: "/images/collab/412-a.png", alt: "Early combat mockup" }],
    jam: { jamId: 991, title: "Brackeys Game Jam 2026.1", slug: "brackeys-game-jam-2026-1" },
    team: null,
    project: null,
    author: { id: "usr_9", urlStub: "mellobacon" },
    ...overrides,
  };
}

const AUTHOR = {
  authorName: "mellobacon",
  authorAvatarUrl: "https://cdn.discordapp.com/avatars/1/2.png",
  description: "Six-week build, combat is in, looking for someone to own the character art.",
};

describe("jamLinkPreview", () => {
  it("leads with a linked heading, the phase and the window", () => {
    const [text] = jamLinkPreview(jam(), 1893, NOW)!.components;
    expect(text).toMatchObject({
      type: 9,
      components: [
        {
          type: 10,
          content:
            `## [Brackeys Game Jam 2026.1](${ORIGIN}/jams/brackeys-game-jam-2026-1)\n` +
            "**LIVE** · 14 Sept 2026 – 21 Sept 2026\n" +
            "Hosted by Brackeys · 1,893 submissions tracked here",
        },
      ],
    });
  });

  it("names the phase the dates imply, not the scraped status column", () => {
    const voting = jamLinkPreview(jam(), 0, new Date("2026-09-24T12:00:00Z"))!;
    const ended = jamLinkPreview(jam(), 0, new Date("2026-10-24T12:00:00Z"))!;
    expect(JSON.stringify(voting)).toContain("**VOTING**");
    expect(JSON.stringify(ended)).toContain("**CLOSED**");
  });

  it("takes its accent from the jam's own theme color", () => {
    expect(jamLinkPreview(jam(), 0, NOW)?.accent_color).toBe(0x222034);
    expect(jamLinkPreview(jam({ themeColor: null }), 0, NOW)?.accent_color).toBe(0xffa949);
    // Scraped junk falls back rather than poisoning the payload.
    expect(jamLinkPreview(jam({ themeColor: "url(evil)" }), 0, NOW)?.accent_color).toBe(0xffa949);
  });

  it("serves the banner from our own origin", () => {
    const [section] = jamLinkPreview(jam(), 0, NOW)!.components;
    const accessory = section?.type === 9 ? section.accessory : null;
    expect(accessory).toMatchObject({ type: 11 });
    expect(accessory && "media" in accessory ? accessory.media.url : "").toContain(
      `${ORIGIN}/cdn-cgi/image/`,
    );
  });

  it("drops the thumbnail, not the layout, for a jam with no banner", () => {
    const [text] = jamLinkPreview(jam({ bannerUrl: null }), 0, NOW)!.components;
    expect(text?.type).toBe(10);
  });

  it("offers both destinations", () => {
    const row = jamLinkPreview(jam(), 0, NOW)!.components.at(-1);
    expect(row?.type === 1 ? row.components.map((b) => [b.label, b.url]) : []).toEqual([
      ["Open on Brackeys", `${ORIGIN}/jams/brackeys-game-jam-2026-1`],
      ["View on itch.io", "https://itch.io/jam/brackeys-game-jam-2026-1"],
    ]);
  });

  it("fits the payload budget", () => {
    expect(componentEmbed(jamLinkPreview(jam(), 1893, NOW))).toHaveLength(1);
  });
});

describe("collabLinkPreview", () => {
  it("reads like the feed mirror — looking for, terms, byline", () => {
    const [section] = collabLinkPreview(post(), AUTHOR)!.components;
    expect(section?.type === 9 ? section.components[0]?.content : "").toBe(
      `## [Pixel artist for a co-op roguelite](${ORIGIN}/collab/412)\n` +
        "**Looking for** 2D Artist · Animator\n" +
        `$25 - $50 /hr · [Brackeys Game Jam 2026.1](${ORIGIN}/jams/brackeys-game-jam-2026-1) · 6 applied\n` +
        `Posted by [mellobacon](${ORIGIN}/profile/mellobacon)`,
    );
  });

  it("goes grey and stops saying apply once the post closes", () => {
    const closed = collabLinkPreview(post({ status: "expired" }), AUTHOR)!;
    expect(closed.accent_color).toBe(0x4b5563);
    expect(JSON.stringify(closed)).toContain("No longer recruiting");
    const row = closed.components.at(-1);
    expect(row?.type === 1 ? row.components[0]?.label : "").toBe("View the post");
  });

  it("bylines the team, not whoever pressed the button", () => {
    const teamPost = collabLinkPreview(
      post({ team: { id: "t_1", name: "Night Shift", slug: "night-shift", avatarUrl: null } }),
      AUTHOR,
    )!;
    expect(JSON.stringify(teamPost)).toContain(
      `Posted by [Night Shift](${ORIGIN}/teams/night-shift)`,
    );
  });

  it("makes stored image paths absolute", () => {
    const gallery = collabLinkPreview(post(), AUTHOR)!.components.find((c) => c.type === 12);
    expect(gallery?.type === 12 ? gallery.items[0]?.media.url : "").toBe(
      `${ORIGIN}/images/collab/412-a.png`,
    );
  });

  it("neutralizes markdown in a title the author wrote", () => {
    const shouty = collabLinkPreview(post({ title: "**FREE** _work_ [urgent]" }), AUTHOR)!;
    expect(JSON.stringify(shouty)).toContain("\\\\*\\\\*FREE\\\\*\\\\* \\\\_work\\\\_ urgent");
  });

  it("fits the payload budget with a full gallery", () => {
    const busy = post({
      images: Array.from({ length: 4 }, (_, i) => ({
        url: `/images/collab/412-${i}.png`,
        alt: "A screenshot of the prototype",
      })),
    });
    expect(componentEmbed(collabLinkPreview(busy, AUTHOR))).toHaveLength(1);
  });
});
