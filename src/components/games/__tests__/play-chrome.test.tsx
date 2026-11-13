// @vitest-environment jsdom
import { formatSaveFile } from "@jams/engine/game";
import { ORPCError } from "@orpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { PlayPayload } from "@/lib/engine/game-play";
import type { HostServerOptions, RecordingAnswer } from "@/lib/engine/host-server";
import type { LiveClientOptions } from "@/lib/engine/live-client";
import type { LiveSnapshot } from "@/lib/engine/live-state";
import { localPlaySaves, SIGNED_OUT_SAVES_DESCRIBE } from "@/lib/engine/local-saves";
import type { SiteSaveStore } from "@/lib/engine/save-store";
import { pageTitle } from "@/lib/site-meta";

const calls = vi.hoisted(() => ({
  getGamePlay: vi.fn(),
  reportGame: vi.fn(),
}));
const gate = vi.hoisted(() => ({ flagBlocks: false, allowed: true }));
const auth = vi.hoisted(() => ({
  user: null as null | { id: string; name: string; image: string | null },
  signIn: vi.fn(),
}));
const hosts = vi.hoisted(() => ({
  created: [] as HostServerOptions[],
  notified: 0,
  recordingAsked: 0,
  recordingAnswer: "offered" as RecordingAnswer,
  siteWrites: [] as string[],
}));

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
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: auth.user ? { user: auth.user } : null }) },
  signInWithDiscord: auth.signIn,
}));
vi.mock("@/lib/hooks/use-flag", () => ({
  useFlag: () => !gate.flagBlocks,
  useFlagBlocks: (key: string) => key === "engine-games-enabled" && gate.flagBlocks,
}));
vi.mock("@/lib/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/engine/guard", () => ({ engineGamesAllowed: () => gate.allowed }));
vi.mock("@/lib/engine/host-server", () => ({
  createHostServer: (opts: HostServerOptions) => {
    hosts.created.push(opts);
    return {
      notifySavesChanged: () => {
        hosts.notified += 1;
      },
      pause: vi.fn(),
      resume: vi.fn(),
      requestRecording: () => {
        hosts.recordingAsked += 1;
        return Promise.resolve(hosts.recordingAnswer);
      },
      dispose: vi.fn(),
    };
  },
}));
const live = vi.hoisted(() => ({ clients: [] as LiveClientOptions[] }));
vi.mock("@/lib/engine/live-client", () => ({
  createLiveClient: (opts: LiveClientOptions) => {
    live.clients.push(opts);
    return { dispose: vi.fn() };
  },
}));
const toasts = vi.hoisted(() => ({
  show: vi.fn(),
  dismiss: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({
  toast: Object.assign(toasts.show, {
    dismiss: toasts.dismiss,
    success: toasts.success,
    error: toasts.error,
    loading: toasts.loading,
  }),
}));
vi.mock("@/lib/engine/save-store", async () => {
  const { SITE_SAVE_LIMITS } = await import("@/lib/engine/limits");
  return {
    siteSaveStore: (): SiteSaveStore => ({
      kind: "host",
      describe: "Saved to your account.",
      limits: SITE_SAVE_LIMITS,
      load: () =>
        Promise.resolve({
          saves: [],
          limits: SITE_SAVE_LIMITS,
          describe: "Saved to your account.",
          mode: "site",
        }),
      list: () => Promise.resolve([]),
      read: () => Promise.resolve(null),
      write: (_game, slot, text) => {
        hosts.siteWrites.push(slot);
        return Promise.resolve({ ok: true, bytes: text.length });
      },
      remove: () => Promise.resolve(),
    }),
  };
});
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
  useRouter: () => ({ history: { back: vi.fn() } }),
  useRouterState: () => "/games/tactics/play/latest",
}));

