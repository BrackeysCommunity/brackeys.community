/**
 * The shell's scene change: between ticks, through a transition's halves,
 * with a loading view on a slow preload. DOM only; the shell supplies the
 * runtime side (unload, preload, load) and the layer it draws into.
 */
import {
  flowIssue,
  type FlowRequest,
  type LibraryScene,
  type SceneLibrary,
  type TransitionSpec,
} from "./game/flow";
import type { AssetId } from "./project/types";
import type { LoadProgress } from "./render/asset-loader";
import { liveScene } from "./runtime/live";
import { makeIssue } from "./scene/issues";
import type { SceneIssue } from "./scene/types";
import type {
  FlowResult,
  LoadingView,
  LoadingViewFactory,
  SceneSource,
  TransitionRunner,
} from "./types";
import { createLoadingOverlay, fadeTransition } from "./ui/flow-views";

/** How long a preload runs before the loading view shows. */
export const LOADING_DELAY_MS = 150;

const NO_TRANSITION: TransitionSpec = { kind: "none" };

/** The live versions a scene source reads first: the active version's scene for a listed id, or null for the release's own. */
export type LiveSceneVersions = { sceneFor(id: AssetId): LibraryScene | null };

/**
 * `base` with each scene's active live version in place of its own, so
 * every load and sublevel library built from it gets that version; the
 * list and the start are `base`'s.
 */
export function liveSceneSource(base: SceneSource, live: LiveSceneVersions): SceneSource {
  return {
    list: () => base.list(),
    start: () => base.start(),
    scene: (id) => liveScene(live, id) ?? base.scene(id),
  };
}

/** `source`'s listed scenes as a run's library: what its flow loads and attaches read. */
export function sourceLibrary(source: SceneSource): SceneLibrary {
  const list = source.list();
  const scenes = new Map<AssetId, LibraryScene>();
  for (const entry of list) {
    const listed = source.scene(entry.scene);
    if (listed) scenes.set(entry.scene, listed);
  }
  return { list, scenes };
}

export type FlowHostOptions = {
  source: SceneSource;
  /** Runs every transition but "none"; default `fadeTransition()`. */
  transition?: TransitionRunner;
  /** Default `createLoadingOverlay()`; false shows none. */
  loading?: LoadingViewFactory | false;
  /** The element transitions and the loading view draw into; null runs a change without visuals. */
  layer(): HTMLElement | null;
  /** The main scene playing, or null. */
  current(): AssetId | null;
  /** Off stops the loop ticking (rendering goes on); on resumes it. */
  setTicking(on: boolean): void;
  /**
   * Runs the game's `onUnload` and leaves the world empty (sublevels with
   * it); returns what loads the unloaded scene again when the change fails.
   */
  unload(): () => void;
  preload(
    id: AssetId,
    scene: LibraryScene,
    onProgress: (p: LoadProgress) => void,
  ): Promise<unknown>;
  /** Builds the listed scene; `reset` returns persist to the game's initial value first. */
  load(
    id: AssetId,
    opts: { entry: string | null; persist?: FlowRequest["persist"]; reset?: boolean },
  ): FlowResult;
  /** After ticking resumes. */
  changed(e: ChangeEvent): void;
  /**
   * Once a change has left `scene` for a loaded one (the same scene on a
   * restart): a live layer drops its pending swap there, since the scene's
   * next load uses the version anyway. A failed change puts the scene back
   * and leaves its pending swap.
   */
  left?(scene: AssetId): void;
  loadingProgress(p: LoadProgress): void;
  destroyed(): boolean;
  dev: boolean;
  /** The instance's resolved reduced motion, handed to every transition; default false. */
  reducedMotion?: boolean;
};

export type FlowHost = {
  /** Changes to `to`; a call during a change waits for it. */
  go(to: AssetId, opts?: Omit<FlowRequest, "to">): Promise<FlowResult>;
  /** Changes to the list's start with persist reset. */
  restart(): Promise<FlowResult>;
  /** True from the moment a change starts until ticking resumes; no live swap runs while it is. */
  readonly changing: boolean;
  /** Drops the loading view and the layer's state; later calls refuse. */
  destroy(): void;
};

type ChangeEvent = { from: AssetId | null; to: AssetId; entry: string | null };
/** A change's result, and what to announce once ticking resumes. */
type Changed = { result: FlowResult; change?: ChangeEvent };

function destroyedResult(id: AssetId): FlowResult {
  return {
    ok: false,
    issue: makeIssue("schema", {
      message: `"${id}" didn't load: the game was destroyed`,
      entityIds: [id],
    }),
  };
}

