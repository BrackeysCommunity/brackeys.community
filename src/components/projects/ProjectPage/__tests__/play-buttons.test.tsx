// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/orpc/client", () => ({ client: {}, orpc: {} }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({
    children,
    params,
    search: _search,
    to,
    ...rest
  }: {
    children?: ReactNode;
    params?: Record<string, string>;
    search?: unknown;
    to?: string;
  }) => (
    <a {...rest} href={(to ?? "").replace(/\$(\w+)/g, (_m, key: string) => params?.[key] ?? "")}>
      {children}
    </a>
  ),
  useRouter: () => ({ invalidate: () => Promise.resolve() }),
}));

const { ProjectHero } = await import("../ProjectHero");
const { playableGame } = await import("../PlayButton");
const { ShowcaseCard } = await import("@/components/teams/TeamPage");
const { JamEntryCard } = await import("@/components/jams/JamDetailPage/JamEntryCard");
type ProjectRow = import("../types").ProjectRow;
type TeamProject = import("@/components/teams/TeamPage").TeamProject;
type JamEntryRow = import("@/components/jams/JamDetailPage/types").JamEntryRow;
type PlayableGame = import("../PlayButton").PlayableGame;

afterEach(cleanup);

const ITCH_URL = "https://someone.itch.io/lantern";

const project = {
  id: "proj-1",
  slug: "lantern",
  title: "Lantern",
  description: null,
  type: "game",
  subTypes: [],
  embedType: null,
  url: ITCH_URL,
  imageUrl: null,
  releaseStatus: "released",
  releasedAt: null,
  restrictedAt: null,
  published: true,
  links: [],
} as unknown as ProjectRow;

const playable: PlayableGame = { projectId: "lantern-game", playable: true };
const unplayable: PlayableGame = { projectId: "lantern-game", playable: false };

// The house Button keeps `role="button"` on the anchor it renders.
const buttonHref = (name: RegExp) => screen.getByRole("button", { name }).getAttribute("href");
const linkHref = (name: RegExp) => screen.getByRole("link", { name }).getAttribute("href");

function hero(game: PlayableGame | null, patch: Partial<ProjectRow> = {}) {
  render(
    <ProjectHero
      project={{ ...project, ...patch }}
      canEdit={false}
      canDelete={false}
      deleteBlockers={[]}
      game={playableGame(game)}
    />,
  );
}

describe("the project page's CTA", () => {
  it("plays in the browser when the linked game is playable, keeping the itch link beside it", () => {
    hero(playable);
    expect(buttonHref(/play in browser/i)).toBe("/games/lantern-game/play/latest");
    expect(buttonHref(/play on itch\.io/i)).toBe(ITCH_URL);
    expect(screen.getByText("someone.itch.io")).toBeTruthy();
  });

  it("keeps the itch link when the game isn't playable", () => {
    hero(unplayable);
    expect(screen.queryByRole("button", { name: /play in browser/i })).toBeNull();
    expect(buttonHref(/play on itch\.io/i)).toBe(ITCH_URL);
  });

  it("keeps the itch link with no linked game", () => {
    hero(null);
    expect(screen.queryByRole("button", { name: /play in browser/i })).toBeNull();
    expect(buttonHref(/play on itch\.io/i)).toBe(ITCH_URL);
  });

  it("still plays a playable game whose itch page is restricted", () => {
    hero(playable, { restrictedAt: new Date("2026-11-01T00:00:00.000Z") });
    expect(buttonHref(/play in browser/i)).toBe("/games/lantern-game/play/latest");
    expect(screen.queryByText(/no longer public on itch/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /itch/i })).toBeNull();
  });
});

const placement = {
  id: "proj-1",
  title: "Lantern",
  description: null,
  url: ITCH_URL,
  imageUrl: null,
  pinned: false,
  jamId: null,
  jamName: null,
  jamUrl: null,
  jamSlug: null,
  projectSlug: "lantern",
  submissionUrl: null,
  result: null,
  participatedAt: null,
  addedBy: null,
} satisfies TeamProject;

describe("the team page's showcase cards", () => {
  it("shows Play beside the tile when the placement's game is playable", () => {
    render(<ShowcaseCard project={{ ...placement, game: playable }} />);
    expect(buttonHref(/^play$/i)).toBe("/games/lantern-game/play/latest");
    expect(linkHref(/^lantern$/i)).toBe("/projects/lantern");
  });

  it.each([
    ["isn't playable", unplayable],
    ["has no game", null],
  ])("shows no Play when the placement %s", (_label, game) => {
    render(<ShowcaseCard project={{ ...placement, game }} />);
    expect(screen.queryByRole("button", { name: /^play$/i })).toBeNull();
    expect(linkHref(/^lantern$/i)).toBe("/projects/lantern");
  });
});

const entry = {
  gameId: 42,
  gameTitle: "Lantern",
  gameCoverUrl: null,
  gameCoverColor: null,
  gamePlatforms: [],
  authorName: "someone",
  rank: null,
  ratingCount: 0,
  members: [],
} as unknown as JamEntryRow;

const PLAY_ON = /play on jams\.team/i;

describe("the jam page's entry cards", () => {
  it("plays this jam's pinned version", () => {
    render(<JamEntryCard entry={{ ...entry, game: { ...playable, jamVersion: 3 } }} jamId={7} />);
    expect(buttonHref(PLAY_ON)).toBe("/games/lantern-game/play/3");
  });

  it("plays the pinned version when the live release isn't playable", () => {
    render(<JamEntryCard entry={{ ...entry, game: { ...unplayable, jamVersion: 2 } }} jamId={7} />);
    expect(buttonHref(PLAY_ON)).toBe("/games/lantern-game/play/2");
  });

  it("plays the live release when no version is pinned to this jam", () => {
    render(<JamEntryCard entry={{ ...entry, game: playable }} jamId={7} />);
    expect(buttonHref(PLAY_ON)).toBe("/games/lantern-game/play/latest");
  });

  it("sits beside the member chips, outside the card's own link", () => {
    const members = [
      {
        profileId: "u1",
        urlStub: "someone",
        username: "someone",
        avatarUrl: null,
        guildAvatarUrl: null,
      },
    ];
    render(
      <JamEntryCard
        entry={{ ...entry, members, game: playable } as typeof entry}
        jamId={7}
        projectSlug="lantern"
      />,
    );
    const play = screen.getByRole("button", { name: PLAY_ON });
    expect(play.closest("a")).toBe(play);
    expect(play.parentElement?.closest("a")).toBeNull();
  });

  it.each([
    ["isn't playable", unplayable],
    ["has no game", null],
  ])("shows no play button when the entry %s", (_label, game) => {
    render(<JamEntryCard entry={{ ...entry, game }} jamId={7} />);
    expect(screen.queryByRole("button", { name: PLAY_ON })).toBeNull();
  });
});
