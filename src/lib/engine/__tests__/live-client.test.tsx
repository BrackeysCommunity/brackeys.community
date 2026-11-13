// @vitest-environment jsdom
import type { LiveSnapshot, LiveStateMessage } from "@jams/engine/standalone";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { LIVE_POLL_SECONDS } from "../limits";
import {
  createLiveClient,
  type AppliedSwap,
  type LiveClientOptions,
  type LiveProcedures,
} from "../live-client";
import { disposeHostRigs, hostRig, RIG_RELEASE } from "./host-rig";

const RELEASE = RIG_RELEASE.id;
const OTHER_RELEASE = "f".repeat(64);
const V1 = "1".repeat(64);
const V2 = "2".repeat(64);
const SINCE = "2026-11-13T00:00:00.000Z";

function snapshot(over: Partial<LiveSnapshot> = {}): LiveSnapshot {
  return { channel: "production", rev: 1, release: RELEASE, scenes: [], removed: [], ...over };
}

const entry = (scene: string, version: string, timing: "next-load" | "boundary" | "now") => ({
  scene,
  version,
  number: 1,
  timing,
  since: SINCE,
});

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static all: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  closed = false;
  private readonly listeners = new Map<string, Set<(e: Event) => void>>();
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, fn: (e: Event) => void) {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
  }
  removeEventListener(type: string, fn: (e: Event) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
  emit(type: string, data?: unknown) {
    if (type === "open") this.readyState = FakeEventSource.OPEN;
    const event = new MessageEvent(type, data === undefined ? {} : { data: JSON.stringify(data) });
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
  live(rev: number) {
    this.emit("live", { channel: "production", rev });
  }
  /** The server refused or dropped it for good. */
  fail() {
    this.readyState = FakeEventSource.CLOSED;
    this.emit("error");
  }
}

const stream = () => FakeEventSource.all.at(-1)!;

function fakeHost() {
  const states = new Set<(s: LiveStateMessage) => void>();
  return {
    sendLive: vi.fn((_s: LiveSnapshot) => true),
    onLiveState: vi.fn((fn: (s: LiveStateMessage) => void) => {
      states.add(fn);
      return () => void states.delete(fn);
    }),
    state(s: LiveStateMessage) {
      for (const fn of states) fn(s);
    },
    get listeners() {
      return states.size;
    },
  };
}

function fakeProcedures(answer: () => LiveSnapshot | null = () => snapshot()) {
  return {
    live: vi.fn<LiveProcedures["live"]>(() => Promise.resolve(answer())),
    report: vi.fn<LiveProcedures["report"]>(() => Promise.resolve(null)),
  };
}

let visibility: DocumentVisibilityState = "visible";
const setVisibility = (state: DocumentVisibilityState) => {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
};

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const disposers: Array<() => void> = [];

function client(over: {
  host: LiveClientOptions["host"];
  initial?: LiveSnapshot;
  procedures?: ReturnType<typeof fakeProcedures>;
}) {
  const spies = {
    procedures: over.procedures ?? fakeProcedures(),
    onReleaseMoved: vi.fn<() => void>(),
    onRemoved: vi.fn<() => void>(),
    onSwapApplied: vi.fn<(swap: AppliedSwap) => void>(),
  };
  const c = createLiveClient({
    projectId: RIG_RELEASE.projectId,
    channel: "production",
    initial: over.initial ?? snapshot(),
    host: over.host,
    ...spies,
  });
  disposers.push(() => c.dispose());
  return { ...spies, client: c };
}

beforeEach(() => {
  FakeEventSource.all = [];
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  for (const d of disposers.splice(0)) d();
  disposeHostRigs();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the stream", () => {
  it("opens the channel's stream and fetches the state once per new rev", async () => {
    const procedures = fakeProcedures(() => snapshot({ rev: 3 }));
    client({ host: fakeHost(), procedures });
    expect(stream().url).toBe(
      `/api/engine/live/${RIG_RELEASE.projectId}/stream?channel=production`,
    );
    stream().emit("open");

    stream().live(1);
    await flush();
    expect(procedures.live).not.toHaveBeenCalled();

    stream().live(2);
    stream().live(2);
    await flush();
    expect(procedures.live).toHaveBeenCalledTimes(1);
    expect(procedures.live).toHaveBeenCalledWith({
      projectId: RIG_RELEASE.projectId,
      channel: "production",
    });

    // The fetched state was already at rev 3.
    stream().live(3);
    await flush();
    expect(procedures.live).toHaveBeenCalledTimes(1);

    stream().live(4);
    await flush();
    expect(procedures.live).toHaveBeenCalledTimes(2);
  });

  it("sends a changed snapshot to the frame, and an unchanged one never", async () => {
    let next = snapshot({ rev: 2, scenes: [entry("level-1", V1, "now")] });
    const host = fakeHost();
    client({ host, procedures: fakeProcedures(() => next) });
    stream().live(2);
    await flush();
    expect(host.sendLive).toHaveBeenCalledTimes(1);
    expect(host.sendLive).toHaveBeenLastCalledWith(next);

    next = { ...next, rev: 3 };
    stream().live(3);
    await flush();
    expect(host.sendLive).toHaveBeenCalledTimes(1);
  });

  it("reads the state once after a dropped stream reconnects", async () => {
    const procedures = fakeProcedures();
    client({ host: fakeHost(), procedures });
    stream().emit("open");
    expect(procedures.live).not.toHaveBeenCalled();
    stream().emit("error");
    stream().emit("open");
    await flush();
    expect(procedures.live).toHaveBeenCalledTimes(1);
  });
});

describe("the poll", () => {
  it("runs only while the page is visible, and once on becoming visible", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", undefined);
    const procedures = fakeProcedures();
    client({ host: fakeHost(), procedures });

    await vi.advanceTimersByTimeAsync(LIVE_POLL_SECONDS * 1_000);
    expect(procedures.live).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(LIVE_POLL_SECONDS * 3_000);
    expect(procedures.live).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await flush();
    expect(procedures.live).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(LIVE_POLL_SECONDS * 1_000);
    expect(procedures.live).toHaveBeenCalledTimes(3);
  });

  it("takes over when the stream closes with an error", async () => {
    vi.useFakeTimers();
    const procedures = fakeProcedures();
    client({ host: fakeHost(), procedures });
    await vi.advanceTimersByTimeAsync(LIVE_POLL_SECONDS * 1_000);
    expect(procedures.live).not.toHaveBeenCalled();

    stream().fail();
    await flush();
    expect(stream().closed).toBe(true);
    expect(procedures.live).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(LIVE_POLL_SECONDS * 1_000);
    expect(procedures.live).toHaveBeenCalledTimes(2);
  });
});

