// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createGame } from "../engine";
import { planContent } from "../export/content";
import { finishExport, type BuiltCode, type ExportInput } from "../export/plan";
import type { GameDefinition } from "../game/types";
import type { BundleEntry } from "../project/bundle";
import { createKindRegistry } from "../project/kinds";
import {
  formatReleaseManifest,
  releaseId,
  SERVICE_WORKER_FILE,
  type ReleaseManifest,
} from "../project/release";
import { projectView } from "../project/view";
import type { AssetUrl } from "../render/asset-loader";
import type { RunRecording } from "../scene/recording-schema";
import { bootStandalone, type StandaloneGame, type StandaloneOptions } from "../standalone/boot";
import { manifestView } from "../standalone/manifest-view";
import type { UiContext } from "../ui/types";
import { ENGINE_VERSION } from "../version";
import { FREE_PROJECT, heldInput, physicsFreeFiles, scene } from "./fixtures/held-project";
import { testGame } from "./fixtures/test-game";

type RendererHooks = {
  lost?: (backend: "webgl" | "webgpu") => void;
  restored?: (backend: "webgl" | "webgpu", rebuilt: boolean) => void;
  fallback?: (reason: "init" | "lost") => void;
  failed?: (backend: "webgl" | "webgpu", error: unknown) => void;
};
const renderer = vi.hoisted(() => ({ hooks: null as RendererHooks | null }));

vi.mock("../renderer", () => ({
  createRenderer: async (_canvas: unknown, _config: unknown, _resolution: unknown, hooks = {}) => {
    renderer.hooks = hooks as RendererHooks;
    return {
      app: {},
      worldContainer: new Container(),
      uiContainer: new Container(),
      resize: () => {},
      destroy: () => {},
    };
  },
}));

vi.mock("../engine", async (original) => {
  const real = await original<typeof import("../engine")>();
  return { ...real, createGame: vi.fn(real.createGame) };
});

// The shell pages aren't what boot reads; fixed texts keep this file off their renderers.
vi.mock("../export/html", async (original) => ({
  ...(await original<typeof import("../export/html")>()),
  renderIndexHtml: () => "index\n",
}));
vi.mock("../export/credits", async (original) => ({
  ...(await original<typeof import("../export/credits")>()),
  renderCredits: () => "credits\n",
}));
vi.mock("../export/service-worker", async (original) => ({
  ...(await original<typeof import("../export/service-worker")>()),
  renderServiceWorker: () => "sw\n",
}));
vi.mock("../export/web-manifest", async (original) => ({
  ...(await original<typeof import("../export/web-manifest")>()),
  renderWebManifest: () => "{}\n",
}));

// Textures resolve through the loader's `url`; recording what it resolves stands in for Pixi's fetch.
const { textureUrls } = vi.hoisted(() => ({ textureUrls: [] as string[] }));
vi.mock("../render/asset-loader", async (original) => {
  const real = await original<typeof import("../render/asset-loader")>();
  return {
    ...real,
    createAssetLoader: (opts: { project: string; url: AssetUrl }) => ({
      async load(bundle: { entries: readonly BundleEntry[] }) {
        for (const entry of bundle.entries) textureUrls.push(opts.url(opts.project, entry));
        return { failed: [] };
      },
      retain() {},
      release() {},
      texture: () => null,
      onTexture: () => () => {},
      destroy() {},
    }),
  };
});

const CODE: BuiltCode = {
  files: [{ path: "code/main-abc123.js", sha256: "d".repeat(64), bytes: 1000, role: "code" }],
  entry: "code/main-abc123.js",
  rapier: null,
  thirdParty: [],
};

/** A planned build in memory: every file's text by path, and its manifest. */
type Build = { manifest: ReleaseManifest; files: Map<string, string> };

async function plannedBuild(target: ExportInput["target"] = "web"): Promise<Build> {
  const input = await heldInput(FREE_PROJECT, physicsFreeFiles(), testGame, target);
  const plan = await finishExport(await planContent(input), CODE, input);
  expect(plan.issues.filter((i) => i.severity === "error")).toEqual([]);
  const files = new Map<string, string>();
  for (const f of plan.files)
    files.set(f.path, f.source.kind === "text" ? f.source.text : `<${f.source.kind}>`);
  return { manifest: plan.manifest, files };
}

