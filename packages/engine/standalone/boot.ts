// A hosted release runs under a CSP without 'unsafe-eval'; Pixi's eval-free shader and uniform sync works there and anywhere else.
import "pixi.js/unsafe-eval";
import { createGame } from "../engine";
import { createRegistry, withProject } from "../game/define";
import type { LibraryScene, SceneListEntry } from "../game/flow";
import { resolveTime } from "../game/time";
import type { GameDefinition, Registry } from "../game/types";
import { browserRemapStore, snapshotRemapStore } from "../input/remap";
import { stableJson } from "../project/canonical";
import { ContentStoreError, memoryContentStore } from "../project/content-store";
import { createKindRegistry } from "../project/kinds";
import {
  checkReleaseManifest,
  CREDITS_FILE,
  ENGINE_FORMATS,
  parseReleaseManifest,
  RELEASE_FILE,
  releaseId,
  releaseSnapshot,
  SERVICE_WORKER_FILE,
  type ReleaseManifest,
} from "../project/release";
import { jsonValues, snapshotScene, SnapshotError } from "../project/snapshot";
import type { AssetId, Sha256 } from "../project/types";
import { createAssetLoader } from "../render/asset-loader";
import { browserSaveStore } from "../saves/browser";
import { channelSaveStore, type SaveStore } from "../saves/store";
import { makeIssue } from "../scene/issues";
import type { SceneIssue } from "../scene/types";
import type { GameEventMap, GameInstance, RapierModule, SceneSource } from "../types";
import { mountUi } from "../ui/layer";
import type { MountUi, UiContext } from "../ui/types";
import { ENGINE_VERSION } from "../version";
import { fetchReleaseTexts, fetchText, releaseUrl, type FetchText } from "./data";
import { renderBootError, StandaloneBootError } from "./errors";
import { connectHost, hostRequested, type HostChannel } from "./host-channel";
import { manifestRuntimeView, manifestView } from "./manifest-view";

export type StandaloneOptions = {
  /** The element the game's canvas and UI go in. */
  root: HTMLElement;
  game: GameDefinition;
  ui?: MountUi;
  /** Present only when the build ships Rapier. */
  rapier?: () => Promise<RapierModule>;
  /** The manifest's URL, resolved against the document's base URI; default "release.json" next to the page. */
  release?: string;
  /** Default `browserSaveStore()`, or the host's store when a page hosts the frame; a game's own `saves.store` still wins. */
  saves?: SaveStore;
  /** Default true when the manifest has `pwa`; ignored where there is no service worker or the context isn't secure. */
  serviceWorker?: boolean;
  fetch?: typeof fetch;
  /**
   * Default true: the page is laid out for the game alone (no margin or
   * scrolling, the build's background, `root` fixed over the whole window)
   * and the canvas takes the root's size. False leaves the page's layout to
   * its own CSS, which then gives `root` its size.
   */
  fillPage?: boolean;
};

export type StandaloneGame = {
  instance: GameInstance;
  manifest: ReleaseManifest;
  /** The release id: the SHA-256 of `release.json`'s text. */
  release: Sha256;
  /**
   * Shows the browser's install prompt, resolving true once it was accepted.
   * null until the browser offers one (`beforeinstallprompt`), after it was
   * used, and wherever the build registers no service worker.
   */
  install: (() => Promise<boolean>) | null;
  /** The credits page, relative to the manifest: "credits.html". */
  credits: string;
  /** The page hosting this frame (`?host=jams`), or null when none answered. */
  host: HostChannel | null;
  destroy(): void;
};

