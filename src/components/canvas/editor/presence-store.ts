import { createContext, use, useSyncExternalStore } from "react";
import type { Awareness } from "y-protocols/awareness";

import { type PeerState, parsePeerState, type PresenceUser } from "@/lib/canvas/presence";

/** Pointer updates go out at most this often; the last position is always sent. */
export const POINTER_THROTTLE_MS = 40;

export interface PeerPointer {
  clientId: number;
  user: PresenceUser;
  x: number;
  y: number;
}

export interface CardMarks {
  /** Everyone with this card selected, each person once. */
  selectedBy: readonly PresenceUser[];
  /** Whoever has its text open. */
  typing: PresenceUser | null;
}

type Channel = "pointers" | "people" | "cards";

const NO_MARKS: CardMarks = { selectedBy: [], typing: null };
const NO_POINTERS: readonly PeerPointer[] = [];
const NO_PEOPLE: readonly PresenceUser[] = [];

function sameUser(a: PresenceUser, b: PresenceUser): boolean {
  return a.id === b.id && a.name === b.name && a.avatarUrl === b.avatarUrl;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function marksKey(marks: CardMarks): string {
  return `${marks.typing?.id ?? ""}|${marks.selectedBy.map((u) => `${u.id}:${u.name}`).join(",")}`;
}

/**
 * Everyone else on the canvas, kept outside React Flow and card state. It
 * splits awareness into three channels so a subscriber only hears about
 * its own slice: a peer's pointer moving notifies the cursor layer and
 * nothing else, and each card's marks keep their identity unless that
 * card's own selectors or typist changed. Cards themselves never subscribe.
 */
export class PresenceStore {
  private readonly peers = new Map<number, PeerState>();
  private readonly listeners: Record<Channel, Set<() => void>> = {
    pointers: new Set(),
    people: new Set(),
    cards: new Set(),
  };
  private marks = new Map<string, CardMarks>();
  private pointerTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPointer: PeerState["pointer"] | undefined;
  private destroyed = false;

  pointers: readonly PeerPointer[] = NO_POINTERS;
  /** Connected people other than this tab, each once, in the order they arrived. */
  people: readonly PresenceUser[] = NO_PEOPLE;

  constructor(
    readonly awareness: Awareness,
    readonly self: PresenceUser,
  ) {
    awareness.setLocalState({
      ...awareness.getLocalState(),
      user: self,
      pointer: null,
      selection: [],
      editing: null,
    });
    awareness.on("change", this.onChange);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    this.read([...awareness.getStates().keys()], []);
  }

  destroy(): void {
    this.destroyed = true;
    this.awareness.off("change", this.onChange);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    if (this.pointerTimer) clearTimeout(this.pointerTimer);
    for (const set of Object.values(this.listeners)) set.clear();
  }

  subscribe(channel: Channel, listener: () => void): () => void {
    this.listeners[channel].add(listener);
    return () => this.listeners[channel].delete(listener);
  }

  marksFor(cardId: string): CardMarks {
    return this.marks.get(cardId) ?? NO_MARKS;
  }

  /** Where to find someone: their pointer, else the card they're on. */
  locate(userId: string): { x: number; y: number } | { cardId: string } | null {
    let card: string | null = null;
    for (const peer of this.peers.values()) {
      if (peer.user.id !== userId) continue;
      if (peer.pointer) return peer.pointer;
      card ??= peer.editing ?? peer.selection[0] ?? null;
    }
    return card ? { cardId: card } : null;
  }

  // ── This tab ─────────────────────────────────────────────────────────────

  /** Leading and trailing: the first move goes out at once, the last one always lands. */
  setPointer(pointer: PeerState["pointer"]): void {
    if (this.destroyed) return;
    if (pointer === null) {
      if (this.pointerTimer) clearTimeout(this.pointerTimer);
      this.pointerTimer = null;
      this.pendingPointer = undefined;
      if (this.awareness.getLocalState()?.pointer != null) this.publish("pointer", null);
      return;
    }
    if (this.pointerTimer) {
      this.pendingPointer = pointer;
      return;
    }
    this.publish("pointer", { x: Math.round(pointer.x), y: Math.round(pointer.y) });
    this.pointerTimer = setTimeout(this.flushPointer, POINTER_THROTTLE_MS);
  }

  setSelection(ids: readonly string[]): void {
    const current = (this.awareness.getLocalState()?.selection as string[] | undefined) ?? [];
    if (!this.destroyed && !sameIds(current, ids)) this.publish("selection", [...ids]);
  }

  setEditing(cardId: string | null): void {
    const current = this.awareness.getLocalState()?.editing ?? null;
    if (!this.destroyed && current !== cardId) this.publish("editing", cardId);
  }

  private flushPointer = () => {
    this.pointerTimer = null;
    const pending = this.pendingPointer;
    this.pendingPointer = undefined;
    if (pending) this.setPointer(pending);
  };

  private onVisibility = () => {
    if (document.visibilityState === "hidden") this.setPointer(null);
  };

  private publish(field: string, value: unknown): void {
    if (this.awareness.getLocalState() === null) return;
    this.awareness.setLocalStateField(field, value);
  }

  // ── Everyone else ────────────────────────────────────────────────────────

  private onChange = ({
    added,
    updated,
    removed,
  }: {
    added: number[];
    updated: number[];
    removed: number[];
  }) => this.read([...added, ...updated], removed);

  private read(changed: number[], removed: number[]): void {
    const states = this.awareness.getStates();
    let pointers = false;
    let people = false;
    for (const id of removed) {
      if (this.peers.delete(id)) pointers = people = true;
    }
    for (const id of changed) {
      if (id === this.awareness.clientID) continue;
      const prev = this.peers.get(id);
      const next = parsePeerState(states.get(id));
      if (!next) {
        if (prev) {
          this.peers.delete(id);
          pointers = people = true;
        }
        continue;
      }
      this.peers.set(id, next);
      // A caret moving in someone's open card changes neither slice.
      const userChanged = !prev || !sameUser(prev.user, next.user);
      if (userChanged || prev.pointer?.x !== next.pointer?.x || prev.pointer?.y !== next.pointer?.y)
        pointers = true;
      if (userChanged || prev.editing !== next.editing || !sameIds(prev.selection, next.selection))
        people = true;
    }
    if (pointers) {
      const list: PeerPointer[] = [];
      for (const [clientId, peer] of this.peers) {
        if (peer.pointer) list.push({ clientId, user: peer.user, ...peer.pointer });
      }
      this.pointers = list.length ? list : NO_POINTERS;
      this.emit("pointers");
    }
    if (people) {
      this.rebuildPeople();
      this.emit("people");
      this.emit("cards");
    }
  }

  private rebuildPeople(): void {
    const seen = new Map<string, PresenceUser>();
    const byCard = new Map<
      string,
      { selectedBy: Map<string, PresenceUser>; typing: PresenceUser | null }
    >();
    const entry = (cardId: string) => {
      let marks = byCard.get(cardId);
      if (!marks) byCard.set(cardId, (marks = { selectedBy: new Map(), typing: null }));
      return marks;
    };
    for (const peer of this.peers.values()) {
      if (!seen.has(peer.user.id)) seen.set(peer.user.id, peer.user);
      for (const cardId of peer.selection) entry(cardId).selectedBy.set(peer.user.id, peer.user);
      if (peer.editing) entry(peer.editing).typing ??= peer.user;
    }
    this.people = seen.size ? [...seen.values()] : NO_PEOPLE;

    const next = new Map<string, CardMarks>();
    for (const [cardId, raw] of byCard) {
      const marks: CardMarks = { selectedBy: [...raw.selectedBy.values()], typing: raw.typing };
      const prev = this.marks.get(cardId);
      next.set(cardId, prev && marksKey(prev) === marksKey(marks) ? prev : marks);
    }
    this.marks = next;
  }

  private emit(channel: Channel): void {
    for (const listener of this.listeners[channel]) listener();
  }
}

export const PresenceContext = createContext<PresenceStore | null>(null);

const noSubscribe = () => () => {};

export function usePeerPointers(): readonly PeerPointer[] {
  const store = use(PresenceContext);
  return useSyncExternalStore(
    store ? (listener) => store.subscribe("pointers", listener) : noSubscribe,
    () => store?.pointers ?? NO_POINTERS,
    () => NO_POINTERS,
  );
}

export function usePeople(): readonly PresenceUser[] {
  const store = use(PresenceContext);
  return useSyncExternalStore(
    store ? (listener) => store.subscribe("people", listener) : noSubscribe,
    () => store?.people ?? NO_PEOPLE,
    () => NO_PEOPLE,
  );
}

export function useCardMarks(cardId: string): CardMarks {
  const store = use(PresenceContext);
  return useSyncExternalStore(
    store ? (listener) => store.subscribe("cards", listener) : noSubscribe,
    () => store?.marksFor(cardId) ?? NO_MARKS,
    () => NO_MARKS,
  );
}