/** A fetch over `build` served at `dir`, recording every URL it's asked for. */
function fakeFetch(build: Build, dir: string, manifest = build.manifest) {
  const urls: string[] = [];
  const serve = (input: string): Promise<Response> => {
    const url = String(input);
    urls.push(url);
    const path = url.startsWith(dir) ? url.slice(dir.length) : null;
    const text =
      path === "release.json"
        ? formatReleaseManifest(manifest)
        : path === null
          ? undefined
          : build.files.get(path);
    return Promise.resolve({
      ok: text !== undefined,
      status: text === undefined ? 404 : 200,
      text: async () => text ?? "",
    } as Response);
  };
  return { urls, fetch: vi.fn(serve) as unknown as typeof fetch };
}

let build: Build;
let root: HTMLElement;
const booted: StandaloneGame[] = [];

beforeAll(async () => {
  build = await plannedBuild();
});

beforeEach(() => {
  textureUrls.length = 0;
  root = document.createElement("div");
  root.id = "game";
  document.body.append(root);
  delete document.documentElement.dataset.jamsState;
  renderer.hooks = null;
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  );
});

afterEach(() => {
  for (const game of booted.splice(0)) game.destroy();
  document.body.replaceChildren();
  document.documentElement.removeAttribute("style");
  document.body.removeAttribute("style");
  document.head.querySelector("base")?.remove();
  vi.unstubAllGlobals();
});

async function boot(opts: Partial<StandaloneOptions> & { fetch: typeof fetch }) {
  const game = await bootStandalone({ root, game: testGame, ...opts });
  booted.push(game);
  return game;
}

const DIR = new URL(".", document.baseURI).href;

