import { describe, expect, it, vi } from "vite-plus/test";

import { componentEmbed } from "@/lib/discord-embed";
import {
  collabLinkPreview,
  type CollabPreviewSource,
  homeLinkPreview,
  jamLinkPreview,
  type JamPreviewSource,
  profileLinkPreview,
  type ProfilePreviewSource,
  teamLinkPreview,
  type TeamPreviewSource,
} from "@/lib/discord-link-preview";

const ORIGIN = "https://brackeys.community";

vi.mock("@/env", () => ({
  env: { VITE_CF_IMAGES: "1" },
  siteOrigin: () => ORIGIN,
  siteUrl: (path: string) =>
    /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//") ? path : `${ORIGIN}${path}`,
}));

function jam(overrides: Partial<JamPreviewSource> = {}): JamPreviewSource {
  return {
    slug: "brackeys-game-jam-2026-1",
    title: "Brackeys Game Jam 2026.1",
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
    images: [{ url: "/images/collab/412-a.png", alt: "Early combat mockup" }],
    jam: { jamId: 991, title: "Brackeys Game Jam 2026.1", slug: "brackeys-game-jam-2026-1" },
    team: null,
    author: { id: "usr_9", urlStub: "mellobacon" },
    ...overrides,
  };
}

const AUTHOR = { authorName: "mellobacon" };

describe("jamLinkPreview", () => {
  it("leads with a linked title and nothing the card already prints", () => {
    const [heading] = jamLinkPreview(jam())!.components;
    expect(heading).toEqual({
      type: 10,
      content: `## [Brackeys Game Jam 2026.1](${ORIGIN}/jams/brackeys-game-jam-2026-1)`,
    });
  });

  it("shows our own generated card, full width", () => {
    const gallery = jamLinkPreview(jam())!.components.find((component) => component.type === 12);
    expect(gallery?.type === 12 ? gallery.items : []).toEqual([
      {
        media: { url: `${ORIGIN}/og/jam/brackeys-game-jam-2026-1.png?v=2&embed` },
        description: "Brackeys Game Jam 2026.1",
      },
    ]);
  });

  it("uses the blurple accent", () => {
    expect(jamLinkPreview(jam())?.accent_color).toBe(0x5865f2);
  });

  it("carries the host blurb, the one thing the card leaves out", () => {
    const withBlurb = jamLinkPreview(jam(), { blurb: "One week to make a game!" })!;
    expect(withBlurb.components[1]).toEqual({ type: 10, content: "One week to make a game!" });
    // And skips the line entirely for a jam whose page has no body.
    expect(jamLinkPreview(jam())!.components[1]?.type).toBe(12);
  });

  it("offers both destinations", () => {
    const row = jamLinkPreview(jam())!.components.at(-1);
    expect(row?.type === 1 ? row.components.map((b) => [b.label, b.url]) : []).toEqual([
      ["Open on Brackeys", `${ORIGIN}/jams/brackeys-game-jam-2026-1`],
      ["View on itch.io", "https://itch.io/jam/brackeys-game-jam-2026-1"],
    ]);
  });

  it("fits the payload budget", () => {
    expect(componentEmbed(jamLinkPreview(jam(), { blurb: "x".repeat(180) }))).toHaveLength(1);
  });
});

describe("collabLinkPreview", () => {
  it("states the terms the card only summarizes as Paid or Hobby", () => {
    const [heading] = collabLinkPreview(post(), AUTHOR)!.components;
    expect(heading).toEqual({
      type: 10,
      content:
        `## [Pixel artist for a co-op roguelite](${ORIGIN}/collab/412)\n` +
        `$25 - $50 /hr · [Brackeys Game Jam 2026.1](${ORIGIN}/jams/brackeys-game-jam-2026-1)`,
    });
  });

  it("leads the gallery with the card and skips the shot the card already used", () => {
    const withShots = collabLinkPreview(
      post({
        images: [
          { url: "/images/collab/412-a.png", alt: "On the card" },
          { url: "/images/collab/412-b.png", alt: "Tileset" },
        ],
      }),
      AUTHOR,
    )!;
    const gallery = withShots.components.find((component) => component.type === 12);
    expect(gallery?.type === 12 ? gallery.items.map((item) => item.description) : []).toEqual([
      "Pixel artist for a co-op roguelite",
      "Tileset",
    ]);
    expect(gallery?.type === 12 ? gallery.items[0]!.media.url : "").toBe(
      `${ORIGIN}/og/collab/412.png?v=2&embed`,
    );
  });

  it("stops saying apply once the post closes", () => {
    const closed = collabLinkPreview(post({ status: "expired" }), AUTHOR)!;
    expect(JSON.stringify(closed)).toContain("No longer recruiting");
    const row = closed.components.at(-1);
    expect(row?.type === 1 ? row.components[0]?.label : "").toBe("View the post");
  });

  it("puts a linked byline and the application count in the footer subtext", () => {
    expect(JSON.stringify(collabLinkPreview(post(), AUTHOR))).toContain(
      `-# Posted by [mellobacon](${ORIGIN}/profile/mellobacon) · 6 applied`,
    );
  });

  it("bylines the team, not whoever pressed the button", () => {
    const teamPost = collabLinkPreview(
      post({ team: { id: "t_1", name: "Night Shift", slug: "night-shift" } }),
      AUTHOR,
    )!;
    expect(JSON.stringify(teamPost)).toContain(
      `Posted by [Night Shift](${ORIGIN}/teams/night-shift)`,
    );
  });

  it("neutralizes markdown in a title the author wrote", () => {
    const shouty = collabLinkPreview(post({ title: "**FREE** _work_ [urgent]" }), AUTHOR)!;
    expect(JSON.stringify(shouty)).toContain("\\\\*\\\\*FREE\\\\*\\\\* \\\\_work\\\\_ urgent");
  });

  it("fits the payload budget with a full gallery", () => {
    const busy = post({
      images: Array.from({ length: 6 }, (_, i) => ({
        url: `/images/collab/412-${i}.png`,
        alt: "A screenshot of the prototype",
      })),
    });
    expect(componentEmbed(collabLinkPreview(busy, AUTHOR))).toHaveLength(1);
  });
});

