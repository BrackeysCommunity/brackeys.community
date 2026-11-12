// @vitest-environment jsdom
import { formatSaveFile, type SaveFile } from "@jams/engine/game";
import { connectHost, HostRequestError, type HostChannel } from "@jams/engine/standalone";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vite-plus/test";

import {
  createHostServer,
  HOST_NO_SITE_SAVES_MESSAGE,
  HOST_THROTTLED_MESSAGE,
  type HostServer,
  type HostServerOptions,
} from "../host-server";
import { SITE_SAVE_LIMITS } from "../limits";
import { localPlayPrefs, localPlaySaves, SIGNED_OUT_SAVES_DESCRIBE } from "../local-saves";

const RELEASE = { id: "e".repeat(64), gameId: "tactics", projectId: "proj-1" };
const HELLO = { engine: "0.14.1", release: RELEASE.id, game: RELEASE.gameId };

function saveText(slot: string, data: unknown = null): string {
  const file: SaveFile = {
    kind: "save",
    v: 1,
    game: RELEASE.gameId,
    gameVersion: 1,
    engine: "0.14.1",
    release: null,
    project: null,
    slot,
    meta: { scene: "one", savedAt: 0, playTicks: 0 },
    depth: "progress",
    persist: null,
    scene: { id: "one", runHash: "", sublevels: [] },
    data: data as SaveFile["data"],
  };
  return formatSaveFile(file);
}

function saveOfBytes(slot: string, bytes: number): string {
  const base = saveText(slot, "");
  return saveText(slot, "x".repeat(bytes - new TextEncoder().encode(base).length));
}

/**
 * The page and a framed game in one jsdom document. jsdom's postMessage
 * carries neither `source`, `origin` nor ports, so each side's post is
 * stood in for by the event a browser would deliver: the frame's to its
 * parent from its own window on the opaque origin, the page's to the frame
 * from its parent with the transferred port.
 */
type Rig = {
  iframe: HTMLIFrameElement;
  frame: Window;
  server: HostServer;
  /** What the page posted to the frame's window, with its target. */
  toFrame: { data: unknown; target: string; ports: number }[];
  /** The frame's end of the last port the page handed over. */
  framePort: () => MessagePort;
  /** Dispatches a window message on the page as if from `source` on `origin`. */
  toPage(data: unknown, source: unknown, origin: string): void;
  connect(): Promise<HostChannel>;
};

const rigs: Rig[] = [];

function rig(over: Partial<HostServerOptions> = {}): Rig {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const frame = iframe.contentWindow!;
  const toFrame: Rig["toFrame"] = [];
  let lastPort: MessagePort | null = null;
  Object.defineProperty(frame, "postMessage", {
    configurable: true,
    value(data: unknown, target: string, transfer: MessagePort[] = []) {
      toFrame.push({ data, target, ports: transfer.length });
      lastPort = transfer[0] ?? null;
      queueMicrotask(() => {
        const event = new MessageEvent("message", { data });
        Object.defineProperty(event, "ports", { value: transfer });
        Object.defineProperty(event, "source", { value: frameView.parent });
        frame.dispatchEvent(event);
      });
    },
  });
  const toPage = (data: unknown, source: unknown, origin: string) => {
    const event = new MessageEvent("message", { data, origin });
    Object.defineProperty(event, "source", { value: source });
    window.dispatchEvent(event);
  };
  const frameView = {
    parent: { postMessage: (data: unknown) => toPage(data, frame, "null") },
    addEventListener: frame.addEventListener.bind(frame),
    removeEventListener: frame.removeEventListener.bind(frame),
  } as unknown as Window;
  const server = createHostServer({
    iframe,
    release: RELEASE,
    saves: () => localPlaySaves(RELEASE.projectId),
    describe: () => SIGNED_OUT_SAVES_DESCRIBE,
    mode: "site",
    prefs: localPlayPrefs(RELEASE.projectId),
    ...over,
  });
  const r: Rig = {
    iframe,
    frame,
    server,
    toFrame,
    framePort: () => lastPort!,
    toPage,
    async connect() {
      const channel = await connectHost({ hello: HELLO, window: frameView, timeoutMs: 2_000 });
      if (!channel) throw new Error("the page didn't answer");
      channels.push(channel);
      return channel;
    },
  };
  rigs.push(r);
  return r;
}

const channels: HostChannel[] = [];

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  for (const c of channels.splice(0)) c.close();
  for (const r of rigs.splice(0)) {
    r.server.dispose();
    r.iframe.remove();
  }
  vi.restoreAllMocks();
});

const refusal = async (p: Promise<unknown>) => {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HostRequestError);
  return (error as HostRequestError).issue;
};