describe("bootStandalone", () => {
  it("boots a planned build to ready at its start scene", async () => {
    const served = fakeFetch(build, DIR);
    const mounted: unknown[] = [];
    const game = await boot({
      fetch: served.fetch,
      ui: (ctx) => {
        mounted.push(ctx);
        return { destroy() {} };
      },
    });
    expect(document.documentElement.dataset.jamsState).toBe("ready");
    expect(game.instance.flow.current()).toBe("yard");
    expect(game.instance.flow.scenes.map((s) => s.scene)).toEqual(["yard", "hall"]);
    expect(game.release).toBe(await releaseId(build.manifest));
    expect(game.manifest.project.id).toBe("free");
    expect(game.credits).toBe("credits.html");
    expect(mounted).toHaveLength(1);
    expect((mounted[0] as { links?: unknown }).links).toEqual({ credits: `${DIR}credits.html` });
    expect(root.querySelector("canvas")).not.toBeNull();
    game.destroy();
    booted.length = 0;
    expect(root.querySelector("canvas")).toBeNull();
  });

  it("fetches only paths relative to release.json, the docs in parallel, never a shell file", async () => {
    const served = fakeFetch(build, `${DIR}builds/r1/`);
    await boot({ fetch: served.fetch, release: "builds/r1/release.json" });
    expect(served.urls[0]).toBe(`${DIR}builds/r1/release.json`);
    for (const url of [...served.urls, ...textureUrls])
      expect(url).toMatch(/^http:.*\/builds\/r1\//);
    const docs = Object.values(build.manifest.assets)
      .filter((a) => a.storage === "doc")
      .map((a) => `${DIR}builds/r1/${a.file}`);
    expect(served.urls.slice(1).sort()).toEqual([...new Set(docs)].sort());
    expect([...new Set(textureUrls)]).toEqual([
      `${DIR}builds/r1/${build.manifest.assets.tiles!.file}`,
    ]);
  });

  it("refuses a manifest of a newer format on the page, with a Reload button", async () => {
    const newer = structuredClone(build.manifest) as ReleaseManifest;
    newer.engine.formats = { ...newer.engine.formats, scene: 99 };
    const served = fakeFetch(build, DIR, newer);
    await expect(boot({ fetch: served.fetch })).rejects.toMatchObject({
      name: "StandaloneBootError",
      issues: [expect.objectContaining({ code: "version-newer" })],
    });
    expect(document.documentElement.dataset.jamsState).toBe("error");
    const alert = root.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("version-newer");
    expect(alert.textContent).toContain("v99");
    expect(alert.textContent).toContain("The game couldn't start");
    const reload = alert.querySelector("button")!;
    expect(reload.textContent).toBe("Reload");
    expect(reload.type).toBe("button");
    expect(root.querySelectorAll("[title]")).toHaveLength(0);
    expect(root.querySelector("canvas")).toBeNull();
    expect(served.urls).toHaveLength(1);
  });

  it("refuses a build of another game on the page", async () => {
    const served = fakeFetch(build, DIR);
    const other = { ...testGame, id: "other-game" } as GameDefinition;
    await expect(boot({ fetch: served.fetch, game: other })).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "asset-kind", got: "test-game" })],
    });
    expect(root.querySelector('[role="alert"]')!.textContent).toContain("asset-kind");
    expect(document.documentElement.dataset.jamsState).toBe("error");
  });

  it("refuses a doc served from another build as hash-mismatch", async () => {
    const stale: Build = { manifest: build.manifest, files: new Map(build.files) };
    const sceneFile = build.manifest.assets.hall!.file;
    stale.files.set(sceneFile, `${stale.files.get(sceneFile)} `);
    await expect(boot({ fetch: fakeFetch(stale, DIR).fetch })).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "hash-mismatch", entityIds: ["hall"] })],
    });
    expect(root.querySelector('[role="alert"]')!.textContent).toContain("hash-mismatch");
  });

  it("refuses a game whose time model isn't the build's", async () => {
    const faster = { ...testGame, time: { ...testGame.time, kind: "fixed", rate: 30 } };
    const served = fakeFetch(build, DIR);
    await expect(
      boot({ fetch: served.fetch, game: faster as GameDefinition }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "hash-mismatch", path: "/time" })],
    });
  });

  it("refuses a build whose shipped doc names an asset the build doesn't ship", async () => {
    const held = physicsFreeFiles();
    const spare = {
      kind: "animation",
      v: 1,
      atlas: "band",
      clips: [{ name: "spin", tag: "spin" }],
    };
    const text = `${JSON.stringify(spare, null, 2)}\n`;
    held.files.push({ path: "spare.animation.json", json: spare });
    held.texts.set("spare.animation.json", text);
    const input = await heldInput(FREE_PROJECT, held, testGame);
    const plan = await finishExport(await planContent(input), CODE, input);
    expect(plan.manifest.assets["spare-animation"]?.kind).toBe("animation");
    expect(plan.manifest.assets.band).toBeUndefined();
    const files = new Map<string, string>();
    for (const f of plan.files)
      files.set(f.path, f.source.kind === "text" ? f.source.text : `<${f.source.kind}>`);
    const served = fakeFetch({ manifest: plan.manifest, files }, DIR);
    await expect(boot({ fetch: served.fetch })).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          code: "asset-missing",
          path: "/assets/spare-animation",
          entityIds: ["spare-animation", "band"],
        }),
      ],
    });
    expect(document.documentElement.dataset.jamsState).toBe("error");
  });

  it("never loads Rapier for a physics-free build", async () => {
    expect(build.manifest.build.rapier).toBeNull();
    const rapier = vi.fn(async () => {
      throw new Error("a physics-free build loads no Rapier");
    });
    await boot({ fetch: fakeFetch(build, DIR).fetch, rapier });
    expect(document.documentElement.dataset.jamsState).toBe("ready");
    expect(rapier).not.toHaveBeenCalled();
  });

  it("passes ?renderer=webgl on as the renderer preference", async () => {
    const created = vi.mocked(createGame);
    await boot({ fetch: fakeFetch(build, DIR).fetch });
    expect(created.mock.lastCall?.[1].renderer).toBeUndefined();
    window.history.replaceState(null, "", "?renderer=webgl");
    try {
      await boot({ fetch: fakeFetch(build, DIR).fetch });
      expect(created.mock.lastCall?.[1].renderer).toEqual({ preference: "webgl" });
    } finally {
      window.history.replaceState(null, "", window.location.pathname);
    }
  });

  it("records the release a run was played from", async () => {
    const game = await boot({ fetch: fakeFetch(build, DIR).fetch });
    const recorded: RunRecording[] = [];
    game.instance.on("play:recorded", (r) => recorded.push(r));
    game.instance.play(scene("yard", ["tiles"]));
    game.instance.step(2);
    game.instance.stop();
    expect(recorded[0]?.release).toBe(game.release);
    expect(recorded[0]?.project).toEqual({
      id: build.manifest.project.id,
      snapshot: build.manifest.project.snapshot,
    });
    expect(recorded[0]?.engine.version).toBe(build.manifest.engine.version);
    expect(recorded[0]?.engine.version).toBe(ENGINE_VERSION);
  });

  it("refuses a game whose save version or config hash isn't the build's", async () => {
    const resaved = { ...testGame, saves: { ...testGame.saves, version: 99 } };
    await expect(
      boot({ fetch: fakeFetch(build, DIR).fetch, game: resaved as GameDefinition }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "hash-mismatch", path: "/game/saveVersion" })],
    });
    expect(root.querySelector('[role="alert"]')!.textContent).toContain("hash-mismatch");
    const rehashed = { ...testGame, configHash: "f".repeat(64) };
    await expect(
      boot({ fetch: fakeFetch(build, DIR).fetch, game: rehashed as GameDefinition }),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "hash-mismatch", path: "/game/configHash" })],
    });
  });
});

