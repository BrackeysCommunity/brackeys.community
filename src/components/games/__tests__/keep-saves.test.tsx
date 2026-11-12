// @vitest-environment jsdom
import { memorySaveStore, type SaveStore, type SaveSummary } from "@jams/engine";
import { formatSaveFile, type SaveFile } from "@jams/engine/game";
import { makeIssue } from "@jams/engine/scene";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SITE_SAVE_LIMITS } from "@/lib/engine/limits";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: toasts }));

const { KeepSavesDialog, keepSavesDeclinedKey, REPLACE_ACCOUNT_SAVE } =
  await import("../KeepSavesDialog");

const GAME = "tactics";
const PROJECT = "tactics";

function saveText(slot: string, savedAt: number): string {
  const file: SaveFile = {
    kind: "save",
    v: 1,
    game: GAME,
    gameVersion: 1,
    engine: "0.14.2",
    release: null,
    project: null,
    slot,
    meta: { title: `Save ${slot}`, scene: "level-1", savedAt, playTicks: 0 },
    depth: "progress",
    persist: null,
    scene: { id: "level-1", runHash: "", sublevels: [] },
    data: null,
  };
  return formatSaveFile(file);
}

async function localWith(...slots: string[]): Promise<SaveStore> {
  const store = memorySaveStore();
  for (const slot of slots) await store.write(GAME, slot, saveText(slot, Date.UTC(2026, 10, 1)));
  return store;
}

function fakeSite(opts: { account?: string[]; refuse?: Record<string, string> } = {}) {
  const written = new Map<string, string>();
  const account: SaveSummary[] = (opts.account ?? []).map((slot) => ({
    slot,
    meta: {
      title: `Account ${slot}`,
      scene: "level-2",
      savedAt: Date.UTC(2026, 9, 1),
      playTicks: 0,
    },
    bytes: 100,
  }));
  const store: SaveStore = {
    kind: "host",
    describe: "On your account.",
    limits: SITE_SAVE_LIMITS,
    list: () => Promise.resolve(account),
    read: () => Promise.resolve(null),
    write(_game, slot, text) {
      const message = opts.refuse?.[slot];
      if (message !== undefined) {
        return Promise.resolve({ ok: false, issue: makeIssue("save-too-large", { message }) });
      }
      written.set(slot, text);
      return Promise.resolve({ ok: true, bytes: text.length });
    },
    remove: () => Promise.resolve(),
  };
  return { store, written };
}

function show(local: SaveStore, site: SaveStore, signIn = "session-1") {
  const onClaimed = vi.fn();
  const view = render(
    <KeepSavesDialog
      projectId={PROJECT}
      gameId={GAME}
      title="Tactics"
      signIn={signIn}
      local={local}
      site={site}
      onClaimed={onClaimed}
    />,
  );
  return { onClaimed, ...view };
}

const box = (dialog: HTMLElement, title: string) => {
  const item = within(dialog).getByText(title).closest("li");
  if (!item) throw new Error(`no row for ${title}`);
  return within(item).getByRole("checkbox");
};

beforeEach(() => {
  sessionStorage.clear();
  toasts.success.mockReset();
});
afterEach(cleanup);

describe("Keep your saves", () => {
  it("ticks this browser's saves up to the account's free slots", async () => {
    const local = await localWith("a", "b", "c");
    show(local, fakeSite({ account: ["x", "y"] }).store);

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("room for 2 more of 4");
    expect(box(dialog, "Save a").getAttribute("aria-checked")).toBe("true");
    expect(box(dialog, "Save b").getAttribute("aria-checked")).toBe("true");
    expect(box(dialog, "Save c").getAttribute("aria-checked")).toBe("false");
    expect(within(dialog).getByRole("button", { name: "Keep 2 saves" })).toBeTruthy();
  });

  it("leaves a colliding slot unticked and shows both dates", async () => {
    const local = await localWith("a");
    show(local, fakeSite({ account: ["a"] }).store);

    const dialog = await screen.findByRole("alertdialog");
    expect(box(dialog, "Save a").getAttribute("aria-checked")).toBe("false");
    expect(dialog.textContent).toContain(REPLACE_ACCOUNT_SAVE);
    expect(dialog.textContent).toContain("This browser");
    expect(dialog.textContent).toContain("Your account");
    expect(
      within(dialog).getByRole("button", { name: "Keep 0 saves" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("uploads the ticked saves, removes them from this browser and tells the host", async () => {
    const user = userEvent.setup();
    const local = await localWith("a", "b");
    const site = fakeSite();
    const { onClaimed } = show(local, site.store);

    await user.click(await screen.findByRole("button", { name: "Keep 2 saves" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect([...site.written.keys()]).toEqual(["a", "b"]);
    expect(await local.list(GAME)).toEqual([]);
    expect(onClaimed).toHaveBeenCalledTimes(1);
    expect(toasts.success).toHaveBeenCalled();
    expect(sessionStorage.getItem(keepSavesDeclinedKey(PROJECT))).toBeNull();
  });

  it("keeps a refused save in this browser and shows its message", async () => {
    const user = userEvent.setup();
    const local = await localWith("a", "b");
    const site = fakeSite({ refuse: { b: "This save is 40 KB; saves are limited to 32 KB." } });
    const { onClaimed } = show(local, site.store);

    await user.click(await screen.findByRole("button", { name: "Keep 2 saves" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("This save is 40 KB; saves are limited to 32 KB.");
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).queryByText("Save a")).toBeNull();
    expect(within(dialog).getByText("Save b")).toBeTruthy();
    expect((await local.list(GAME)).map((s) => s.slot)).toEqual(["b"]);
    expect(onClaimed).toHaveBeenCalledTimes(1);
  });

  it("keeps every save when declined, and asks again only on the next sign-in", async () => {
    const user = userEvent.setup();
    const local = await localWith("a", "b");
    const site = fakeSite();
    const first = show(local, site.store);

    await user.click(await screen.findByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(site.written.size).toBe(0);
    expect((await local.list(GAME)).map((s) => s.slot)).toEqual(["a", "b"]);
    expect(first.onClaimed).not.toHaveBeenCalled();
    first.unmount();

    const again = show(local, site.store);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    again.unmount();

    show(local, site.store, "session-2");
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
  });

  it("asks nothing when this browser holds no saves", async () => {
    const list = vi.fn(() => Promise.resolve([] as SaveSummary[]));
    show(memorySaveStore(), { ...fakeSite().store, list });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it("still asks when this tab's storage refuses", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    try {
      show(await localWith("a"), fakeSite().store);
      expect(await screen.findByRole("alertdialog")).toBeTruthy();
    } finally {
      get.mockRestore();
    }
  });
});
