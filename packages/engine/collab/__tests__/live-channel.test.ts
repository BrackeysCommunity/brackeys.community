import type { HocuspocusProvider } from "@hocuspocus/provider";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { docNameOf } from "../../project/doc-names";
import { formatScene } from "../../scene/format";
import type { GameInstance } from "../../types";
import { connect, engineProjectCopy, pushed, until } from "../../vite/__tests__/dev-server-fixture";
import { listenSceneCollab } from "../../vite/collab-server";
import { applyOpsToDoc } from "../apply";
import { docToScene } from "../convert";
import {
  createLiveResponder,
  electResponder,
  isLiveMessage,
  LIVE_FRAME_MAX_BYTES,
  LIVE_MESSAGE_MAX_BYTES,
  LIVE_REQUEST_TIMEOUT_MS,
  LIVE_STATE_EVENTS,
  LIVE_STEP_MAX_TICKS,
  liveRequest,
  livePresence,
  relayableStateless,
  type LiveResponse,
  type StatelessProvider,
} from "../live-channel";
import type { AwarenessLike, SceneOrigin } from "../types";

/** Peers on one doc: each message reaches every other peer, never its sender. */
function hub() {
  const peers: { listeners: Set<(e: { payload: string }) => void> }[] = [];
  const sent: string[] = [];
  return {
    sent,
    peer(awareness?: AwarenessLike): StatelessProvider {
      const self = { listeners: new Set<(e: { payload: string }) => void>() };
      peers.push(self);
      return {
        awareness: awareness ?? null,
        sendStateless(payload) {
          sent.push(payload);
          for (const p of peers) if (p !== self) for (const l of [...p.listeners]) l({ payload });
        },
        on: (_e, fn) => void self.listeners.add(fn),
        off: (_e, fn) => void self.listeners.delete(fn),
      };
    },
  };
}

/** One awareness per client, all sharing a state map, as peers on one doc see each other. */
function awarenessGroup() {
  const states = new Map<number, Record<string, unknown>>();
  const listeners = new Set<(...args: unknown[]) => void>();
  return (clientID: number): AwarenessLike => ({
    clientID,
    getLocalState: () => states.get(clientID) ?? null,
    setLocalStateField(field, value) {
      states.set(clientID, { ...states.get(clientID), [field]: value });
      for (const l of [...listeners]) l();
    },
    getStates: () => states,
    on: (_e, cb) => void listeners.add(cb),
    off: (_e, cb) => void listeners.delete(cb),
  });
}

function fakeGame(over: Partial<GameInstance> = {}) {
  const state = {
    phase: "running",
    tick: 7,
    mode: "play",
    game: { score: 3 },
    dialogue: null,
    timings: null,
    session: { startTick: 0, outcome: null },
  };
  const calls: string[] = [];
  const game = {
    getStore: () => ({ state }),
    pause: () => calls.push("pause"),
    resume: () => calls.push("resume"),
    step: (n?: number) => calls.push(`step ${n}`),
    stop: () => calls.push("stop"),
    debug: {
      entities: async () => [{ id: "hero", type: "player", at: [1, 2] }],
      events: { list: () => [{ type: "hit", tick: 3 }] },
    },
    ...over,
  } as unknown as GameInstance;
  return { game, calls, state };
}

/** A 1x1 PNG header followed by `extra` bytes. */
function png(extra = 0): Uint8Array {
  const bytes = new Uint8Array(33 + extra);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 64);
  view.setUint32(20, 32);
  return bytes;
}

