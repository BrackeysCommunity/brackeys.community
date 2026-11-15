// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import {
  LIVE_FRAME_MAX_BYTES,
  liveRequest,
  sceneToDoc,
  sequentialKeys,
  type AwarenessLike,
  type LiveResponse,
  type StatelessProvider,
} from "../../collab/index";
import { createDebugOverlay } from "../../debug/index";
import type { SceneDefinition } from "../../editor/index";
import { defineGame } from "../../game/index";
import { createGame, type GameInstance, type RapierModule } from "../../index";
import type { EditorStorage } from "../host";
import { KitProvider } from "../kit/index";
import { AgentsPanel } from "../panels/settings/AgentsPanel";
import { createPending } from "../pending/pending";
import {
  AGENTS_DRIVE_PLAY_KEY,
  agentsDrivePlay,
  attachEditorResponder,
  encodePng,
  fitFrame,
  frameRegion,
  type FramePixels,
} from "../session/live-responder";
import { editorIdentity, openLiveEditor, type LiveEditor } from "../session/live-scene-editor";

vi.mock("pixi.js", async (importOriginal) => {
  const pixi = await importOriginal<typeof import("pixi.js")>();
  class Application {
    stage = new pixi.Container();
    renderer = { resize: () => {} };
    async init() {}
    destroy() {}
  }
  return {
    ...pixi,
    Application,
    Assets: { load: async () => pixi.Texture.WHITE, unload: async () => {} },
  };
});

vi.mock("../../ui/layer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ui/layer")>()),
  mountUi: () => () => {},
}));

const notify = Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() });

const liveGame = defineGame({
  id: "live-responder",
  types: [],
  actions: [{ action: "right", keys: ["d"], description: "Right." }],
  play: { spawnShape: { type: "box", hw: 0.2, hh: 0.2 } },
  createRuntime: () => ({ snapshot: () => null }),
});

const yard = (): SceneDefinition => ({
  v: 4,
  name: "live-yard",
  bounds: [0, 0, 20, 12],
  solid: [["box", 5, 10.4, 5, 0.2]],
  entities: [{ id: "pad", type: "marker", at: [10, 10.1] }],
});

/**
 * A doc's connections as a relay serves them: awareness states every client
 * sees, and stateless messages delivered to every other client, never back
 * to the sender, after the send returns.
 */
function relay() {
  const states = new Map<number, Record<string, unknown>>();
  const change = new Set<() => void>();
  const clients = new Map<number, Set<(e: { payload: string }) => void>>();
  const join = (clientID: number): StatelessProvider & { leave(): void } => {
    const listeners = new Set<(e: { payload: string }) => void>();
    clients.set(clientID, listeners);
    const awareness: AwarenessLike = {
      clientID,
      getLocalState: () => states.get(clientID) ?? null,
      setLocalStateField(field, value) {
        states.set(clientID, { ...states.get(clientID), [field]: value });
        for (const h of change) h();
      },
      getStates: () => states,
      on: (_e, cb) => void change.add(cb as () => void),
      off: (_e, cb) => void change.delete(cb as () => void),
    };
    return {
      awareness,
      sendStateless(payload) {
        queueMicrotask(() => {
          for (const [id, ls] of clients) if (id !== clientID) for (const l of ls) l({ payload });
        });
      },
      on: (_e, fn) => void listeners.add(fn),
      off: (_e, fn) => void listeners.delete(fn),
      leave() {
        clients.delete(clientID);
        states.delete(clientID);
        for (const h of change) h();
      },
    };
  };
  return { join, states };
}

function memoryStorage(): EditorStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, get: (k) => map.get(k) ?? null, set: (k, v) => void map.set(k, v) };
}

/** Noise, which no deflate shrinks, so a large frame has to be downscaled to fit. */
function noise(width: number, height: number): FramePixels {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i++) {
    let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    data[i] = i % 4 === 3 ? 255 : (h ^ (h >>> 16)) & 0xff;
  }
  return { width, height, data };
}

const pngSize = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

let rapier: RapierModule;
beforeAll(async () => {
  rapier = await import("@dimforge/rapier2d");
});

let game: GameInstance | null = null;
let live: LiveEditor | null = null;
let detach: (() => void) | null = null;

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  localStorage.removeItem("debug-overlay-mode");
  detach?.();
  live?.destroy();
  game?.destroy();
  detach = live = game = null;
  vi.unstubAllGlobals();
});