export function createFlowHost(opts: FlowHostOptions): FlowHost {
  const runner = opts.transition ?? fadeTransition();
  const loadingFactory = opts.loading === false ? null : (opts.loading ?? createLoadingOverlay());
  let loadingView: LoadingView | null = null;
  /** Changes asked for and not yet finished; the loop ticks only at none. */
  let pending = 0;
  let tail: Promise<unknown> = Promise.resolve();

  /**
   * Queues a change behind any running one. Ticking stops now, before the
   * loop's next tick, and resumes once the last queued change is done.
   */
  function enqueue(run: () => Promise<Changed>): Promise<FlowResult> {
    pending++;
    opts.setTicking(false);
    const settle = async (): Promise<FlowResult> => {
      let done: Changed;
      try {
        done = await run();
      } finally {
        pending--;
        if (pending === 0 && !opts.destroyed()) opts.setTicking(true);
      }
      if (done.change && !opts.destroyed()) opts.changed(done.change);
      return done.result;
    };
    const next = tail.then(settle, settle);
    tail = next.catch(() => {});
    return next;
  }

  async function half(phase: "out" | "in", spec: TransitionSpec): Promise<void> {
    if (spec.kind === "none") return;
    const layer = opts.layer();
    if (!layer) return;
    try {
      await runner(phase, spec, layer, { reducedMotion: opts.reducedMotion ?? false });
    } catch (err) {
      if (opts.dev) console.warn(`[flow] the transition's ${phase} half failed`, err);
    }
  }

  async function preloadWithView(id: AssetId, scene: LibraryScene): Promise<void> {
    const layer = loadingFactory ? opts.layer() : null;
    let latest: LoadProgress = { loaded: 0, total: 0, bytes: 0, totalBytes: 0 };
    let shown = false;
    const timer = setTimeout(() => {
      if (!layer || !loadingFactory) return;
      loadingView ??= loadingFactory(layer);
      loadingView.show(latest);
      shown = true;
    }, LOADING_DELAY_MS);
    try {
      await opts.preload(id, scene, (p) => {
        latest = p;
        opts.loadingProgress(p);
        if (shown) loadingView?.show(p);
      });
    } catch (err) {
      if (opts.dev) console.warn(`[flow] "${id}" didn't preload; loading it anyway`, err);
    } finally {
      clearTimeout(timer);
      if (shown) loadingView?.hide();
    }
  }

  /**
   * One change, in order: ticking stops, the out half, the old scene
   * unloads, the new one preloads (the loading view past 150 ms) and loads,
   * the in half, ticking resumes and the change is announced.
   */
  async function change(
    to: AssetId,
    entry: string | null,
    spec: TransitionSpec,
    load: { persist?: FlowRequest["persist"]; reset?: boolean },
  ): Promise<Changed> {
    if (opts.destroyed()) return { result: destroyedResult(to) };
    const from = opts.current();
    await half("out", spec);
    if (opts.destroyed()) return { result: destroyedResult(to) };
    const putBack = opts.unload();
    const scene = opts.source.scene(to);
    let result: FlowResult;
    if (!scene) {
      result = {
        ok: false,
        issue: makeIssue("asset-missing", {
          message: `"${to}" is in the scene list, but the scene source holds no scene for it`,
          entityIds: [to],
        }),
      };
    } else {
      await preloadWithView(to, scene);
      if (opts.destroyed()) return { result: destroyedResult(to) };
      result = opts.load(to, { entry, ...load });
    }
    if (!result.ok) putBack();
    else if (from !== null) opts.left?.(from);
    await half("in", spec);
    if (opts.destroyed()) return { result: result.ok ? destroyedResult(to) : result };
    return result.ok ? { result, change: { from, to, entry } } : { result };
  }

  return {
    go(to, req = {}) {
      const refusedNow = flowIssue(opts.source.list(), to, "go");
      if (refusedNow) return Promise.resolve({ ok: false, issue: refusedNow });
      return enqueue(async () => {
        const refused = flowIssue(opts.source.list(), to, "go");
        if (refused) return { result: { ok: false, issue: refused } };
        return change(
          to,
          req.entry ?? null,
          req.transition ?? NO_TRANSITION,
          req.persist !== undefined ? { persist: req.persist } : {},
        );
      });
    },
    restart() {
      const startIssue = (): { refused: SceneIssue } | { start: AssetId } => {
        const start = opts.source.start();
        const refused = flowIssue(opts.source.list(), start, "start");
        if (refused) return { refused };
        if (start === null)
          return { refused: makeIssue("start-scene-missing", { message: "no start scene" }) };
        return { start };
      };
      const now = startIssue();
      if ("refused" in now) return Promise.resolve({ ok: false, issue: now.refused });
      return enqueue(async () => {
        const later = startIssue();
        if ("refused" in later) return { result: { ok: false, issue: later.refused } };
        return change(later.start, null, NO_TRANSITION, { reset: true });
      });
    },
    get changing() {
      return pending > 0;
    },
    destroy() {
      loadingView?.hide();
      loadingView = null;
    },
  };
}
