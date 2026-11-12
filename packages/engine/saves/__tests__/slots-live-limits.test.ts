import { describe, expect, it } from "vite-plus/test";

import { MAX_BROWSER_SAVE_LIMITS, type SaveFile, type SaveLimits } from "../../game/save-file";
import { createSaveSlots, type SaveSlotsHost } from "../slots";
import { memorySaveStore, type SaveStore } from "../store";

const file = (slot: string, pad: number): SaveFile => ({
  kind: "save",
  v: 1,
  game: "vault",
  gameVersion: 1,
  engine: "0.14.2",
  release: null,
  project: null,
  slot,
  meta: { scene: "one", savedAt: 0, playTicks: 0, title: "x".repeat(pad) },
  depth: "progress",
  persist: null,
  scene: { id: "one", runHash: "", sublevels: [] },
  data: null,
});

/** A store whose limits the test changes between saves, as a host's do after sign-in. */
function shiftingStore(kind: SaveStore["kind"], initial?: Partial<SaveLimits>) {
  const inner = memorySaveStore();
  let current = initial;
  const store: SaveStore = {
    kind,
    describe: "The host's.",
    get limits() {
      return current;
    },
    list: (gameId) => inner.list(gameId),
    read: (gameId, slot) => inner.read(gameId, slot),
    write: (gameId, slot, text) => inner.write(gameId, slot, text),
    remove: (gameId, slot) => inner.remove(gameId, slot),
  };
  return { store, set: (next: Partial<SaveLimits> | undefined) => (current = next) };
}

function slotsOver(store: SaveStore, game: SaveSlotsHost["game"] = { id: "vault" }) {
  let pad = 0;
  const slots = createSaveSlots({
    game,
    store,
    now: () => 0,
    capture: ({ slot }) => ({ ok: true, file: file(slot, pad) }),
    restore: async () => ({ ok: true }),
  });
  return { slots, pad: (n: number) => (pad = n) };
}

describe("SaveSlots' live limits", () => {
  it("applies a store's raised byte limit to the next save", async () => {
    const { store, set } = shiftingStore("host", { maxBytes: 1_000 });
    const { slots, pad } = slotsOver(store);
    pad(2_000);
    const first = await slots.save("a");
    expect(first.ok ? null : first.issue.code).toBe("save-too-large");
    set({ maxBytes: 8_000 });
    expect(slots.limits.maxBytes).toBe(8_000);
    expect((await slots.save("a")).ok).toBe(true);
  });

  it("applies a store's lowered slot limit to the next save, never to an overwrite", async () => {
    const { store, set } = shiftingStore("host");
    const { slots } = slotsOver(store);
    expect((await slots.save("a")).ok).toBe(true);
    expect((await slots.save("b")).ok).toBe(true);
    set({ maxSlots: 2 });
    expect(slots.limits).toEqual({ maxBytes: 65_536, maxSlots: 2 });
    const third = await slots.save("c");
    expect(third.ok ? null : third.issue.code).toBe("save-slot-limit");
    expect((await slots.save("b")).ok).toBe(true);
    set(undefined);
    expect((await slots.save("c")).ok).toBe(true);
  });

  it("keeps the game's own limits and the browser cap as the ceiling of a changing store", async () => {
    const game = { id: "vault", saves: { version: 1, limits: { maxSlots: 3 } } };
    const host = shiftingStore("host", { maxSlots: 10 });
    expect(slotsOver(host.store, game).slots.limits.maxSlots).toBe(3);
    host.set({ maxSlots: 1 });
    expect(slotsOver(host.store, game).slots.limits.maxSlots).toBe(1);

    const browser = shiftingStore("browser", { maxBytes: 10_000_000 });
    const { slots } = slotsOver(browser.store);
    expect(slots.limits.maxBytes).toBe(Math.min(65_536, MAX_BROWSER_SAVE_LIMITS.maxBytes));
    browser.set({ maxBytes: 100 });
    expect(slots.limits.maxBytes).toBe(100);
  });

  it("judges a queued write under the limits standing when it runs", async () => {
    const { store, set } = shiftingStore("host", { maxSlots: 1 });
    const { slots } = slotsOver(store);
    const first = slots.save("a");
    set({ maxSlots: 2 });
    const second = slots.save("b");
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
  });
});
