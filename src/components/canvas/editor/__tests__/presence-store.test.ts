// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";

import { presenceColor } from "@/lib/canvas/presence";

import { POINTER_THROTTLE_MS, PresenceStore } from "../presence-store";

const self = { id: "me", name: "Me", avatarUrl: null, ...presenceColor("me") };

function setup() {
  const awareness = new Awareness(new Y.Doc());
  const store = new PresenceStore(awareness, self);
  const peer = (id: string) => {
    const own = new Awareness(new Y.Doc());
    own.setLocalState({ user: { id, name: id } });
    const relay = () =>
      applyAwarenessUpdate(awareness, encodeAwarenessUpdate(own, [own.clientID]), "remote");
    relay();
    return {
      set(field: string, value: unknown) {
        own.setLocalStateField(field, value);
        relay();
      },
    };
  };
  return { awareness, store, peer };
}

afterEach(() => vi.useRealTimers());

describe("PresenceStore", () => {
  it("throttles pointer updates, sending the first at once and the last after the window", () => {
    vi.useFakeTimers();
    const { awareness, store } = setup();
    const sent = vi.fn();
    awareness.on("change", sent);
    store.setPointer({ x: 1, y: 1 });
    store.setPointer({ x: 2, y: 2 });
    store.setPointer({ x: 3.4, y: 3.6 });
    expect(awareness.getLocalState()!.pointer).toEqual({ x: 1, y: 1 });
    vi.advanceTimersByTime(POINTER_THROTTLE_MS);
    expect(awareness.getLocalState()!.pointer).toEqual({ x: 3, y: 4 });
    expect(sent).toHaveBeenCalledTimes(2);
    store.setPointer(null);
    expect(awareness.getLocalState()!.pointer).toBeNull();
  });

  it("clears the pointer when the tab is hidden", () => {
    const { awareness, store } = setup();
    store.setPointer({ x: 5, y: 5 });
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(awareness.getLocalState()!.pointer).toBeNull();
    hidden.mockRestore();
  });

  it("only sends selection and editing when they change", () => {
    const { awareness, store } = setup();
    const sent = vi.fn();
    awareness.on("change", sent);
    store.setSelection(["a"]);
    store.setSelection(["a"]);
    store.setEditing("a");
    store.setEditing("a");
    expect(sent).toHaveBeenCalledTimes(2);
  });

  it("tells pointer listeners about pointers and card listeners about selections, not each other", () => {
    const { store, peer } = setup();
    const pointers = vi.fn();
    const cards = vi.fn();
    store.subscribe("pointers", pointers);
    store.subscribe("cards", cards);
    const ana = peer("ana");
    pointers.mockClear();
    cards.mockClear();

    ana.set("pointer", { x: 1, y: 2 });
    expect(pointers).toHaveBeenCalledTimes(1);
    expect(cards).not.toHaveBeenCalled();

    ana.set("selection", ["a"]);
    expect(cards).toHaveBeenCalledTimes(1);
    expect(pointers).toHaveBeenCalledTimes(1);

    ana.set("cursor", { anchor: 1 });
    expect(cards).toHaveBeenCalledTimes(1);
    expect(pointers).toHaveBeenCalledTimes(1);
  });

  it("keeps a card's marks identical while only another card's change", () => {
    const { store, peer } = setup();
    const ana = peer("ana");
    const rin = peer("rin");
    ana.set("selection", ["a"]);
    const marksA = store.marksFor("a");
    rin.set("selection", ["b"]);
    expect(store.marksFor("a")).toBe(marksA);
    expect(store.marksFor("b").selectedBy.map((u) => u.id)).toEqual(["rin"]);
  });

  it("locates a peer by pointer, else by the card they are on", () => {
    const { store, peer } = setup();
    const ana = peer("ana");
    ana.set("editing", "card-1");
    expect(store.locate("ana")).toEqual({ cardId: "card-1" });
    ana.set("pointer", { x: 4, y: 5 });
    expect(store.locate("ana")).toEqual({ x: 4, y: 5 });
    expect(store.locate("nobody")).toBeNull();
  });
});
