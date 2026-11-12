// @vitest-environment jsdom
import { Container } from "pixi.js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import { createGame } from "../../engine";
import { planContent } from "../../export/content";
import { finishExport, type BuiltCode, type ExportInput } from "../../export/plan";
import { createRegistry, withProject } from "../../game/define";
import type { GameDefinition } from "../../game/types";
import { snapshotRemapStore, type RemapState } from "../../input/remap";
import { formatReleaseManifest, releaseId, type ReleaseManifest } from "../../project/release";
import { heldProject, type HeldFile } from "../../project/runtime-view";
import { jsonValues, snapshotProject } from "../../project/snapshot";
import type { ProjectFile } from "../../project/types";
import { channelSaveStore, memorySaveStore } from "../../saves/store";
import { makeIssue } from "../../scene/issues";
import type { SceneDefinition, SceneIssue } from "../../scene/types";
import { ENGINE_VERSION } from "../../version";
import { bootStandalone, type StandaloneGame } from "../boot";
import { StandaloneBootError } from "../errors";
import { connectHost, HostRequestError, type HostChannel } from "../host-channel";
import {
  HOST_HANDSHAKE_TIMEOUT_MS,
  HOST_WELCOME_TIMEOUT_MS,
  type HostSaves,
  type HostWelcome,
} from "../host-protocol";

vi.mock("../../renderer", () => ({
  createRenderer: async () => ({
    app: {},
    worldContainer: new Container(),
    uiContainer: new Container(),
    resize: () => {},
    destroy: () => {},
  }),
}));

vi.mock("../../engine", async (original) => {
  const real = await original<typeof import("../../engine")>();
  return { ...real, createGame: vi.fn(real.createGame) };
});

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
vi.mock("../../render/asset-loader", async (original) => ({
  ...(await original<typeof import("../../render/asset-loader")>()),
  createAssetLoader: () => ({
    load: async () => ({ failed: [] }),
    retain() {},
    release() {},
    texture: () => null,
    onTexture: () => () => {},
    destroy() {},
  }),
}));

// ─── A fake parent page on a real MessageChannel ─────────

const RELEASE = "e".repeat(64);
const HELLO = { engine: ENGINE_VERSION, release: RELEASE, game: "test" };

const SAVES: HostSaves = {
  describe: "Saves stay in this browser until you sign in.",
  limits: { maxBytes: 32_768, maxSlots: 8 },
  mode: "site",
};

const REMAP: RemapState = {
  v: 1,
  players: { 0: { jump: [{ device: "key", code: "KeyW" }] } },
};

const welcomeOf = (over: Partial<HostWelcome> = {}): HostWelcome => ({
  player: { signedIn: false, name: null },
  saves: SAVES,
  prefs: { remap: REMAP, prefs: null },
  online: false,
  ...over,
});

type Received = { type: string; id?: number; params?: unknown; [k: string]: unknown };

type FakePage = {
  /** What the frame posted to its parent window. */
  readyPosts: { message: unknown; target: string }[];
  /** Every message the frame sent over the port. */
  received: Received[];
  /** The page's end of the port, once the handshake ran. */
  port: MessagePort | null;
  /** The saves the page holds, by `gameId:slot`. */
  slots: Map<string, string>;
  /** Sends a raw message to the frame over the port. */
  send(message: unknown): void;
  /** Waits until the frame has sent `n` messages of `type`. */
  until(type: string, n?: number): Promise<Received[]>;
};

type FakeOptions = {
  /** Never answer the handshake. */
  silent?: boolean;
  welcome?: HostWelcome;
  /** An answer to a request in place of the default one. */
  answer?: (m: Received) => unknown;
  /** Called with the window and a second port, after the real answer: a later `jams:host` the frame must ignore. */
  before?: (post: (data: unknown, ports?: MessagePort[]) => void) => void;
};

const open: MessagePort[] = [];

/** Dispatches a window message from `source` (default the parent), carrying `ports`. */
function postToFrame(data: unknown, ports: MessagePort[] = [], source: unknown = window.parent) {
  const event = new MessageEvent("message", { data });
  Object.defineProperty(event, "ports", { value: ports });
  Object.defineProperty(event, "source", { value: source });
  window.dispatchEvent(event);
}