describe("the page", () => {
  it("lays the page out for the game alone, in the build's background", async () => {
    await boot({ fetch: fakeFetch(build, DIR).fetch });
    const html = document.documentElement.style;
    const body = document.body.style;
    expect(body.margin).toBe("0px");
    expect(body.overflow).toBe("hidden");
    expect(html.overflow).toBe("hidden");
    expect(html.height).toBe("100%");
    expect(body.height).toBe("100%");
    expect(build.manifest.pwa?.background).toBeTruthy();
    expect(body.background).toBe(html.background);
    expect(body.background).not.toBe("");
    expect(root.style.position).toBe("fixed");
    for (const side of ["top", "right", "bottom", "left"] as const)
      expect(root.style[side]).toBe("0px");
    expect(root.style.touchAction).toBe("none");
  });

  it("leaves the page alone with fillPage off", async () => {
    await boot({ fetch: fakeFetch(build, DIR).fetch, fillPage: false });
    expect(document.documentElement.getAttribute("style")).toBeNull();
    expect(document.body.getAttribute("style")).toBeNull();
    expect(root.style.position).toBe("");
  });

  it("shows a loading line until the first scene is up", async () => {
    const served = fakeFetch(build, DIR);
    const serve = vi.mocked(served.fetch).getMockImplementation()!;
    let during: string | null | undefined;
    vi.mocked(served.fetch).mockImplementation(async (url) => {
      during ??= root.querySelector("[data-jams-loading]")?.textContent;
      return serve(url);
    });
    await boot({ fetch: served.fetch });
    expect(during).toBe("Loading…");
    expect(root.querySelector("[data-jams-loading]")).toBeNull();
  });

  it("lays the error panel over the viewport, scrolling, so a long message reads from its start", async () => {
    const newer = structuredClone(build.manifest) as ReleaseManifest;
    newer.engine.formats = { ...newer.engine.formats, scene: 99 };
    await expect(boot({ fetch: fakeFetch(build, DIR, newer).fetch })).rejects.toThrow();
    expect(root.querySelector("[data-jams-loading]")).toBeNull();
    const alert = root.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert.style.position).toBe("fixed");
    expect(alert.style.overflow).toBe("auto");
    const inner = alert.firstElementChild as HTMLElement;
    expect(inner.style.margin).toBe("auto");
    expect(inner.firstElementChild?.textContent).toBe("The game couldn't start");
  });
});

