// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { unzipSync } from "fflate";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { AccountSaves } from "@/lib/engine/save-api";

const saves = vi.hoisted(() => ({
  fetchAccountSaves: vi.fn(),
  fetchSaveText: vi.fn(),
  deleteAccountSave: vi.fn(),
}));
const gate = vi.hoisted(() => ({ flag: true, allowed: true, signedIn: true }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }));

vi.mock("@/lib/engine/save-store", () => saves);
vi.mock("@/lib/toast", () => ({ toast: Object.assign(vi.fn(), toasts) }));
vi.mock("@/lib/hooks/use-flag", () => ({
  useFlag: (key: string) => key === "engine-games-enabled" && gate.flag,
}));
vi.mock("@/lib/engine/guard", () => ({ engineGamesAllowed: () => gate.allowed }));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: gate.signedIn ? { user: { id: "u1", name: "Player" } } : null,
      isPending: false,
    }),
  },
  signInWithDiscord: vi.fn(),
}));
vi.mock("@/components/layout/NotFoundPage", () => ({
  NotFoundPage: () => <p>Not found</p>,
}));

const { GameSaves, GameSavesPage, SAVES_ZIP_NAME, GAME_SAVES_SETTINGS_RULE } =
  await import("../GameSaves");
const { useSettingsNavTabs, SETTINGS_TABS } = await import("../settings-tabs");

const meta = (title: string | undefined, savedAt = 0) => ({
  ...(title ? { title } : {}),
  scene: "level-1",
  savedAt,
  playTicks: 60,
});

const ACCOUNT: AccountSaves = {
  games: [
    {
      projectId: "moon-miner",
      title: "Moon Miner",
      saves: [
        {
          slot: "auto",
          meta: meta("Crater 3"),
          bytes: 12_288,
          gameVersion: 2,
          releaseId: "r1",
          writtenAt: "2026-11-01T10:00:00.000Z",
          usedAt: "2026-11-10T10:00:00.000Z",
        },
        {
          slot: "slot-2",
          meta: meta(undefined),
          bytes: 2_048,
          gameVersion: 2,
          releaseId: "r1",
          writtenAt: "2026-11-02T10:00:00.000Z",
          usedAt: "2026-11-02T10:00:00.000Z",
        },
      ],
    },
    {
      projectId: "tiny-tactics",
      title: "Tiny Tactics",
      saves: [
        {
          slot: "auto",
          meta: meta("Turn 14"),
          bytes: 30_720,
          gameVersion: 1,
          releaseId: null,
          writtenAt: "2026-10-01T10:00:00.000Z",
          usedAt: "2026-10-05T10:00:00.000Z",
        },
      ],
    },
  ],
  usedBytes: 45_056,
  maxBytes: 1_048_576,
  expiryDays: 180,
};

function renderPane(node: ReactNode = <GameSaves />) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