describe("the handshake", () => {
  it("answers its own frame on the opaque origin with a port, targeting *", async () => {
    const r = rig();
    const channel = await r.connect();
    expect(r.toFrame).toEqual([
      { data: { type: "jams:host", protocol: 1 }, target: "*", ports: 1 },
    ]);
    expect(channel.welcome.saves).toEqual({
      describe: SIGNED_OUT_SAVES_DESCRIBE,
      limits: SITE_SAVE_LIMITS,
      mode: "site",
    });
    expect(channel.welcome.player).toEqual({ signedIn: false, name: null });
    expect(channel.welcome.online).toBe(false);
  });

  it("tells an online project's frame it may go online", async () => {
    const channel = await rig({ online: true }).connect();
    expect(channel.welcome.online).toBe(true);
  });

  it("ignores a frame-ready from another window or a named origin", async () => {
    const r = rig();
    const other = document.createElement("iframe");
    document.body.append(other);
    const ready = { type: "jams:frame-ready", protocol: 1 };
    r.toPage(ready, other.contentWindow, "null");
    r.toPage(ready, window, "null");
    r.toPage(ready, r.frame, "https://elsewhere.example");
    r.toPage({ type: "jams:frame-ready", protocol: 2 }, r.frame, "null");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(r.toFrame).toEqual([]);
    other.remove();
  });

  it("refuses a hello for another release, so the game plays without the page", async () => {
    const r = rig({ release: { ...RELEASE, id: "f".repeat(64) } });
    await expect(r.connect()).rejects.toThrow("the page didn't answer");
  });

  it("sends this browser's stored preferences in welcome", async () => {
    const remap = { v: 1, players: { 0: { jump: [{ device: "key", code: "KeyW" }] } } };
    localStorage.setItem("jams-play:proj-1:remap", JSON.stringify(remap));
    localStorage.setItem("jams-play:proj-1:prefs", JSON.stringify({ volume: 0.25 }));
    const channel = await rig().connect();
    expect(channel.welcome.prefs).toEqual({ remap, prefs: { volume: 0.25 } });
  });
});

describe("saves", () => {
  it("round-trips a save through the page's signed-out store", async () => {
    const channel = await rig().connect();
    const text = saveText("slot-1");
    const written = await channel.request("saves.write", {
      gameId: "tactics",
      slot: "slot-1",
      text,
    });
    expect(written).toEqual({ ok: true, bytes: new TextEncoder().encode(text).length });
    expect(await channel.request("saves.read", { gameId: "tactics", slot: "slot-1" })).toBe(text);
    const listed = await channel.request("saves.list", { gameId: "tactics" });
    expect(listed.map((s) => s.slot)).toEqual(["slot-1"]);
    expect(localStorage.getItem("jams-play-saves:proj-1:slot-1")).toBe(text);
    await channel.request("saves.remove", { gameId: "tactics", slot: "slot-1" });
    expect(await channel.request("saves.read", { gameId: "tactics", slot: "slot-1" })).toBeNull();
  });

  it("refuses a 33 KiB save with the site's message before any write", async () => {
    const saves = localPlaySaves(RELEASE.projectId);
    const write = vi.spyOn(saves, "write");
    const channel = await rig({ saves: () => saves }).connect();
    const result = await channel.request("saves.write", {
      gameId: "tactics",
      slot: "slot-1",
      text: saveOfBytes("slot-1", 33 * 1024),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.code).toBe("save-too-large");
      expect(result.issue.message).toBe(
        "This save is 33 KB; saves on jams.team are limited to 32 KB.",
      );
    }
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a fifth slot, and still overwrites a held one", async () => {
    const channel = await rig().connect();
    for (const slot of ["a", "b", "c", "d"]) {
      const r = await channel.request("saves.write", {
        gameId: "tactics",
        slot,
        text: saveText(slot),
      });
      expect(r.ok).toBe(true);
    }
    const fifth = await channel.request("saves.write", {
      gameId: "tactics",
      slot: "e",
      text: saveText("e"),
    });
    expect(fifth.ok).toBe(false);
    if (!fifth.ok) {
      expect(fifth.issue.code).toBe("save-slot-limit");
      expect(fifth.issue.message).toBe(
        "You have 4 saves for this game, the most jams.team keeps. Delete one to save again.",
      );
    }
    const again = await channel.request("saves.write", {
      gameId: "tactics",
      slot: "a",
      text: saveText("a", 1),
    });
    expect(again.ok).toBe(true);
  });

  it("refuses another game's saves", async () => {
    const channel = await rig().connect();
    const issue = await refusal(channel.request("saves.list", { gameId: "platformer" }));
    expect(issue.code).toBe("save-store-failed");
  });

  it("refuses site writes for a game that doesn't save to the site", async () => {
    const saves = localPlaySaves(RELEASE.projectId);
    const write = vi.spyOn(saves, "write");
    const channel = await rig({ mode: "none", saves: () => saves }).connect();
    expect(channel.welcome.saves.mode).toBe("none");
    const issue = await refusal(
      channel.request("saves.write", { gameId: "tactics", slot: "a", text: saveText("a") }),
    );
    expect(issue.code).toBe("save-forbidden");
    expect(issue.message).toBe("This game doesn't save to jams.team.");
    expect(HOST_NO_SITE_SAVES_MESSAGE).toBe(issue.message);
    expect(await channel.request("saves.list", { gameId: "tactics" })).toEqual([]);
    expect(write).not.toHaveBeenCalled();
  });

  it("tells the frame where saves go when they change", async () => {
    let describe = SIGNED_OUT_SAVES_DESCRIBE;
    const r = rig({ describe: () => describe });
    const channel = await r.connect();
    const seen = vi.fn();
    channel.on("saves.changed", seen);
    describe = "Saved to your account.";
    r.server.notifySavesChanged();
    await vi.waitFor(() =>
      expect(seen).toHaveBeenCalledWith({
        describe: "Saved to your account.",
        limits: SITE_SAVE_LIMITS,
        mode: "site",
      }),
    );
  });
});

