// @vitest-environment jsdom
import type { SaveStore } from "@jams/engine";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { PlayPayload } from "@/lib/engine/game-play";
import type { HostServerOptions } from "@/lib/engine/host-server";
import { SITE_SAVE_LIMITS } from "@/lib/engine/limits";
import { SIGNED_OUT_SAVES_DESCRIBE } from "@/lib/engine/local-saves";
import { SIGNED_IN_SAVES_DESCRIBE } from "@/lib/engine/save-api";

const auth = vi.hoisted(() => ({
  user: null as null | { id: string; name: string; image: string | null },
  pending: false,
}));
const hosts = vi.hoisted(() => ({ created: [] as HostServerOptions[] }));
const site = vi.hoisted(() => ({ stores: [] as Array<{ projectId: string; store: unknown }> }));

vi.mock("@/orpc/client", () => ({ client: {}, orpc: {} }));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: auth.user ? { user: auth.user } : null,
      isPending: auth.pending,
    }),
  },
  signInWithDiscord: vi.fn(),
}));
vi.mock("@/lib/hooks/use-flag", () => ({ useFlag: () => true, useFlagBlocks: () => false }));
vi.mock("@/lib/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/engine/guard", () => ({ engineGamesAllowed: () => true }));
vi.mock("@/lib/engine/host-server", () => ({
  createHostServer: (opts: HostServerOptions) => {
    hosts.created.push(opts);
    return { notifySavesChanged: vi.fn(), pause: vi.fn(), resume: vi.fn(), dispose: vi.fn() };
  },
}));
vi.mock("@/lib/engine/save-store", async () => {
  const { SIGNED_IN_SAVES_DESCRIBE: describe } = await import("@/lib/engine/save-api");
  return {
    siteSaveStore: (projectId: string): SaveStore => {
      const store: SaveStore = {
        kind: "host",
        describe,
        limits: SITE_SAVE_LIMITS,
        list: () => Promise.resolve([]),
        read: () => Promise.resolve(null),
        write: (_game, _slot, text) => Promise.resolve({ ok: true, bytes: text.length }),
        remove: () => Promise.resolve(),
      };
      site.stores.push({ projectId, store });
      return store;
    },
  };
});
vi.mock("@/components/canvas/shell/SiteMenu", () => ({
  SiteMenu: () => <button type="button">Site menu</button>,
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ children, to }: { children?: ReactNode; to?: string }) => <a href={to}>{children}</a>,
  useRouter: () => ({ history: { back: vi.fn() } }),
  useRouterState: () => "/games/tactics/play/latest",
}));

const { PlayChrome } = await import("../PlayChrome");

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
    ...patch,
  };
}

function wrap(node: ReactNode) {
  const queryClient = new QueryClient();
  const tree = (n: ReactNode) => (
    <QueryClientProvider client={queryClient}>{n}</QueryClientProvider>
  );
  const view = render(tree(node));
  return { ...view, rerender: (n: ReactNode) => view.rerender(tree(n)) };
}

function host(): HostServerOptions {
  const opts = hosts.created.at(-1);
  if (!opts) throw new Error("no host server created");
  return opts;
}

const text = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

async function openSaves(): Promise<string> {
  await userEvent.click(screen.getByRole("button", { name: "Saves" }));
  const notice = await screen.findByText("Saves.");
  const root = notice.closest("[data-save-mode]");
  if (!root) throw new Error("no save notice");
  return text(root);
}

beforeEach(() => {
  auth.user = null;
  auth.pending = false;
  hosts.created.length = 0;
  site.stores.length = 0;
  try {
    localStorage.clear();
  } catch {
    // jsdom without storage plays on the memory store
  }
});
afterEach(cleanup);

describe("the play page's saves", () => {
  it("signed in, serves the account's saves with the signed-in sentence", async () => {
    auth.user = { id: "u1", name: "Carol", image: null };
    wrap(<PlayChrome play={payload()} version="latest" />);

    expect(site.stores.map((s) => s.projectId)).toEqual(["tactics"]);
    const opts = host();
    expect(opts.saves()).toBe(site.stores[0]?.store);
    expect(opts.saves().kind).toBe("host");
    expect(opts.describe()).toBe(SIGNED_IN_SAVES_DESCRIBE);
    expect(opts.player?.()).toEqual({ signedIn: true, name: "Carol" });

    const notice = await openSaves();
    expect(notice).toContain(`Saves. ${SIGNED_IN_SAVES_DESCRIBE} Key bindings`);
    expect(notice).not.toContain(SIGNED_OUT_SAVES_DESCRIBE);
  });

  it("signed out, serves this browser's saves with the signed-out sentence", async () => {
    wrap(<PlayChrome play={payload()} version="latest" />);

    expect(site.stores).toEqual([]);
    const opts = host();
    expect(opts.saves().kind).toBe("browser");
    expect(opts.saves().limits).toEqual(SITE_SAVE_LIMITS);
    expect(opts.describe()).toBe(SIGNED_OUT_SAVES_DESCRIBE);
    expect(opts.player?.()).toEqual({ signedIn: false, name: null });

    const notice = await openSaves();
    expect(notice).toContain(`Saves. ${SIGNED_OUT_SAVES_DESCRIBE} Key bindings`);
    expect(notice).not.toContain(SIGNED_IN_SAVES_DESCRIBE);
  });

  it("waits for the session before it starts the game", () => {
    auth.pending = true;
    const view = wrap(<PlayChrome play={payload()} version="latest" />);
    expect(screen.queryByTitle("Tactics")).toBeNull();
    expect(screen.getByRole("status", { name: "Loading the game" })).toBeTruthy();
    expect(hosts.created).toEqual([]);

    auth.pending = false;
    auth.user = { id: "u1", name: "Carol", image: null };
    view.rerender(<PlayChrome play={payload()} version="latest" />);
    expect(screen.getByTitle("Tactics")).toBeTruthy();
    expect(hosts.created).toHaveLength(1);
    expect(host().saves().kind).toBe("host");
  });

  it("leaves the save menu's sentence out for a game that doesn't save to the site", async () => {
    auth.user = { id: "u1", name: "Carol", image: null };
    wrap(<PlayChrome play={payload({ saveMode: "none" })} version="latest" />);
    const notice = await openSaves();
    expect(notice).toContain("This game doesn't save progress.");
    expect(notice).not.toContain(SIGNED_IN_SAVES_DESCRIBE);
  });
});