const {
  DOWNLOAD_RUN_LABEL,
  PlayChrome,
  PlayPage,
  PLAY_UNAVAILABLE_MESSAGE,
  RUN_NOT_OFFERED,
  RUN_NOT_READY,
  RUN_PREPARING,
  SIGN_IN_MESSAGE,
} = await import("../PlayChrome");
const { EmbedFrame, EMBED_SAVES_DESCRIBE } = await import("../EmbedFrame");
const { Route: PlayIndexRoute } = await import("@/routes/games_.$projectId.play.index");

function payload(patch: Partial<PlayPayload> = {}): PlayPayload {
  return {
    projectId: "tactics",
    title: "Tactics",
    version: 7,
    channel: "production",
    release: {
      id: "a".repeat(64),
      gameId: "tactics",
      engineVersion: "0.14.1",
      createdAt: "2026-11-10T12:00:00.000Z",
    },
    frameUrl: `https://play.example.test/frames/${"a".repeat(64)}/index.html?host=jams`,
    visibility: "public",
    saveMode: "site",
    connectOrigins: [],
    online: false,
    viewer: { signedIn: false },
    live: null,
    ...patch,
  };
}

function saveText(slot: string): string {
  return formatSaveFile({
    kind: "save",
    v: 1,
    game: "tactics",
    gameVersion: 1,
    engine: "0.14.2",
    release: null,
    project: null,
    slot,
    meta: { title: "Camp", scene: "level-1", savedAt: Date.UTC(2026, 10, 1), playTicks: 0 },
    depth: "progress",
    persist: null,
    scene: { id: "level-1", runHash: "", sublevels: [] },
    data: null,
  });
}

