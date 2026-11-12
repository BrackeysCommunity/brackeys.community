import {
  DEFAULT_SAVE_LIMITS,
  effectiveSaveLimits,
  formatSaveFile,
  parseSaveFile,
  slotNameIssue,
  type SaveDepth,
  type SaveFile,
  type SaveLimits,
  type SaveMeta,
} from "../game/save-file";
import type { GameDefinition, SaveRequest } from "../game/types";
import { makeIssue } from "../scene/issues";
import type { SceneIssue } from "../scene/types";
import { browserSaveStore } from "./browser";
import {
  saveLimitIssue,
  storeFailed,
  textBytes,
  type SaveStore,
  type SaveSummary,
  type SaveWriteResult,
} from "./store";

/** A game instance's save slots, over the store precedence picked. */
export interface SaveSlots {
  readonly store: Pick<SaveStore, "kind" | "describe">;
  /** min(the game's limits or the defaults, `MAX_BROWSER_SAVE_LIMITS` for a browser store, the store's own). */
  readonly limits: SaveLimits;
  list(): Promise<readonly SaveSummary[]>;
  save(slot: string, opts?: { depth?: SaveDepth; title?: string }): Promise<SaveWriteResult>;
  load(
    slot: string,
  ): Promise<
    { ok: true; meta: SaveMeta; migratedFrom?: number } | { ok: false; issue: SceneIssue }
  >;
  remove(slot: string): Promise<void>;
}

type Failed = { ok: false; issue: SceneIssue };

/** What slots need from the instance they save: a capture of its world now, and a load of a save into it. */
export type SaveSlotsHost = {
  game: Pick<GameDefinition, "id" | "saves">;
  store: SaveStore;
  /** The host's clock, ms since the epoch: what `meta.savedAt` holds. */
  now(): number;
  /** Synchronous, so the save holds the world as it is when asked. */
  capture(opts: {
    depth: SaveDepth;
    slot: string;
    title?: string;
    now: number;
  }): { ok: true; file: SaveFile } | Failed;
  /** Pauses, swaps in the save's scene, restores it and resumes. */
  restore(file: SaveFile): Promise<{ ok: true } | Failed>;
};

/** The game's own backend, else the host's, else the browser's. */
export function pickSaveStore(
  game: Pick<GameDefinition, "saves"> | null,
  host: SaveStore | undefined,
): SaveStore {
  return game?.saves?.store?.() ?? host ?? browserSaveStore();
}

/** Runs a store call, turning a throw into `save-store-failed`. */
async function guarded<T>(what: string, slot: string, call: () => Promise<T>, text?: string) {
  try {
    return { ok: true as const, value: await call() };
  } catch (error) {
    return { ok: false as const, issue: storeFailed(what, slot, error, text) };
  }
}

/**
 * Slots over `host.store` for `host.game`. A save captures at once, then
 * judges size before any write and the slot limit before a new slot; writes
 * run one at a time, so saves made together can't pass the limit. Every
 * store call that throws is `save-store-failed`.
 */
export function createSaveSlots(host: SaveSlotsHost): SaveSlots {
  const { game, store } = host;
  const limits = effectiveSaveLimits(game, store);
  const slotNames = async () => (await store.list(game.id)).map((s) => s.slot);

  let writing: Promise<unknown> = Promise.resolve();
  function write(file: SaveFile): Promise<SaveWriteResult> {
    const next = writing.then(() => writeNow(file));
    writing = next.catch(() => {});
    return next;
  }

  async function writeNow(file: SaveFile): Promise<SaveWriteResult> {
    const text = formatSaveFile(file);
    const bytes = textBytes(text);
    const limited = await guarded(
      "listing before saving",
      file.slot,
      () => saveLimitIssue(limits, { slot: file.slot, text, bytes }, slotNames),
      text,
    );
    if (!limited.ok) return limited;
    if (limited.value) return { ok: false, issue: limited.value };
    const written = await guarded(
      "saving",
      file.slot,
      () => store.write(game.id, file.slot, text),
      text,
    );
    return written.ok ? written.value : written;
  }

  return {
    store: {
      kind: store.kind,
      get describe() {
        return store.describe;
      },
    },
    limits,
    async list() {
      const listed = await guarded("listing", "*", () => store.list(game.id));
      return listed.ok ? listed.value : [];
    },
    save(slot, opts) {
      const bad = slotNameIssue(slot);
      if (bad) return Promise.resolve({ ok: false, issue: bad });
      const captured = host.capture({
        depth: opts?.depth ?? "progress",
        slot,
        ...(opts?.title !== undefined ? { title: opts.title } : {}),
        now: host.now(),
      });
      return captured.ok ? write(captured.file) : Promise.resolve(captured);
    },
    async load(slot) {
      const bad = slotNameIssue(slot);
      if (bad) return { ok: false, issue: bad };
      const read = await guarded("loading", slot, () => store.read(game.id, slot));
      if (!read.ok) return read;
      if (read.value === null)
        return {
          ok: false,
          issue: makeIssue("save-store-failed", {
            message: `there's no save in slot "${slot}"`,
            path: "/slot",
          }),
        };
      const parsed = parseSaveFile(read.value, game);
      if (!parsed.ok) {
        const issue = parsed.issues.find((i) => i.severity === "error") ?? parsed.issues[0];
        return { ok: false, issue: issue ?? storeFailed("reading", slot, "unreadable") };
      }
      const restored = await host.restore(parsed.file);
      if (!restored.ok) return restored;
      return {
        ok: true,
        meta: parsed.file.meta,
        ...(parsed.migratedFrom !== undefined ? { migratedFrom: parsed.migratedFrom } : {}),
      };
    },
    async remove(slot) {
      if (slotNameIssue(slot)) return;
      await guarded("removing", slot, () => store.remove(game.id, slot));
    },
  };
}

/** Saves what game code asked for this tick; each result is a host event only. */
export function saveRequested(
  slots: SaveSlots,
  requests: readonly SaveRequest[],
  report: (slot: string, result: SaveWriteResult) => void,
): void {
  for (const { slot, depth, title } of requests) {
    const opts = {
      ...(depth !== undefined ? { depth } : {}),
      ...(title !== undefined ? { title } : {}),
    };
    void slots.save(slot, opts).then((result) => report(slot, result));
  }
}

/** Slots that hold nothing: `list` is empty and every save and load is `save-store-failed`. */
export function inertSaveSlots(
  why = "this instance runs no game, so it keeps no saves",
): SaveSlots {
  const unavailable = (slot: string) =>
    makeIssue("save-store-failed", { message: `slot "${slot}" can't be saved or loaded: ${why}` });
  return {
    store: { kind: "memory", describe: "Saving isn't available here." },
    limits: DEFAULT_SAVE_LIMITS,
    list: async () => [],
    save: async (slot) => ({ ok: false, issue: unavailable(slot) }),
    load: async (slot) => ({ ok: false, issue: unavailable(slot) }),
    remove: async () => {},
  };
}