function fakeParent(opts: FakeOptions = {}): FakePage {
  const page: FakePage = {
    readyPosts: [],
    received: [],
    port: null,
    slots: new Map(),
    send: (message) => page.port?.postMessage(message),
    until: (type, n = 1) =>
      vi.waitFor(
        () => {
          const of = page.received.filter((m) => m.type === type);
          expect(of.length).toBeGreaterThanOrEqual(n);
          return of;
        },
        { timeout: 2000 },
      ),
  };
  const reply = (m: Received, result: unknown) =>
    page.port?.postMessage({ type: "reply", id: m.id, ok: true, result });
  const answer = (m: Received): unknown => {
    const p = m.params as { gameId: string; slot: string; text: string; sessionId: string };
    switch (m.type) {
      case "hello":
        return opts.welcome ?? welcomeOf();
      case "saves.list":
        return [...page.slots.keys()]
          .filter((k) => k.startsWith(`${p.gameId}:`))
          .map((k) => ({
            slot: k.slice(p.gameId.length + 1),
            meta: { scene: "yard", savedAt: 1, playTicks: 2 },
            bytes: page.slots.get(k)!.length,
          }));
      case "saves.read":
        return page.slots.get(`${p.gameId}:${p.slot}`) ?? null;
      case "saves.write":
        page.slots.set(`${p.gameId}:${p.slot}`, p.text);
        return { ok: true, bytes: p.text.length };
      case "saves.remove":
        page.slots.delete(`${p.gameId}:${p.slot}`);
        return null;
      case "prefs.save":
        return null;
      case "session.token":
        return { token: `t-${p.sessionId}`, url: "wss://sync.example/" };
      default:
        return undefined;
    }
  };
  const parent = {
    postMessage(message: unknown, target: string) {
      page.readyPosts.push({ message, target });
      if (opts.silent) return;
      const { port1, port2 } = new MessageChannel();
      open.push(port1, port2);
      page.port = port1;
      port1.onmessage = (event: MessageEvent) => {
        const m = event.data as Received;
        page.received.push(m);
        if (m.id === undefined) return;
        const custom = opts.answer?.(m);
        if (custom !== undefined) page.port?.postMessage(custom);
        else reply(m, answer(m));
      };
      queueMicrotask(() => {
        opts.before?.(postToFrame);
        postToFrame({ type: "jams:host", protocol: 1 }, [port2]);
      });
    },
  };
  Object.defineProperty(window, "parent", { value: parent, configurable: true });
  return page;
}

function unframe() {
  Object.defineProperty(window, "parent", { value: window, configurable: true });
}

const channels: HostChannel[] = [];

async function connected(page: FakePage = fakeParent()): Promise<[HostChannel, FakePage]> {
  const channel = await connectHost({ hello: HELLO, timeoutMs: 2000 });
  expect(channel).not.toBeNull();
  channels.push(channel!);
  return [channel!, page];
}

afterEach(() => {
  for (const c of channels.splice(0)) c.close();
  for (const p of open.splice(0)) p.close();
  unframe();
  vi.useRealTimers();
});

// ─── The channel ─────────────────────────────────────────

