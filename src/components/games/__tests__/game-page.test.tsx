// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const calls = vi.hoisted(() => ({
  getGamePage: vi.fn(),
  promoteRelease: vi.fn(),
  rollbackRelease: vi.fn(),
  linkReleaseJam: vi.fn(),
  reportGame: vi.fn(),
  listJams: vi.fn(),
}));
const gate = vi.hoisted(() => ({ flagBlocks: false, allowed: true }));

vi.mock("@/orpc/client", () => {
  const fn = (name: string) => (calls as Record<string, (input: unknown) => unknown>)[name];
  return {
    client: new Proxy({}, { get: (_t, name: string) => (input: unknown) => fn(name)?.(input) }),
    orpc: new Proxy(
      {},
      {
        get: (_t, name: string) => ({
          // oxlint-disable-next-line eslint-tanstack-query/exhaustive-deps -- a stand-in for the oRPC utils
          queryOptions: ({ input }: { input: unknown }) => ({
            queryKey: [name, input],
            queryFn: () => fn(name)?.(input),
          }),
        }),
      },
    ),
  };
});
vi.mock("@/lib/hooks/use-flag", () => ({
  useFlag: () => !gate.flagBlocks,
  useFlagBlocks: (key: string) => key === "engine-games-enabled" && gate.flagBlocks,
}));
vi.mock("@/components/layout/NotFoundPage", () => ({
  NotFoundPage: () => <p>Not found</p>,
}));
vi.mock("@/lib/engine/guard", () => ({ engineGamesAllowed: () => gate.allowed }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({
    children,
    params,
    to,
    ...rest
  }: {
    children?: ReactNode;
    params?: Record<string, string>;
    to?: string;
  }) => (
    <a {...rest} href={(to ?? "").replace(/\$(\w+)/g, (_m, key: string) => params?.[key] ?? "")}>
      {children}
    </a>
  ),
}));

const { GamePage, missingLicencesLine } = await import("../GamePage");
type GamePageView = import("../GamePage").GamePageView;
const { releaseDate, versionLine } = await import("../VersionList");
const { embedSnippet } = await import("../EmbedSnippet");
const { gamePageHead } = await import("@/routes/games.$projectId");

const MB = 1024 * 1024;

type Version = GamePageView["versions"][number];

function version(patch: Partial<Version> & Pick<Version, "version">): Version {
  return {
    createdAt: "2026-11-12T09:00:00.000Z",
    bytes: 38 * MB,
    engineVersion: "0.14.3",
    badges: [],
    jams: [],
    playUrl: `/games/tactics/play/${patch.version}`,
    previewOnly: false,
    hidden: null,
    removalAt: null,
    removalNotice: null,
    actions: [],
    ...patch,
  };
}

const LIVE = version({ version: 7, id: "a".repeat(64), badges: ["live"] });
const JAM = version({
  version: 6,
  id: "b".repeat(64),
  createdAt: "2026-11-05T09:00:00.000Z",
  bytes: 37 * MB,
  engineVersion: "0.14.1",
  badges: ["jam"],
  jams: [{ jamId: 41, title: "Brackeys Game Jam 2026.2" }],
});
/** What a publisher sees on top of the players' list: a preview-only build on its way out. */
const PREVIEW_ONLY = version({
  version: 8,
  id: "c".repeat(64),
  createdAt: "2026-11-12T12:00:00.000Z",
  bytes: 39 * MB,
  badges: ["preview"],
  previewOnly: true,
  removalAt: "2026-11-26T00:00:00.000Z",
  removalNotice: "Removed on 26 Nov unless pinned",
  actions: ["promote", "jam-link", "download-zip"],
});
const PUBLISHER_ACTIONS = {
  7: ["jam-link", "download-zip"],
  6: ["rollback", "jam-link", "download-zip"],
} as const;

function page(patch: Partial<GamePageView> = {}): GamePageView {
  return {
    projectId: "tactics",
    title: "Tactics",
    description: "Move, then strike.",
    showcaseProjectId: null,
    showcaseSlug: null,
    cover: { imageKey: null, url: null },
    contributors: [],
    teams: [],
    visibility: "public",
    reviewPending: false,
    saveMode: "site",
    connectOrigins: [],
    versions: [LIVE, JAM],
    live: { version: 7, playUrl: "/games/tactics/play/7" },
    embeddable: true,
    credits: null,
    creditsMissing: 0,
    publisher: false,
    role: "player",
    hidden: null,
    noindex: false,
    viewer: { signedIn: false },
    ...patch,
  };
}

