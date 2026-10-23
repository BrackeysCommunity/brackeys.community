// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import * as Y from "yjs";

import { presenceColor } from "@/lib/canvas/presence";

import {
  CHAT_LINGER_MS,
  IDLE_AFTER_MS,
  IDLE_DROP_MS,
  POINTER_THROTTLE_MS,
  PresenceStore,
} from "../presence-store";

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
      clientId: own.clientID,
      set(field: string, value: unknown) {
        own.setLocalStateField(field, value);
        relay();
      },
      timeOut: () => removeAwarenessStates(awareness, [own.clientID], "timeout"),
      renew() {
        own.setLocalState(own.getLocalState());
        relay();
      },
      leave: () => removeAwarenessStates(awareness, [own.clientID], "remote"),
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

  it("goes idle when the tab hides or nothing happens for a while, and back on input", () => {
    vi.useFakeTimers();
    const { awareness } = setup();
    expect(awareness.getLocalState()!.idle).toBe(false);
    vi.advanceTimersByTime(IDLE_AFTER_MS + 5_000);
    expect(awareness.getLocalState()!.idle).toBe(true);
    window.dispatchEvent(new Event("keydown"));
    expect(awareness.getLocalState()!.idle).toBe(false);

    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(awareness.getLocalState()!.idle).toBe(true);
    hidden.mockRestore();
  });

  it("grays out a peer who goes idle or times out, and drops them only when they leave or idle out", () => {
    vi.useFakeTimers();
    const { store, peer } = setup();
    const ana = peer("ana");
    const rin = peer("rin");
    rin.set("pointer", { x: 1, y: 1 });
    const person = (id: string) => store.people.find((p) => p.id === id);
    expect(person("ana")).toMatchObject({ idle: false, locatable: false });
    expect(person("rin")).toMatchObject({ idle: false, locatable: true });

    ana.set("idle", true);
    expect(person("ana")!.idle).toBe(true);

    // A throttled background tab: its renewal came late, so it timed out here.
    rin.timeOut();
    expect(person("rin")).toMatchObject({ idle: true, locatable: false });
    expect(store.pointers).toHaveLength(0);
    rin.renew();
    expect(person("rin")).toMatchObject({ idle: false, locatable: true });

    vi.advanceTimersByTime(IDLE_DROP_MS + 5_000);
    expect(person("ana")).toBeUndefined();
    ana.set("idle", false);
    expect(person("ana")!.idle).toBe(false);

    rin.leave();
    expect(person("rin")).toBeUndefined();
  });

  it("forgets a timed-out peer that never comes back", () => {
    vi.useFakeTimers();
    const { store, peer } = setup();
    peer("ana").timeOut();
    expect(store.people.map((p) => p.id)).toEqual(["ana"]);
    vi.advanceTimersByTime(IDLE_DROP_MS + 5_000);
    expect(store.people).toHaveLength(0);
  });

  it("sends chat as it's typed, and lingers a sent message before clearing it", () => {
    vi.useFakeTimers();
    const { awareness, store } = setup();
    expect(store.openChat()).toBe(false);
    store.setPointer({ x: 10, y: 20 });
    expect(store.openChat()).toBe(true);
    expect(store.chat).toEqual({ open: true, text: "", at: { x: 10, y: 20 } });

    store.typeChat("hi");
    store.typeChat("hi there");
    expect(awareness.getLocalState()!.chat).toBe("hi there");
    store.closeChat(true);
    expect(store.chat.open).toBe(false);
    expect(awareness.getLocalState()!.chat).toBe("hi there");
    vi.advanceTimersByTime(CHAT_LINGER_MS);
    expect(awareness.getLocalState()!.chat).toBeNull();
    expect(store.chat.text).toBe("");

    store.openChat();
    store.typeChat("never mind");
    store.closeChat(false);
    expect(awareness.getLocalState()!.chat).toBeNull();
  });

  it("tells only the cursor layer about a peer's chat", () => {
    const { store, peer } = setup();
    const ana = peer("ana");
    ana.set("pointer", { x: 1, y: 1 });
    const pointers = vi.fn();
    const cards = vi.fn();
    store.subscribe("pointers", pointers);
    store.subscribe("cards", cards);
    ana.set("chat", "look here");
    expect(store.pointers[0]!.chat).toBe("look here");
    expect(pointers).toHaveBeenCalledTimes(1);
    expect(cards).not.toHaveBeenCalled();
  });
});