describe("electResponder", () => {
  it("picks the lowest client id among entries advertising live", () => {
    expect(
      electResponder([
        { clientId: 9, live: true },
        { clientId: 2 },
        { clientId: 5, live: true },
        { clientId: 1, live: false },
      ]),
    ).toBe(5);
    expect(electResponder([{ clientId: 3 }])).toBeNull();
    expect(electResponder([])).toBeNull();
  });

  it("prefers an editor that drives Play, then one on screen, then the lowest id", () => {
    expect(
      electResponder([
        { clientId: 1, live: true },
        { clientId: 8, live: true, drives: true },
        { clientId: 4, live: true, drives: true, hidden: true },
      ]),
    ).toBe(8);
    expect(
      electResponder([
        { clientId: 1, live: true },
        { clientId: 4, live: true, drives: true, hidden: true },
      ]),
    ).toBe(4);
    expect(
      electResponder([
        { clientId: 6, live: true, hidden: true },
        { clientId: 9, live: true },
      ]),
    ).toBe(9);
    expect(electResponder([{ clientId: 2, drives: true }])).toBeNull();
  });

  it("lets the editor with the toggle on answer when a lower id has it off", async () => {
    const group = awarenessGroup();
    const h = hub();
    const answered: number[] = [];
    for (const [id, on] of [
      [3, false],
      [40, true],
    ] as const) {
      const { game } = fakeGame();
      createLiveResponder().attach(h.peer(group(id)), {
        enabled: () => on,
        game: () => game,
        render: async () => {
          answered.push(id);
          return png();
        },
      });
    }
    const res = await liveRequest(h.peer(group(99)), { t: "frame", id: "f", opts: {} });
    expect(res).toMatchObject({ ok: true });
    expect(answered).toEqual([40]);
    expect(h.sent.filter((m) => m.includes('"ok"'))).toHaveLength(1);
  });

  it("lets a visible editor answer before a hidden one with a lower id", async () => {
    const group = awarenessGroup();
    const h = hub();
    const answered: number[] = [];
    for (const [id, visible] of [
      [3, false],
      [40, true],
    ] as const) {
      const { game } = fakeGame();
      createLiveResponder().attach(h.peer(group(id)), {
        enabled: () => true,
        visible: () => visible,
        game: () => game,
        render: async () => {
          answered.push(id);
          return png();
        },
      });
    }
    expect(await liveRequest(h.peer(group(99)), { t: "frame", id: "f", opts: {} })).toMatchObject({
      ok: true,
    });
    expect(answered).toEqual([40]);
  });

  it("re-advertises when its watch says the toggle changed, moving the election", async () => {
    const group = awarenessGroup();
    const h = hub();
    let on = false;
    let changed = () => {};
    const { game } = fakeGame();
    const low = group(3);
    const detach = createLiveResponder().attach(h.peer(low), {
      enabled: () => on,
      watch: (fn) => {
        changed = fn;
        return () => {
          changed = () => {};
        };
      },
      game: () => game,
      render: async () => png(),
    });
    createLiveResponder().attach(h.peer(group(40)), {
      enabled: () => true,
      game: () => game,
      render: async () => png(),
    });
    expect(electResponder(livePresence(low))).toBe(40);
    on = true;
    changed();
    expect(low.getLocalState()).toMatchObject({ scene: { live: true, drives: true } });
    expect(electResponder(livePresence(low))).toBe(3);
    detach();
    on = false;
    changed();
    expect(low.getLocalState()).toMatchObject({ scene: { live: false } });
  });

  it("still answers live-refused from a lone editor with its toggle off", async () => {
    const group = awarenessGroup();
    const h = hub();
    const { game } = fakeGame();
    createLiveResponder().attach(h.peer(group(5)), {
      enabled: () => false,
      game: () => game,
      render: async () => png(),
    });
    expect(await liveRequest(h.peer(group(6)), { t: "state", id: "s" })).toMatchObject({
      ok: false,
      code: "live-refused",
    });
  });

  it("is what decides which of two attached editors answers", async () => {
    const group = awarenessGroup();
    const h = hub();
    const answered: number[] = [];
    for (const id of [40, 12]) {
      const { game } = fakeGame();
      createLiveResponder().attach(h.peer(group(id)), {
        enabled: () => true,
        game: () => game,
        render: async () => {
          answered.push(id);
          return png();
        },
      });
    }
    const requester = h.peer(group(99));
    expect(livePresence(group(99)).filter((p) => p.live)).toHaveLength(2);
    const res = await liveRequest(requester, { t: "frame", id: "f1", opts: {} });
    expect(res).toMatchObject({ t: "frame", id: "f1", ok: true, width: 64, height: 32, tick: 7 });
    expect(answered).toEqual([12]);
  });
});