function buttonsOf(root: ReturnType<typeof homeLinkPreview>) {
  const row = root!.components.find((component) => component.type === 1);
  return row?.type === 1 ? row.components.map(({ label, url }) => ({ label, url })) : [];
}

function galleryOf(root: ReturnType<typeof homeLinkPreview>) {
  const gallery = root!.components.find((component) => component.type === 12);
  return gallery?.type === 12 ? gallery.items.map((item) => item.media.url) : [];
}

describe("homeLinkPreview", () => {
  it("shows the home card and a button for each main board", () => {
    const root = homeLinkPreview();
    expect(galleryOf(root)).toEqual([`${ORIGIN}/og/default.png?v=2&embed`]);
    expect(root!.accent_color).toBe(0x5865f2);
    expect(buttonsOf(root).map((button) => button.url)).toEqual([
      `${ORIGIN}/jams`,
      `${ORIGIN}/collab`,
      `${ORIGIN}/members`,
    ]);
    expect(componentEmbed(root)).toHaveLength(1);
  });
});

function member(overrides: Partial<ProfilePreviewSource> = {}): ProfilePreviewSource {
  return {
    id: "usr_9",
    urlStub: "mellobacon",
    availableForWork: true,
    ...overrides,
  };
}

describe("profileLinkPreview", () => {
  const extras = { name: "mellobacon", skills: ["Godot", "FMOD", "Aseprite"] };

  it("leads with the linked name, work status and stack", () => {
    const [heading] = profileLinkPreview(member(), extras)!.components;
    expect(heading).toEqual({
      type: 10,
      content: `## [mellobacon](${ORIGIN}/profile/mellobacon)\n**Open to work** · Works in Godot, FMOD, Aseprite`,
    });
  });

  it("shows their card, and GitHub only when the account is linked", () => {
    const root = profileLinkPreview(member(), extras);
    expect(galleryOf(root)).toEqual([`${ORIGIN}/og/profile/mellobacon.png?v=2&embed`]);
    expect(buttonsOf(root).map((button) => button.label)).toEqual(["View profile", "All members"]);

    const linked = profileLinkPreview(member(), { ...extras, githubUsername: "mellobacon" });
    expect(buttonsOf(linked)).toEqual([
      { label: "View profile", url: `${ORIGIN}/profile/mellobacon` },
      { label: "GitHub", url: "https://github.com/mellobacon" },
      { label: "All members", url: `${ORIGIN}/members` },
    ]);
  });

  it("never turns a username into anything but a github.com profile", () => {
    const root = profileLinkPreview(member(), {
      ...extras,
      githubUsername: "evil.example/../phish",
    });
    expect(buttonsOf(root).map((button) => button.label)).not.toContain("GitHub");
  });

  it("falls back to the id when no handle is claimed", () => {
    const root = profileLinkPreview(member({ urlStub: null, availableForWork: false }), {
      name: "A Brackeys member",
      skills: [],
    });
    expect(root!.components[0]).toEqual({
      type: 10,
      content: `## [A Brackeys member](${ORIGIN}/profile/usr_9)`,
    });
    expect(root!.accent_color).toBe(0x5865f2);
  });
});

function crew(overrides: Partial<TeamPreviewSource> = {}): TeamPreviewSource {
  return {
    id: "team_1",
    slug: "salty-sweet",
    name: "Salty Sweet",
    recruiting: true,
    ...overrides,
  };
}

describe("teamLinkPreview", () => {
  it("says it's recruiting and points at the open roles", () => {
    const root = teamLinkPreview(crew(), { skills: ["Unity"] });
    expect(root!.components[0]).toEqual({
      type: 10,
      content: `## [Salty Sweet](${ORIGIN}/teams/salty-sweet)\n**Recruiting** · Works in Unity`,
    });
    expect(galleryOf(root)).toEqual([`${ORIGIN}/og/team/salty-sweet.png?v=2&embed`]);
    expect(buttonsOf(root).map((button) => button.label)).toEqual([
      "View team and open roles",
      "All teams",
    ]);
    expect(root!.accent_color).toBe(0x5865f2);
  });

  it("goes quiet when it isn't", () => {
    const root = teamLinkPreview(crew({ recruiting: false }), { skills: [] });
    expect(buttonsOf(root)[0]?.label).toBe("View team");
  });

  it("stays inside the payload budget with a long name and a long stack", () => {
    const root = teamLinkPreview(crew({ name: "Ｘ".repeat(100) }), {
      skills: Array.from({ length: 20 }, (_, i) => `Skill number ${i}`),
    });
    expect(componentEmbed(root)).toHaveLength(1);
  });
});