/** Chromium's `beforeinstallprompt` event: the install prompt, deferred until `prompt()`. */
type InstallPromptEvent = Event & {
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** Whether `win` can run a service worker: it has the API and its context is secure. */
const canServiceWork = (win: Window | null): win is Window =>
  win !== null && "serviceWorker" in win.navigator && win.isSecureContext === true;

/**
 * Holds the browser's install prompt from the moment it fires (keeping its
 * own banner back), so `install()` can show it later. An event prompts
 * once, and installing drops it.
 */
function installPrompt(win: Window) {
  let deferred: InstallPromptEvent | null = null;
  const listeners = new Set<() => void>();
  const set = (next: InstallPromptEvent | null) => {
    const changed = (deferred === null) !== (next === null);
    deferred = next;
    if (changed) for (const fn of [...listeners]) fn();
  };
  const onPrompt = (event: Event) => {
    event.preventDefault();
    set(event as InstallPromptEvent);
  };
  const onInstalled = () => set(null);
  win.addEventListener("beforeinstallprompt", onPrompt);
  win.addEventListener("appinstalled", onInstalled);
  const install = async (): Promise<boolean> => {
    const event = deferred;
    if (!event) return false;
    set(null);
    try {
      await event.prompt();
      return (await event.userChoice).outcome === "accepted";
    } catch {
      return false;
    }
  };
  const ui: NonNullable<UiContext["install"]> = {
    current: () => (deferred ? install : null),
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return {
    ui,
    current: () => ui.current(),
    stop() {
      win.removeEventListener("beforeinstallprompt", onPrompt);
      win.removeEventListener("appinstalled", onInstalled);
      set(null);
      listeners.clear();
    },
  };
}

type Formats = ReleaseManifest["engine"]["formats"];

const setState = (doc: Document, state: "loading" | "ready" | "error") => {
  doc.documentElement.dataset.jamsState = state;
};

/** What `data-jams-render` says: the GPU context is gone, came back in place, a new renderer took over, or none could be built. */
export type RenderState = "lost" | "restored" | "rebuilt" | "failed";

/**
 * Mirrors the game's renderer on `root` (default the document's root
 * element), where the page, its tests and a smoke can read it:
 * `dataset.jamsRender` is "lost" from `render:lost`, then "restored" or
 * "rebuilt" from `render:restored`, or "failed" from `render:failed`;
 * `dataset.jamsRenderFallback` is the
 * reason ("init" or "lost") once `render:fallback` moved drawing to WebGL.
 * Listen before `start()`, which tells an init fallback. The returned stop
 * clears both.
 */
export function mirrorRenderState(
  game: Pick<GameInstance, "on" | "off">,
  root: HTMLElement = document.documentElement,
): () => void {
  const set = (state: RenderState) => {
    root.dataset.jamsRender = state;
  };
  const onLost = () => set("lost");
  const onRestored = ({ rebuilt }: GameEventMap["render:restored"]) =>
    set(rebuilt ? "rebuilt" : "restored");
  const onFailed = () => set("failed");
  const onFallback = ({ reason }: GameEventMap["render:fallback"]) => {
    root.dataset.jamsRenderFallback = reason;
  };
  game.on("render:lost", onLost);
  game.on("render:restored", onRestored);
  game.on("render:failed", onFailed);
  game.on("render:fallback", onFallback);
  return () => {
    game.off("render:lost", onLost);
    game.off("render:restored", onRestored);
    game.off("render:failed", onFailed);
    game.off("render:fallback", onFallback);
    delete root.dataset.jamsRender;
    delete root.dataset.jamsRenderFallback;
  };
}

/** The issues a thrown error carries, or null for one that carries none. */
function issuesOf(error: unknown): readonly SceneIssue[] | null {
  if (error instanceof StandaloneBootError || error instanceof SnapshotError) return error.issues;
  if (error instanceof ContentStoreError) return [error.issue];
  return null;
}

/** The manifest's formats this engine can't read: `version-newer`. */
function formatIssues(m: ReleaseManifest): SceneIssue[] {
  const readable = ENGINE_FORMATS;
  return (Object.keys(readable) as (keyof Formats)[])
    .filter((name) => m.engine.formats[name] > readable[name])
    .map((name) =>
      makeIssue("version-newer", {
        message: `this build's ${name} format is v${m.engine.formats[name]}, newer than the v${readable[name]} this engine (${m.engine.version}) reads`,
        path: `/engine/formats/${name}`,
        expected: `v${readable[name]} or older`,
        got: `v${m.engine.formats[name]}`,
      }),
    );
}

/** The game's time model as this page resolves it must be the build's: else its code and data come from different builds. */
function timeIssues(m: ReleaseManifest, time: ReturnType<typeof resolveTime>): SceneIssue[] {
  const resolved: ReleaseManifest["time"] = {
    kind: time.kind,
    rate: time.rate,
    catchUp: time.catchUp,
    wakeOnPointerMove: time.wakeOnPointerMove,
  };
  const want = stableJson(m.time);
  const got = stableJson(resolved);
  if (want === got) return [];
  return [
    makeIssue("hash-mismatch", {
      message:
        "the game's time model isn't the one release.json was built with: the page's code and its data come from different builds; reload to fetch one build",
      path: "/time",
      expected: want,
      got,
    }),
  ];
}

/** The game's save version and config hash must be the build's: else its code and data come from different builds. */
function gameIssues(m: ReleaseManifest, game: GameDefinition): SceneIssue[] {
  const page = { saveVersion: game.saves?.version ?? null, configHash: game.configHash ?? null };
  return (["saveVersion", "configHash"] as const)
    .filter((field) => m.game[field] !== page[field])
    .map((field) =>
      makeIssue("hash-mismatch", {
        message: `the game's ${field} (${String(page[field])}) isn't the ${String(m.game[field])} release.json was built with: the page's code and its data come from different builds; reload to fetch one build`,
        path: `/game/${field}`,
        expected: String(m.game[field]),
        got: String(page[field]),
      }),
    );
}

/** The page's background while the build has none of its own (a target without the PWA). */
const DEFAULT_BACKGROUND = "#000000";

/** Lays the page out for the game alone, through CSSOM so a strict CSP allows it. */
function fillPage(root: HTMLElement, background: string | null): void {
  const doc = root.ownerDocument;
  const html = doc.documentElement.style;
  html.height = "100%";
  html.overflow = "hidden";
  html.background = background ?? DEFAULT_BACKGROUND;
  const body = doc.body?.style;
  if (body) {
    body.margin = "0";
    body.height = "100%";
    body.overflow = "hidden";
    body.background = background ?? DEFAULT_BACKGROUND;
  }
  Object.assign(root.style, {
    position: "fixed",
    top: "0",
    right: "0",
    bottom: "0",
    left: "0",
    overflow: "hidden",
    touchAction: "none",
    overscrollBehavior: "none",
  });
}

/** The line shown in `root` until the game's first scene is up. */
function showLoading(root: HTMLElement, cover: boolean): { remove(): void } {
  const line = root.ownerDocument.createElement("p");
  line.dataset.jamsLoading = "";
  line.setAttribute("role", "status");
  line.textContent = "Loading…";
  line.style.cssText = `${cover ? "position:absolute;inset:0;" : ""}margin:0;padding:16px;display:flex;align-items:center;justify-content:center;font:16px/1.4 system-ui,sans-serif;color:#888;pointer-events:none`;
  root.append(line);
  return { remove: () => line.remove() };
}

/** `?renderer=webgl` on the page asks for WebGL. */
function rendererPreference(doc: Document): { preference: "webgl" } | null {
  const search = doc.defaultView?.location.search ?? "";
  return new URLSearchParams(search).get("renderer") === "webgl" ? { preference: "webgl" } : null;
}

/** The manifest's scene list over the listed scenes, each resident. */
async function shippedScenes(
  m: ReleaseManifest,
  texts: ReadonlyMap<AssetId, string>,
  registry: Registry,
): Promise<SceneSource> {
  const store = memoryContentStore();
  const encoder = new TextEncoder();
  for (const [id, text] of texts) await store.put(encoder.encode(text), m.assets[id]!.sha256);
  const snapshot = releaseSnapshot(m);
  const scenes = new Map<AssetId, LibraryScene>();
  for (const { id } of m.flow.scenes) {
    const { def, prefabs } = await snapshotScene(snapshot, id, store, registry);
    scenes.set(id, { def, prefabs });
  }
  const list: SceneListEntry[] = m.flow.scenes.map((s) => ({
    scene: s.id,
    ...(s.title !== undefined ? { title: s.title } : {}),
    ...(s.sublevel ? { sublevel: true as const } : {}),
  }));
  return {
    list: () => list,
    start: () => m.flow.start,
    scene: (id) => scenes.get(id) ?? null,
  };
}

/**
 * Boots a released game from its `release.json`: the project's data, the
 * asset loader over the build's files, the scene flow at the list's start,
 * the UI and saves. Sets `document.documentElement.dataset.jamsState` to
 * "loading", then "ready", or "error" with the refusal shown in `root`
 * (the promise rejects then), and mirrors the renderer's state there too
 * (`mirrorRenderState`). Every URL is resolved against the manifest's
 * own, which resolves against the document's base URI, and none leaves its
 * directory.
 *
 * With `?host=jams` on the page's URL it first looks for the page that
 * frames it (`connectHost`). When one answers, saves and remaps go through
 * that page, no service worker registers, the state is reported to it too
 * and its `pause`/`resume` pause the game; when none answers in 2 s the
 * build plays as it would anywhere else.
 */
export async function bootStandalone(opts: StandaloneOptions): Promise<StandaloneGame> {
  const { root, game } = opts;
  const doc = root.ownerDocument;
  const fetchFn: FetchText = opts.fetch ?? ((url) => globalThis.fetch(url));
  const fills = opts.fillPage !== false;
  setState(doc, "loading");
  if (fills) fillPage(root, null);
  let loading: { remove(): void } | null = showLoading(root, fills);

  let canvas: HTMLCanvasElement | null = null;
  let instance: GameInstance | null = null;
  let unmountUi: (() => void) | null = null;
  let unmirror: (() => void) | null = null;
  let loader: ReturnType<typeof createAssetLoader> | null = null;
  let host: HostChannel | null = null;
  const win = doc.defaultView;
  const workerWin = opts.serviceWorker !== false && canServiceWork(win) ? win : null;
  let prompt = workerWin ? installPrompt(workerWin) : null;
  const resize = () => {
    const size = sizeOf(root);
    instance?.resize(size.width, size.height);
  };
  const teardown = () => {
    loading?.remove();
    loading = null;
    win?.removeEventListener("resize", resize);
    prompt?.stop();
    prompt = null;
    unmountUi?.();
    unmountUi = null;
    unmirror?.();
    unmirror = null;
    instance?.destroy();
    instance = null;
    loader?.destroy();
    loader = null;
    canvas?.remove();
    canvas = null;
    host?.close();
    host = null;
  };

  try {
    const base = new URL(opts.release ?? RELEASE_FILE, doc.baseURI);
    const parsed = parseReleaseManifest(await fetchText(base, base.href, fetchFn));
    if (!parsed.ok) throw new StandaloneBootError(parsed.issues);
    const { manifest } = parsed;
    const newer = formatIssues(manifest);
    if (newer.length > 0) throw new StandaloneBootError(newer);
    if (manifest.game.id !== game.id)
      throw new StandaloneBootError([
        makeIssue("asset-kind", {
          message: `this build plays the game "${manifest.game.id}", not "${game.id}"`,
          path: "/game/id",
          expected: game.id,
          got: manifest.game.id,
        }),
      ]);
    const mixed = gameIssues(manifest, game);
    if (mixed.length > 0) throw new StandaloneBootError(mixed);
    if (fills && manifest.pwa) fillPage(root, manifest.pwa.background);
    if (!manifest.pwa) {
      prompt?.stop();
      prompt = null;
    }
    const held = (await checkReleaseManifest(manifest)).filter((i) => i.severity === "error");
    if (held.length > 0) throw new StandaloneBootError(held);

    const [id, texts] = await Promise.all([
      releaseId(manifest),
      fetchReleaseTexts(manifest, base, fetchFn),
    ]);
    if (hostRequested(win?.location.href)) {
      host = await connectHost({
        hello: { engine: ENGINE_VERSION, release: id, game: game.id },
        ...(win ? { window: win } : {}),
      });
    }
    // A hosted frame has an opaque origin: no worker, and storage only through the page.
    if (host) {
      prompt?.stop();
      prompt = null;
      host.state("loading");
    }
    const view = manifestView(manifest);
    const project = manifestRuntimeView(manifest, texts, game);
    const registry = withProject(createRegistry(game), view, jsonValues(texts));
    const late = timeIssues(
      manifest,
      resolveTime({ project: project.engine, game: registry.time }),
    );
    if (late.length > 0) throw new StandaloneBootError(late);
    const source = await shippedScenes(manifest, texts, registry);

    const assetUrl = (assetId: AssetId, hash: Sha256): string => {
      const asset = Object.hasOwn(manifest.assets, assetId) ? manifest.assets[assetId] : undefined;
      return releaseUrl(base, asset?.file ?? `assets/${hash}`).href;
    };
    loader = createAssetLoader({
      project: manifest.project.id,
      url: (_, entry) => assetUrl(entry.id, entry.sha256),
    });
    const kinds = createKindRegistry(registry.game);
    const renderer = rendererPreference(doc);
    const size = sizeOf(root);
    canvas = doc.createElement("canvas");
    canvas.style.display = "block";
    root.append(canvas);

    instance = await createGame(canvas, {
      game,
      registry,
      displayWidth: size.width,
      displayHeight: size.height,
      dev: false,
      ...(opts.rapier && manifest.build.rapier !== null ? { rapier: opts.rapier } : {}),
      keyTarget: win ?? undefined,
      input: { touch: "auto", remaps: remapsFor(host) },
      flow: { source },
      project,
      assets: { loader, view, kinds },
      saves: opts.saves ?? (host ? channelSaveStore(host) : browserSaveStore()),
      release: { id, manifest },
      ...(renderer ? { renderer } : {}),
    });
    unmirror = mirrorRenderState(instance, doc.documentElement);
    if (opts.ui) {
      const credits = manifest.build.files.some((f) => f.path === CREDITS_FILE)
        ? { credits: releaseUrl(base, CREDITS_FILE).href }
        : null;
      const install = prompt?.ui;
      const ui = opts.ui;
      unmountUi = mountUi(
        instance,
        canvas,
        install ? (ctx) => ui({ ...ctx, install }) : ui,
        credits ? { links: credits } : {},
      );
    }
    instance.start();
    const started = await instance.flow.restart();
    if (!started.ok) throw new StandaloneBootError([started.issue]);
    if (workerWin && manifest.pwa && !host)
      registerWorker(workerWin, releaseUrl(base, SERVICE_WORKER_FILE));
    win?.addEventListener("resize", resize);
    loading?.remove();
    loading = null;
    setState(doc, "ready");
    const playing = instance;
    if (host) {
      followHostPause(host, playing);
      host.state("ready");
    }

    return {
      instance: playing,
      manifest,
      release: id,
      get install() {
        return prompt?.current() ?? null;
      },
      credits: CREDITS_FILE,
      host,
      destroy: teardown,
    };
  } catch (error) {
    const issues = issuesOf(error);
    const [first] = issues ?? [];
    host?.state("error", first);
    teardown();
    setState(doc, "error");
    renderBootError(
      root,
      first
        ? { message: first.message, code: first.code }
        : { message: error instanceof Error ? error.message : String(error), code: null },
    );
    throw issues
      ? error instanceof StandaloneBootError
        ? error
        : new StandaloneBootError(issues)
      : error;
  }
}

/** The host's remaps snapshot, saved back over its channel; else this browser's. */
function remapsFor(host: HostChannel | null) {
  if (!host) return browserRemapStore();
  const channel = host;
  return snapshotRemapStore(channel.welcome.prefs.remap, (_gameId, state) => {
    // A remap the page couldn't keep still applies for this session.
    channel.request("prefs.save", { store: "remap", value: state }).catch(() => {});
  });
}

/**
 * Pauses the game while the page says it is hidden or covered, and resumes
 * it after only when the page's pause was what stopped it: a game the
 * player had already paused stays paused.
 */
function followHostPause(host: HostChannel, instance: GameInstance): void {
  let pausedByHost = false;
  host.on("pause", () => {
    const already = instance.getStore().state.sim.paused;
    instance.pause();
    if (!already) pausedByHost = true;
  });
  host.on("resume", () => {
    if (!pausedByHost) return;
    pausedByHost = false;
    instance.resume();
  });
}

/** Registers the build's `sw.js`, scoped to its directory. A refusal leaves the game playing online only. */
function registerWorker(win: Window, url: URL): void {
  win.navigator.serviceWorker.register(url.href).catch(() => {});
}

/** The root's size; the window's only while the root has no box at all (not laid out yet). */
function sizeOf(root: HTMLElement): { width: number; height: number } {
  const win = root.ownerDocument.defaultView;
  if (root.clientWidth === 0 && root.clientHeight === 0)
    return { width: win?.innerWidth || 1, height: win?.innerHeight || 1 };
  return { width: root.clientWidth || 1, height: root.clientHeight || 1 };
}