describe("liveRequest", () => {
  it("gives live-no-editor when nothing answers in time", async () => {
    const h = hub();
    const started = Date.now();
    const res = await liveRequest(h.peer(), { t: "state", id: "s1" }, { timeoutMs: 50 });
    expect(res).toMatchObject({ t: "state", id: "s1", ok: false, code: "live-no-editor" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
  });

  it("gives live-no-editor at once when presence shows no responder", async () => {
    const group = awarenessGroup();
    group(1).setLocalStateField("scene", { mode: "edit" });
    const h = hub();
    const res = await liveRequest(
      h.peer(group(2)),
      { t: "state", id: "s2" },
      { timeoutMs: 60_000 },
    );
    expect(res).toMatchObject({ ok: false, code: "live-no-editor" });
    expect(h.sent).toEqual([]);
  });

  it("ignores answers to other requests and other peers' requests", async () => {
    const h = hub();
    const requester = h.peer();
    const other = h.peer();
    const pending = liveRequest(requester, { t: "state", id: "mine" }, { timeoutMs: 500 });
    other.sendStateless(JSON.stringify({ t: "state", id: "theirs", ok: true }));
    other.sendStateless(JSON.stringify({ t: "state", id: "mine" }));
    other.sendStateless("not json");
    other.sendStateless(JSON.stringify({ t: "state", id: "mine", ok: true, store: { tick: 1 } }));
    expect(await pending).toEqual({ t: "state", id: "mine", ok: true, store: { tick: 1 } });
  });
});

describe("the responder", () => {
  it("answers live-refused while its toggle is off, and again once it's on", async () => {
    const h = hub();
    let on = false;
    const { game } = fakeGame();
    createLiveResponder().attach(h.peer(), {
      enabled: () => on,
      game: () => game,
      render: async () => png(),
    });
    const requester = h.peer();
    expect(await liveRequest(requester, { t: "state", id: "a" })).toMatchObject({
      ok: false,
      code: "live-refused",
    });
    on = true;
    expect(await liveRequest(requester, { t: "state", id: "b" })).toMatchObject({ ok: true });
  });

  it("answers state as plain data, the store with its dialogue", async () => {
    const h = hub();
    const { game } = fakeGame();
    createLiveResponder().attach(h.peer(), {
      enabled: () => true,
      game: () => game,
      render: async () => png(),
    });
    const res = await liveRequest(h.peer(), {
      t: "state",
      id: "s",
      select: ["store", "entities", "events", "timings"],
    });
    expect(res).toEqual({
      t: "state",
      id: "s",
      ok: true,
      store: { phase: "running", tick: 7, mode: "play", game: { score: 3 }, dialogue: null },
      entities: [{ id: "hero", type: "player", at: [1, 2] }],
      events: [{ type: "hit", tick: 3 }],
      eventsTotal: 1,
      timings: null,
    });
  });

  it("drives Play's controls on the game and refuses play without the host's path", async () => {
    const h = hub();
    const { game, calls } = fakeGame();
    const responder = createLiveResponder();
    const detach = responder.attach(h.peer(), {
      enabled: () => true,
      game: () => game,
      render: async () => png(),
    });
    const r = h.peer();
    for (const action of ["pause", "step", "resume", "stop"] as const) {
      expect(await liveRequest(r, { t: "play", id: action, action, ticks: 3 })).toMatchObject({
        ok: true,
        tick: 7,
        phase: "running",
        outcome: null,
      });
    }
    expect(calls).toEqual(["pause", "step 3", "resume", "stop"]);
    expect(await liveRequest(r, { t: "play", id: "p", action: "play" })).toMatchObject({
      ok: false,
      code: "live-refused",
    });
    detach();
    const played: string[] = [];
    responder.attach(h.peer(), {
      enabled: () => true,
      game: () => game,
      render: async () => png(),
      play: (req) => void played.push(req.from ?? "start"),
    });
    expect(
      await liveRequest(r, { t: "play", id: "p2", action: "play", from: "here" }),
    ).toMatchObject({ ok: true });
    expect(played).toEqual(["here"]);
  });

  it("steps only a whole number of ticks from 1 to LIVE_STEP_MAX_TICKS", async () => {
    const h = hub();
    const { game, calls } = fakeGame();
    createLiveResponder().attach(h.peer(), {
      enabled: () => true,
      game: () => game,
      render: async () => png(),
    });
    const r = h.peer();
    for (const [id, ticks] of [
      ["over", LIVE_STEP_MAX_TICKS + 1],
      ["zero", 0],
      ["part", 1.5],
      ["huge", 1e12],
    ] as const) {
      const res = await liveRequest(r, { t: "play", id, action: "step", ticks });
      expect(res, id).toMatchObject({ ok: false, code: "live-refused" });
      if (!res.ok) expect(res.message, id).toContain(`from 1 to ${LIVE_STEP_MAX_TICKS}`);
    }
    expect(calls).toEqual([]);
    expect(
      await liveRequest(r, { t: "play", id: "cap", action: "step", ticks: LIVE_STEP_MAX_TICKS }),
    ).toMatchObject({ ok: true });
    expect(await liveRequest(r, { t: "play", id: "one", action: "step" })).toMatchObject({
      ok: true,
    });
    expect(calls).toEqual([`step ${LIVE_STEP_MAX_TICKS}`, "step 1"]);
  });

  it("answers a request it couldn't carry out with live-refused and the reason", async () => {
    const h = hub();
    const { game } = fakeGame();
    createLiveResponder().attach(h.peer(), {
      enabled: () => true,
      game: () => game,
      render: async () => {
        throw new Error("The editor's canvas can't be read.");
      },
    });
    expect(await liveRequest(h.peer(), { t: "frame", id: "f", opts: {} })).toMatchObject({
      ok: false,
      code: "live-refused",
      message: "The editor's canvas can't be read.",
    });
  });

  it("caps a frame at LIVE_FRAME_MAX_BYTES with frame-too-large, and fits the cap in one message", async () => {
    const h = hub();
    let extra = LIVE_FRAME_MAX_BYTES - 33;
    const { game } = fakeGame();
    createLiveResponder().attach(h.peer(), {
      enabled: () => true,
      game: () => game,
      render: async () => png(extra),
    });
    const r = h.peer();
    const fits = await liveRequest(r, { t: "frame", id: "max", opts: {} });
    expect(fits.ok).toBe(true);
    const sent = h.sent.at(-1)!;
    expect(relayableStateless(sent)).toBe(true);
    expect(
      Buffer.from((fits as LiveResponse & { t: "frame"; ok: true }).png, "base64"),
    ).toHaveLength(LIVE_FRAME_MAX_BYTES);
    extra += 1;
    expect(await liveRequest(r, { t: "frame", id: "over", opts: {} })).toMatchObject({
      ok: false,
      code: "frame-too-large",
    });
  });

  it("stops answering and withdraws its presence once detached", async () => {
    const group = awarenessGroup();
    const h = hub();
    const { game } = fakeGame();
    const editor = group(3);
    const detach = createLiveResponder().attach(h.peer(editor), {
      enabled: () => true,
      game: () => game,
      render: async () => png(),
    });
    expect(editor.getLocalState()).toEqual({ scene: { live: true, drives: true, hidden: false } });
    detach();
    expect(editor.getLocalState()).toEqual({
      scene: { live: false, drives: false, hidden: false },
    });
    const res = await liveRequest(h.peer(group(4)), { t: "state", id: "gone" });
    expect(res).toMatchObject({ ok: false, code: "live-no-editor" });
  });
});

describe("a state answer's size", () => {
  const fullLog = (n: number, pad: number) => {
    const events = Array.from({ length: n }, (_, i) => ({
      type: "contact",
      tick: i,
      entityId: `entity-${i}`,
      other: `other-${i}`,
      at: [i, i],
      data: { note: "x".repeat(pad) },
    }));
    return {
      list: (f?: { limit?: number }) =>
        f?.limit !== undefined ? events.slice(Math.max(0, events.length - f.limit)) : events,
    };
  };

  it("carries the newest LIVE_STATE_EVENTS events by default, with the log's total", async () => {
    const h = hub();
    const { game } = fakeGame({
      debug: { entities: async () => [], events: fullLog(10_000, 100) },
    } as unknown as Partial<GameInstance>);
    createLiveResponder().attach(h.peer(), {
      enabled: () => true,
      game: () => game,
      render: async () => png(),
    });
    const res = await liveRequest(h.peer(), { t: "state", id: "s", select: ["events"] });
    if (res.t !== "state" || !res.ok) throw new Error("expected a state answer");
    expect(res.events).toHaveLength(LIVE_STATE_EVENTS);
    expect(res.events?.at(-1)?.tick).toBe(9_999);
    expect(res.eventsTotal).toBe(10_000);
    const limited = await liveRequest(h.peer(), {
      t: "state",
      id: "l",
      select: ["events"],
      limit: 3,
    });
    expect(limited).toMatchObject({ ok: true, eventsTotal: 10_000 });
    expect((limited as { events?: unknown[] }).events).toHaveLength(3);
  });

  it("keeps a full log under the relay cap, trimming the oldest events", async () => {
    const h = hub();
    const { game } = fakeGame({
      debug: { entities: async () => [], events: fullLog(10_000, 200) },
    } as unknown as Partial<GameInstance>);
    createLiveResponder().attach(h.peer(), {
      enabled: () => true,
      game: () => game,
      render: async () => png(),
    });
    const res = await liveRequest(h.peer(), {
      t: "state",
      id: "all",
      select: ["store", "entities", "events", "timings"],
      limit: 10_000,
    });
    if (res.t !== "state" || !res.ok) throw new Error("expected a state answer");
    expect(relayableStateless(h.sent.at(-1)!)).toBe(true);
    expect(res.events!.length).toBeGreaterThan(0);
    expect(res.events!.length).toBeLessThan(10_000);
    expect(res.events?.at(-1)?.tick).toBe(9_999);
    expect(res.eventsTotal).toBe(10_000);
  });

  it("refuses an answer it can't fit rather than letting the relay drop it", async () => {
    const h = hub();
    const huge = Array.from({ length: 4 }, (_, i) => ({ id: `e${i}`, blob: "y".repeat(500_000) }));
    const { game } = fakeGame({
      debug: { entities: async () => huge, events: fullLog(0, 0) },
    } as unknown as Partial<GameInstance>);
    createLiveResponder().attach(h.peer(), {
      enabled: () => true,
      game: () => game,
      render: async () => png(),
    });
    const res = await liveRequest(h.peer(), { t: "state", id: "big", select: ["entities"] });
    expect(res).toMatchObject({ ok: false, code: "live-refused" });
    if (!res.ok) expect(res.message).toContain(`${LIVE_MESSAGE_MAX_BYTES}-byte cap`);
    expect(relayableStateless(h.sent.at(-1)!)).toBe(true);
  });
});

describe("a step's wait", () => {
  afterEach(() => vi.useRealTimers());

  it("grows with the ticks asked for, so a long step isn't taken for no editor", async () => {
    vi.useFakeTimers();
    const h = hub();
    const settled: LiveResponse[] = [];
    void liveRequest(h.peer(), { t: "play", id: "p", action: "step", ticks: 6_000 }).then((r) =>
      settled.push(r),
    );
    await vi.advanceTimersByTimeAsync(LIVE_REQUEST_TIMEOUT_MS + 1);
    expect(settled).toEqual([]);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(settled).toMatchObject([
      {
        ok: false,
        code: "live-no-editor",
        message: expect.stringContaining(`${LIVE_REQUEST_TIMEOUT_MS + 6_000} ms`),
      },
    ]);
  });
});

describe("isLiveMessage", () => {
  it("passes live requests and answers and nothing else", () => {
    expect(isLiveMessage(JSON.stringify({ t: "state", id: "a" }))).toBe(true);
    expect(isLiveMessage(JSON.stringify({ t: "frame", id: "a", ok: false }))).toBe(true);
    expect(isLiveMessage(JSON.stringify({ type: "asset:changed", project: "p", id: "a" }))).toBe(
      false,
    );
    expect(isLiveMessage(JSON.stringify({ t: "other", id: "a" }))).toBe(false);
    expect(isLiveMessage(JSON.stringify({ t: "play", id: 3 }))).toBe(false);
    expect(isLiveMessage("after")).toBe(false);
    expect(isLiveMessage("[1]")).toBe(false);
  });
});

describe("relayableStateless", () => {
  it("passes up to LIVE_MESSAGE_MAX_BYTES of UTF-8 and no more", () => {
    expect(relayableStateless("x".repeat(LIVE_MESSAGE_MAX_BYTES))).toBe(true);
    expect(relayableStateless("x".repeat(LIVE_MESSAGE_MAX_BYTES + 1))).toBe(false);
    const wide = "é".repeat(LIVE_MESSAGE_MAX_BYTES / 2);
    expect(relayableStateless(wide)).toBe(true);
    expect(relayableStateless(`${wide}é`)).toBe(false);
  });

  it("reads a provider's awareness structurally", async () => {
    const copy = await engineProjectCopy(["engine-yard.json"]);
    const server = await listenSceneCollab({ projects: [copy.project], warn: () => {} });
    const clients: HocuspocusProvider[] = [];
    try {
      const name = docNameOf({ kind: "scene", project: "engine", key: "engine-yard" });
      const { provider } = await connect(server.url, name, clients);
      const awareness = provider.awareness!;
      awareness.setLocalStateField("scene", { live: true });
      expect(livePresence(awareness)).toEqual([{ clientId: awareness.clientID, live: true }]);
    } finally {
      for (const c of clients) c.destroy();
      await server.close();
      await copy.remove();
    }
  });
});

describe("the live channel beside co-editing (dev collab server)", () => {
  const clients: HocuspocusProvider[] = [];
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) c.destroy();
    for (const close of closers.splice(0)) await close();
  });

  const YARD = docNameOf({ kind: "scene", project: "engine", key: "engine-yard" });
  const ada: SceneOrigin = { kind: "user", userId: "ada" };
  const bob: SceneOrigin = { kind: "user", userId: "bob" };

  /** Two clients each make 20 edits; with `requests`, a third sends 200 live requests meanwhile. */
  async function coEdit(requests: boolean): Promise<string> {
    const copy = await engineProjectCopy(["engine-yard.json"]);
    const server = await listenSceneCollab({
      projects: [copy.project],
      debounceMs: 50,
      watchDelayMs: 20,
      settleMs: 150,
      buildAt: 1234,
      warn: () => {},
    });
    closers.push(async () => {
      await server.close();
      await copy.remove();
    });
    const registry = copy.project.registry;
    const a = await connect(server.url, YARD, clients);
    const b = await connect(server.url, YARD, clients);
    const answers: Promise<LiveResponse>[] = [];
    if (requests) {
      const { game } = fakeGame();
      createLiveResponder().attach(a.provider as unknown as StatelessProvider, {
        enabled: () => true,
        game: () => game,
        render: async () => png(4096),
      });
      const agent = await connect(server.url, YARD, clients);
      const asker = agent.provider as unknown as StatelessProvider;
      await until(
        () => electResponder(livePresence(agent.provider.awareness!)) !== null,
        "the responder's presence",
      );
      for (let i = 0; i < 200; i++) {
        answers.push(
          liveRequest(
            asker,
            i % 2 === 0
              ? { t: "frame", id: `f${i}`, opts: { width: 64 } }
              : { t: "state", id: `s${i}`, select: ["store", "entities"] },
            { timeoutMs: 20_000 },
          ),
        );
      }
    }
    for (let i = 0; i < 20; i++) {
      const ra = applyOpsToDoc(
        a.doc,
        { ops: [{ op: "move", refs: ["crate"], by: [1, 0] }] },
        ada,
        registry,
      );
      const rb = applyOpsToDoc(
        b.doc,
        { ops: [{ op: "add", entity: { id: `flag-${i}`, type: "marker", at: [i * 10, 50] } }] },
        bob,
        registry,
      );
      expect(ra.ok && rb.ok).toBe(true);
      await new Promise((r) => setTimeout(r, 5));
    }
    await Promise.all([pushed(a.provider), pushed(b.provider)]);
    const text = (doc: Y.Doc) => formatScene(docToScene(doc)).text;
    await until(() => text(a.doc) === text(b.doc), "the clients to converge", 20_000);
    if (requests) {
      const done = await Promise.all(answers);
      expect(done.every((r) => r.ok)).toBe(true);
    }
    const out = text(a.doc);
    expect(text(server.server.hocuspocus.documents.get(YARD)!)).toBe(out);
    return out;
  }

  it("converges exactly as without 200 frame and state requests on the same doc", async () => {
    const quiet = await coEdit(false);
    for (const c of clients.splice(0)) c.destroy();
    for (const close of closers.splice(0)) await close();
    expect(await coEdit(true)).toBe(quiet);
  }, 60_000);
});