describe("validation and throttling", () => {
  it("ignores and counts a malformed or oversized message", async () => {
    const r = rig();
    await r.connect();
    const port = r.framePort();
    port.postMessage({ type: "saves.write", id: 99, params: { gameId: "tactics" } });
    port.postMessage({ type: "nope" });
    port.postMessage({ type: "state", jamsState: "ready", extra: "x".repeat(70_000) });
    await vi.waitFor(() => expect(r.server.dropped).toBe(3));
  });

  it("refuses saves past 20 a second with the site's message", async () => {
    const channel = await rig().connect();
    const results = await Promise.allSettled(
      Array.from({ length: 21 }, () => channel.request("saves.list", { gameId: "tactics" })),
    );
    const refused = results.filter((r) => r.status === "rejected");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(20);
    expect(refused).toHaveLength(1);
    const reason = (refused[0] as PromiseRejectedResult).reason as HostRequestError;
    expect(reason.issue.code).toBe("save-store-failed");
    expect(reason.issue.message).toBe(HOST_THROTTLED_MESSAGE);
    expect(HOST_THROTTLED_MESSAGE).toBe("Too many save requests; try again in a moment.");
  });

  it("refuses preferences past 10 a second, and over 16 KiB", async () => {
    const channel = await rig().connect();
    const results = await Promise.allSettled(
      Array.from({ length: 11 }, (_, i) =>
        channel.request("prefs.save", { store: "prefs", value: { volume: i } }),
      ),
    );
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("jams-play:proj-1:prefs")!)).toEqual({ volume: 9 });
  });

  it("refuses a preferences value over 16 KiB", async () => {
    const channel = await rig().connect();
    const issue = await refusal(
      channel.request("prefs.save", { store: "remap", value: "x".repeat(16_384) }),
    );
    expect(issue.code).toBe("save-store-failed");
    expect(localStorage.getItem("jams-play:proj-1:remap")).toBeNull();
  });

  it("hands one download per 10 seconds to onDownload", async () => {
    // Node's MessagePort delivers buffers from the main realm, not the test's;
    // a browser delivers them in the receiving page's own.
    Object.defineProperty(ArrayBuffer, Symbol.hasInstance, {
      configurable: true,
      value: (v: unknown) => Object.prototype.toString.call(v) === "[object ArrayBuffer]",
    });
    onTestFinished(() => {
      delete (ArrayBuffer as { [Symbol.hasInstance]?: unknown })[Symbol.hasInstance];
    });
    const onDownload = vi.fn();
    const r = rig({ onDownload });
    const channel = await r.connect();
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    channel.offerDownload("match.recording.json", "application/json", bytes);
    channel.offerDownload("again.recording.json", "application/json", bytes);
    await vi.waitFor(() => expect(r.server.dropped).toBe(1));
    expect(onDownload).toHaveBeenCalledTimes(1);
    const d = onDownload.mock.calls[0]![0] as {
      name: string;
      contentType: string;
      bytes: ArrayBuffer;
    };
    expect(d.name).toBe("match.recording.json");
    expect(d.contentType).toBe("application/json");
    expect([...new Uint8Array(d.bytes)]).toEqual([1, 2, 3]);
  });
});

describe("events", () => {
  it("passes the frame's state on, and sends pause and resume", async () => {
    const onState = vi.fn();
    const r = rig({ onState });
    const channel = await r.connect();
    channel.state("ready");
    await vi.waitFor(() => expect(onState).toHaveBeenCalledWith({ jamsState: "ready" }));
    const paused = vi.fn();
    const resumed = vi.fn();
    channel.on("pause", paused);
    channel.on("resume", resumed);
    r.server.pause();
    r.server.resume();
    await vi.waitFor(() => {
      expect(paused).toHaveBeenCalledTimes(1);
      expect(resumed).toHaveBeenCalledTimes(1);
    });
  });

  it("answers a reloaded frame with a fresh port, and nothing once disposed", async () => {
    const r = rig();
    await r.connect();
    const second = await r.connect();
    expect(r.toFrame).toHaveLength(2);
    expect(await second.request("saves.list", { gameId: "tactics" })).toEqual([]);
    r.server.dispose();
    r.toPage({ type: "jams:frame-ready", protocol: 1 }, r.frame, "null");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(r.toFrame).toHaveLength(2);
  });
});