function readBlob(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

beforeEach(() => {
  gate.flag = true;
  gate.allowed = true;
  gate.signedIn = true;
  saves.fetchAccountSaves.mockResolvedValue(ACCOUNT);
  saves.deleteAccountSave.mockResolvedValue(undefined);
  saves.fetchSaveText.mockImplementation(
    async (projectId: string, slot: string) => `{"game":"${projectId}","slot":"${slot}"}`,
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("Settings → Game saves", () => {
  it("states the expiry rule at the top", async () => {
    renderPane();
    expect(GAME_SAVES_SETTINGS_RULE).toBe(
      "Games on jams.team can save to your account: up to 4 saves of 32 KB per game, 1 MB in all. A save you don't load, overwrite or open the game's save menu for in 180 days is deleted. Saves made while signed out stay in that browser and aren't listed here.",
    );
    expect(screen.getByText(GAME_SAVES_SETTINGS_RULE)).toBeTruthy();
    await screen.findByText("Moon Miner");
  });

  it("lists every game's saves with size and last use, and the total against 1 MB", async () => {
    renderPane();

    const moon = await screen.findByRole("region", { name: "Moon Miner" });
    expect(within(moon).getByText("Crater 3")).toBeTruthy();
    expect(within(moon).getByText("Slot slot-2")).toBeTruthy();
    expect(within(moon).getByText("12 KB")).toBeTruthy();
    expect(within(moon).getByText("2 KB")).toBeTruthy();
    expect(within(moon).getByText(/2 saves · 14 KB/)).toBeTruthy();
    const times = moon.querySelectorAll("time");
    expect(times[0]?.getAttribute("dateTime")).toBe("2026-11-10T10:00:00.000Z");
    expect(times[0]?.textContent).toMatch(/^Last used .* · Nov 10, 2026 UTC$/);

    const tactics = screen.getByRole("region", { name: "Tiny Tactics" });
    expect(within(tactics).getByText("Turn 14")).toBeTruthy();

    expect(screen.getByText("44 KB of 1 MB used")).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    expect(Number(bar.getAttribute("aria-valuenow"))).toBeCloseTo((45_056 / 1_048_576) * 100);
  });

  it.each([
    [0.5, "ok"],
    [0.8, "warn"],
    [1, "full"],
  ])("colours the total's bar at %s of the cap as %s", async (share, level) => {
    saves.fetchAccountSaves.mockResolvedValue({
      ...ACCOUNT,
      usedBytes: Math.round(ACCOUNT.maxBytes * share),
    });
    renderPane();
    await screen.findByText("Moon Miner");
    expect(screen.getByRole("progressbar").getAttribute("data-level")).toBe(level);
  });

  it("says it's preparing the download while the saves load", async () => {
    Object.assign(URL, { createObjectURL: () => "blob:saves", revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    let finish: () => void = () => {};
    const waiting = new Promise<void>((resolve) => (finish = resolve));
    saves.fetchSaveText.mockImplementation(async () => {
      await waiting;
      return "{}";
    });
    const user = userEvent.setup();
    renderPane();
    await screen.findByText("Moon Miner");

    await user.click(screen.getByRole("button", { name: /download my saves/i }));
    const busy = await screen.findByRole("button", { name: /preparing/i });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.hasAttribute("disabled")).toBe(true);
    finish();
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("Downloaded 3 saves."));
    expect(
      screen.getByRole("button", { name: /download my saves/i }).hasAttribute("aria-busy"),
    ).toBe(false);
  });

  it("shows a skeleton while loading and an empty state with no saves", async () => {
    let answer: (value: AccountSaves) => void = () => {};
    saves.fetchAccountSaves.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { container } = renderPane();
    expect(container.querySelector('[data-slot="skeleton"]')).toBeTruthy();

    answer({ ...ACCOUNT, games: [], usedBytes: 0 });
    expect(await screen.findByText("No games have saved to your account yet.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /download my saves/i }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("asks before deleting one save, then deletes it", async () => {
    const user = userEvent.setup();
    renderPane();
    const moon = await screen.findByRole("region", { name: "Moon Miner" });

    await user.click(within(moon).getByRole("button", { name: "Delete Crater 3" }));
    expect(saves.deleteAccountSave).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete “Crater 3”?")).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(saves.deleteAccountSave).toHaveBeenCalledWith("moon-miner", "auto"));
    expect(saves.deleteAccountSave).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("Deleted “Crater 3”."));
    await waitFor(() => expect(saves.fetchAccountSaves).toHaveBeenCalledTimes(2));
  });

  it("cancelling the question deletes nothing", async () => {
    const user = userEvent.setup();
    renderPane();
    const moon = await screen.findByRole("region", { name: "Moon Miner" });

    await user.click(within(moon).getByRole("button", { name: "Delete all" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(saves.deleteAccountSave).not.toHaveBeenCalled();
  });

  it("deleting a game asks first, then deletes each of its slots", async () => {
    const user = userEvent.setup();
    renderPane();
    const moon = await screen.findByRole("region", { name: "Moon Miner" });

    await user.click(within(moon).getByRole("button", { name: "Delete all" }));
    expect(saves.deleteAccountSave).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete every save for Moon Miner?")).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "Delete all" }));
    await waitFor(() => expect(saves.deleteAccountSave).toHaveBeenCalledTimes(2));
    expect(saves.deleteAccountSave.mock.calls).toEqual([
      ["moon-miner", "auto"],
      ["moon-miner", "slot-2"],
    ]);
    await waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith("Deleted your saves for Moon Miner."),
    );
  });

  it("a refused delete shows the API's message", async () => {
    saves.deleteAccountSave.mockRejectedValue(new Error("You're saving very often."));
    const user = userEvent.setup();
    renderPane();
    const moon = await screen.findByRole("region", { name: "Moon Miner" });

    await user.click(within(moon).getByRole("button", { name: "Delete Crater 3" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith("You're saving very often."));
  });

  it("downloads a zip of the save texts named <game>/<slot>.save.json", async () => {
    const blobs: Blob[] = [];
    const create = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return "blob:saves";
    });
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    let downloaded = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        downloaded = this.download;
      },
    );
    const user = userEvent.setup();
    renderPane();
    await screen.findByText("Moon Miner");

    await user.click(screen.getByRole("button", { name: /download my saves/i }));
    await waitFor(() => expect(blobs).toHaveLength(1));
    expect(downloaded).toBe(SAVES_ZIP_NAME);
    expect(saves.fetchSaveText).toHaveBeenCalledTimes(3);

    const entries = unzipSync(await readBlob(blobs[0]!));
    const decoded = Object.fromEntries(
      Object.entries(entries).map(([path, bytes]) => [path, new TextDecoder().decode(bytes)]),
    );
    expect(decoded).toEqual({
      "moon-miner/auto.save.json": '{"game":"moon-miner","slot":"auto"}',
      "moon-miner/slot-2.save.json": '{"game":"moon-miner","slot":"slot-2"}',
      "tiny-tactics/auto.save.json": '{"game":"tiny-tactics","slot":"auto"}',
    });
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("Downloaded 3 saves."));
  });

  it("a save that doesn't load is left out of the zip and named in the toast", async () => {
    const blobs: Blob[] = [];
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => (blobs.push(blob), "blob:saves"),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    saves.fetchSaveText.mockImplementation(async (projectId: string, slot: string) => {
      if (slot === "slot-2") throw new Error("network");
      return projectId === "tiny-tactics" ? null : "{}";
    });
    const user = userEvent.setup();
    renderPane();
    await screen.findByText("Moon Miner");

    await user.click(screen.getByRole("button", { name: /download my saves/i }));
    await waitFor(() => expect(blobs).toHaveLength(1));
    expect(Object.keys(unzipSync(await readBlob(blobs[0]!)))).toEqual([
      "moon-miner/auto.save.json",
    ]);
    expect(toasts.warning).toHaveBeenCalledWith("Downloaded 1 of 3 saves. 2 didn't load.");
  });

  it("asks a signed-out visitor to sign in", () => {
    gate.signedIn = false;
    renderPane();
    expect(screen.getByText(/Sign in to see the saves/)).toBeTruthy();
    expect(saves.fetchAccountSaves).not.toHaveBeenCalled();
  });
});

describe("the Game saves section's gate", () => {
  it("renders the pane and lists the nav entry before Account while the flag and the guard hold", async () => {
    renderPane(<GameSavesPage />);
    expect(await screen.findByText("Moon Miner")).toBeTruthy();
    const { result } = renderHook(() => useSettingsNavTabs());
    expect(result.current).toEqual([
      "appearance",
      "motion",
      "notifications",
      "privacy",
      "game-saves",
      "account",
    ]);
  });

  it("is hidden with the flag off: 404 and no nav entry", () => {
    gate.flag = false;
    renderPane(<GameSavesPage />);
    expect(screen.getByText("Not found")).toBeTruthy();
    expect(saves.fetchAccountSaves).not.toHaveBeenCalled();
    expect(renderHook(() => useSettingsNavTabs()).result.current).toEqual(SETTINGS_TABS);
  });

  it("is hidden where the deployment doesn't host games", () => {
    gate.allowed = false;
    renderPane(<GameSavesPage />);
    expect(screen.getByText("Not found")).toBeTruthy();
    expect(renderHook(() => useSettingsNavTabs()).result.current).not.toContain("game-saves");
  });

  it("isn't one of the sections kept in this browser", async () => {
    const { LOCAL_SETTINGS_TABS } = await import("../settings-tabs");
    expect(LOCAL_SETTINGS_TABS).not.toContain("game-saves");
  });
});
