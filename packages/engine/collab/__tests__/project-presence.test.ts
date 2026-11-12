import { describe, expect, it } from "vite-plus/test";

import { peers, presenceChannel, setPresence } from "../presence";
import {
  observeProjectPeers,
  projectPeers,
  projectPeersByDoc,
  setProjectPresence,
  type ProjectPeer,
} from "../project-presence";
import { PROJECT_PRESENCE_FIELD, type AwarenessLike, type ProjectPresence } from "../types";

/**
 * The project doc's awareness as a provider relays it: one view per client
 * over shared states, where leaving drops the client's state and rejoining
 * publishes it again.
 */
function awarenessNet() {
  const states = new Map<number, Record<string, unknown>>();
  const handlers = new Set<() => void>();
  const emit = () => {
    for (const h of handlers) h();
  };
  const join = (clientID: number): AwarenessLike => ({
    clientID,
    getLocalState: () => states.get(clientID) ?? null,
    setLocalStateField(field, value) {
      states.set(clientID, { ...states.get(clientID), [field]: value });
      emit();
    },
    getStates: () => states,
    on: (_e, cb) => handlers.add(cb as () => void),
    off: (_e, cb) => handlers.delete(cb as () => void),
  });
  const leave = (clientID: number) => {
    states.delete(clientID);
    emit();
  };
  return { join, leave };
}

const user = (id: string) => ({ id, name: id.toUpperCase(), color: "#f80" });
const where = (list: ProjectPeer[]) => list.map((p) => [p.user.id, p.doc, p.mode]);

describe("project presence", () => {
  it("reports peers in different docs by doc, and who is on the overview", () => {
    const net = awarenessNet();
    const [ada, bo, cy, di] = [1, 2, 3, 4].map(net.join) as [
      AwarenessLike,
      AwarenessLike,
      AwarenessLike,
      AwarenessLike,
    ];
    setProjectPresence(ada, { user: user("ada"), doc: null, mode: "edit" });
    setProjectPresence(bo, { user: user("bo"), doc: "scene:p.yard", mode: "edit" });
    setProjectPresence(cy, { user: user("cy"), doc: "prefab:p.gate", mode: "edit" });
    setProjectPresence(di, { user: user("di"), doc: "scene:p.yard", mode: "edit" });

    const seen = projectPeers(ada);
    expect(where(seen)).toEqual([
      ["bo", "scene:p.yard", "edit"],
      ["cy", "prefab:p.gate", "edit"],
      ["di", "scene:p.yard", "edit"],
    ]);
    const byDoc = projectPeersByDoc(seen);
    expect([...byDoc.keys()]).toEqual(["scene:p.yard", "prefab:p.gate"]);
    expect(byDoc.get("scene:p.yard")!.map((p) => p.clientId)).toEqual([2, 4]);
    expect(byDoc.get("prefab:p.gate")!.map((p) => p.user.id)).toEqual(["cy"]);
    expect(
      projectPeersByDoc(projectPeers(bo))
        .get(null)!
        .map((p) => p.user.id),
    ).toEqual(["ada"]);
  });

  it("follows a peer moving between docs and into play, merging each patch over the last", () => {
    const net = awarenessNet();
    const ada = net.join(1);
    const bo = net.join(2);
    setProjectPresence(bo, { user: user("bo"), doc: "scene:p.yard", mode: "edit" });

    const updates: unknown[][] = [];
    const off = observeProjectPeers(ada, (list) => updates.push(where(list)));
    setProjectPresence(bo, { doc: "prefab:p.gate" });
    setProjectPresence(bo, { mode: "play" });
    off();
    setProjectPresence(bo, { doc: null });

    expect(updates).toEqual([[["bo", "prefab:p.gate", "edit"]], [["bo", "prefab:p.gate", "play"]]]);
    expect(where(projectPeers(ada))).toEqual([["bo", null, "play"]]);
  });

  it("drops a peer that leaves and shows it again when it rejoins", () => {
    const net = awarenessNet();
    const ada = net.join(1);
    let bo = net.join(2);
    const present: ProjectPresence = { user: user("bo"), doc: "scene:p.yard", mode: "edit" };
    setProjectPresence(bo, present);

    const counts: number[] = [];
    const off = observeProjectPeers(ada, (list) => counts.push(list.length));
    net.leave(2);
    expect(projectPeers(ada)).toEqual([]);

    bo = net.join(2);
    expect(bo.getLocalState()).toBeNull();
    setProjectPresence(bo, present);
    expect(projectPeers(ada)).toEqual([{ ...present, clientId: 2 }]);
    expect(counts).toEqual([0, 1]);
    off();
  });

  it("sits beside a doc's scene presence without touching it, and skips malformed states", () => {
    const net = awarenessNet();
    const ada = net.join(1);
    const bo = net.join(2);
    const cy = net.join(3);
    setPresence(bo, { user: user("bo"), selection: ["k1"], mode: "edit" });
    setProjectPresence(bo, { user: user("bo"), doc: "scene:p.yard", mode: "edit" });
    setPresence(cy, { user: user("cy"), selection: [], mode: "edit" });
    cy.setLocalStateField(PROJECT_PRESENCE_FIELD, { user: user("cy"), doc: 7, mode: "edit" });

    expect(peers(ada).map((p) => [p.user.id, p.selection])).toEqual([
      ["bo", ["k1"]],
      ["cy", []],
    ]);
    expect(where(projectPeers(ada))).toEqual([["bo", "scene:p.yard", "edit"]]);
    expect(projectPeers(bo)).toEqual([]);
  });
});

describe("presenceChannel", () => {
  type Cursor = { at: number };
  const isCursor = (v: unknown): v is Cursor =>
    v !== null && typeof v === "object" && typeof (v as Cursor).at === "number";

  it("keeps each channel under its own field, beside scene and project presence", () => {
    const net = awarenessNet();
    const ada = net.join(1);
    const bo = net.join(2);
    const cursor = presenceChannel("cursor", isCursor);
    setPresence(bo, { user: user("bo"), selection: [], mode: "edit" });
    setProjectPresence(bo, { user: user("bo"), doc: null, mode: "edit" });

    const seen: number[][] = [];
    const off = cursor.observe(ada, (list) => seen.push(list.map((p) => p.at)));
    cursor.set(bo, { at: 3 });
    cursor.set(bo, { at: 5 });
    off();

    expect(seen).toEqual([[3], [5]]);
    expect(cursor.peers(ada)).toEqual([{ at: 5, clientId: 2 }]);
    expect(bo.getLocalState()?.cursor).toEqual({ at: 5 });
    expect(peers(ada)).toHaveLength(1);
    expect(projectPeers(ada)).toHaveLength(1);
    expect(cursor.peers(bo)).toEqual([]);
  });
});
