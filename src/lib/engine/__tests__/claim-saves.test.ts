import { memorySaveStore, type SaveStore, type SaveSummary } from "@jams/engine";
import { formatSaveFile, type SaveFile } from "@jams/engine/game";
import { makeIssue } from "@jams/engine/scene";
import { describe, expect, it } from "vite-plus/test";

import { CLAIM_GONE_MESSAGE, claimSaves, planClaim } from "../claim-saves";
import { SITE_SAVE_LIMITS } from "../limits";

const GAME = "tactics";

function saveText(slot: string, savedAt = 0): string {
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

const summary = (slot: string, savedAt = 0): SaveSummary => ({
  slot,
  meta: { title: `Save ${slot}`, scene: "level-1", savedAt, playTicks: 0 },
  bytes: 100,
});

async function localWith(...slots: string[]): Promise<SaveStore> {
  const store = memorySaveStore();
  for (const slot of slots) await store.write(GAME, slot, saveText(slot));
  return store;
}

/** The account's store: records writes, refusing the slots given. */
function fakeSite(refuse: Record<string, string> = {}) {
  const written = new Map<string, string>();
  const store: SaveStore = {
    kind: "host",
    describe: "On your account.",
    limits: SITE_SAVE_LIMITS,
    list: () => Promise.resolve([]),
    read: (_game, slot) => Promise.resolve(written.get(slot) ?? null),
    write(_game, slot, text) {
      const message = refuse[slot];
      if (message !== undefined) {
        return Promise.resolve({ ok: false, issue: makeIssue("save-slot-limit", { message }) });
      }
      written.set(slot, text);
      return Promise.resolve({ ok: true, bytes: text.length });
    },
    remove: () => Promise.resolve(),
  };
  return { store, written };
}

describe("planClaim", () => {
  it("ticks this browser's saves up to the account's free slots", () => {
    const rows = planClaim(
      ["a", "b", "c", "d"].map((s) => summary(s)),
      [summary("x"), summary("y")],
      SITE_SAVE_LIMITS,
    );
    expect(rows.map((r) => [r.slot, r.ticked])).toEqual([
      ["a", true],
      ["b", true],
      ["c", false],
      ["d", false],
    ]);
  });

  it("leaves a slot the account already holds unticked, with both saves", () => {
    const rows = planClaim(
      [summary("a", 2_000), summary("b")],
      [summary("a", 1_000)],
      SITE_SAVE_LIMITS,
    );
    expect(rows[0]).toMatchObject({ slot: "a", collides: true, ticked: false });
    expect(rows[0]?.local.meta.savedAt).toBe(2_000);
    expect(rows[0]?.account?.meta.savedAt).toBe(1_000);
    expect(rows[1]).toMatchObject({ slot: "b", collides: false, ticked: true, account: null });
  });

  it("ticks none when the account is full", () => {
    const account = ["w", "x", "y", "z"].map((s) => summary(s));
    expect(planClaim([summary("a")], account, SITE_SAVE_LIMITS)[0]?.ticked).toBe(false);
  });
});

describe("claimSaves", () => {
  it("uploads the ticked saves and removes each from this browser", async () => {
    const local = await localWith("a", "b");
    const site = fakeSite();
    const rows = planClaim(await local.list(GAME), [], SITE_SAVE_LIMITS);

    const results = await claimSaves(rows, local, site.store, GAME);

    expect(results).toEqual([
      { slot: "a", ok: true },
      { slot: "b", ok: true },
    ]);
    expect(site.written.get("a")).toBe(saveText("a"));
    expect(await local.list(GAME)).toEqual([]);
  });

  it("keeps a refused save in this browser, with the refusal's message", async () => {
    const local = await localWith("a", "b");
    const site = fakeSite({ b: "You have 4 saves for this game." });
    const rows = planClaim(await local.list(GAME), [], SITE_SAVE_LIMITS);

    const results = await claimSaves(rows, local, site.store, GAME);

    expect(results).toEqual([
      { slot: "a", ok: true },
      { slot: "b", ok: false, message: "You have 4 saves for this game." },
    ]);
    expect((await local.list(GAME)).map((s) => s.slot)).toEqual(["b"]);
  });

  it("leaves unticked saves alone", async () => {
    const local = await localWith("a", "b");
    const site = fakeSite();
    const rows = planClaim(await local.list(GAME), [], SITE_SAVE_LIMITS).map((r) => ({
      ...r,
      ticked: r.slot === "b",
    }));

    expect(await claimSaves(rows, local, site.store, GAME)).toEqual([{ slot: "b", ok: true }]);
    expect([...site.written.keys()]).toEqual(["b"]);
    expect((await local.list(GAME)).map((s) => s.slot)).toEqual(["a"]);
  });

  it("reports a save that left this browser before the upload", async () => {
    const local = await localWith("a");
    const rows = planClaim(await local.list(GAME), [], SITE_SAVE_LIMITS);
    await local.remove(GAME, "a");

    expect(await claimSaves(rows, local, fakeSite().store, GAME)).toEqual([
      { slot: "a", ok: false, message: CLAIM_GONE_MESSAGE },
    ]);
  });
});