async function setup(opts: { storage?: EditorStorage; hosted?: boolean; debug?: boolean } = {}) {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  game = await createGame(canvas, {
    game: liveGame,
    rapier: async () => rapier,
    dev: true,
    ...(opts.debug ? { debug: createDebugOverlay } : {}),
  });
  game.start();
  const doc = sceneToDoc(yard(), { key: sequentialKeys("t") });
  const net = relay();
  const editorSide = net.join(1);
  const agent = net.join(9);
  const projectNet = relay();
  const projectAwareness = projectNet.join(1).awareness!;
  live = openLiveEditor({
    game,
    doc,
    awareness: editorSide.awareness!,
    name: "live-yard",
    identity: editorIdentity("Ada"),
    notify,
    issuesDebounceMs: 0,
  });
  const storage = opts.storage ?? memoryStorage();
  const pending = createPending({ notify });
  const capture = vi.fn(async () => noise(1600, 1000));
  detach = attachEditorResponder({
    provider: editorSide,
    projectAwareness,
    enabled: () => agentsDrivePlay(storage, opts.hosted ?? false),
    live,
    game,
    capture,
    pending,
  });
  let n = 0;
  const ask = <T extends LiveResponse["t"]>(req: Record<string, unknown> & { t: T }) =>
    liveRequest(agent, { ...req, id: `r${++n}` } as never) as Promise<
      Extract<LiveResponse, { t: T }>
    >;
  return { doc, agent, ask, storage, pending, capture, projectAwareness, net };
}

const state = () => game!.getStore().state;

