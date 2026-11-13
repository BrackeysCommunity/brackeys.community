// @vitest-environment jsdom
import { releasePromoteMessage, releaseRollbackMessage } from "@jams/engine/game";
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
const toasts = vi.hoisted(() => ({
  loading: vi.fn(() => "pending"),
  dismiss: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ toast: Object.assign(vi.fn(), toasts) }));

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
type LinkStandInProps = {
  children?: ReactNode;
  params?: Record<string, string>;
  search?: Record<string, string | number>;
  to?: string;
};
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const hrefOf = ({ to, params, search }: LinkStandInProps) => {
    const path = (to ?? "").replace(/\$(\w+)/g, (_m, key: string) => params?.[key] ?? "");
    const query = search
      ? `?${new URLSearchParams(Object.entries(search).map(([k, v]) => [k, String(v)]))}`
      : "";
    return path + query;
  };
  return {
    ...(await importOriginal<typeof import("@tanstack/react-router")>()),
    Link: ({ children, params, to, search, ...rest }: LinkStandInProps) => (
      <a {...rest} href={hrefOf({ to, params, search })}>
        {children}
      </a>
    ),
    createLink:
      (Anchor: React.ComponentType<Record<string, unknown>>) =>
      ({ params, to, search, ...rest }: LinkStandInProps & Record<string, unknown>) => (
        <Anchor {...rest} href={hrefOf({ to, params, search })} />
      ),
  };
});