describe("connectHost", () => {
  it("posts frame-ready to the parent, keeps the port it answers with and says hello", async () => {
    const [channel, page] = await connected();
    expect(page.readyPosts).toEqual([
      { message: { type: "jams:frame-ready", protocol: 1 }, target: "*" },
    ]);
    expect(page.received).toEqual([{ type: "hello", id: 0, params: HELLO }]);
    expect(channel.welcome).toEqual(welcomeOf());
    expect(channel.dropped).toBe(0);
  });

  it("resolves null when no parent answers within the timeout, 2 s by default", async () => {
    expect(HOST_HANDSHAKE_TIMEOUT_MS).toBe(2000);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const page = fakeParent({ silent: true });
    let result: HostChannel | null | undefined;
    void connectHost({ hello: HELLO }).then((c) => (result = c));
    await vi.advanceTimersByTimeAsync(1999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBeNull();
    expect(page.readyPosts).toHaveLength(1);
  });

  it("resolves null at once for a page that isn't framed", async () => {
    unframe();
    await expect(connectHost({ hello: HELLO })).resolves.toBeNull();
  });

  it("resolves null when the page answers hello with a refusal or never answers it", async () => {
    fakeParent({
      answer: (m) => ({
        type: "reply",
        id: m.id,
        ok: false,
        issue: makeIssue("save-store-failed", { message: "no" }),
      }),
    });
    await expect(connectHost({ hello: HELLO, timeoutMs: 500 })).resolves.toBeNull();
    fakeParent({ answer: () => ({ type: "pause" }) });
    await expect(
      connectHost({ hello: HELLO, timeoutMs: 100, welcomeTimeoutMs: 100 }),
    ).resolves.toBeNull();
  });

  it("waits past the handshake timeout for a welcome once the page's port arrived", async () => {
    expect(HOST_WELCOME_TIMEOUT_MS).toBe(30_000);
    let helloId: number | undefined;
    const page = fakeParent({
      answer: (m) => {
        if (m.type !== "hello") return undefined;
        helloId = m.id;
        return { type: "pause" };
      },
    });
    const pending = connectHost({ hello: HELLO, timeoutMs: 100 });
    await new Promise((done) => setTimeout(done, 300));
    page.send({ type: "reply", id: helloId, ok: true, result: welcomeOf() });
    const channel = await pending;
    expect(channel).not.toBeNull();
    channels.push(channel!);
  });

  it("takes the handshake only from the parent window, never a sourceless or foreign one", async () => {
    const page = fakeParent({ silent: true });
    const pending = connectHost({ hello: HELLO, timeoutMs: 200 });
    for (const source of [null, window, {}]) {
      const { port1, port2 } = new MessageChannel();
      open.push(port1, port2);
      postToFrame({ type: "jams:host", protocol: 1 }, [port2], source);
    }
    await expect(pending).resolves.toBeNull();
    expect(page.readyPosts).toHaveLength(1);
  });

  it("ignores every window message but the first valid jams:host with a port", async () => {
    let stray: MessageChannel | null = null;
    const page = fakeParent({
      before: (post) => {
        post({ type: "jams:host", protocol: 2 }, [new MessageChannel().port2]);
        post({ type: "jams:host", protocol: 1 });
        post({ type: "jams:host", protocol: 1, extra: true }, [new MessageChannel().port2]);
        post("hello");
        stray = new MessageChannel();
        open.push(stray.port1, stray.port2);
        queueMicrotask(() => post({ type: "jams:host", protocol: 1 }, [stray!.port2]));
      },
    });
    const strayReceived: unknown[] = [];
    const [channel] = await connected(page);
    (stray as MessageChannel | null)!.port1.onmessage = (e) => strayReceived.push(e.data);
    await channel.request("saves.list", { gameId: "test" });
    expect(strayReceived).toEqual([]);
    expect(page.received.map((m) => m.type)).toEqual(["hello", "saves.list"]);
  });
});

describe("the channel's methods", () => {
  it("round-trips every request and carries both events to the page", async () => {
    const [channel, page] = await connected();
    await expect(channel.request("saves.list", { gameId: "test" })).resolves.toEqual([]);
    await expect(
      channel.request("saves.write", { gameId: "test", slot: "a", text: "{}" }),
    ).resolves.toEqual({ ok: true, bytes: 2 });
    await expect(channel.request("saves.read", { gameId: "test", slot: "a" })).resolves.toBe("{}");
    const listed = await channel.request("saves.list", { gameId: "test" });
    expect(listed.map((s) => s.slot)).toEqual(["a"]);
    await expect(channel.request("saves.remove", { gameId: "test", slot: "a" })).resolves.toBe(
      null,
    );
    await expect(channel.request("saves.read", { gameId: "test", slot: "a" })).resolves.toBe(null);
    await expect(channel.request("prefs.save", { store: "remap", value: REMAP })).resolves.toBe(
      null,
    );
    await expect(channel.request("session.token", { sessionId: "s1" })).resolves.toEqual({
      token: "t-s1",
      url: "wss://sync.example/",
    });

    const issue = makeIssue("scene-unlisted", { message: "boom" });
    channel.state("loading");
    channel.state("error", issue);
    channel.offerDownload("run.json", "application/json", new Uint8Array([91, 49, 93]).buffer);
    const [, failed] = await page.until("state", 2);
    expect(page.received.filter((m) => m.type === "state")[0]).toEqual({
      type: "state",
      jamsState: "loading",
    });
    expect(failed).toEqual({ type: "state", jamsState: "error", issue });
    const [download] = await page.until("download");
    expect(download?.name).toBe("run.json");
    expect(download?.contentType).toBe("application/json");
    expect(new TextDecoder().decode(download?.bytes as ArrayBuffer)).toBe("[1]");
  });

  it("rejects with the page's issue unchanged when the page refuses", async () => {
    const refusal: SceneIssue = {
      ...makeIssue("save-store-failed", {
        message: "Too many save requests; try again in a moment.",
      }),
      hint: "the page's own words",
    };
    const [channel] = await connected(
      fakeParent({
        answer: (m) =>
          m.type === "hello" ? undefined : { type: "reply", id: m.id, ok: false, issue: refusal },
      }),
    );
    const error = await channel
      .request("saves.read", { gameId: "test", slot: "a" })
      .catch((e) => e);
    expect(error).toBeInstanceOf(HostRequestError);
    expect((error as HostRequestError).issue).toEqual(refusal);
  });

  it("refuses a request the protocol can't carry without posting it", async () => {
    const [channel, page] = await connected();
    const error = await channel
      .request("saves.read", { gameId: "test", slot: "not a slot!" })
      .catch((e) => e);
    expect((error as HostRequestError).issue.code).toBe("save-store-failed");
    const huge = "x".repeat(70_000);
    await expect(
      channel.request("saves.write", { gameId: "test", slot: "a", text: huge }),
    ).rejects.toBeInstanceOf(HostRequestError);
    expect(page.received.map((m) => m.type)).toEqual(["hello"]);
  });

  it("drops invalid messages from the page, counting them, and keeps working", async () => {
    const [channel, page] = await connected(
      fakeParent({
        answer: (m) =>
          m.type === "saves.read" ? { type: "reply", id: m.id, ok: true, result: 42 } : undefined,
      }),
    );
    const paused = vi.fn();
    channel.on("pause", paused);
    page.send("nonsense");
    page.send({ type: "pause", extra: "x".repeat(70_000) });
    page.send({ type: "saves.changed", saves: { describe: 1 } });
    page.send({ type: "reply", id: 999, ok: true, result: null });
    page.send({ type: "explode" });
    const bad = await channel.request("saves.read", { gameId: "test", slot: "a" }).catch((e) => e);
    expect((bad as HostRequestError).issue.message).toContain("saves.read");
    expect(channel.dropped).toBe(6);
    expect(paused).not.toHaveBeenCalled();
    page.send({ type: "pause" });
    await vi.waitFor(() => expect(paused).toHaveBeenCalledTimes(1));
    await expect(channel.request("saves.list", { gameId: "test" })).resolves.toEqual([]);
  });

  it("rejects what is pending when the channel closes, and every request after", async () => {
    const [channel] = await connected(
      fakeParent({ answer: (m) => (m.type === "hello" ? undefined : { type: "pause" }) }),
    );
    const pending = channel.request("saves.list", { gameId: "test" });
    channel.close();
    await expect(pending).rejects.toBeInstanceOf(HostRequestError);
    await expect(channel.request("saves.list", { gameId: "test" })).rejects.toBeInstanceOf(
      HostRequestError,
    );
  });
});

describe("channelSaveStore", () => {
  it("is the host's store, with the welcome's words and limits", async () => {
    const [channel, page] = await connected();
    const store = channelSaveStore(channel);
    expect(store.kind).toBe("host");
    expect(store.describe).toBe(SAVES.describe);
    expect(store.limits).toEqual(SAVES.limits);
    await expect(store.write("test", "a", "{}")).resolves.toEqual({ ok: true, bytes: 2 });
    expect(page.slots.get("test:a")).toBe("{}");
    await expect(store.read("test", "a")).resolves.toBe("{}");
    expect((await store.list("test")).map((s) => s.slot)).toEqual(["a"]);
    await store.remove("test", "a");
    await expect(store.read("test", "a")).resolves.toBeNull();
  });

  it("takes the page's new words and limits from saves.changed", async () => {
    const [channel, page] = await connected();
    const store = channelSaveStore(channel);
    const signedIn: HostSaves = {
      describe: "Saves are kept on your account.",
      limits: { maxBytes: 65_536, maxSlots: 20 },
      mode: "site",
    };
    page.send({ type: "saves.changed", saves: signedIn });
    await vi.waitFor(() => expect(store.describe).toBe(signedIn.describe));
    expect(store.limits).toEqual(signedIn.limits);
  });

  it("returns the page's refusal of a write unchanged; a failed read, list or remove is quiet", async () => {
    const refusal = makeIssue("save-too-large", {
      message: "Saves on jams.team are 32 KB at most.",
    });
    const [channel] = await connected(
      fakeParent({
        answer: (m) => {
          if (m.type === "saves.write")
            return { type: "reply", id: m.id, ok: true, result: { ok: false, issue: refusal } };
          if (m.type === "hello") return undefined;
          return {
            type: "reply",
            id: m.id,
            ok: false,
            issue: makeIssue("save-store-failed", { message: "Too many save requests" }),
          };
        },
      }),
    );
    const store = channelSaveStore(channel);
    await expect(store.write("test", "a", "{}")).resolves.toEqual({ ok: false, issue: refusal });
    await expect(store.read("test", "a")).resolves.toBeNull();
    await expect(store.list("test")).resolves.toEqual([]);
    await expect(store.remove("test", "a")).resolves.toBeUndefined();
  });

  it("passes a refused request's issue through as the write's result", async () => {
    const throttled = makeIssue("save-store-failed", {
      message: "Too many save requests; try again in a moment.",
    });
    const [channel] = await connected(
      fakeParent({
        answer: (m) =>
          m.type === "hello" ? undefined : { type: "reply", id: m.id, ok: false, issue: throttled },
      }),
    );
    await expect(channelSaveStore(channel).write("test", "a", "{}")).resolves.toEqual({
      ok: false,
      issue: throttled,
    });
  });
});

describe("snapshotRemapStore", () => {
  it("loads the host's snapshot; a value that isn't a v1 state loads as none", () => {
    const store = snapshotRemapStore(REMAP, () => {});
    expect(store.load("test")).toEqual(REMAP);
    expect(store.load("test")).not.toBe(REMAP);
    expect(snapshotRemapStore(null, () => {}).load("test")).toBeNull();
    expect(snapshotRemapStore({ v: 2, players: {} }, () => {}).load("test")).toBeNull();
  });

  it("hands the latest state back once, 500 ms after the last change", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const saved = vi.fn();
    const store = snapshotRemapStore(null, saved);
    const next = (code: string): RemapState => ({
      v: 1,
      players: { 0: { jump: [{ device: "key", code }] } },
    });
    store.save("test", next("KeyA"));
    expect(store.load("test")).toEqual(next("KeyA"));
    await vi.advanceTimersByTimeAsync(400);
    store.save("test", next("KeyB"));
    await vi.advanceTimersByTimeAsync(499);
    expect(saved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(saved.mock.calls).toEqual([["test", next("KeyB")]]);
    expect(store.load("test")).toEqual(next("KeyB"));
  });
});

// ─── bootStandalone with a host ──────────────────────────

const yard = (): SceneDefinition =>
  ({
    v: 4,
    name: "yard",
    bounds: [0, 0, 6.4, 3.84],
    settings: { physics: "none" },
    entities: [{ id: "start", type: "marker", at: [1, 1], tags: ["spawn"] }],
  }) as SceneDefinition;

const PROJECT: ProjectFile = { kind: "project", v: 1, id: "free", name: "Free", game: null };

const CODE: BuiltCode = {
  files: [{ path: "code/main-abc123.js", sha256: "d".repeat(64), bytes: 1000, role: "code" }],
  entry: "code/main-abc123.js",
  rapier: null,
  thirdParty: [],
};

type Build = { manifest: ReleaseManifest; files: Map<string, string> };

/** A one-scene, physics-free web build of `game`, planned in memory. */
async function plannedBuild(game: GameDefinition): Promise<Build> {
  const docs: Record<string, unknown> = {
    "scene-list.json": { kind: "scene-list", v: 1, start: "yard", scenes: [{ scene: "yard" }] },
    "game-settings.json": { kind: "game-settings", v: 2, engine: {}, game: {} },
    "yard.json": yard(),
  };
  const held: HeldFile[] = Object.entries(docs).map(([path, json]) => ({ path, json }));
  const { view, kinds } = heldProject(held, createRegistry(game), {
    projectId: PROJECT.id,
    name: PROJECT.name,
  });
  const texts = new Map<string, string>();
  for (const entry of view.byId.values()) {
    const json = docs[entry.path];
    if (json !== undefined) texts.set(entry.id, `${JSON.stringify(json, null, 2)}\n`);
  }
  const input: ExportInput = {
    project: PROJECT,
    view,
    texts,
    kinds,
    registry: withProject(createRegistry(game), view, jsonValues(texts)),
    game,
    engine: {},
    target: "web",
    snapshot: await snapshotProject(view, texts, view.state.build),
  };
  const plan = await finishExport(await planContent(input), CODE, input);
  expect(plan.issues.filter((i) => i.severity === "error")).toEqual([]);
  const files = new Map<string, string>();
  for (const f of plan.files)
    files.set(f.path, f.source.kind === "text" ? f.source.text : `<${f.source.kind}>`);
  return { manifest: plan.manifest, files };
}

function serve(b: Build): typeof fetch {
  const dir = new URL(".", document.baseURI).href;
  return (async (input: string) => {
    const path = String(input).slice(dir.length);
    const text = path === "release.json" ? formatReleaseManifest(b.manifest) : b.files.get(path);
    return { ok: text !== undefined, status: text ? 200 : 404, text: async () => text ?? "" };
  }) as unknown as typeof fetch;
}

const own = memorySaveStore();
const ownGame: GameDefinition = { ...testGame, saves: { version: 1, store: () => own } };

describe("bootStandalone with ?host=jams", () => {
  let build: Build;
  let ownBuild: Build;
  let root: HTMLElement;
  let register: ReturnType<typeof vi.fn>;
  const booted: StandaloneGame[] = [];

  beforeAll(async () => {
    build = await plannedBuild(testGame);
    ownBuild = await plannedBuild(ownGame);
    expect(build.manifest.pwa).not.toBeNull();
  });

  beforeEach(() => {
    root = document.createElement("div");
    document.body.append(root);
    window.history.replaceState(null, "", "?host=jams");
    vi.mocked(createGame).mockClear();
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
    register = vi.fn(async () => ({}));
    Object.defineProperty(navigator, "serviceWorker", { value: { register }, configurable: true });
    vi.stubGlobal("isSecureContext", true);
  });

  afterEach(() => {
    for (const game of booted.splice(0)) game.destroy();
    document.body.replaceChildren();
    document.documentElement.removeAttribute("style");
    document.body.removeAttribute("style");
    delete document.documentElement.dataset.jamsState;
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    window.history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
  });

  async function boot(game: GameDefinition = testGame, b: Build = build) {
    const playing = await bootStandalone({ root, game, fetch: serve(b) });
    booted.push(playing);
    return playing;
  }

  it("saves and remaps through the page, reports its state and registers no worker", async () => {
    const page = fakeParent();
    const game = await boot();
    expect(game.host).not.toBeNull();
    expect(game.host!.welcome).toEqual(welcomeOf());
    expect(page.received[0]).toEqual({
      type: "hello",
      id: 0,
      params: {
        engine: ENGINE_VERSION,
        release: await releaseId(build.manifest),
        game: testGame.id,
      },
    });
    expect(game.instance.saves.store.kind).toBe("host");
    expect(game.instance.saves.store.describe).toBe(SAVES.describe);
    await game.instance.saves.list();
    await page.until("saves.list");

    const opts = vi.mocked(createGame).mock.calls[0]![1];
    const remaps = opts.input!.remaps!;
    expect(remaps.load("test")).toEqual(REMAP);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    remaps.save("test", { v: 1, players: {} });
    await vi.advanceTimersByTimeAsync(500);
    vi.useRealTimers();
    const [prefs] = await page.until("prefs.save");
    expect(prefs?.params).toEqual({ store: "remap", value: { v: 1, players: {} } });

    const states = await page.until("state", 2);
    expect(states.map((s) => s.jamsState)).toEqual(["loading", "ready"]);
    expect(document.documentElement.dataset.jamsState).toBe("ready");
    expect(register).not.toHaveBeenCalled();
    expect(game.install).toBeNull();
  });

  it("pauses and resumes on the page's events, leaving a game it didn't pause paused", async () => {
    const page = fakeParent();
    const game = await boot();
    expect(game.instance.getStore().state.sim.paused).toBe(false);
    page.send({ type: "pause" });
    await vi.waitFor(() => expect(game.instance.getStore().state.sim.paused).toBe(true));
    page.send({ type: "resume" });
    await vi.waitFor(() => expect(game.instance.getStore().state.sim.paused).toBe(false));

    game.instance.pause();
    page.send({ type: "pause" });
    page.send({ type: "resume" });
    page.send({ type: "saves.changed", saves: SAVES });
    await vi.waitFor(() => expect(game.host!.dropped).toBe(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(game.instance.getStore().state.sim.paused).toBe(true);
  });

  it("keeps the game's own store over the page's", async () => {
    const page = fakeParent();
    const game = await boot(ownGame, ownBuild);
    expect(game.host).not.toBeNull();
    expect(game.instance.saves.store.kind).toBe("memory");
    await own.write(ownGame.id, "a", "{}");
    await game.instance.saves.remove("a");
    await expect(own.read(ownGame.id, "a")).resolves.toBeNull();
    expect(page.received.filter((m) => m.type.startsWith("saves."))).toEqual([]);
  });

  it("reports a refusal to the page before closing the channel", async () => {
    const early = fakeParent();
    const other: GameDefinition = { ...testGame, id: "other" };
    await expect(bootStandalone({ root, game: other, fetch: serve(build) })).rejects.toThrow();
    expect(early.readyPosts).toEqual([]);

    const page = fakeParent();
    const issue = makeIssue("scene-unlisted", { message: "the start scene is gone" });
    vi.mocked(createGame).mockImplementationOnce(async () => {
      throw new StandaloneBootError([issue]);
    });
    await expect(bootStandalone({ root, game: testGame, fetch: serve(build) })).rejects.toThrow();
    const states = await page.until("state", 2);
    expect(states).toEqual([
      { type: "state", jamsState: "loading" },
      { type: "state", jamsState: "error", issue },
    ]);
    expect(document.documentElement.dataset.jamsState).toBe("error");
  });

  it("plays as a plain build when the page doesn't answer in 2 s", async () => {
    const page = fakeParent({ silent: true });
    const started = Date.now();
    const game = await boot();
    expect(Date.now() - started).toBeGreaterThanOrEqual(HOST_HANDSHAKE_TIMEOUT_MS - 50);
    expect(page.readyPosts).toHaveLength(1);
    expect(game.host).toBeNull();
    expect(game.instance.saves.store.kind).not.toBe("host");
    expect(register).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("never looks for a host without ?host=jams", async () => {
    window.history.replaceState(null, "", "/");
    const page = fakeParent();
    const game = await boot();
    expect(page.readyPosts).toEqual([]);
    expect(game.host).toBeNull();
  });
});