describe("the editor's live responder", () => {
  it("answers a frame with a PNG under the cap at the game's tick", async () => {
    const { ask, capture } = await setup();
    const res = await ask({ t: "frame", opts: {} });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const bytes = Uint8Array.from(atob(res.png), (c) => c.charCodeAt(0));
    expect(bytes.byteLength).toBeLessThanOrEqual(LIVE_FRAME_MAX_BYTES);
    expect([...bytes.subarray(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
    expect(pngSize(bytes)).toEqual({ width: res.width, height: res.height });
    expect(res.width).toBeLessThan(1600);
    expect(res.width / res.height).toBeCloseTo(1.6, 1);
    expect(res.tick).toBe(state().tick);
    expect(res.mode).toBe("edit");
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("plays through the editor's own Play, steps 60 ticks and reports tick 60", async () => {
    const { ask } = await setup();
    const played = await ask({ t: "play", action: "play" });
    expect(played).toMatchObject({ ok: true, phase: expect.any(String) });
    expect(state().mode).toBe("play");
    expect(live!.session.store.state.mode).toBe("play");
    const stepped = await ask({ t: "play", action: "step", ticks: 60 });
    expect(stepped).toMatchObject({ ok: true, tick: 60 });
    const read = await ask({ t: "state" });
    expect(read).toMatchObject({ ok: true, store: { tick: 60, mode: "play" } });
    if (read.ok) expect(JSON.parse(JSON.stringify(read.store))).toEqual(read.store);
  });

  it("stops back to the edit world", async () => {
    const { ask } = await setup();
    await ask({ t: "play", action: "play" });
    await ask({ t: "play", action: "step", ticks: 5 });
    const stopped = await ask({ t: "play", action: "stop" });
    expect(stopped.ok).toBe(true);
    expect(state().mode).toBe("edit");
    expect(state().session).toBeNull();
    expect(live!.session.store.state.mode).toBe("edit");
  });

  it("lets an agent play, step 60 ticks and read state over the doc's relay", async () => {
    const { ask } = await setup();
    const steps = [
      await ask({ t: "play", action: "play" }),
      await ask({ t: "play", action: "pause" }),
      await ask({ t: "play", action: "step", ticks: 60 }),
    ];
    expect(steps.every((s) => s.ok)).toBe(true);
    const read = await ask({ t: "state", select: ["store", "events", "timings"] });
    expect(read).toMatchObject({ ok: true, store: { tick: 60, phase: state().phase } });
    if (read.ok) {
      expect(Array.isArray(read.events)).toBe(true);
      expect(read.store!.dialogue).toEqual(state().dialogue);
    }
  });

  it("refuses while the viewer's toggle is off, and defaults off on a hosted server", async () => {
    const storage = memoryStorage();
    storage.set(AGENTS_DRIVE_PLAY_KEY, "false");
    const { ask } = await setup({ storage });
    expect(await ask({ t: "frame", opts: {} })).toMatchObject({ ok: false, code: "live-refused" });
    expect(await ask({ t: "play", action: "play" })).toMatchObject({
      ok: false,
      code: "live-refused",
    });
    expect(state().mode).toBe("edit");
    expect(agentsDrivePlay(memoryStorage(), true)).toBe(false);
    expect(agentsDrivePlay(memoryStorage(), false)).toBe(true);
  });

  it("refuses an input script, which the open editor doesn't play", async () => {
    const { ask } = await setup();
    const res = await ask({ t: "play", action: "play", script: { steps: [] } });
    expect(res).toMatchObject({ ok: false, code: "live-refused" });
    expect(state().mode).toBe("edit");
  });

  it("takes a debug frame with every debug layer showing, then puts the overlay back", async () => {
    const { ask, capture } = await setup({ debug: true });
    const seen: string[] = [];
    capture.mockImplementation(async () => {
      seen.push(state().debugMode);
      return noise(8, 8);
    });
    expect(state().debugMode).toBe("off");
    expect((await ask({ t: "frame", opts: { debug: true } })).ok).toBe(true);
    expect(seen).toEqual(["perf"]);
    expect(state().debugMode).toBe("off");

    game!.router.dispatch({
      kind: "key",
      type: "down",
      key: "F3",
      code: "F3",
      native: new KeyboardEvent("keydown", { key: "F3" }),
    });
    expect(state().debugMode).toBe("grid");
    expect((await ask({ t: "frame", opts: { debug: true } })).ok).toBe(true);
    expect((await ask({ t: "frame", opts: {} })).ok).toBe(true);
    expect(seen).toEqual(["perf", "perf", "grid"]);
    expect(state().debugMode).toBe("grid");
    expect(localStorage.getItem("debug-overlay-mode")).toBe("grid");
  });

  it("puts the overlay back when a debug frame's capture fails", async () => {
    const { ask, capture } = await setup({ debug: true });
    capture.mockImplementationOnce(async () => {
      throw new Error("lost the canvas");
    });
    expect(await ask({ t: "frame", opts: { debug: true } })).toMatchObject({
      ok: false,
      code: "live-refused",
      message: "lost the canvas",
    });
    expect(state().debugMode).toBe("off");
  });

  it("refuses a debug frame from an editor without the debug overlay", async () => {
    const { ask, capture } = await setup();
    expect(await ask({ t: "frame", opts: { debug: true } })).toMatchObject({
      ok: false,
      code: "live-refused",
      message: expect.stringMatching(/no debug overlay/),
    });
    expect(capture).not.toHaveBeenCalled();
  });

  it("keeps the toggle in the viewer's storage, never in a doc", async () => {
    const storage = memoryStorage();
    const { doc } = await setup({ storage });
    const before = Y.encodeStateVector(doc);
    const updates = vi.fn();
    doc.on("update", updates);
    render(
      <KitProvider host={{ storage }}>
        <AgentsPanel />
      </KitProvider>,
    );
    const toggle = screen.getByRole("switch", { name: "Let agents drive Play" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    act(() => {
      fireEvent.click(toggle);
    });
    expect(storage.map.get(AGENTS_DRIVE_PLAY_KEY)).toBe("false");
    expect(agentsDrivePlay(storage, false)).toBe(false);
    expect(updates).not.toHaveBeenCalled();
    expect(Y.encodeStateVector(doc)).toEqual(before);
    expect(screen.getByText(/not saved to the project|Nothing here is saved/)).toBeTruthy();
  });

  it("shows a pending task while it answers", async () => {
    const { ask, pending, capture } = await setup();
    let release!: () => void;
    capture.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(noise(8, 8));
        }),
    );
    const answer = ask({ t: "frame", opts: {} });
    await vi.waitFor(() => expect(pending.store.state.tasks).toHaveLength(1));
    expect(pending.store.state.tasks[0]!.label).toBe("An agent is taking a frame");
    release();
    expect((await answer).ok).toBe(true);
    expect(pending.store.state.tasks).toHaveLength(0);
  });

  it("advertises live in the scene's and the project's presence until detached", async () => {
    const { projectAwareness, net } = await setup();
    expect(net.states.get(1)?.scene).toMatchObject({ live: true });
    expect(projectAwareness.getLocalState()?.project).toMatchObject({ live: true });
    detach!();
    detach = null;
    expect(net.states.get(1)?.scene).toMatchObject({ live: false });
    expect(projectAwareness.getLocalState()?.project).toMatchObject({ live: false });
  });
});

describe("live frames", () => {
  it("encodes a PNG whose header names its size", async () => {
    const png = await encodePng(noise(3, 2));
    expect(pngSize(png)).toEqual({ width: 3, height: 2 });
  });

  it("downscales until the PNG fits, keeping the aspect", async () => {
    const png = await fitFrame(noise(400, 200), 64 * 1024);
    expect(png.byteLength).toBeLessThanOrEqual(64 * 1024);
    const { width, height } = pngSize(png);
    expect(width).toBeLessThan(400);
    expect(width / height).toBeCloseTo(2, 1);
  });

  it("frames `viewport` metres through the canvas px per metre", () => {
    const r = frameRegion({ width: 1000, height: 500 }, { viewport: 10 }, 40);
    expect(r).toEqual({ x: 300, y: 150, width: 400, height: 200, outWidth: 400, outHeight: 200 });
    expect(frameRegion({ width: 1000, height: 500 }, { width: 200 }, null)).toMatchObject({
      width: 1000,
      outWidth: 200,
      outHeight: 100,
    });
  });
});