function wrap(node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  calls.getGamePlay.mockReset();
  calls.reportGame.mockReset();
  auth.signIn.mockReset();
  auth.user = null;
  gate.flagBlocks = false;
  gate.allowed = true;
  hosts.created.length = 0;
  hosts.notified = 0;
  hosts.siteWrites.length = 0;
  live.clients.length = 0;
  for (const fn of Object.values(toasts)) fn.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(cleanup);

describe("the play page", () => {
  it("asks before signing in, then returns to the play URL", async () => {
    const user = userEvent.setup();
    wrap(<PlayChrome play={payload()} version="latest" />);

    await user.click(screen.getByRole("button", { name: /Sign in to keep your saves/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(SIGN_IN_MESSAGE);
    expect(auth.signIn).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(auth.signIn).toHaveBeenCalledWith("game", {
        callbackURL: "/games/tactics/play/latest",
      }),
    );
  });

  it("asks the same before the site menu's Sign in, and signs in only once confirmed", async () => {
    const user = userEvent.setup();
    wrap(<PlayChrome play={payload()} version="latest" />);

    await user.click(screen.getByRole("button", { name: "Site menu" }));
    await user.click(await screen.findByRole("menuitem", { name: "Sign in with Discord" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Sign in to keep your saves?");
    expect(dialog.textContent).toContain(SIGN_IN_MESSAGE);
    expect(auth.signIn).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "CANCEL" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(auth.signIn).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Site menu" }));
    await user.click(await screen.findByRole("menuitem", { name: "Sign in with Discord" }));
    await user.click(await screen.findByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(auth.signIn).toHaveBeenCalledWith("game", {
        callbackURL: "/games/tactics/play/latest",
      }),
    );
    expect(auth.signIn).toHaveBeenCalledTimes(1);
  });

  it("offers a plain Sign in for a game that doesn't save to the site", async () => {
    for (const saveMode of ["own", "none"] as const) {
      const user = userEvent.setup();
      const view = wrap(
        <PlayChrome
          play={payload({ saveMode, connectOrigins: ["https://saves.example.test"] })}
          version="latest"
        />,
      );
      expect(screen.queryByRole("button", { name: /keep your saves/ })).toBeNull();

      await user.click(screen.getByRole("button", { name: "Sign in" }));
      const dialog = await screen.findByRole("alertdialog");
      expect(dialog.textContent).toContain("Sign in?");
      expect(dialog.textContent).not.toContain("keep your saves");
      expect(dialog.textContent).toContain(SIGN_IN_MESSAGE);
      await user.click(screen.getByRole("button", { name: "CANCEL" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

      await user.click(screen.getByRole("button", { name: "Site menu" }));
      await user.click(await screen.findByRole("menuitem", { name: "Sign in with Discord" }));
      expect((await screen.findByRole("alertdialog")).textContent).not.toContain("keep your saves");
      view.unmount();
    }
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it("puts the one Saves paragraph under the Saves menu, with only the signed-out sentence", async () => {
    const user = userEvent.setup();
    wrap(<PlayChrome play={payload()} version="latest" />);

    await user.click(screen.getByRole("button", { name: "Saves" }));
    const notice = await waitFor(() => {
      const el = document.querySelector("[data-save-mode='site']");
      if (!el) throw new Error("no save notice");
      return el;
    });
    const body = notice.textContent ?? "";
    expect(body).toContain(`Saves. ${SIGNED_OUT_SAVES_DESCRIBE}`);
    expect(body).not.toContain("Signed in");
    expect(body.match(/clear its site data/g)).toHaveLength(1);
  });

  it("leaves the site menu's Sign in immediate on pages that don't ask first", async () => {
    const { SiteMenu } = await import("@/components/canvas/shell/SiteMenu");
    const user = userEvent.setup();
    wrap(<SiteMenu signinSource="game" />);

    await user.click(screen.getByRole("button", { name: "Site menu" }));
    await user.click(await screen.findByRole("menuitem", { name: "Sign in with Discord" }));
    expect(auth.signIn).toHaveBeenCalledWith("game");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows the viewer's avatar and Report when signed in, not the sign-in button", async () => {
    auth.user = { id: "u1", name: "Carol", image: null };
    calls.reportGame.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    wrap(<PlayChrome play={payload()} version="7" />);

    expect(screen.queryByRole("button", { name: /Sign in to keep your saves/ })).toBeNull();
    expect(screen.getByText("C")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Report" }));
    await user.type(await screen.findByPlaceholderText("Reason"), "stolen art");
    await user.click(screen.getByRole("button", { name: "REPORT" }));
    await waitFor(() =>
      expect(calls.reportGame).toHaveBeenCalledWith({
        projectId: "tactics",
        version: 7,
        reason: "stolen art",
      }),
    );
  });

  it("offers this browser's saves once signed in, and tells the frame after keeping them", async () => {
    await localPlaySaves("tactics").write("tactics", "1", saveText("1"));
    auth.user = { id: "u1", name: "Carol", image: null };
    const user = userEvent.setup();
    wrap(<PlayChrome play={payload()} version="latest" />);

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Keep your saves?");
    const before = hosts.notified;
    await user.click(screen.getByRole("button", { name: "Keep 1 save" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(hosts.siteWrites).toEqual(["1"]);
    expect(hosts.notified).toBe(before + 1);
    expect(await localPlaySaves("tactics").list("tactics")).toEqual([]);
  });

  it("offers no saves to keep signed out or on the preview", async () => {
    await localPlaySaves("tactics").write("tactics", "1", saveText("1"));
    const signedOut = wrap(<PlayChrome play={payload()} version="latest" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    signedOut.unmount();

    auth.user = { id: "u1", name: "Carol", image: null };
    wrap(<PlayChrome play={payload({ channel: "preview" })} version="preview" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("has no Report for a signed-out viewer", () => {
    wrap(<PlayChrome play={payload()} version="latest" />);
    expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
  });

  it("frames the release with the title, version and a link to the game page", () => {
    wrap(<PlayChrome play={payload({ channel: "preview" })} version="preview" />);
    const frame = screen.getByTitle("Tactics");
    expect(frame.getAttribute("src")).toBe(payload().frameUrl);
    expect(screen.getByText("v7")).toBeTruthy();
    expect(screen.getByText("PREVIEW")).toBeTruthy();
    expect(screen.getByLabelText("Game page").getAttribute("href")).toBe("/games/tactics");
    expect(hosts.created).toHaveLength(1);
  });

  it("names the tab after the game and version, and puts it back on leaving", () => {
    document.title = "Before";
    const view = wrap(<PlayChrome play={payload({ online: true })} version="latest" />);
    expect(document.title).toBe(pageTitle("Tactics v7"));
    expect(hosts.created[0]?.online).toBe(true);
    view.unmount();
    expect(document.title).toBe("Before");
  });

  it("asks the frame for this run's recording, which comes back as the download offer", async () => {
    hosts.recordingAsked = 0;
    hosts.recordingAnswer = "offered";
    toasts.loading.mockReturnValueOnce("preparing");
    wrap(<PlayChrome play={payload()} version="latest" />);
    await userEvent.click(screen.getByRole("button", { name: DOWNLOAD_RUN_LABEL }));
    expect(hosts.recordingAsked).toBe(1);
    expect(toasts.loading).toHaveBeenCalledWith(RUN_PREPARING);
    await waitFor(() => expect(toasts.dismiss).toHaveBeenCalledWith("preparing"));
    expect(toasts.error).not.toHaveBeenCalled();
    act(() => {
      hosts.created[0]?.onDownload?.({
        name: "hall.recording.json",
        contentType: "application/json",
        bytes: new TextEncoder().encode("{}").buffer,
      });
    });
    expect(screen.getByRole("button", { name: /download recording/i })).toBeTruthy();
  });

  it("says so when the frame can't be asked for its run yet", async () => {
    hosts.recordingAsked = 0;
    hosts.recordingAnswer = "unsent";
    wrap(<PlayChrome play={payload()} version="latest" />);
    await userEvent.click(screen.getByRole("button", { name: DOWNLOAD_RUN_LABEL }));
    expect(hosts.recordingAsked).toBe(1);
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith(RUN_NOT_READY));
    hosts.recordingAnswer = "offered";
  });

  it("says the game has no run to share when the frame offers none in time", async () => {
    hosts.recordingAnswer = "unanswered";
    toasts.loading.mockReturnValueOnce("preparing");
    wrap(<PlayChrome play={payload()} version="latest" />);
    await userEvent.click(screen.getByRole("button", { name: DOWNLOAD_RUN_LABEL }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith(RUN_NOT_OFFERED));
    expect(toasts.dismiss).toHaveBeenCalledWith("preparing");
    hosts.recordingAnswer = "offered";
  });

  it("lets the player dismiss a recording the game offers", async () => {
    wrap(<PlayChrome play={payload()} version="latest" />);
    act(() => {
      hosts.created[0]?.onDownload?.({
        name: "match.jamsrec",
        contentType: "application/json",
        bytes: new TextEncoder().encode("{}").buffer,
      });
    });
    expect(screen.getByRole("button", { name: /download recording/i })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss the recording" }));
    expect(screen.queryByRole("button", { name: /download recording/i })).toBeNull();
  });

  it("fullscreens the iframe element", async () => {
    const requestFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(HTMLIFrameElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    const user = userEvent.setup();
    wrap(<PlayChrome play={payload()} version="latest" />);
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(requestFullscreen.mock.contexts[0]).toBe(screen.getByTitle("Tactics"));
    delete (HTMLIFrameElement.prototype as { requestFullscreen?: unknown }).requestFullscreen;
  });

  it("shows the reason for a hidden release instead of a frame", async () => {
    calls.getGamePlay.mockRejectedValue(
      new ORPCError("NOT_FOUND", { message: "Not found.", data: { reason: "hidden" } }),
    );
    wrap(<PlayPage projectId="tactics" version="latest" />);
    expect(await screen.findByText(PLAY_UNAVAILABLE_MESSAGE.hidden)).toBeTruthy();
    expect(screen.queryByTitle("Tactics")).toBeNull();
  });

  it("shows the reason for a collected release", async () => {
    calls.getGamePlay.mockRejectedValue(
      new ORPCError("NOT_FOUND", { message: "Not found.", data: { reason: "collected" } }),
    );
    wrap(<PlayPage projectId="tactics" version="2" />);
    expect(await screen.findByText(PLAY_UNAVAILABLE_MESSAGE.collected)).toBeTruthy();
  });

  it("reads a refused release the same as a missing one", async () => {
    calls.getGamePlay.mockRejectedValue(
      new ORPCError("NOT_FOUND", { message: "Not found.", data: { reason: "forbidden" } }),
    );
    wrap(<PlayPage projectId="tactics" version="latest" />);
    expect(await screen.findByText(PLAY_UNAVAILABLE_MESSAGE.unavailable)).toBeTruthy();
  });

  it("renders the 404 without asking when the flag is off", () => {
    gate.flagBlocks = true;
    wrap(<PlayPage projectId="tactics" version="latest" />);
    expect(screen.getByText("Page not found")).toBeTruthy();
    expect(calls.getGamePlay).not.toHaveBeenCalled();
  });

  it("renders the 404 on production", () => {
    gate.allowed = false;
    wrap(<PlayPage projectId="tactics" version="latest" />);
    expect(screen.getByText("Page not found")).toBeTruthy();
    expect(calls.getGamePlay).not.toHaveBeenCalled();
  });

  it("asks for latest, preview and numbers, and nothing else", async () => {
    calls.getGamePlay.mockResolvedValue(payload());
    for (const version of ["latest", "preview", "12"]) {
      const view = wrap(<PlayPage projectId="tactics" version={version} />);
      await screen.findByTitle("Tactics");
      view.unmount();
    }
    expect(calls.getGamePlay.mock.calls.map(([input]) => input)).toEqual([
      { projectId: "tactics", version: "latest" },
      { projectId: "tactics", version: "preview" },
      { projectId: "tactics", version: "12" },
    ]);
    wrap(<PlayPage projectId="tactics" version="v2" />);
    expect(screen.getByText("Page not found")).toBeTruthy();
    expect(calls.getGamePlay).toHaveBeenCalledTimes(3);
  });

  it("redirects /play to /play/latest", () => {
    const beforeLoad = PlayIndexRoute.options.beforeLoad as (ctx: unknown) => void;
    let thrown: unknown;
    try {
      beforeLoad({ params: { projectId: "tactics" } });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      options: {
        to: "/games/$projectId/play/$version",
        params: { projectId: "tactics", version: "latest" },
        replace: true,
      },
    });
  });
});

describe("the embed page", () => {
  it("has no actions beyond Open on the site, in a new tab", async () => {
    auth.user = { id: "u1", name: "Carol", image: null };
    calls.getGamePlay.mockResolvedValue(payload({ visibility: "unlisted" }));
    wrap(<EmbedFrame projectId="tactics" version="latest" />);
    await screen.findByTitle("Tactics");

    expect(screen.queryAllByRole("button")).toEqual([]);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toMatch(/^Open on /);
    expect(links[0]?.getAttribute("target")).toBe("_blank");
    expect(links[0]?.getAttribute("href")).toMatch(/\/games\/tactics\/play\/latest$/);
  });

  it("keeps its link in a bar outside the frame and names the tab after the game", async () => {
    calls.getGamePlay.mockResolvedValue(payload());
    wrap(<EmbedFrame projectId="tactics" version="latest" />);
    const frame = await screen.findByTitle("Tactics");
    const link = screen.getByRole("link");
    expect(frame.parentElement?.contains(link)).toBe(false);
    expect(document.title).toBe(pageTitle("Tactics v7"));
  });

  it("tells the frame its saves stay with the embedding page", async () => {
    calls.getGamePlay.mockResolvedValue(payload());
    wrap(<EmbedFrame projectId="tactics" version="7" />);
    await screen.findByTitle("Tactics");
    expect(hosts.created[0]?.describe()).toBe(EMBED_SAVES_DESCRIBE);
  });

  it("refuses private and team games and the preview", async () => {
    calls.getGamePlay.mockResolvedValue(payload({ visibility: "private" }));
    const view = wrap(<EmbedFrame projectId="tactics" version="latest" />);
    expect(await screen.findByText(PLAY_UNAVAILABLE_MESSAGE.unavailable)).toBeTruthy();
    expect(screen.queryByTitle("Tactics")).toBeNull();
    view.unmount();

    calls.getGamePlay.mockClear();
    wrap(<EmbedFrame projectId="tactics" version="preview" />);
    expect(screen.getByText(PLAY_UNAVAILABLE_MESSAGE.unavailable)).toBeTruthy();
    expect(calls.getGamePlay).not.toHaveBeenCalled();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("shows a hidden release's reason with no actions", async () => {
    calls.getGamePlay.mockRejectedValue(
      new ORPCError("NOT_FOUND", { message: "Not found.", data: { reason: "hidden" } }),
    );
    wrap(<EmbedFrame projectId="tactics" version="latest" />);
    expect(await screen.findByText(PLAY_UNAVAILABLE_MESSAGE.hidden)).toBeTruthy();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });
});

const RELEASE_A = "a".repeat(64);
const RELEASE_B = "b".repeat(64);
const frameOf = (release: string) =>
  `https://play.example.test/frames/${release}/index.html?host=jams`;

function liveOn(release: string): LiveSnapshot {
  return {
    channel: "production",
    rev: 4,
    release,
    scenes: [
      {
        scene: "ford",
        version: "f".repeat(64),
        number: 2,
        timing: "boundary",
        since: "2026-11-12T14:48:00.000Z",
      },
    ],
    removed: [],
  };
}

function lastClient(): LiveClientOptions {
  const opts = live.clients.at(-1);
  if (!opts) throw new Error("no live client");
  return opts;
}

type ToastAction = {
  action: { label: string; onClick: (event: { preventDefault(): void }) => void };
};
const reload = (options: ToastAction) => options.action.onClick({ preventDefault: () => {} });

describe("live levels on the play page", () => {
  it("follows latest's live scenes and welcomes the frame with them", async () => {
    calls.getGamePlay.mockResolvedValue(payload({ live: liveOn(RELEASE_A) }));
    wrap(<PlayPage projectId="tactics" version="latest" />);
    await screen.findByTitle("Tactics");
    expect(live.clients).toHaveLength(1);
    expect(lastClient()).toMatchObject({
      projectId: "tactics",
      channel: "production",
      initial: liveOn(RELEASE_A),
    });
    expect(hosts.created.at(-1)?.live?.()).toEqual(liveOn(RELEASE_A));
  });

  it("starts no live client for a numbered play", async () => {
    calls.getGamePlay.mockResolvedValue(payload({ live: null }));
    wrap(<PlayPage projectId="tactics" version="7" />);
    await screen.findByTitle("Tactics");
    expect(live.clients).toHaveLength(0);
    expect(hosts.created.at(-1)?.live?.()).toBeNull();
  });

  it("toasts each live text", async () => {
    calls.getGamePlay.mockResolvedValue(payload({ live: liveOn(RELEASE_A) }));
    wrap(<PlayPage projectId="tactics" version="latest" />);
    await screen.findByTitle("Tactics");
    act(() => lastClient().onSwapApplied?.({ scene: "ford", version: null, timing: "boundary" }));
    act(() => lastClient().onReleaseMoved());
    act(() => lastClient().onRemoved());
    expect(toasts.show.mock.calls.map((c) => c[0])).toEqual([
      "This level was just updated.",
      "A new version of Tactics is available.",
      "A level in this game was removed by moderators.",
    ]);
  });

  it("reloads the frame on the new release when the player picks Reload", async () => {
    calls.getGamePlay.mockResolvedValue(payload({ live: liveOn(RELEASE_A) }));
    wrap(<PlayPage projectId="tactics" version="latest" />);
    const frame = await screen.findByTitle("Tactics");
    expect(frame.getAttribute("src")).toBe(frameOf(RELEASE_A));

    act(() => lastClient().onReleaseMoved());
    const [, options] = toasts.show.mock.calls[0] as [string, ToastAction];
    expect(options.action.label).toBe("Reload");

    calls.getGamePlay.mockResolvedValue(
      payload({
        version: 8,
        release: { ...payload().release, id: RELEASE_B },
        frameUrl: frameOf(RELEASE_B),
        live: liveOn(RELEASE_B),
      }),
    );
    act(() => reload(options));
    await waitFor(() =>
      expect(screen.getByTitle("Tactics").getAttribute("src")).toBe(frameOf(RELEASE_B)),
    );
    expect(calls.getGamePlay).toHaveBeenCalledTimes(2);
    expect(hosts.created.at(-1)?.release.id).toBe(RELEASE_B);
    expect(lastClient().initial.release).toBe(RELEASE_B);
  });

  it("keeps the game it has when the reload for a new release fails, and offers it again", async () => {
    calls.getGamePlay.mockResolvedValue(payload({ live: liveOn(RELEASE_A) }));
    wrap(<PlayPage projectId="tactics" version="latest" />);
    await screen.findByTitle("Tactics");
    act(() => lastClient().onReleaseMoved());
    const [, options] = toasts.show.mock.calls[0] as [string, ToastAction];
    calls.getGamePlay.mockRejectedValue(new Error("offline"));
    act(() => reload(options));
    expect(toasts.loading.mock.calls[0]?.[0]).toBe("Loading the new version…");
    await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));
    // The first load, then the reload and its two retries.
    expect(calls.getGamePlay).toHaveBeenCalledTimes(4);
    expect(toasts.error.mock.calls[0]?.[0]).toBe("The new version of Tactics didn't load.");
    expect(screen.getByTitle("Tactics").getAttribute("src")).toBe(frameOf(RELEASE_A));

    calls.getGamePlay.mockResolvedValue(
      payload({
        release: { ...payload().release, id: RELEASE_B },
        frameUrl: frameOf(RELEASE_B),
        live: liveOn(RELEASE_B),
      }),
    );
    act(() => reload(toasts.error.mock.calls[0]?.[1] as ToastAction));
    await waitFor(() =>
      expect(screen.getByTitle("Tactics").getAttribute("src")).toBe(frameOf(RELEASE_B)),
    );
  });

  it("gives an embed of latest the same live client and Reload", async () => {
    calls.getGamePlay.mockResolvedValue(payload({ live: liveOn(RELEASE_A) }));
    wrap(<EmbedFrame projectId="tactics" version="latest" />);
    await screen.findByTitle("Tactics");
    expect(lastClient().initial).toEqual(liveOn(RELEASE_A));

    act(() => lastClient().onReleaseMoved());
    const [text, options] = toasts.show.mock.calls[0] as [string, ToastAction];
    expect(text).toBe("A new version of Tactics is available.");
    calls.getGamePlay.mockResolvedValue(
      payload({
        release: { ...payload().release, id: RELEASE_B },
        frameUrl: frameOf(RELEASE_B),
        live: liveOn(RELEASE_B),
      }),
    );
    act(() => reload(options));
    await waitFor(() =>
      expect(screen.getByTitle("Tactics").getAttribute("src")).toBe(frameOf(RELEASE_B)),
    );
  });

  it("starts no live client for an embedded version number", async () => {
    calls.getGamePlay.mockResolvedValue(payload({ live: null }));
    wrap(<EmbedFrame projectId="tactics" version="7" />);
    await screen.findByTitle("Tactics");
    expect(live.clients).toHaveLength(0);
  });
});
