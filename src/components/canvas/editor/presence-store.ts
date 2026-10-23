import { createContext, use, useSyncExternalStore } from "react";
import type { Awareness } from "y-protocols/awareness";

import { MAX_CHAT, type PeerState, parsePeerState, type PresenceUser } from "@/lib/canvas/presence";

/** Pointer updates go out at most this often; the last position is always sent. */
export const POINTER_THROTTLE_MS = 40;
/** Without input for this long, this tab reads as idle to everyone else. */
export const IDLE_AFTER_MS = 60_000;
/** An idle peer stays in the stack, grayed out, this long before it drops off. */
export const IDLE_DROP_MS = 5 * 60_000;
/** A sent chat bubble stays up this long. */
export const CHAT_LINGER_MS = 5_000;
const TICK_MS = 5_000;

export interface PeerPointer {
  clientId: number;
  user: PresenceUser;
  x: number;
  y: number;
  chat: string | null;
}

export interface PresencePerson extends PresenceUser {
  idle: boolean;
  /** Has a pointer on the canvas or a card selected, so "go to them" has somewhere to go. */
  locatable: boolean;
}

export interface CardMarks {
  /** Everyone with this card selected, each person once. */
  selectedBy: readonly PresenceUser[];
  /** Whoever has its text open. */
  typing: PresenceUser | null;
}

/** This tab's own chat bubble: open while typing, then shown until it lingers out. */
export interface SelfChat {
  open: boolean;
  text: string;
  at: { x: number; y: number } | null;
}

interface Peer {
  state: PeerState;
  /** Their awareness timed out here without a goodbye: a throttled background tab, usually. */
  stale: boolean;
  idleSince: number | null;
}

type Channel = "pointers" | "people" | "cards" | "self";

const NO_MARKS: CardMarks = { selectedBy: [], typing: null };
const NO_POINTERS: readonly PeerPointer[] = [];
const NO_PEOPLE: readonly PresencePerson[] = [];
const CHAT_CLOSED: SelfChat = { open: false, text: "", at: null };

