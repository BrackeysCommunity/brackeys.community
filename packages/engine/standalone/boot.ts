import { createGame } from "../engine";
import { createRegistry, withProject } from "../game/define";
import type { LibraryScene, SceneListEntry } from "../game/flow";
import { SAVE_VERSION } from "../game/save-file";
import { resolveTime } from "../game/time";
import type { GameDefinition, Registry } from "../game/types";
import { browserRemapStore } from "../input/remap";
import { stableJson } from "../project/canonical";
import { ContentStoreError, memoryContentStore } from "../project/content-store";
import { createKindRegistry } from "../project/kinds";
import {
  checkReleaseManifest,
  parseReleaseManifest,
  RELEASE_FILE,
  releaseId,
  releaseSnapshot,
  type ReleaseManifest,
} from "../project/release";
import { jsonValues, snapshotScene, SnapshotError } from "../project/snapshot";
import type { AssetId, Sha256 } from "../project/types";
import { createAssetLoader } from "../render/asset-loader";
import { browserSaveStore } from "../saves/browser";
import type { SaveStore } from "../saves/store";
import { INPUT_SCRIPT_VERSION } from "../scene/input-script";
import { makeIssue } from "../scene/issues";
import { RECORDING_VERSION } from "../scene/recording-schema";
import { SCENE_FORMAT_VERSION, type SceneIssue } from "../scene/types";
import type { GameInstance, RapierModule, SceneSource } from "../types";
import { mountUi } from "../ui/layer";
import type { MountUi } from "../ui/types";
import { COLLAB_LAYOUT_VERSION } from "../version";
import { fetchReleaseTexts, fetchText, releaseUrl, type FetchText } from "./data";
import { renderBootError, StandaloneBootError } from "./errors";
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
  /** Default `browserSaveStore()`; a game's own `saves.store` still wins. */
  saves?: SaveStore;
  /** Default true when the manifest has `pwa`; ignored where there is no service worker or the context isn't secure. */
  serviceWorker?: boolean;
  fetch?: typeof fetch;
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
  destroy(): void;
};

const CREDITS_FILE = "credits.html";
const SERVICE_WORKER_FILE = "sw.js";

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
  const onPrompt = (event: Event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
  };
  const onInstalled = () => {
    deferred = null;
  };
  win.addEventListener("beforeinstallprompt", onPrompt);
  win.addEventListener("appinstalled", onInstalled);
  const install = async (): Promise<boolean> => {
    const event = deferred;
    if (!event) return false;
    deferred = null;
    try {
      await event.prompt();
      return (await event.userChoice).outcome === "accepted";
    } catch {
      return false;
    }
  };
  return {
    current: () => (deferred ? install : null),
    stop() {
      win.removeEventListener("beforeinstallprompt", onPrompt);
      win.removeEventListener("appinstalled", onInstalled);
      deferred = null;
    },
  };
}

type Formats = ReleaseManifest["engine"]["formats"];

/** The format versions this engine reads. */
const readableFormats = (): Formats => ({
  scene: SCENE_FORMAT_VERSION,
  prefab: SCENE_FORMAT_VERSION,
  recording: RECORDING_VERSION,
  inputScript: INPUT_SCRIPT_VERSION,
  save: SAVE_VERSION,
  collabLayout: COLLAB_LAYOUT_VERSION,
});

const setState = (doc: Document, state: "loading" | "ready" | "error") => {
  doc.documentElement.dataset.jamsState = state;
};

/** The issues a thrown error carries, or null for one that carries none. */
function issuesOf(error: unknown): readonly SceneIssue[] | null {
  if (error instanceof StandaloneBootError || error instanceof SnapshotError) return error.issues;
  if (error instanceof ContentStoreError) return [error.issue];
  return null;
}

/** The manifest's formats this engine can't read: `version-newer`. */
function formatIssues(m: ReleaseManifest): SceneIssue[] {
  const readable = readableFormats();
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
 * (the promise rejects then). Every URL is resolved against the manifest's
 * own, which resolves against the document's base URI, and none leaves its
 * directory.
 */
export async function bootStandalone(opts: StandaloneOptions): Promise<StandaloneGame> {
  const { root, game } = opts;
  const doc = root.ownerDocument;
  const fetchFn: FetchText = opts.fetch ?? ((url) => globalThis.fetch(url));
  setState(doc, "loading");

  let canvas: HTMLCanvasElement | null = null;
  let instance: GameInstance | null = null;
  let unmountUi: (() => void) | null = null;
  let loader: ReturnType<typeof createAssetLoader> | null = null;
  const win = doc.defaultView;
  const workerWin = opts.serviceWorker !== false && canServiceWork(win) ? win : null;
  let prompt = workerWin ? installPrompt(workerWin) : null;
  const resize = () => {
    const size = sizeOf(root);
    instance?.resize(size.width, size.height);
  };
  const teardown = () => {
    win?.removeEventListener("resize", resize);
    prompt?.stop();
    prompt = null;
    unmountUi?.();
    unmountUi = null;
    instance?.destroy();
    instance = null;
    loader?.destroy();
    loader = null;
    canvas?.remove();
    canvas = null;
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
      input: { touch: "auto", remaps: browserRemapStore() },
      flow: { source },
      project,
      assets: { loader, view, kinds },
      saves: opts.saves ?? browserSaveStore(),
      release: { id, manifest },
      ...(renderer ? { renderer } : {}),
    });
    if (opts.ui) {
      const credits = manifest.build.files.some((f) => f.path === CREDITS_FILE)
        ? { credits: releaseUrl(base, CREDITS_FILE).href }
        : null;
      unmountUi = mountUi(instance, canvas, opts.ui, credits ? { links: credits } : {});
    }
    instance.start();
    const started = await instance.flow.restart();
    if (!started.ok) throw new StandaloneBootError([started.issue]);
    if (workerWin && manifest.pwa) registerWorker(workerWin, releaseUrl(base, SERVICE_WORKER_FILE));
    win?.addEventListener("resize", resize);
    setState(doc, "ready");

    const playing = instance;
    return {
      instance: playing,
      manifest,
      release: id,
      get install() {
        return prompt?.current() ?? null;
      },
      credits: CREDITS_FILE,
      destroy: teardown,
    };
  } catch (error) {
    teardown();
    setState(doc, "error");
    const issues = issuesOf(error);
    const [first] = issues ?? [];
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

/** Registers the build's `sw.js`, scoped to its directory. A refusal leaves the game playing online only. */
function registerWorker(win: Window, url: URL): void {
  win.navigator.serviceWorker.register(url.href).catch(() => {});
}

/** The root's size, or the window's while the root has none (before layout). */
function sizeOf(root: HTMLElement): { width: number; height: number } {
  const win = root.ownerDocument.defaultView;
  return {
    width: root.clientWidth || win?.innerWidth || 1,
    height: root.clientHeight || win?.innerHeight || 1,
  };
}
