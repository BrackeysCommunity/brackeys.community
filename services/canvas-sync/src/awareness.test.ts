import { describe, expect, it } from "bun:test";

import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";

import { holdAwarenessWhileConnected, pinAwareness } from "./awareness.ts";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A server-side document's awareness with a peer's state applied to it. */
function serverWith(...peers: number[]) {
  const awareness = new Awareness(new Y.Doc());
  awareness.setLocalState(null);
  for (const id of peers) {
    const doc = new Y.Doc();
    doc.clientID = id;
    const peer = new Awareness(doc);
    peer.setLocalState({ user: { id: `u${id}` } });
    applyAwarenessUpdate(awareness, encodeAwarenessUpdate(peer, [id]), "remote");
    peer.destroy();
  }
  return awareness;
}

describe("holdAwarenessWhileConnected", () => {
  it("keeps a connected client however long since its renewal, and times out a relayed one", async () => {
    const awareness = serverWith(1, 2);
    const connection = {};
    const stop = holdAwarenessWhileConnected(
      {
        awareness,
        getConnections: () => [connection] as never,
        getClients: () => new Set([1]),
      },
      { timeoutMs: 60_000, checkMs: 20, now: () => Date.now() + 120_000 },
    );
    // Past y-protocols' own 30s timeout and its 3s check.
    for (const meta of awareness.meta.values()) meta.lastUpdated -= 120_000;
    await tick(3_200);
    stop();
    expect(awareness.states.has(1)).toBe(true);
    expect(awareness.states.has(2)).toBe(false);
    awareness.destroy();
  });
});

describe("pinAwareness", () => {
  it("pins the face and keeps everything else the client sent", () => {
    const states = new Map<number, Record<string, unknown>>([
      [7, { user: { id: "bob", name: "Bob" }, chat: "hi", idle: true }],
      [8, { user: { id: "carol" } }],
    ]);
    pinAwareness(states, { userId: "alice", name: "Alice", avatarUrl: null }, new Set([8]));
    expect(states.get(7)).toMatchObject({
      user: { id: "alice", name: "Alice", avatarUrl: null },
      chat: "hi",
      idle: true,
    });
    expect(states.has(8)).toBe(false);
  });
});
