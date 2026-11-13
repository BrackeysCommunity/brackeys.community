import { expect, vi } from "vite-plus/test";

import type { RemapState } from "../../input/remap";
import type { HostSaves, HostWelcome } from "../host-protocol";

/** A fake page that frames the game, over a real `MessageChannel`, for jsdom tests. */

export const SAVES: HostSaves = {
  describe: "Saves stay in this browser until you sign in.",
  limits: { maxBytes: 32_768, maxSlots: 8 },
  mode: "site",
};

export const REMAP: RemapState = {
  v: 1,
  players: { 0: { jump: [{ device: "key", code: "KeyW" }] } },
};

export const welcomeOf = (over: Partial<HostWelcome> = {}): HostWelcome => ({
  player: { signedIn: false, name: null },
  saves: SAVES,
  prefs: { remap: REMAP, prefs: null },
  online: false,
  ...over,
});

export type Received = { type: string; id?: number; params?: unknown; [k: string]: unknown };

export type FakePage = {
  /** What the frame posted to its parent window. */
  readyPosts: { message: unknown; target: string }[];
  /** Every message the frame sent over the port. */
  received: Received[];
  /** The page's end of the port, once the handshake ran. */
  port: MessagePort | null;
  /** The saves the page holds, by `gameId:slot`. */
  slots: Map<string, string>;
  /** Sends a raw message to the frame over the port. */
  send(message: unknown): void;
  /** Waits until the frame has sent `n` messages of `type`. */
  until(type: string, n?: number, timeoutMs?: number): Promise<Received[]>;
};

export type FakeOptions = {
  /** Never answer the handshake. */
  silent?: boolean;
  welcome?: HostWelcome;
  /** An answer to a request in place of the default one. */
  answer?: (m: Received) => unknown;
  /** Called with the window and a second port, after the real answer: a later `jams:host` the frame must ignore. */
  before?: (post: (data: unknown, ports?: MessagePort[]) => void) => void;
};

const open: MessagePort[] = [];

/** Dispatches a window message from `source` (default the parent), carrying `ports`. */
export function postToFrame(
  data: unknown,
  ports: MessagePort[] = [],
  source: unknown = window.parent,
) {
  const event = new MessageEvent("message", { data });
  Object.defineProperty(event, "ports", { value: ports });
  Object.defineProperty(event, "source", { value: source });
  window.dispatchEvent(event);
}

/** Makes `window.parent` a page that answers the handshake with a port and every request as a page would. */
export function fakeParent(opts: FakeOptions = {}): FakePage {
  const page: FakePage = {
    readyPosts: [],
    received: [],
    port: null,
    slots: new Map(),
    send: (message) => page.port?.postMessage(message),
    until: (type, n = 1, timeoutMs = 2000) =>
      vi.waitFor(
        () => {
          const of = page.received.filter((m) => m.type === type);
          expect(of.length).toBeGreaterThanOrEqual(n);
          return of;
        },
        { timeout: timeoutMs },
      ),
  };
  const reply = (m: Received, result: unknown) =>
    page.port?.postMessage({ type: "reply", id: m.id, ok: true, result });
  const answer = (m: Received): unknown => {
    const p = m.params as { gameId: string; slot: string; text: string; sessionId: string };
    switch (m.type) {
      case "hello":
        return opts.welcome ?? welcomeOf();
      case "saves.list":
        return [...page.slots.keys()]
          .filter((k) => k.startsWith(`${p.gameId}:`))
          .map((k) => ({
            slot: k.slice(p.gameId.length + 1),
            meta: { scene: "yard", savedAt: 1, playTicks: 2 },
            bytes: page.slots.get(k)!.length,
          }));
      case "saves.read":
        return page.slots.get(`${p.gameId}:${p.slot}`) ?? null;
      case "saves.write":
        page.slots.set(`${p.gameId}:${p.slot}`, p.text);
        return { ok: true, bytes: p.text.length };
      case "saves.remove":
        page.slots.delete(`${p.gameId}:${p.slot}`);
        return null;
      case "prefs.save":
        return null;
      case "session.token":
        return { token: `t-${p.sessionId}`, url: "wss://sync.example/" };
      default:
        return undefined;
    }
  };
  const parent = {
    postMessage(message: unknown, target: string) {
      page.readyPosts.push({ message, target });
      if (opts.silent) return;
      const { port1, port2 } = new MessageChannel();
      open.push(port1, port2);
      page.port = port1;
      port1.onmessage = (event: MessageEvent) => {
        const m = event.data as Received;
        page.received.push(m);
        if (m.id === undefined) return;
        const custom = opts.answer?.(m);
        if (custom !== undefined) page.port?.postMessage(custom);
        else reply(m, answer(m));
      };
      queueMicrotask(() => {
        opts.before?.(postToFrame);
        postToFrame({ type: "jams:host", protocol: 1 }, [port2]);
      });
    },
  };
  Object.defineProperty(window, "parent", { value: parent, configurable: true });
  return page;
}

/** Puts `window.parent` back to the window itself and closes every port the fake opened. */
export function unframe() {
  for (const p of open.splice(0)) p.close();
  Object.defineProperty(window, "parent", { value: window, configurable: true });
}
