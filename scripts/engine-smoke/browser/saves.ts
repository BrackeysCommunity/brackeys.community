/**
 * The browser smoke's save run: a save written to, listed from, read back
 * from, overwritten in and removed from a real IndexedDB, through the
 * public entries, then the same through `browserSaveStore`, which must pick
 * IndexedDB in a browser. jsdom has no IndexedDB, so this page is the only
 * place the IndexedDB store runs. Any mismatch throws, failing the page.
 */
import { browserSaveStore, indexedDbSaveStore, type SaveStore } from "@jams/engine";
import { formatSaveFile, type SaveFile } from "@jams/engine/game";

export type SavesProbe = {
  /** Bytes the first write reported. */
  bytes: number;
  /** What the browser store tells players about where saves live. */
  describe: string;
};

const GAME = "smoke-saves";

const file = (slot: string, title: string): SaveFile => ({
  kind: "save",
  v: 1,
  game: GAME,
  gameVersion: 1,
  engine: "smoke",
  release: null,
  project: null,
  slot,
  meta: { title, scene: "smoke", savedAt: 0, playTicks: 0 },
  depth: "progress",
  persist: { coins: 3 },
  scene: { id: "smoke", runHash: "", sublevels: [] },
  data: { level: 2 },
});

function expectSame(what: string, got: unknown, want: unknown): void {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) throw new Error(`saves: ${what} was ${a}, not ${b}`);
}

async function roundTrip(store: SaveStore): Promise<number> {
  const first = formatSaveFile(file("slot-1", "First"));
  const written = await store.write(GAME, "slot-1", first);
  if (!written.ok) throw new Error(`saves: the write failed: ${written.issue.message}`);
  expectSame("the read", await store.read(GAME, "slot-1"), first);
  const listed = await store.list(GAME);
  expectSame(
    "the list",
    listed.map((s) => [s.slot, s.meta.title, s.bytes]),
    [["slot-1", "First", written.bytes]],
  );
  const again = formatSaveFile(file("slot-1", "Again"));
  if (!(await store.write(GAME, "slot-1", again)).ok)
    throw new Error("saves: the overwrite failed");
  expectSame("the overwritten read", await store.read(GAME, "slot-1"), again);
  await store.remove(GAME, "slot-1");
  expectSame("the list after remove", await store.list(GAME), []);
  return written.bytes;
}

function dropDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

export async function runSaves(): Promise<SavesProbe> {
  if (typeof indexedDB === "undefined") throw new Error("saves: this browser has no IndexedDB");
  const db = `jams-engine-smoke-saves-${Date.now()}`;
  try {
    const bytes = await roundTrip(indexedDbSaveStore({ db }));
    const browser = browserSaveStore();
    await roundTrip(browser);
    const text = formatSaveFile(file("probe", "Probe"));
    await browser.write(GAME, "probe", text);
    const inDb = await indexedDbSaveStore().read(GAME, "probe");
    await browser.remove(GAME, "probe");
    expectSame("browserSaveStore's save as IndexedDB holds it", inDb, text);
    return { bytes, describe: browser.describe };
  } finally {
    await dropDatabase(db);
  }
}