function sameUser(a: PresenceUser, b: PresenceUser): boolean {
  return a.id === b.id && a.name === b.name && a.avatarUrl === b.avatarUrl;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function marksKey(marks: CardMarks): string {
  return `${marks.typing?.id ?? ""}|${marks.selectedBy.map((u) => `${u.id}:${u.name}`).join(",")}`;
}

function peopleKey(people: readonly PresencePerson[]): string {
  return people
    .map((p) => `${p.id}:${p.name}:${p.avatarUrl}:${p.idle ? 1 : 0}${p.locatable ? 1 : 0}`)
    .join(",");
}

const isIdle = (peer: Peer) => peer.stale || peer.state.idle;
const isLocatable = (peer: Peer) =>
  !peer.stale &&
  (peer.state.pointer != null || peer.state.editing != null || peer.state.selection.length > 0);

/**
 * Everyone else on the canvas, kept outside React Flow and card state. It
 * splits awareness into channels so a subscriber only hears about its own
 * slice: a peer's pointer moving notifies the cursor layer and nothing
 * else, and each card's marks keep their identity unless that card's own
 * selectors or typist changed. Cards themselves never subscribe.
 *
 * A peer whose awareness times out stays, grayed out like an idle one,
 * until they leave or have been idle for `IDLE_DROP_MS`, so a background
 * tab doesn't blink in and out of the stack.
 */
export class PresenceStore {
  private readonly peers = new Map<number, Peer>();
  private readonly listeners: Record<Channel, Set<() => void>> = {
    pointers: new Set(),
    people: new Set(),
    cards: new Set(),
    self: new Set(),
  };
  private marks = new Map<string, CardMarks>();
  private pointerTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPointer: PeerState["pointer"] | undefined;
  private chatTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly tick: ReturnType<typeof setInterval>;
  private lastActivity = Date.now();
  private selfPointer: { x: number; y: number } | null = null;
  private destroyed = false;

  pointers: readonly PeerPointer[] = NO_POINTERS;
  /** Connected people other than this tab, each once, in the order they arrived. */
  people: readonly PresencePerson[] = NO_PEOPLE;
  chat: SelfChat = CHAT_CLOSED;

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
      idle: typeof document !== "undefined" && document.visibilityState === "hidden",
      chat: null,
    });
    awareness.on("change", this.onChange);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
      window.addEventListener("pointerdown", this.noteActivity, { passive: true });
      window.addEventListener("pointermove", this.noteActivity, { passive: true });
      window.addEventListener("keydown", this.noteActivity, { passive: true });
    }
    this.tick = setInterval(this.onTick, TICK_MS);
    this.read([...awareness.getStates().keys()], [], null);
  }

  destroy(): void {
    this.destroyed = true;
    this.awareness.off("change", this.onChange);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
      window.removeEventListener("pointerdown", this.noteActivity);
      window.removeEventListener("pointermove", this.noteActivity);
      window.removeEventListener("keydown", this.noteActivity);
    }
    clearInterval(this.tick);
    if (this.pointerTimer) clearTimeout(this.pointerTimer);
    if (this.chatTimer) clearTimeout(this.chatTimer);
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
      if (peer.stale || peer.state.user.id !== userId) continue;
      if (peer.state.pointer) return peer.state.pointer;
      card ??= peer.state.editing ?? peer.state.selection[0] ?? null;
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
    this.selfPointer = pointer;
    if (this.chat.open || this.chat.text) this.setChatState({ ...this.chat, at: pointer });
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

  /** Opens a chat bubble at this tab's pointer; false while the pointer has never been on the canvas. */
  openChat(): boolean {
    if (this.destroyed || !this.selfPointer) return false;
    if (this.chatTimer) clearTimeout(this.chatTimer);
    this.chatTimer = null;
    this.setChatState({ open: true, text: "", at: this.selfPointer });
    this.publish("chat", null);
    return true;
  }

  typeChat(text: string): void {
    if (this.destroyed || !this.chat.open) return;
    const clipped = text.slice(0, MAX_CHAT);
    this.setChatState({ ...this.chat, text: clipped });
    this.publish("chat", clipped || null);
  }

  /** `send` leaves the message up for a moment; otherwise it goes at once. */
  closeChat(send: boolean): void {
    if (this.destroyed || !this.chat.open) return;
    if (send && this.chat.text) {
      this.setChatState({ ...this.chat, open: false });
      this.chatTimer = setTimeout(this.clearChat, CHAT_LINGER_MS);
    } else {
      this.clearChat();
    }
  }

  private clearChat = () => {
    this.chatTimer = null;
    this.setChatState(CHAT_CLOSED);
    if (this.awareness.getLocalState()?.chat != null) this.publish("chat", null);
  };

  private setChatState(chat: SelfChat): void {
    this.chat = chat;
    this.emit("self");
  }

  private flushPointer = () => {
    this.pointerTimer = null;
    const pending = this.pendingPointer;
    this.pendingPointer = undefined;
    if (pending) this.setPointer(pending);
  };

  private noteActivity = () => {
    this.lastActivity = Date.now();
    if (this.awareness.getLocalState()?.idle === true && document.visibilityState !== "hidden") {
      this.publish("idle", false);
    }
  };

  private onVisibility = () => {
    if (document.visibilityState === "hidden") {
      this.setPointer(null);
      this.publish("idle", true);
    } else {
      this.noteActivity();
    }
  };

  private onTick = () => {
    const local = this.awareness.getLocalState();
    if (local && local.idle !== true && Date.now() - this.lastActivity >= IDLE_AFTER_MS) {
      this.publish("idle", true);
    }
    let dropped = false;
    for (const [id, peer] of this.peers) {
      if (peer.stale && peer.idleSince !== null && Date.now() - peer.idleSince > IDLE_DROP_MS) {
        this.peers.delete(id);
        dropped = true;
      }
    }
    const before = peopleKey(this.people);
    this.rebuildPeople();
    if (dropped || peopleKey(this.people) !== before) {
      this.emit("people");
      this.emit("cards");
    }
  };

  private publish(field: string, value: unknown): void {
    if (this.awareness.getLocalState() === null) return;
    this.awareness.setLocalStateField(field, value);
  }

  // ── Everyone else ────────────────────────────────────────────────────────

  private onChange = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => this.read([...added, ...updated], removed, origin);

  private read(changed: number[], removed: number[], origin: unknown): void {
    const states = this.awareness.getStates();
    let pointers = false;
    let people = false;
    let cards = false;
    for (const id of removed) {
      const peer = this.peers.get(id);
      if (!peer) continue;
      // Timed out here, not a goodbye: keep them, grayed, until they come back or drop off.
      if (origin === "timeout") {
        if (!peer.stale) {
          peer.stale = true;
          peer.idleSince ??= Date.now();
          pointers = people = cards = true;
        }
      } else {
        this.peers.delete(id);
        pointers = people = cards = true;
      }
    }
    for (const id of changed) {
      if (id === this.awareness.clientID) continue;
      const prev = this.peers.get(id);
      const state = parsePeerState(states.get(id));
      if (!state) {
        if (prev) {
          this.peers.delete(id);
          pointers = people = cards = true;
        }
        continue;
      }
      const next: Peer = {
        state,
        stale: false,
        idleSince: state.idle ? (prev?.idleSince ?? Date.now()) : null,
      };
      this.peers.set(id, next);
      if (!prev) {
        pointers = people = cards = true;
        continue;
      }
      const was = prev.state;
      // A caret moving in someone's open card changes no slice.
      const userChanged = !sameUser(was.user, state.user);
      const idleChanged = isIdle(prev) !== isIdle(next);
      if (
        userChanged ||
        idleChanged ||
        prev.stale ||
        was.pointer?.x !== state.pointer?.x ||
        was.pointer?.y !== state.pointer?.y ||
        was.chat !== state.chat
      )
        pointers = true;
      if (
        userChanged ||
        prev.stale ||
        was.editing !== state.editing ||
        !sameIds(was.selection, state.selection)
      )
        people = cards = true;
      else if (idleChanged || isLocatable(prev) !== isLocatable(next)) people = true;
    }
    if (pointers) {
      const list: PeerPointer[] = [];
      for (const [clientId, peer] of this.peers) {
        if (!peer.stale && peer.state.pointer) {
          list.push({
            clientId,
            user: peer.state.user,
            chat: peer.state.chat,
            ...peer.state.pointer,
          });
        }
      }
      this.pointers = list.length ? list : NO_POINTERS;
      this.emit("pointers");
    }
    if (people || cards) this.rebuildPeople();
    if (people) this.emit("people");
    if (cards) this.emit("cards");
  }

  private rebuildPeople(): void {
    const now = Date.now();
    const seen = new Map<string, PresencePerson>();
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
      const { user, selection, editing } = peer.state;
      const gone = peer.idleSince !== null && now - peer.idleSince > IDLE_DROP_MS;
      if (!gone) {
        const person = seen.get(user.id);
        if (!person) {
          seen.set(user.id, { ...user, idle: isIdle(peer), locatable: isLocatable(peer) });
        } else {
          person.idle &&= isIdle(peer);
          person.locatable ||= isLocatable(peer);
        }
      }
      if (peer.stale) continue;
      for (const cardId of selection) entry(cardId).selectedBy.set(user.id, user);
      if (editing) entry(editing).typing ??= user;
    }
    const people = [...seen.values()];
    this.people =
      people.length === 0
        ? NO_PEOPLE
        : peopleKey(people) === peopleKey(this.people)
          ? this.people
          : people;

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

export function usePeople(): readonly PresencePerson[] {
  const store = use(PresenceContext);
  return useSyncExternalStore(
    store ? (listener) => store.subscribe("people", listener) : noSubscribe,
    () => store?.people ?? NO_PEOPLE,
    () => NO_PEOPLE,
  );
}

export function useSelfChat(): SelfChat {
  const store = use(PresenceContext);
  return useSyncExternalStore(
    store ? (listener) => store.subscribe("self", listener) : noSubscribe,
    () => store?.chat ?? CHAT_CLOSED,
    () => CHAT_CLOSED,
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