/** The page as a publisher gets it: the menu's actions on every version, and the preview-only one. */
function publisherPage(patch: Partial<GamePageView> = {}): GamePageView {
  return page({
    publisher: true,
    role: "publisher",
    versions: [
      PREVIEW_ONLY,
      { ...LIVE, actions: [...PUBLISHER_ACTIONS[7]] },
      { ...JAM, actions: [...PUBLISHER_ACTIONS[6]] },
    ],
    ...patch,
  });
}

function wrap(node: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  for (const call of Object.values(calls)) call.mockReset();
  calls.listJams.mockResolvedValue({
    jams: [
      {
        jamId: 41,
        title: "Brackeys Game Jam 2026.2",
        bannerUrl: null,
        startsAt: "2026-11-01T00:00:00.000Z",
        endsAt: "2026-11-30T00:00:00.000Z",
      },
    ],
  });
  gate.flagBlocks = false;
  gate.allowed = true;
});

afterEach(cleanup);

const versionRows = () =>
  within(screen.getByRole("list", { name: "Versions" }))
    .getAllByRole("listitem")
    .map((row) => row.getAttribute("data-version"));

describe("the game page", () => {
  it("is a missing page with the flag off, on a closed deployment, or without a payload", () => {
    gate.flagBlocks = true;
    wrap(<GamePage page={page()} onChanged={() => {}} />);
    expect(screen.getByText("Not found")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Tactics" })).toBeNull();
    cleanup();

    gate.flagBlocks = false;
    gate.allowed = false;
    wrap(<GamePage page={page()} onChanged={() => {}} />);
    expect(screen.queryByRole("heading", { name: "Tactics" })).toBeNull();
    cleanup();

    gate.allowed = true;
    wrap(<GamePage page={null} onChanged={() => {}} />);
    expect(screen.queryByRole("heading", { name: "Tactics" })).toBeNull();
  });

  it("shows the versions the payload gives this viewer, newest first, with their badges", () => {
    wrap(<GamePage page={page()} onChanged={() => {}} />);
    expect(screen.getByRole("heading", { name: "Tactics" })).toBeTruthy();
    expect(versionRows()).toEqual(["7", "6"]);
    expect(screen.getByText("v7 · 12 Nov 2026 · 38 MB · engine 0.14.3")).toBeTruthy();
    expect(screen.getByText("LIVE")).toBeTruthy();
    expect(screen.getByText("JAM VERSION: Brackeys Game Jam 2026.2")).toBeTruthy();
    expect(screen.queryByText(/unless pinned/)).toBeNull();
    expect(screen.getByRole("button", { name: "Play v6" }).getAttribute("href")).toBe(
      "/games/tactics/play/6",
    );
    expect(screen.getByRole("button", { name: "Play" }).getAttribute("href")).toBe(
      "/games/tactics/play/latest",
    );
  });

  it("takes its identity from the showcase project: cover, contributors, teams", () => {
    wrap(
      <GamePage
        page={page({
          cover: { imageKey: "covers/tactics.png", url: "https://cdn.example.test/tactics.png" },
          contributors: [
            {
              id: 1,
              profileId: "user-ada",
              displayName: "Ada",
              role: "Code",
              avatarUrl: null,
              guildAvatarUrl: null,
              urlStub: "ada",
            },
            {
              id: 2,
              profileId: null,
              displayName: "Guest artist",
              role: "Art",
              avatarUrl: null,
              guildAvatarUrl: null,
              urlStub: null,
            },
          ],
          teams: [{ id: "team-1", name: "Night Owls", slug: "night-owls", avatarUrl: null }],
        })}
        onChanged={() => {}}
      />,
    );
    expect(screen.getByAltText("Tactics cover")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ada" }).getAttribute("href")).toBe("/profile/ada");
    expect(screen.getByRole("img", { name: "Guest artist" })).toBeTruthy();
    expect(screen.getByText("Night Owls").closest("a")?.getAttribute("href")).toBe(
      "/teams/night-owls",
    );
  });

  it("tells a publisher what staff hid and what waits for review", () => {
    wrap(
      <GamePage
        page={publisherPage({
          visibility: "unlisted",
          reviewPending: true,
          versions: [{ ...JAM, hidden: { reason: "Flashing lights" } }],
        })}
        onChanged={() => {}}
      />,
    );
    expect(screen.getByText("PUBLIC AFTER REVIEW")).toBeTruthy();
    expect(screen.getByText("HIDDEN")).toBeTruthy();
    expect(screen.getByText(/Hidden: Flashing lights/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Play v6" })).toBeNull();
  });

  it("shows a publisher the preview-only version and when it goes", () => {
    wrap(<GamePage page={publisherPage()} onChanged={() => {}} />);
    expect(versionRows()).toEqual(["8", "7", "6"]);
    expect(screen.getByText("PREVIEW")).toBeTruthy();
    expect(screen.getByText(/Removed on 26 Nov unless pinned/)).toBeTruthy();
  });

  it("says there's nothing to play and offers no Play button without a live version", () => {
    wrap(
      <GamePage
        page={page({ versions: [], live: null, embeddable: false })}
        onChanged={() => {}}
      />,
    );
    expect(screen.getByText("There's no version here for you to play yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Embed" })).toBeNull();
  });

  it.each([
    ["site", /saves to your .* account: up to 4 saves of 32 KB, deleted after 180 days/],
    ["own", /keeps its saves on its own servers \(https:\/\/saves\.example\.com\)/],
    ["none", /This game doesn't save progress\./],
  ] as const)("states where saves go for the %s mode", (mode, sentence) => {
    wrap(
      <GamePage
        page={page({ saveMode: mode, connectOrigins: ["https://saves.example.com"] })}
        onChanged={() => {}}
      />,
    );
    const notice = document.querySelector(`[data-save-mode="${mode}"]`);
    expect(notice?.textContent).toMatch(sentence);
    expect(notice?.textContent).toContain("stay in this browser and are never uploaded");
  });

  it("lists the origins the game connects to, and none when it declares none", () => {
    wrap(
      <GamePage
        page={page({ connectOrigins: ["https://api.example.com", "wss://live.example.com"] })}
        onChanged={() => {}}
      />,
    );
    expect(
      screen.getByText(
        "This game connects to: https://api.example.com, wss://live.example.com. Those sites' own terms apply to what you send them.",
      ),
    ).toBeTruthy();
    cleanup();

    wrap(<GamePage page={page()} onChanged={() => {}} />);
    expect(screen.queryByText(/This game connects to/)).toBeNull();
  });

  it("dates every version in UTC", () => {
    // Late on the 30th in UTC is already the 1st east of it, and the 31st's evening west of it.
    expect(releaseDate("2026-11-30T23:30:00.000Z")).toBe("30 Nov 2026");
    expect(releaseDate("2026-12-01T00:30:00.000Z")).toBe("1 Dec 2026");
    expect(
      versionLine({
        version: 3,
        createdAt: "2027-01-01T00:10:00.000Z",
        bytes: 512,
        engineVersion: "0.14.1",
      }),
    ).toBe("v3 · 1 Jan 2027 · 512 B · engine 0.14.1");
  });

  it("offers Embed when the payload says the game is embeddable", () => {
    wrap(<GamePage page={page({ visibility: "unlisted" })} onChanged={() => {}} />);
    expect(screen.getByRole("button", { name: "Embed" })).toBeTruthy();
    expect(screen.getByText("UNLISTED")).toBeTruthy();
    cleanup();
    for (const visibility of ["team", "private"] as const) {
      wrap(<GamePage page={page({ visibility, embeddable: false })} onChanged={() => {}} />);
      expect(screen.queryByRole("button", { name: "Embed" })).toBeNull();
      cleanup();
    }
    expect(embedSnippet("tactics", 'A "quoted" <game>')).toMatch(
      /^<iframe src="[^"]*\/games\/tactics\/embed\/latest" title="A &#34;quoted&#34; &#60;game&#62;"/,
    );
  });

  it("offers Report to signed-in players only", () => {
    wrap(<GamePage page={page()} onChanged={() => {}} />);
    expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
    cleanup();
    wrap(<GamePage page={page({ viewer: { signedIn: true } })} onChanged={() => {}} />);
    expect(screen.getByRole("button", { name: "Report" })).toBeTruthy();
  });

  it("links the credits, and counts missing licences for publishers only", () => {
    const credits = {
      credits: { url: "https://play.example.test/frames/x/credits.html", version: 7 },
    };
    wrap(<GamePage page={page({ ...credits, creditsMissing: 3 })} onChanged={() => {}} />);
    expect(screen.getByRole("link", { name: "Credits and licences for v7" })).toBeTruthy();
    expect(screen.queryByText(missingLicencesLine(3))).toBeNull();
    cleanup();

    wrap(<GamePage page={publisherPage({ ...credits, creditsMissing: 3 })} onChanged={() => {}} />);
    expect(screen.getByText("3 assets have no licence recorded.")).toBeTruthy();
  });
});

describe("the publisher menu", () => {
  it("is not there for players", () => {
    wrap(<GamePage page={page()} onChanged={() => {}} />);
    expect(screen.queryByRole("button", { name: /^Actions for v/ })).toBeNull();
  });

  it("promotes a newer version through a confirm, then reloads the page", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    calls.promoteRelease.mockResolvedValue({ from: 7, to: 8 });
    wrap(<GamePage page={publisherPage()} onChanged={onChanged} />);
    await user.click(screen.getByRole("button", { name: "Actions for v8" }));
    expect(screen.queryByRole("menuitem", { name: /Roll back/ })).toBeNull();
    await user.click(await screen.findByRole("menuitem", { name: /Promote/ }));
    expect(calls.promoteRelease).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Promote" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.promoteRelease).toHaveBeenCalledWith({
      projectId: "tactics",
      version: 8,
      channel: "production",
    });
  });

  it("rolls production back to an older version", async () => {
    const user = userEvent.setup();
    calls.rollbackRelease.mockResolvedValue({ from: 7, to: 6 });
    wrap(<GamePage page={publisherPage()} onChanged={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Actions for v6" }));
    expect(screen.queryByRole("menuitem", { name: /Promote/ })).toBeNull();
    await user.click(await screen.findByRole("menuitem", { name: /Roll back to this/ }));
    await user.click(await screen.findByRole("button", { name: "Roll back" }));

    await waitFor(() =>
      expect(calls.rollbackRelease).toHaveBeenCalledWith({
        projectId: "tactics",
        channel: "production",
        to: 6,
      }),
    );
  });

  it("links a version to a jam picked from the jam search", async () => {
    const user = userEvent.setup();
    calls.linkReleaseJam.mockResolvedValue({ ok: true });
    wrap(<GamePage page={publisherPage()} onChanged={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Actions for v7" }));
    await user.click(await screen.findByRole("menuitem", { name: /Link to a jam/ }));
    const link = await screen.findByRole("button", { name: "Link" });
    expect(link.hasAttribute("disabled")).toBe(true);
    await user.click(await screen.findByRole("button", { name: /Brackeys Game Jam 2026\.2/ }));
    await user.click(screen.getByRole("button", { name: "Link" }));

    await waitFor(() =>
      expect(calls.linkReleaseJam).toHaveBeenCalledWith({
        projectId: "tactics",
        version: 7,
        jamId: 41,
      }),
    );
  });

  it("downloads a version's zip from the release route", async () => {
    const user = userEvent.setup();
    wrap(<GamePage page={publisherPage()} onChanged={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Actions for v7" }));
    const zip = await screen.findByRole("menuitem", { name: /Download zip/ });
    expect(zip.getAttribute("href")).toBe(`/api/engine/releases/${"a".repeat(64)}/zip`);
  });

  it("offers only the actions the payload gives each version", async () => {
    const user = userEvent.setup();
    wrap(
      <GamePage
        page={publisherPage({ versions: [{ ...JAM, actions: ["download-zip"] }] })}
        onChanged={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Actions for v6" }));
    expect(await screen.findByRole("menuitem", { name: /Download zip/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Roll back/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Link to a jam/ })).toBeNull();
  });
});

describe("the game page's head", () => {
  const robots = (head: ReturnType<typeof gamePageHead>) =>
    head.meta.find((tag) => tag.name === "robots")?.content ?? null;
  const image = (head: ReturnType<typeof gamePageHead>) =>
    head.meta.find((tag) => tag.property === "og:image")?.content ?? "";

  it("indexes a public game and gives it the game card", () => {
    const head = gamePageHead("tactics", page());
    expect(robots(head)).toBeNull();
    expect(image(head)).toContain("/og/game/tactics.png");
  });

  it("sends noindex and no game card for unlisted, team and private games", () => {
    for (const visibility of ["unlisted", "team", "private"] as const) {
      const head = gamePageHead(
        "tactics",
        page({ visibility, noindex: visibility === "unlisted" }),
      );
      expect(robots(head)).toBe("noindex, follow");
      expect(image(head)).not.toContain("/og/game/");
    }
  });

  it("is a not-found head without a payload", () => {
    expect(robots(gamePageHead("tactics", null))).toBe("noindex, nofollow");
  });
});