describe("what the frame is sent", () => {
  it("offers a reload when the release moves, and sends the frame nothing", async () => {
    const host = fakeHost();
    const c = client({
      host,
      procedures: fakeProcedures(() =>
        snapshot({ rev: 2, release: OTHER_RELEASE, scenes: [entry("level-1", V1, "now")] }),
      ),
    });
    stream().live(2);
    await flush();
    stream().live(3);
    await flush();
    expect(c.onReleaseMoved).toHaveBeenCalledTimes(1);
    expect(host.sendLive).not.toHaveBeenCalled();
  });

  it("gives a frame without 'live' no live.update", async () => {
    const rig = hostRig();
    const channel = await rig.connect();
    const updates = vi.fn();
    channel.on("live.update", updates);
    const sendLive = vi.spyOn(rig.server, "sendLive");
    client({
      host: rig.server,
      procedures: fakeProcedures(() => snapshot({ rev: 2, scenes: [entry("level-1", V1, "now")] })),
    });
    stream().live(2);
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sendLive).toHaveBeenCalledTimes(1);
    expect(sendLive.mock.results[0]?.value).toBe(false);
    expect(updates).not.toHaveBeenCalled();
  });

  it("reloads a frame running a version that was removed", async () => {
    const host = fakeHost();
    let next = snapshot({ rev: 2, removed: [V2] });
    const c = client({
      host,
      initial: snapshot({ scenes: [entry("level-1", V1, "now")] }),
      procedures: fakeProcedures(() => next),
    });
    stream().live(2);
    await flush();
    expect(c.onRemoved).not.toHaveBeenCalled();

    next = snapshot({ rev: 3, removed: [V1, V2] });
    stream().live(3);
    await flush();
    expect(c.onRemoved).toHaveBeenCalledTimes(1);
    expect(host.sendLive).toHaveBeenLastCalledWith(next);

    next = { ...next, rev: 4 };
    stream().live(4);
    await flush();
    expect(c.onRemoved).toHaveBeenCalledTimes(1);
  });
});