describe("the renderer's state", () => {
  it("mirrors render:lost, render:restored, render:failed and render:fallback on the root element, until destroyed", async () => {
    const served = fakeFetch(build, DIR);
    const game = await boot({ fetch: served.fetch });
    const { dataset } = document.documentElement;
    const hooks = renderer.hooks!;
    expect(dataset.jamsRender).toBeUndefined();
    hooks.lost!("webgpu");
    expect(dataset.jamsRender).toBe("lost");
    hooks.fallback!("lost");
    expect(dataset.jamsRenderFallback).toBe("lost");
    hooks.restored!("webgl", true);
    expect(dataset.jamsRender).toBe("rebuilt");
    hooks.lost!("webgl");
    hooks.restored!("webgl", false);
    expect(dataset.jamsRender).toBe("restored");
    hooks.lost!("webgl");
    hooks.failed!("webgl", new Error("no context"));
    expect(dataset.jamsRender).toBe("failed");
    game.destroy();
    expect(dataset.jamsRender).toBeUndefined();
    expect(dataset.jamsRenderFallback).toBeUndefined();
  });
});

describe("manifestView", () => {
  it("passes projectView's own checks, every entry created by the release", () => {
    const view = manifestView(build.manifest);
    expect(view.issues).toEqual([]);
    const checked = projectView(view.state, createKindRegistry(testGame));
    expect(checked.issues).toEqual([]);
    expect(checked.repairs.size).toBe(0);
    expect([...view.byId.keys()].sort()).toEqual(Object.keys(build.manifest.assets).sort());
    for (const entry of view.byId.values()) {
      expect(entry.created).toEqual({ at: 0, by: "release" });
      expect(entry.sha256 !== undefined, entry.id).toBe(
        build.manifest.assets[entry.id]!.storage === "blob",
      );
    }
    expect(view.byId.get("tiles")?.meta).toEqual({ format: "png", width: 16, height: 16 });
  });
});

describe("any origin", () => {
  const APP = "app://game/sub/";

  function onAppScheme(): void {
    const base = document.createElement("base");
    base.href = `${APP}index.html`;
    document.head.append(base);
    expect(document.baseURI).toBe(`${APP}index.html`);
    expect("serviceWorker" in navigator).toBe(false);
  }

  it("boots a PWA build from app:// with no service worker; every request stays under the page", async () => {
    expect(build.manifest.pwa).not.toBeNull();
    onAppScheme();
    const served = fakeFetch(build, APP);
    const game = await boot({ fetch: served.fetch });
    expect(document.documentElement.dataset.jamsState).toBe("ready");
    expect(game.install).toBeNull();
    expect(served.urls.length).toBeGreaterThan(1);
    for (const url of [...served.urls, ...textureUrls]) expect(url.startsWith(APP), url).toBe(true);
  });

  it("boots the same outside a secure context", async () => {
    onAppScheme();
    vi.stubGlobal("isSecureContext", false);
    const served = fakeFetch(build, APP);
    const game = await boot({ fetch: served.fetch });
    expect(document.documentElement.dataset.jamsState).toBe("ready");
    expect(game.install).toBeNull();
    for (const url of served.urls) expect(url.startsWith(APP), url).toBe(true);
  });
});

