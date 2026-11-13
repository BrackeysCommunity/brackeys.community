// @vitest-environment jsdom
import type { HostRequestError, LiveSnapshot, LiveStateMessage } from "@jams/engine/standalone";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vite-plus/test";

import { HOST_NO_SITE_SAVES_MESSAGE, HOST_THROTTLED_MESSAGE } from "../host-server";
import { SITE_SAVE_LIMITS } from "../limits";
import { localPlaySaves, SIGNED_OUT_SAVES_DESCRIBE } from "../local-saves";
import {
  disposeHostRigs,
  hostRig as rig,
  refusal,
  RIG_RELEASE as RELEASE,
  rigLive,
  rigSaveText as saveText,
} from "./host-rig";

function saveOfBytes(slot: string, bytes: number): string {
  const base = saveText(slot, "");
  return saveText(slot, "x".repeat(bytes - new TextEncoder().encode(base).length));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  disposeHostRigs();
  vi.restoreAllMocks();
});

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

describe("live levels", () => {
  const ONE = "a".repeat(64);
  const TWO = "b".repeat(64);

  /** Waits a few turns for messages that should not arrive. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  it("gives a frame that announced live the current snapshot in welcome", async () => {
    const live = rigLive(3, { one: ONE });
    const r = rig({ live: () => live });
    const channel = await r.connect(["live"]);
    expect(channel.welcome.live).toEqual(live);
  });

  it("gives a frame without the feature no live in welcome and no live.update", async () => {
    const r = rig({ live: () => rigLive(3, { one: ONE }) });
    const channel = await r.connect();
    expect("live" in channel.welcome).toBe(false);
    const seen = vi.fn();
    channel.on("live.update", seen);
    expect(r.server.sendLive(rigLive(4, { one: TWO }))).toBe(false);
    await settle();
    expect(seen).not.toHaveBeenCalled();
  });

  it("sends live.update to a frame that announced live, and keeps it for a reload's welcome", async () => {
    const r = rig({ live: () => rigLive(3, { one: ONE }) });
    const channel = await r.connect(["live"]);
    const seen = vi.fn<(live: LiveSnapshot) => void>();
    channel.on("live.update", seen);
    const next = rigLive(4, { one: TWO });
    expect(r.server.sendLive(next)).toBe(true);
    await vi.waitFor(() => expect(seen).toHaveBeenCalledWith(next));
    const reloaded = await r.connect(["live"]);
    expect(reloaded.welcome.live).toEqual(next);
  });

  it("forgets a reloaded frame's feature when the new one doesn't announce it", async () => {
    const r = rig();
    await r.connect(["live"]);
    const plain = await r.connect();
    const seen = vi.fn();
    plain.on("live.update", seen);
    expect(r.server.sendLive(rigLive(1))).toBe(false);
    await settle();
    expect(seen).not.toHaveBeenCalled();
  });

  it("sends nothing during an online session", async () => {
    let session = true;
    const r = rig({ sessionActive: () => session });
    const channel = await r.connect(["live"]);
    const seen = vi.fn();
    channel.on("live.update", seen);
    expect(r.server.sendLive(rigLive(1, { one: ONE }))).toBe(false);
    await settle();
    expect(seen).not.toHaveBeenCalled();
    session = false;
    expect(r.server.sendLive(rigLive(2, { one: ONE }))).toBe(true);
    await vi.waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
  });

  it("sends nothing for another release, or a snapshot the schema refuses", async () => {
    const r = rig();
    const channel = await r.connect(["live"]);
    const seen = vi.fn();
    channel.on("live.update", seen);
    expect(r.server.sendLive({ ...rigLive(1), release: "f".repeat(64) })).toBe(false);
    expect(r.server.sendLive({ ...rigLive(1), rev: -1 })).toBe(false);
    await settle();
    expect(seen).not.toHaveBeenCalled();
  });

  it("sends nothing over the message cap", async () => {
    const r = rig();
    const channel = await r.connect(["live"]);
    const seen = vi.fn();
    channel.on("live.update", seen);
    const big = rigLive(
      1,
      Object.fromEntries(Array.from({ length: 1_000 }, (_, i) => [`scene-${i}`, ONE])),
    );
    expect(r.server.sendLive(big)).toBe(false);
    await settle();
    expect(seen).not.toHaveBeenCalled();
  });

  it("hands on each live.state, validated, and stops after unsubscribing", async () => {
    const r = rig();
    const channel = await r.connect(["live"]);
    const states = vi.fn<(s: LiveStateMessage) => void>();
    const off = r.server.onLiveState(states);
    channel.liveState({ scene: "one", version: ONE, status: "applied", timing: "now", tick: 12 });
    channel.liveState({ scene: "one", version: null, status: "ready" });
    await vi.waitFor(() => expect(states).toHaveBeenCalledTimes(2));
    expect(states.mock.calls[0]![0]).toEqual({
      scene: "one",
      version: ONE,
      status: "applied",
      timing: "now",
      tick: 12,
    });
    expect(states.mock.calls[1]![0]).toEqual({ scene: "one", version: null, status: "ready" });
    const port = r.framePort();
    port.postMessage({ type: "live.state", scene: "one", version: "nope", status: "applied" });
    port.postMessage({ type: "live.state", scene: "one", version: ONE, status: "won" });
    await vi.waitFor(() => expect(r.server.dropped).toBe(2));
    off();
    channel.liveState({ scene: "one", version: ONE, status: "applied" });
    await settle();
    expect(states).toHaveBeenCalledTimes(2);
  });

  it("drops live.state from a frame that didn't announce live", async () => {
    const r = rig();
    const channel = await r.connect();
    const states = vi.fn();
    r.server.onLiveState(states);
    channel.liveState({ scene: "one", version: ONE, status: "applied" });
    await vi.waitFor(() => expect(r.server.dropped).toBe(1));
    expect(states).not.toHaveBeenCalled();
  });

  it("takes live.state 10 a second, beside 20 for saves", async () => {
    const r = rig();
    const channel = await r.connect(["live"]);
    const states = vi.fn();
    r.server.onLiveState(states);
    for (let i = 0; i < 11; i++)
      channel.liveState({ scene: "one", version: ONE, status: "staging" });
    const saves = await Promise.allSettled(
      Array.from({ length: 20 }, () => channel.request("saves.list", { gameId: "tactics" })),
    );
    expect(saves.every((s) => s.status === "fulfilled")).toBe(true);
    await vi.waitFor(() => expect(r.server.dropped).toBe(1));
    expect(states).toHaveBeenCalledTimes(10);
  });

  it("asks for the recording, and its answer reaches onDownload past the download rate", async () => {
    Object.defineProperty(ArrayBuffer, Symbol.hasInstance, {
      configurable: true,
      value: (v: unknown) => Object.prototype.toString.call(v) === "[object ArrayBuffer]",
    });
    onTestFinished(() => {
      delete (ArrayBuffer as { [Symbol.hasInstance]?: unknown })[Symbol.hasInstance];
    });
    const onDownload = vi.fn();
    const r = rig({ onDownload });
    expect(r.server.requestRecording()).toBe(false);
    const channel = await r.connect(["live"]);
    const bytes = new Uint8Array([7]).buffer;
    channel.offerDownload("match.recording.json", "application/json", bytes);
    await vi.waitFor(() => expect(onDownload).toHaveBeenCalledTimes(1));
    channel.on("recording.request", () =>
      channel.offerDownload("one.recording.json", "application/json", bytes),
    );
    expect(r.server.requestRecording()).toBe(true);
    await vi.waitFor(() => expect(onDownload).toHaveBeenCalledTimes(2));
    expect((onDownload.mock.calls[1]![0] as { name: string }).name).toBe("one.recording.json");
    channel.offerDownload("unasked.recording.json", "application/json", bytes);
    await vi.waitFor(() => expect(r.server.dropped).toBe(1));
    expect(onDownload).toHaveBeenCalledTimes(2);
  });
});