const { GamePage, missingLicencesLine } = await import("../GamePage");
type GamePageView = import("../GamePage").GamePageView;
const { blockedSceneLine, downloadReleaseZip, versionLine } = await import("../VersionList");
const { releaseDay } = await import("@/lib/jam-links");
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
    live: { version: 7, playUrl: "/games/tactics/play/7", scenes: [] },
    blockedScenes: [],
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
  for (const fn of Object.values(toasts)) fn.mockClear();
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

  it("gives a publisher staff's reason under the HIDDEN BY STAFF badge", () => {
    wrap(
      <GamePage
        page={publisherPage({ hidden: { reason: "Reported art." } })}
        onChanged={() => {}}
      />,
    );
    const header = document.querySelector<HTMLElement>("[data-header-hero]")!;
    expect(within(header).getByText("HIDDEN BY STAFF")).toBeTruthy();
    expect(within(header).getByRole("status").textContent).toBe(
      "Staff hid this game, so nobody can play it: Reported art.",
    );
    cleanup();
    wrap(<GamePage page={page({ hidden: { reason: "Reported art." } })} onChanged={() => {}} />);
    expect(screen.queryByText(/Staff hid this game/)).toBeNull();
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
    ["site", /Saves stay in this browser on .* until you clear its site data\./],
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

  it("tells a signed-in viewer a site game saves to their account", () => {
    wrap(<GamePage page={page({ viewer: { signedIn: true } })} onChanged={() => {}} />);
    const notice = document.querySelector('[data-save-mode="site"]');
    expect(notice?.textContent).toMatch(/Saved to your .* account: up to 4 saves of 32 KB/);
    expect(notice?.textContent).not.toContain("clear its site data");
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
    expect(releaseDay("2026-11-30T23:30:00.000Z")).toBe("30 Nov 2026");
    expect(releaseDay("2026-12-01T00:30:00.000Z")).toBe("1 Dec 2026");
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

describe("live levels on the game page", () => {
  // Half a minute over, so the shared clock lagging by up to a second never rounds it down.
  const minutesAgo = (n: number) => new Date(Date.now() - (n + 0.5) * 60_000).toISOString();
  const LIVE_SCENES = [
    { scene: "ford", title: "The ford", number: 4, since: minutesAgo(12) },
    { scene: "cave", title: "Cave", number: 2, since: minutesAgo(180) },
  ];
  const BLOCKED = [
    {
      scene: "ford",
      title: "The ford",
      number: 5,
      channel: "production" as const,
      reason: "5 of 12 players' games failed after this update",
    },
  ];

  it("adds the live production row when production plays updated levels", () => {
    wrap(
      <GamePage
        page={page({
          live: { version: 7, playUrl: "/games/tactics/play/7", scenes: LIVE_SCENES.slice(0, 1) },
        })}
        onChanged={() => {}}
      />,
    );
    const row = screen
      .getByRole("list", { name: "Versions" })
      .querySelector('[data-version="7"] [data-live-levels]');
    expect(row?.textContent).toBe("with updated levels: The ford (12m ago)");
    expect(row?.parentElement?.textContent).toMatch(
      / · with updated levels: The ford \(12m ago\)$/,
    );
    expect(
      screen.getByRole("list", { name: "Versions" }).querySelectorAll("[data-live-levels]"),
    ).toHaveLength(1);
  });

  it("plays the live row as production plays it, updated levels included", () => {
    wrap(
      <GamePage
        page={page({
          live: { version: 7, playUrl: "/games/tactics/play/7", scenes: LIVE_SCENES.slice(0, 1) },
        })}
        onChanged={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Play v7" }).getAttribute("href")).toBe(
      "/games/tactics/play/latest",
    );
    expect(screen.getByRole("button", { name: "Play v6" }).getAttribute("href")).toBe(
      "/games/tactics/play/6",
    );
  });

  it("lists every updated level in the row", () => {
    wrap(
      <GamePage
        page={page({ live: { version: 7, playUrl: "/games/tactics/play/7", scenes: LIVE_SCENES } })}
        onChanged={() => {}}
      />,
    );
    expect(document.querySelector("[data-live-levels]")?.textContent).toBe(
      "with updated levels: The ford (12m ago), Cave (3h ago)",
    );
  });

  it("has no live row when production plays its release's own levels", () => {
    wrap(<GamePage page={page()} onChanged={() => {}} />);
    expect(document.querySelector("[data-live-levels]")).toBeNull();
    expect(screen.queryByText(/with updated levels/i)).toBeNull();
  });

  it("shows publishers a blocked update in its channel's row, linking to the Publish panel in the editor", () => {
    wrap(
      <GamePage
        page={publisherPage({
          blockedScenes: [
            ...BLOCKED,
            { scene: "cave", title: "Cave", number: 3, channel: "preview", reason: null },
          ],
        })}
        onChanged={() => {}}
      />,
    );
    const link = screen.getByRole("link", {
      name: "The ford update blocked (5 of 12 players' games failed after this update)",
    });
    expect(link.getAttribute("href")).toBe(
      "/game/dev?edit=1&project=tactics&scene=ford&panel=publish",
    );
    expect(link.className).toContain("text-destructive");
    const versions = screen.getByRole("list", { name: "Versions" });
    const live = versions.querySelector<HTMLElement>('[data-version="7"]')!;
    expect(
      within(within(live).getByRole("list", { name: "Blocked level updates" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(1);
    const preview = versions.querySelector<HTMLElement>('[data-version="8"]')!;
    expect(within(preview).getByRole("link", { name: "Cave update blocked" })).toBeTruthy();
    expect(screen.getAllByRole("list", { name: "Blocked level updates" })).toHaveLength(2);
  });

  it("shows a blocked version both channels point at on each channel's row", () => {
    wrap(
      <GamePage
        page={publisherPage({
          blockedScenes: [...BLOCKED, { ...BLOCKED[0]!, channel: "preview" }],
        })}
        onChanged={() => {}}
      />,
    );
    const versions = screen.getByRole("list", { name: "Versions" });
    for (const version of ["7", "8"]) {
      const row = versions.querySelector<HTMLElement>(`[data-version="${version}"]`)!;
      const link = within(row).getByRole("link", {
        name: "The ford update blocked (5 of 12 players' games failed after this update)",
      });
      expect(link.className).toContain("underline");
    }
  });

  it("never shows players a blocked update", () => {
    wrap(<GamePage page={page({ blockedScenes: BLOCKED })} onChanged={() => {}} />);
    expect(screen.queryByText(/update blocked/)).toBeNull();
    expect(screen.queryByRole("list", { name: "Blocked level updates" })).toBeNull();
  });

  it("words a blocked update without a reason", () => {
    expect(blockedSceneLine({ title: "Cave", reason: null })).toBe("Cave update blocked");
    expect(blockedSceneLine({ title: "Cave", reason: "Stopped by hand" })).toBe(
      "Cave update blocked (Stopped by hand)",
    );
  });
});

const SINCE_LIVE = "2026-11-13T10:00:00.000Z";

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
    expect(await screen.findByText(releasePromoteMessage(8))).toBeTruthy();
    expect(calls.promoteRelease).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "Promote" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.promoteRelease).toHaveBeenCalledWith({
      projectId: "tactics",
      version: 8,
      channel: "production",
    });
  });

  it("lists the live levels a promote replaces, and where to keep them", async () => {
    const user = userEvent.setup();
    wrap(
      <GamePage
        page={publisherPage({
          live: {
            version: 7,
            playUrl: "/games/tactics/play/7",
            scenes: [{ scene: "ford", title: "The ford", number: 4, since: SINCE_LIVE }],
          },
        })}
        onChanged={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Actions for v8" }));
    await user.click(await screen.findByRole("menuitem", { name: /Promote/ }));
    expect(await screen.findByText(releasePromoteMessage(8))).toBeTruthy();
    expect(
      screen.getByText("Promoting v8 replaces these live scenes: The ford (ford@4)."),
    ).toBeTruthy();
    const editor = screen.getByRole("link", { name: "Publish panel in the editor" });
    expect(editor.getAttribute("href")).toBe("/game/dev?edit=1&project=tactics&panel=publish");
    expect(editor.className).toContain("underline");
  });

  it("asks the plain promote question as the dialog's description when no live level is replaced", async () => {
    const user = userEvent.setup();
    wrap(<GamePage page={publisherPage()} onChanged={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Actions for v8" }));
    await user.click(await screen.findByRole("menuitem", { name: /Promote/ }));
    const dialog = await screen.findByRole("alertdialog");
    const described = document.getElementById(dialog.getAttribute("aria-describedby") ?? "");
    expect(described?.textContent).toBe(releasePromoteMessage(8));
  });

  it("rolls production back to an older version", async () => {
    const user = userEvent.setup();
    calls.rollbackRelease.mockResolvedValue({ from: 7, to: 6 });
    wrap(<GamePage page={publisherPage()} onChanged={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Actions for v6" }));
    expect(screen.queryByRole("menuitem", { name: /Promote/ })).toBeNull();
    await user.click(await screen.findByRole("menuitem", { name: /Roll back to this/ }));
    expect(await screen.findByText(releaseRollbackMessage(6, 7))).toBeTruthy();
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

  it("downloads a version's zip from the release route, saying so while it builds", async () => {
    const user = userEvent.setup();
    const fetch = vi.fn(
      async () =>
        new Response(new Uint8Array([80, 75]), {
          headers: { "content-disposition": 'attachment; filename="tactics-v7.zip"' },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const saved: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        saved.push(this.download);
      },
    );
    URL.createObjectURL = vi.fn(() => "blob:zip");
    URL.revokeObjectURL = vi.fn();
    try {
      wrap(<GamePage page={publisherPage()} onChanged={() => {}} />);
      await user.click(screen.getByRole("button", { name: "Actions for v7" }));
      await user.click(await screen.findByRole("menuitem", { name: /Download zip/ }));
      expect(toasts.loading).toHaveBeenCalledWith("Building the v7 zip…", expect.anything());
      await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("v7's zip is downloading."));
      expect(fetch).toHaveBeenCalledWith(
        `/api/engine/releases/${"a".repeat(64)}/zip`,
        expect.anything(),
      );
      expect(saved).toEqual(["tactics-v7.zip"]);
      expect(toasts.dismiss).toHaveBeenCalledWith("pending");
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it("shows the itch.io layout issues the zip route sends, and its refusals", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(new Uint8Array([80, 75]), {
            headers: {
              "x-jams-itch-issues": JSON.stringify({
                count: 3,
                messages: ["index.html isn't at the zip's root.", "The zip has 1,200 files."],
              }),
            },
          }),
        )
        .mockResolvedValueOnce(
          Response.json({ message: "Only the game's publishers can do this." }, { status: 403 }),
        ),
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => "blob:zip");
    URL.revokeObjectURL = vi.fn();
    try {
      const release = { projectId: "tactics", version: 7, releaseId: "a".repeat(64) };
      await downloadReleaseZip(release);
      expect(toasts.warning).toHaveBeenCalledWith(
        "v7's zip has 3 things to fix before itch.io takes it",
        expect.objectContaining({
          description: "index.html isn't at the zip's root. The zip has 1,200 files. …and 1 more.",
        }),
      );
      await downloadReleaseZip(release);
      expect(toasts.error).toHaveBeenCalledWith("Only the game's publishers can do this.");
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
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
  const embed = (head: ReturnType<typeof gamePageHead>) =>
    ("scripts" in head ? head.scripts : []).find((s) => s.id === "discord:component-embed");

  it("indexes a public game and gives it the game card and the Discord preview", () => {
    const head = gamePageHead("tactics", page());
    expect(robots(head)).toBeNull();
    expect(image(head)).toContain("/og/game/tactics.png");
    const preview = embed(head);
    expect(preview?.type).toBe("application/json");
    expect(preview?.children).toContain("Tactics");
    expect(preview?.children).toContain("Move, then strike.");
    expect(preview?.children).toContain("/games/tactics");
  });

  it("sends no Discord preview for a game staff hid", () => {
    const head = gamePageHead("tactics", page({ hidden: { reason: "Reported." } }));
    expect(embed(head)).toBeUndefined();
    expect(robots(head)).toBe("noindex, follow");
  });

  it("sends noindex and no game card for unlisted, team and private games", () => {
    for (const visibility of ["unlisted", "team", "private"] as const) {
      const head = gamePageHead(
        "tactics",
        page({ visibility, noindex: visibility === "unlisted" }),
      );
      expect(robots(head)).toBe("noindex, follow");
      expect(image(head)).not.toContain("/og/game/");
      expect(embed(head)).toBeUndefined();
    }
  });

  it("is a not-found head without a payload", () => {
    expect(robots(gamePageHead("tactics", null))).toBe("noindex, nofollow");
  });
});