describe("the PWA", () => {
  let itch: Build;
  let register: ReturnType<typeof vi.fn<(url: string) => Promise<unknown>>>;

  beforeAll(async () => {
    itch = await plannedBuild("itch");
  });

  beforeEach(() => {
    register = vi.fn(async () => ({}));
    Object.defineProperty(navigator, "serviceWorker", {
      value: { register },
      configurable: true,
    });
    vi.stubGlobal("isSecureContext", true);
  });

  afterEach(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });

  /** A `beforeinstallprompt` as Chromium fires it, answered with `outcome`. */
  function offerInstall(outcome: "accepted" | "dismissed") {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    const prompt = vi.fn(async () => {});
    Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
    window.dispatchEvent(event);
    return { event, prompt };
  }

  it("registers sw.js next to release.json for a web build with the PWA on", async () => {
    expect(build.manifest.pwa).not.toBeNull();
    const served = fakeFetch(build, `${DIR}builds/r1/`);
    await boot({ fetch: served.fetch, release: "builds/r1/release.json" });
    expect(document.documentElement.dataset.jamsState).toBe("ready");
    expect(register.mock.calls).toEqual([[`${DIR}builds/r1/${SERVICE_WORKER_FILE}`]]);
    expect(served.urls).not.toContain(`${DIR}builds/r1/${SERVICE_WORKER_FILE}`);
  });

  it("registers nothing for a build without the PWA, or when the page turns it off", async () => {
    expect(itch.manifest.pwa).toBeNull();
    const game = await boot({ fetch: fakeFetch(itch, DIR).fetch });
    offerInstall("accepted");
    expect(game.install).toBeNull();
    await boot({ fetch: fakeFetch(build, DIR).fetch, serviceWorker: false });
    expect(register).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.jamsState).toBe("ready");
  });

  it("registers nothing outside a secure context", async () => {
    vi.stubGlobal("isSecureContext", false);
    const game = await boot({ fetch: fakeFetch(build, DIR).fetch });
    expect(register).not.toHaveBeenCalled();
    expect(game.install).toBeNull();
  });

  it("is still ready when registration is refused", async () => {
    register.mockRejectedValue(new DOMException("denied", "SecurityError"));
    await boot({ fetch: fakeFetch(build, DIR).fetch });
    await Promise.resolve();
    expect(register).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.jamsState).toBe("ready");
  });

  it("offers install only once the browser fires its prompt, and only once per prompt", async () => {
    const game = await boot({ fetch: fakeFetch(build, DIR).fetch });
    expect(game.install).toBeNull();
    const { event, prompt } = offerInstall("accepted");
    expect(event.defaultPrevented).toBe(true);
    const install = game.install;
    expect(install).toBeTypeOf("function");
    await expect(install!()).resolves.toBe(true);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(game.install).toBeNull();
    await expect(install!()).resolves.toBe(false);
    expect(prompt).toHaveBeenCalledTimes(1);

    offerInstall("dismissed");
    await expect(game.install!()).resolves.toBe(false);
  });

  it("hands the install prompt to the game's UI, telling it when one comes and goes", async () => {
    let ctx: UiContext | null = null;
    const game = await boot({
      fetch: fakeFetch(build, DIR).fetch,
      ui: (c) => {
        ctx = c;
        return { destroy() {} };
      },
    });
    const install = (ctx as UiContext | null)?.install;
    expect(install).toBeDefined();
    expect(install!.current()).toBeNull();
    const changes = vi.fn();
    const off = install!.onChange(changes);
    offerInstall("accepted");
    expect(changes).toHaveBeenCalledTimes(1);
    expect(install!.current()).toBe(game.install);
    await expect(install!.current()!()).resolves.toBe(true);
    expect(changes).toHaveBeenCalledTimes(2);
    expect(install!.current()).toBeNull();
    off();
    offerInstall("accepted");
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it("gives the UI no install where the build has no PWA", async () => {
    let ctx: UiContext | null = null;
    await boot({
      fetch: fakeFetch(itch, DIR).fetch,
      ui: (c) => {
        ctx = c;
        return { destroy() {} };
      },
    });
    expect(ctx).not.toBeNull();
    expect((ctx as UiContext | null)?.install).toBeUndefined();
  });

  it("keeps a prompt fired while the game loads, and drops it once installed or destroyed", async () => {
    const served = fakeFetch(build, DIR);
    const serve = vi.mocked(served.fetch).getMockImplementation()!;
    let offered = false;
    vi.mocked(served.fetch).mockImplementation(async (url) => {
      if (!offered) {
        offered = true;
        offerInstall("accepted");
      }
      return serve(url);
    });
    const game = await boot({ fetch: served.fetch });
    expect(game.install).toBeTypeOf("function");
    window.dispatchEvent(new Event("appinstalled"));
    expect(game.install).toBeNull();

    offerInstall("accepted");
    expect(game.install).toBeTypeOf("function");
    game.destroy();
    booted.length = 0;
    expect(game.install).toBeNull();
    const late = offerInstall("accepted");
    expect(late.event.defaultPrevented).toBe(false);
  });
});