describe("what the frame reports", () => {
  it("reports an applied now swap once and surfaces it once", async () => {
    const host = fakeHost();
    const c = client({ host });
    const applied: LiveStateMessage = {
      scene: "level-1",
      version: V1,
      status: "applied",
      timing: "now",
      strategy: "reload",
      tick: 40,
    };
    host.state({ scene: "level-1", version: V1, status: "staging" });
    host.state(applied);
    host.state(applied);
    await flush();
    expect(c.procedures.report).toHaveBeenCalledTimes(1);
    expect(c.procedures.report).toHaveBeenCalledWith({
      projectId: RIG_RELEASE.projectId,
      versionId: V1,
      channel: "production",
      outcome: "applied",
    });
    expect(c.onSwapApplied).toHaveBeenCalledTimes(1);
    expect(c.onSwapApplied).toHaveBeenCalledWith({ scene: "level-1", version: V1, timing: "now" });
  });

  it("surfaces no next-load swap, and forwards a refusal with its issue code", async () => {
    const host = fakeHost();
    const c = client({ host });
    host.state({ scene: "level-1", version: V1, status: "applied", timing: "next-load" });
    host.state({
      scene: "level-2",
      version: V2,
      status: "refused",
      issue: { code: "live-incompatible", severity: "error", message: "No." },
    } as LiveStateMessage);
    host.state({ scene: "level-3", version: null, status: "applied", timing: "next-load" });
    await flush();
    expect(c.onSwapApplied).not.toHaveBeenCalled();
    expect(c.procedures.report.mock.calls.map(([input]) => input)).toEqual([
      expect.objectContaining({ versionId: V1, outcome: "applied" }),
      expect.objectContaining({
        versionId: V2,
        outcome: "refused",
        issueCode: "live-incompatible",
      }),
    ]);
  });

  it("takes an applied swap's timing from the snapshot when the frame leaves it out", async () => {
    const host = fakeHost();
    const c = client({ host, initial: snapshot({ scenes: [entry("level-1", V1, "boundary")] }) });
    host.state({ scene: "level-1", version: null, status: "applied", timing: "now" });
    host.state({ scene: "level-1", version: V1, status: "applied" });
    expect(c.onSwapApplied.mock.calls.map(([swap]) => swap)).toEqual([
      { scene: "level-1", version: null, timing: "now" },
      { scene: "level-1", version: V1, timing: "boundary" },
    ]);
  });

  it("keeps quiet when a report fails", async () => {
    const host = fakeHost();
    const procedures = fakeProcedures();
    procedures.report.mockRejectedValue(new Error("NOT_IMPLEMENTED"));
    client({ host, procedures });
    host.state({ scene: "level-1", version: V1, status: "failed" });
    await flush();
    expect(procedures.report).toHaveBeenCalledTimes(1);
  });
});

describe("dispose", () => {
  it("closes the stream, the timer and the listeners", async () => {
    vi.useFakeTimers();
    const host = fakeHost();
    const procedures = fakeProcedures();
    const c = client({ host, procedures });
    const source = stream();
    expect(host.listeners).toBe(1);
    c.client.dispose();
    expect(source.closed).toBe(true);
    expect(host.listeners).toBe(0);

    vi.stubGlobal("EventSource", undefined);
    const polled = client({ host, procedures });
    polled.client.dispose();
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(LIVE_POLL_SECONDS * 2_000);
    expect(procedures.live).not.toHaveBeenCalled();
  });
});
