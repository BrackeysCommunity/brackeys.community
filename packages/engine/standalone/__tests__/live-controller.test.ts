// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  FREE_PROJECT,
  heldInput,
  physicsFreeFiles,
  png,
  releaseFiles,
  scene,
  withHeldDoc,
  type HeldFiles,
} from "../../__tests__/fixtures/held-project";
import { testGame } from "../../__tests__/fixtures/test-game";
import type { GameDefinition } from "../../game/types";
import { formatReleaseManifest, releaseId, type ReleaseManifest } from "../../project/release";
import { liveFiles } from "../../project/release-assets";
import {
  buildSceneVersion,
  formatSceneVersion,
  sceneVersionId,
  sceneVersionOptions,
  type SceneVersion,
} from "../../project/scene-version";
import type { Sha256 } from "../../project/types";
import type { AssetLoader } from "../../render/asset-loader";
import type { SceneRuntimeHandle } from "../../runtime/types";
import type { SceneDefinition } from "../../scene/types";
import { bootStandalone, type StandaloneGame } from "../boot";
import type { LiveSceneEntry, LiveSnapshot } from "../host-protocol";
import { fakeParent, unframe, welcomeOf, type FakePage, type Received } from "./fake-parent";

vi.mock("../../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

// The shell pages aren't what boot reads; fixed texts keep this file off their renderers.
vi.mock("../../export/html", async (original) => ({
  ...(await original<typeof import("../../export/html")>()),
  renderIndexHtml: () => "index\n",
}));
vi.mock("../../export/credits", async (original) => ({
  ...(await original<typeof import("../../export/credits")>()),
  renderCredits: () => "credits\n",
}));
vi.mock("../../export/service-worker", async (original) => ({
  ...(await original<typeof import("../../export/service-worker")>()),
  renderServiceWorker: () => "sw\n",
}));
vi.mock("../../export/web-manifest", async (original) => ({
  ...(await original<typeof import("../../export/web-manifest")>()),
  renderWebManifest: () => "{}\n",
}));

/** Every URL the loader was asked for, through boot's own URL function. */
const loaded: string[] = [];
vi.mock("../../render/asset-loader", async (original) => ({
  ...(await original<typeof import("../../render/asset-loader")>()),
  createAssetLoader: (
    opts: Parameters<typeof import("../../render/asset-loader").createAssetLoader>[0],
  ) =>
    ({
      load: async (bundle: { entries: readonly { id: string; sha256: string }[] }) => {
        for (const e of bundle.entries) loaded.push(opts.url(opts.project, e as never));
        return { failed: [] };
      },
      retain() {},
      release() {},
      texture: () => null,
      onTexture: () => () => {},
      destroy() {},
    }) as unknown as AssetLoader,
}));

/** Set by a test: the game marks a boundary after each tick while it is true. */
let marking = false;

const liveGame: GameDefinition = {
  ...testGame,
  live: { timings: ["boundary", "now"] },
  createRuntime(ctx) {
    const runtime = testGame.createRuntime(ctx);
    return {
      ...runtime,
      afterStep(dtMs, events) {
        runtime.afterStep?.(dtMs, events);
        if (marking) ctx.live.boundary();
      },
    };
  },
};

type Build = { manifest: ReleaseManifest; files: Map<string, string> };

const release = async (): Promise<Build> =>
  releaseFiles(await heldInput(FREE_PROJECT, physicsFreeFiles(), liveGame));

const flagged = (name: string, assets: string[] = []): SceneDefinition => {
  const def = scene(name, assets);
  return {
    ...def,
    entities: [...(def.entities ?? []), { id: "flag", type: "marker", at: [2, 1] }],
  };
};

type Published = { id: Sha256; version: SceneVersion; text: string };

/** Builds a version of `id` from `held` against the release and serves it, and the docs it carries, under live/. */
async function publish(b: Build, held: HeldFiles, id: string): Promise<Published> {
  const input = await heldInput(FREE_PROJECT, held, liveGame);
  const built = await buildSceneVersion(sceneVersionOptions(input, id, { release: b.manifest }));
  if (!built.ok) throw new Error(JSON.stringify(built.issues, null, 2));
  expect(built.issues.filter((i) => i.severity === "error")).toEqual([]);
  return serveVersion(b, built.version, built.texts);
}

function serveVersion(
  b: Build,
  version: SceneVersion,
  texts: ReadonlyMap<Sha256, string>,
): Promise<Published> {
  const text = formatSceneVersion(version);
  return sceneVersionId(version).then((id) => {
    b.files.set(liveFiles.doc(id), text);
    for (const [sha, t] of texts) b.files.set(liveFiles.doc(sha), t);
    return { id, version, text };
  });
}

type Server = { fetch: typeof fetch; paths: string[]; hold(path: string): () => void };

function serve(b: Build): Server {
  const dir = new URL(".", document.baseURI).href;
  const paths: string[] = [];
  const held = new Map<string, Promise<void>>();
  return {
    paths,
    hold(path) {
      let open!: () => void;
      held.set(path, new Promise<void>((r) => (open = r)));
      return () => open();
    },
    fetch: (async (input: string) => {
      const path = String(input).slice(dir.length);
      paths.push(path);
      await held.get(path);
      const text = path === "release.json" ? formatReleaseManifest(b.manifest) : b.files.get(path);
      return { ok: text !== undefined, status: text ? 200 : 404, text: async () => text ?? "" };
    }) as unknown as typeof fetch,
  };
}

const entry = (p: Published, timing: LiveSceneEntry["timing"], number = 1): LiveSceneEntry => ({
  scene: p.version.scene,
  version: p.id,
  number,
  timing,
  since: "2026-11-13T00:00:00.000Z",
});

let rev = 0;
async function snapshot(
  b: Build,
  scenes: LiveSceneEntry[],
  removed: Sha256[] = [],
): Promise<LiveSnapshot> {
  return {
    channel: "production",
    rev: ++rev,
    release: await releaseId(b.manifest),
    scenes,
    removed,
  };
}

const states = (page: FakePage): Received[] => page.received.filter((m) => m.type === "live.state");
const statuses = (page: FakePage, scene?: string) =>
  states(page)
    .filter((m) => scene === undefined || m.scene === scene)
    .map((m) => m.status);

describe("the live controller in a hosted frame", () => {
  let base: Build;
  let root: HTMLElement;
  const booted: StandaloneGame[] = [];

  beforeAll(async () => {
    base = await release();
  });

  beforeEach(() => {
    loaded.length = 0;
    marking = false;
    root = document.createElement("div");
    document.body.append(root);
    window.history.replaceState(null, "", "?host=jams");
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
    delete document.documentElement.dataset.jamsState;
    window.history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
    vi.useRealTimers();
    unframe();
  });

  /** A fresh copy of the release, so each test's versions and tampering stay its own. */
  const fresh = (): Build => ({ ...base, files: new Map(base.files) });

  async function boot(server: Server) {
    const playing = await bootStandalone({ root, game: liveGame, fetch: server.fetch });
    booted.push(playing);
    return playing;
  }

  const hasFlag = (game: StandaloneGame) => game.instance.runtime()?.get("flag") !== undefined;

  it("lists live in hello", async () => {
    const page = fakeParent();
    await boot(serve(fresh()));
    expect(page.received[0]).toMatchObject({ type: "hello", params: { features: ["live"] } });
  });

  it("leaves the frame as before under a page without live", async () => {
    const page = fakeParent({ welcome: welcomeOf() });
    const server = serve(fresh());
    const game = await boot(server);
    expect(game.instance.flow.current()).toBe("yard");
    expect(hasFlag(game)).toBe(false);
    expect(game.instance.live.current("yard")).toBeNull();
    game.instance.step(3);
    await page.until("state", 2);
    expect(states(page)).toEqual([]);
    expect(server.paths.some((p) => p.startsWith("live/"))).toBe(false);
  });

  it("loads the welcome's version as the start scene's first load", async () => {
    const b = fresh();
    const v = await publish(
      b,
      withHeldDoc(physicsFreeFiles(), "yard.json", flagged("yard", ["tiles"])),
      "yard",
    );
    const page = fakeParent({
      welcome: welcomeOf({ live: await snapshot(b, [entry(v, "now")]) }),
    });
    const server = serve(b);
    const swapped = vi.fn();
    const game = await boot(server);
    game.instance.on("live:swapped", swapped);
    expect(game.instance.flow.current()).toBe("yard");
    expect(hasFlag(game)).toBe(true);
    expect(game.instance.live.current("yard")).toBe(v.id);
    await vi.waitFor(() => expect(statuses(page, "yard")).toEqual(["staging", "ready", "applied"]));
    expect(states(page).at(-1)).toEqual({
      type: "live.state",
      scene: "yard",
      version: v.id,
      status: "applied",
      timing: "next-load",
    });
    game.instance.step(2);
    expect(swapped).not.toHaveBeenCalled();
    // The version and the new scene text came from live/; the state reached the page before ready.
    expect(server.paths).toContain(`live/${v.id}.json`);
    expect(server.paths).toContain(`live/${v.version.assets.yard!.sha256}.json`);
  });

  /** Two versions of the start scene: the welcome's, then one with a second flag a later snapshot moves to. */
  async function startVersions(b: Build) {
    const first = await publish(
      b,
      withHeldDoc(physicsFreeFiles(), "yard.json", flagged("yard", ["tiles"])),
      "yard",
    );
    const def = flagged("yard", ["tiles"]);
    const second = await publish(
      b,
      withHeldDoc(physicsFreeFiles(), "yard.json", {
        ...def,
        entities: [...(def.entities ?? []), { id: "flag2", type: "marker", at: [3, 1] }],
      }),
      "yard",
    );
    return {
      first,
      second,
      welcome: welcomeOf({ live: await snapshot(b, [entry(first, "now")]) }),
      moved: await snapshot(b, [entry(second, "now", 2)]),
    };
  }

  /** The start scene's first load ran `v`: applied at next-load, no swap, before any step. */
  async function expectFirstLoad(page: FakePage, game: StandaloneGame, v: Published) {
    expect(game.instance.flow.current()).toBe("yard");
    expect(game.instance.live.current("yard")).toBe(v.id);
    expect(game.instance.runtime()?.get("flag2")).toBeDefined();
    const ofV = () => states(page).filter((m) => m.version === v.id);
    await vi.waitFor(() =>
      expect(ofV().map((m) => m.status)).toEqual(["staging", "ready", "applied"]),
    );
    expect(ofV().at(-1)).toMatchObject({ timing: "next-load" });
  }

  it("applies a live.update the page sent right after its welcome, while the frame booted", async () => {
    const b = fresh();
    const { first, second, welcome, moved } = await startVersions(b);
    const page: FakePage = fakeParent({
      welcome,
      answer: (m) => {
        if (m.type !== "hello") return undefined;
        queueMicrotask(() => page.send({ type: "live.update", live: moved }));
        return { type: "reply", id: m.id, ok: true, result: welcome };
      },
    });
    const game = await boot(serve(b));
    await expectFirstLoad(page, game, second);
    // The welcome's version was superseded before it staged.
    expect(states(page).filter((m) => m.version === first.id)).toMatchObject([
      { status: "staging" },
    ]);
  });

  it("loads the start scene with the version a live.update named while the welcome's was staging", async () => {
    const b = fresh();
    const { first, second, welcome, moved } = await startVersions(b);
    const page = fakeParent({ welcome });
    const server = serve(b);
    const open = server.hold(`live/${first.id}.json`);
    const booting = boot(server);
    await vi.waitFor(() => expect(statuses(page, "yard")).toEqual(["staging"]));
    page.send({ type: "live.update", live: moved });
    const game = await booting;
    open();
    await expectFirstLoad(page, game, second);
  });

  it("stages and applies a live.update, reporting each step", async () => {
    const b = fresh();
    const v = await publish(
      b,
      withHeldDoc(physicsFreeFiles(), "yard.json", flagged("yard", ["tiles"])),
      "yard",
    );
    const page = fakeParent();
    const game = await boot(serve(b));
    expect(hasFlag(game)).toBe(false);
    page.send({ type: "live.update", live: await snapshot(b, [entry(v, "now")]) });
    await vi.waitFor(() => expect(statuses(page)).toEqual(["staging", "ready"]));
    expect(states(page)[1]).toMatchObject({ version: v.id, timing: "now" });
    game.instance.step();
    await vi.waitFor(() => expect(statuses(page)).toEqual(["staging", "ready", "applied"]));
    expect(states(page)[2]).toMatchObject({
      scene: "yard",
      version: v.id,
      timing: "now",
      strategy: "reconcile",
      tick: expect.any(Number),
    });
    expect(hasFlag(game)).toBe(true);

    // The same snapshot again changes nothing.
    page.send({ type: "live.update", live: await snapshot(b, [entry(v, "now")]) });
    await new Promise((r) => setTimeout(r, 20));
    expect(statuses(page)).toHaveLength(3);
  });

  it("offers the run's recording, its swap included, as a download on recording.request", async () => {
    const b = fresh();
    const v = await publish(
      b,
      withHeldDoc(physicsFreeFiles(), "yard.json", flagged("yard", ["tiles"])),
      "yard",
    );
    const page = fakeParent();
    const game = await boot(serve(b));
    game.instance.step(2);
    page.send({ type: "live.update", live: await snapshot(b, [entry(v, "now")]) });
    await vi.waitFor(() => expect(statuses(page)).toEqual(["staging", "ready"]));
    game.instance.step(3);
    await vi.waitFor(() => expect(statuses(page)).toContain("applied"));
    page.send({ type: "recording.request" });
    const [download] = await page.until("download");
    expect(download).toMatchObject({
      name: "yard.recording.json",
      contentType: "application/json",
    });
    const recording = JSON.parse(new TextDecoder().decode(download!.bytes as ArrayBuffer));
    expect(recording).toMatchObject({ scene: "yard", ticks: 5, outcome: { result: "quit" } });
    expect(recording.sceneVersion).toBeUndefined();
    expect(recording.swaps).toEqual([
      expect.objectContaining({ version: v.id, timing: "now", strategy: "reconcile" }),
    ]);
    // Asking doesn't end the session: it keeps recording.
    game.instance.step();
    page.send({ type: "recording.request" });
    const downloads = await page.until("download", 2);
    const later = JSON.parse(new TextDecoder().decode(downloads[1]!.bytes as ArrayBuffer));
    expect(later.ticks).toBe(6);
  });

  it("waits for the game's boundary before a boundary swap", async () => {
    const b = fresh();
    const v = await publish(
      b,
      withHeldDoc(physicsFreeFiles(), "yard.json", flagged("yard", ["tiles"])),
      "yard",
    );
    const page = fakeParent();
    const game = await boot(serve(b));
    page.send({ type: "live.update", live: await snapshot(b, [entry(v, "boundary")]) });
    await vi.waitFor(() => expect(statuses(page)).toEqual(["staging", "ready", "waiting"]));
    game.instance.step(3);
    expect(hasFlag(game)).toBe(false);
    marking = true;
    game.instance.step(2);
    await vi.waitFor(() =>
      expect(statuses(page)).toEqual(["staging", "ready", "waiting", "applied"]),
    );
    expect(states(page)[3]).toMatchObject({ timing: "boundary", strategy: "reconcile" });
    expect(hasFlag(game)).toBe(true);
  });

  it("refuses a version file that doesn't hash to its id", async () => {
    const b = fresh();
    const v = await publish(
      b,
      withHeldDoc(physicsFreeFiles(), "yard.json", flagged("yard", ["tiles"])),
      "yard",
    );
    b.files.set(`live/${v.id}.json`, `${v.text} `);
    const page = fakeParent();
    const game = await boot(serve(b));
    page.send({ type: "live.update", live: await snapshot(b, [entry(v, "now")]) });
    await vi.waitFor(() => expect(statuses(page)).toEqual(["staging", "refused"]));
    expect(states(page)[1]).toMatchObject({
      version: v.id,
      issue: { code: "hash-mismatch", expected: v.id },
    });
    game.instance.step(2);
    expect(hasFlag(game)).toBe(false);
    expect(game.instance.live.current("yard")).toBeNull();
  });

  it("refuses a carried doc that doesn't hash to its pin", async () => {
    const b = fresh();
    const v = await publish(
      b,
      withHeldDoc(physicsFreeFiles(), "yard.json", flagged("yard", ["tiles"])),
      "yard",
    );
    const doc = v.version.assets.yard!.sha256;
    b.files.set(`live/${doc}.json`, `${b.files.get(`live/${doc}.json`)} `);
    const page = fakeParent();
    await boot(serve(b));
    page.send({ type: "live.update", live: await snapshot(b, [entry(v, "now")]) });
    await vi.waitFor(() => expect(statuses(page)).toEqual(["staging", "refused"]));
    expect(states(page)[1]).toMatchObject({ issue: { code: "hash-mismatch", expected: doc } });
  });

  it("reads what the release ships from data/ and assets/, and only the rest from live/", async () => {
    const b = fresh();
    const same = await publish(b, physicsFreeFiles(), "hall");
    const hall = same.version.assets.hall!.sha256;
    expect(b.files.has(`data/${hall}.json`)).toBe(true);
    const page = fakeParent();
    const server = serve(b);
    await boot(server);
    const booting = server.paths.length;
    page.send({ type: "live.update", live: await snapshot(b, [entry(same, "next-load")]) });
    await vi.waitFor(() => expect(statuses(page, "hall")).toEqual(["staging", "ready"]));
    expect(server.paths).toContain(`live/${same.id}.json`);
    expect(server.paths.slice(booting).filter((p) => p.includes(hall))).toEqual([
      `data/${hall}.json`,
    ]);

    // A new texture loads from live/, the release's own from its assets/ files.
    const moss = "9".repeat(64);
    const held = withHeldDoc(
      physicsFreeFiles(),
      "hall.json",
      scene("hall", ["moss", "rocks", "tiles"]),
    );
    held.files.push({ path: "art/moss.png", sidecar: png("moss", moss, 120, 16) });
    const mossy = await publish(b, held, "hall");
    expect(mossy.version.assets.moss?.file).toBe(`live/${moss}.png`);
    loaded.length = 0;
    page.send({ type: "live.update", live: await snapshot(b, [entry(mossy, "next-load", 2)]) });
    await vi.waitFor(() =>
      expect(statuses(page, "hall")).toEqual(["staging", "ready", "staging", "ready"]),
    );
    const dir = new URL(".", document.baseURI).href;
    const rocks = b.manifest.assets.rocks!.file;
    expect(rocks.startsWith("assets/")).toBe(true);
    expect(loaded).toEqual(expect.arrayContaining([`${dir}live/${moss}.png`, `${dir}${rocks}`]));
  });

  it("puts a scene that leaves the snapshot back to the release's own, at its last timing", async () => {
    const b = fresh();
    const v = await publish(
      b,
      withHeldDoc(physicsFreeFiles(), "yard.json", flagged("yard", ["tiles"])),
      "yard",
    );
    const page = fakeParent();
    const game = await boot(serve(b));
    page.send({ type: "live.update", live: await snapshot(b, [entry(v, "now")]) });
    await vi.waitFor(() => expect(statuses(page)).toEqual(["staging", "ready"]));
    game.instance.step();
    await vi.waitFor(() => expect(statuses(page)).toContain("applied"));
    expect(hasFlag(game)).toBe(true);

    page.send({ type: "live.update", live: await snapshot(b, []) });
    await vi.waitFor(() => expect(statuses(page)).toHaveLength(4));
    expect(states(page)[3]).toMatchObject({
      scene: "yard",
      version: null,
      status: "ready",
      timing: "now",
    });
    game.instance.step();
    await vi.waitFor(() => expect(statuses(page)).toHaveLength(5));
    expect(states(page)[4]).toMatchObject({ version: null, status: "applied", timing: "now" });
    expect(hasFlag(game)).toBe(false);
    expect(game.instance.live.current("yard")).toBeNull();
  });

  it("goes back at the next load when the version it ran was removed", async () => {
    const b = fresh();
    const v = await publish(
      b,
      withHeldDoc(physicsFreeFiles(), "yard.json", flagged("yard", ["tiles"])),
      "yard",
    );
    const page = fakeParent();
    const game = await boot(serve(b));
    page.send({ type: "live.update", live: await snapshot(b, [entry(v, "now")]) });
    await vi.waitFor(() => expect(statuses(page)).toEqual(["staging", "ready"]));
    game.instance.step();
    await vi.waitFor(() => expect(statuses(page)).toContain("applied"));

    page.send({ type: "live.update", live: await snapshot(b, [], [v.id]) });
    await vi.waitFor(() => expect(statuses(page)).toHaveLength(4));
    expect(states(page)[3]).toMatchObject({ version: null, status: "ready", timing: "next-load" });
    game.instance.step(2);
    expect(hasFlag(game)).toBe(true);
    expect((await game.instance.flow.restart()).ok).toBe(true);
    await vi.waitFor(() => expect(statuses(page)).toHaveLength(5));
    expect(states(page)[4]).toMatchObject({
      version: null,
      status: "applied",
      timing: "next-load",
    });
    expect(hasFlag(game)).toBe(false);
  });

  it("goes back at the next load when the version it ran was blocked", async () => {
    const b = fresh();
    const v = await publish(
      b,
      withHeldDoc(physicsFreeFiles(), "yard.json", flagged("yard", ["tiles"])),
      "yard",
    );
    const page = fakeParent();
    const game = await boot(serve(b));
    page.send({ type: "live.update", live: await snapshot(b, [entry(v, "now")]) });
    await vi.waitFor(() => expect(statuses(page)).toEqual(["staging", "ready"]));
    game.instance.step();
    await vi.waitFor(() => expect(statuses(page)).toContain("applied"));

    page.send({ type: "live.update", live: { ...(await snapshot(b, [])), blocked: [v.id] } });
    await vi.waitFor(() => expect(statuses(page)).toHaveLength(4));
    expect(states(page)[3]).toMatchObject({ version: null, status: "ready", timing: "next-load" });
    game.instance.step(2);
    expect(hasFlag(game)).toBe(true);
    expect((await game.instance.flow.restart()).ok).toBe(true);
    await vi.waitFor(() => expect(statuses(page)).toHaveLength(5));
    expect(states(page)[4]).toMatchObject({
      version: null,
      status: "applied",
      timing: "next-load",
    });
    expect(hasFlag(game)).toBe(false);
  });

  it("cancels an older staging when a newer snapshot moves the scene on", async () => {
    const b = fresh();
    const first = await publish(
      b,
      withHeldDoc(physicsFreeFiles(), "yard.json", flagged("yard", ["tiles"])),
      "yard",
    );
    const second = await publish(
      b,
      withHeldDoc(physicsFreeFiles(), "yard.json", flagged("yard")),
      "yard",
    );
    const page = fakeParent();
    const server = serve(b);
    const game = await boot(server);
    const open = server.hold(`live/${first.id}.json`);
    page.send({ type: "live.update", live: await snapshot(b, [entry(first, "now")]) });
    await vi.waitFor(() => expect(server.paths).toContain(`live/${first.id}.json`));
    page.send({ type: "live.update", live: await snapshot(b, [entry(second, "now", 2)]) });
    await vi.waitFor(() => expect(statuses(page)).toEqual(["staging", "staging", "ready"]));
    open();
    await new Promise((r) => setTimeout(r, 30));
    expect(states(page).map((m) => [m.status, m.version])).toEqual([
      ["staging", first.id],
      ["staging", second.id],
      ["ready", second.id],
    ]);
    game.instance.step();
    await vi.waitFor(() => expect(statuses(page)).toHaveLength(4));
    expect(game.instance.live.current("yard")).toBe(second.id);
  });

  it("refuses a preparation that outlasts its 60 s deadline", async () => {
    const b = fresh();
    const v = await publish(
      b,
      withHeldDoc(physicsFreeFiles(), "yard.json", flagged("yard", ["tiles"])),
      "yard",
    );
    const page = fakeParent();
    const server = serve(b);
    await boot(server);
    server.hold(`live/${v.id}.json`);
    const live = await snapshot(b, [entry(v, "now")]);
    // The port's messages arrive on real time; only the deadline's timer is faked.
    const realTimeout = globalThis.setTimeout;
    const realWait = (ms: number) => new Promise((r) => realTimeout(r, ms));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    page.send({ type: "live.update", live });
    for (let i = 0; i < 200 && !server.paths.includes(`live/${v.id}.json`); i++) await realWait(5);
    expect(server.paths).toContain(`live/${v.id}.json`);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(statuses(page)).toEqual(["staging"]);
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    await vi.waitFor(() => expect(statuses(page)).toEqual(["staging", "refused"]));
    expect(states(page)[1]).toMatchObject({
      issue: { code: "live-swap-failed", detail: { phase: "stage" } },
    });
  });

  it("refuses an incompatible welcome version and starts on the release's own", async () => {
    const b = fresh();
    const v = await publish(
      b,
      withHeldDoc(physicsFreeFiles(), "yard.json", flagged("yard", ["tiles"])),
      "yard",
    );
    // Rule 4: the release lists yard as a level, so a sublevel version of it can't go live.
    const sub = await serveVersion(
      b,
      { ...v.version, entry: { ...v.version.entry, sublevel: true } },
      new Map([
        [v.version.assets.yard!.sha256, b.files.get(`live/${v.version.assets.yard!.sha256}.json`)!],
      ]),
    );
    const page = fakeParent({
      welcome: welcomeOf({ live: await snapshot(b, [entry(sub, "now")]) }),
    });
    const game = await boot(serve(b));
    expect(game.instance.flow.current()).toBe("yard");
    expect(hasFlag(game)).toBe(false);
    await vi.waitFor(() => expect(statuses(page)).toEqual(["staging", "refused"]));
    expect(states(page)[1]).toMatchObject({
      version: sub.id,
      issue: { code: "live-scene-unlisted", severity: "error" },
    });
  });

  it("takes a sublevel's version at its next attach in the same run, and says applied then", async () => {
    const b = fresh();
    const v = await publish(
      b,
      withHeldDoc(physicsFreeFiles(), "hall.json", flagged("hall", ["rocks", "tiles"])),
      "hall",
    );
    const page = fakeParent();
    const game = await boot(serve(b));
    const flow = () => (game.instance.runtime() as SceneRuntimeHandle).ctx.flow;
    const attach = () =>
      expect(flow().attach("hall", { label: "side", at: [10, 0] }).ok).toBe(true);
    const hallFlag = () => game.instance.runtime()?.get("side:flag") !== undefined;
    attach();

    page.send({ type: "live.update", live: await snapshot(b, [entry(v, "now")]) });
    await vi.waitFor(() => expect(statuses(page, "hall")).toEqual(["staging", "ready"]));
    // Attached under the running scene, it waits for its next attach.
    expect(states(page).at(-1)).toMatchObject({ status: "ready", timing: "next-load" });
    expect(game.instance.live.pending()).toEqual([]);
    game.instance.step();
    expect(hallFlag()).toBe(false);
    expect(statuses(page, "hall")).toEqual(["staging", "ready"]);

    flow().detach("side");
    game.instance.step();
    attach();
    game.instance.step();
    expect(hallFlag()).toBe(true);
    await vi.waitFor(() => expect(statuses(page, "hall")).toEqual(["staging", "ready", "applied"]));
    expect(states(page).at(-1)).toMatchObject({ version: v.id, timing: "next-load" });
    // The run's recording holds the move, so its replay attaches the same hall. It came
    // before the first step, so the release's own hall (what the load used) is written
    // first: a replay's load takes that one and the move after it.
    expect(game.instance.recording({ running: true })?.swaps).toEqual([
      expect.objectContaining({ tick: 0, sublevel: "hall", version: null, timing: "next-load" }),
      expect.objectContaining({ tick: 0, sublevel: "hall", version: v.id, timing: "next-load" }),
    ]);

    // A recording of the next load starts with the hall version its sublevels attach.
    expect((await game.instance.flow.restart()).ok).toBe(true);
    const next = game.instance.recording({ running: true });
    expect(next?.swaps).toEqual([
      expect.objectContaining({ tick: 0, sublevel: "hall", version: v.id, timing: "next-load" }),
    ]);
  });

  it("says applied when a second copy of a sublevel attaches while the first stays attached", async () => {
    const b = fresh();
    const v = await publish(
      b,
      withHeldDoc(physicsFreeFiles(), "hall.json", flagged("hall", ["rocks", "tiles"])),
      "hall",
    );
    const page = fakeParent();
    const game = await boot(serve(b));
    const flow = () => (game.instance.runtime() as SceneRuntimeHandle).ctx.flow;
    const flagOf = (label: string) => game.instance.runtime()?.get(`${label}:flag`) !== undefined;
    expect(flow().attach("hall", { label: "side", at: [10, 0] }).ok).toBe(true);

    page.send({ type: "live.update", live: await snapshot(b, [entry(v, "now")]) });
    await vi.waitFor(() => expect(statuses(page, "hall")).toEqual(["staging", "ready"]));
    game.instance.step();
    expect(statuses(page, "hall")).toEqual(["staging", "ready"]);

    expect(flow().attach("hall", { label: "east", at: [40, 0] }).ok).toBe(true);
    game.instance.step();
    expect(flagOf("side")).toBe(false);
    expect(flagOf("east")).toBe(true);
    await vi.waitFor(() => expect(statuses(page, "hall")).toEqual(["staging", "ready", "applied"]));
  });
});
