import type {
  ActivityState,
  ClientMessage,
  IntentReply,
  MachineIntent,
  PuzzleMove,
  ServerMessage,
  TokenReply,
  TokenRequest,
  Viewer,
} from "./api.ts";
import { SignInError } from "./discord.ts";

/** The part of a WebSocket the session uses, so a test or the mock can stand in. */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: { code?: number; reason?: string }) => void) | null;
}

export interface SessionDeps {
  signIn(): Promise<TokenRequest>;
  /** Trades a sign-in for a session token; throws SignInError when asking again cannot help. */
  token(req: TokenRequest): Promise<TokenReply>;
  open(): SocketLike;
  instance: string;
  viewer: Viewer;
  now(): number;
  /** A timer; the returned function cancels it. */
  after(ms: number, f: () => void): () => void;
  /** A new intent id: 8 to 64 of [A-Za-z0-9-]. */
  id(): string;
  note?(kind: string, data?: Record<string, string | number | boolean>): void;
}

export type Link =
  | { phase: "signing-in" }
  | { phase: "connecting" }
  | { phase: "open" }
  | { phase: "retrying"; inMs: number }
  | { phase: "stopped"; reason: "no-character" | "replaced" | "sign-in"; message: string };

export interface IntentBody {
  option?: string;
  machine?: MachineIntent;
}

interface Pending {
  id: string;
  seq: number;
  kind: string;
  body: IntentBody;
  version: number | undefined;
  stale: number; // how many more stale refusals to retry past
  sent: boolean;
  resolve(reply: IntentReply): void;
}

const BYE_CODE = 4001;
const RETRY_MIN = 500;
const RETRY_MAX = 15_000;
const PING_EVERY = 20_000;
const QUIET_MAX = 45_000;
// How long the next intent waits for the state an accepted one leaves.
const SETTLE_MAX = 1500;

/**
 * The Activity's one connection to the world: sign-in, the socket, the
 * whole state as last sent, and intents out. It decides nothing; it
 * carries.
 */
export class Session {
  state: ActivityState | undefined;
  link: Link = { phase: "signing-in" };
  /** The server's clock less this one's, from the newest state. */
  offset = 0;

  private socket: SocketLike | undefined;
  private session = "";
  private viewer: Viewer;
  private retry = RETRY_MIN;
  private seq = 0;
  private queue: Pending[] = [];
  private flight: Pending | undefined;
  private settling: (() => void) | undefined;
  private greeted = false;
  private halted = false;
  private lastFrame = 0;
  private stopPing: (() => void) | undefined;
  private stopRetry: (() => void) | undefined;
  private listeners = new Set<() => void>();
  private hintListeners = new Set<(m: PuzzleMove) => void>();

  constructor(private readonly deps: SessionDeps) {
    this.viewer = { ...deps.viewer };
  }

  subscribe(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  /** Hints a master in the same context passes on. */
  onHint(f: (m: PuzzleMove) => void): () => void {
    this.hintListeners.add(f);
    return () => this.hintListeners.delete(f);
  }

  /** The server's clock now, unix ms. */
  serverNow(): number {
    return this.deps.now() + this.offset;
  }

  get open(): boolean {
    return this.link.phase === "open";
  }

  start(): void {
    this.halted = false;
    this.stopRetry?.();
    this.dropSocket();
    void this.connect();
  }

  stop(): void {
    this.halted = true;
    this.stopRetry?.();
    this.dropSocket();
  }

  /** Says what this screen has open: a phone's caps, a bench rig, a pouch. */
  look(viewer: Viewer): void {
    this.viewer = { ...viewer };
    if (this.greeted) this.send({ t: "look", look: this.viewer });
  }

  /**
   * Sends a write and resolves with the world's answer. Intents go one at
   * a time, each naming the row version of the state before it. `stale`
   * is how many times to send again when the row had moved underneath.
   */
  intent(kind: string, body: IntentBody = {}, stale = 0): Promise<IntentReply> {
    return new Promise((resolve) => {
      this.queue.push({
        id: this.deps.id(),
        seq: ++this.seq,
        kind,
        body,
        version: undefined,
        stale,
        sent: false,
        resolve,
      });
      this.pump();
    });
  }

  passHint(hint: PuzzleMove): void {
    this.send({ t: "pass-hint", hint });
  }

  private setLink(link: Link): void {
    this.link = link;
    this.emit();
  }

  private emit(): void {
    for (const f of this.listeners) f();
  }

  private async connect(): Promise<void> {
    if (this.halted) return;
    if (!this.session) {
      this.setLink({ phase: "signing-in" });
      try {
        const reply = await this.deps.token(await this.deps.signIn());
        if (this.halted) return;
        if (!reply.characterId) {
          this.halt(
            "no-character",
            "You have no character yet. Start with /play in chat, then come back.",
          );
          return;
        }
        this.session = reply.session;
      } catch (err) {
        if (err instanceof SignInError) this.halt("sign-in", err.message);
        else this.again();
        return;
      }
    }
    this.setLink({ phase: "connecting" });
    const socket = this.deps.open();
    this.socket = socket;
    this.greeted = false;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.lastFrame = this.deps.now();
      this.send({
        t: "hello",
        hello: { session: this.session, instance: this.deps.instance, viewer: this.viewer },
      });
      this.deps.note?.("socket-open");
      this.ping();
    };
    socket.onmessage = (ev) => {
      if (this.socket !== socket) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      this.lastFrame = this.deps.now();
      this.receive(msg);
    };
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      // The gateway closes with the word it said goodbye with, in case the
      // frame itself never arrived.
      if (ev?.code === BYE_CODE && ev.reason) this.bye(ev.reason);
      if (this.socket === socket) this.lost();
    };
  }

  private receive(msg: ServerMessage): void {
    switch (msg.t) {
      case "state":
        if (msg.state) this.took(msg.state);
        return;
      case "reply":
        if (msg.reply) this.answered(msg.reply);
        return;
      case "hint":
        if (msg.hint) for (const f of this.hintListeners) f(msg.hint);
        return;
      case "bye":
        this.bye(msg.bye ?? "");
        return;
    }
  }

  private took(state: ActivityState): void {
    this.state = state;
    if (state.now) this.offset = state.now - this.deps.now();
    this.retry = RETRY_MIN;
    this.settling?.();
    this.settling = undefined;
    const first = !this.greeted;
    this.greeted = true;
    this.link = { phase: "open" };
    // Listeners hear the state before the next intent leaves, so what is
    // waiting to go can still be put right against it.
    this.emit();
    // An intent the last socket never answered goes again under its own id,
    // so one already applied comes back as the stored reply.
    if (first && this.flight && !this.flight.sent) this.transmit(this.flight);
    this.pump();
  }

  private answered(reply: IntentReply): void {
    const p = this.flight;
    if (!p || p.id !== reply.id) return;
    const moved = reply.refusal?.code === "stale" ? reply.refusal.version : undefined;
    if (moved !== undefined && p.stale > 0) {
      p.stale--;
      p.id = this.deps.id();
      p.version = moved;
      this.transmit(p);
      return;
    }
    this.flight = undefined;
    if (reply.ok && !reply.duplicate) {
      // The row moved; the state that says so is the next frame.
      const cancel = this.deps.after(SETTLE_MAX, () => {
        this.settling = undefined;
        this.pump();
      });
      this.settling = cancel;
    }
    p.resolve(reply);
    this.pump();
  }

  private bye(why: string): void {
    this.deps.note?.("socket-bye", { why });
    switch (why) {
      case "replaced":
        this.halt("replaced", "This character is open in another window.");
        return;
      case "no-character":
        this.halt(
          "no-character",
          "You have no character yet. Start with /play in chat, then come back.",
        );
        return;
      case "expired":
      case "bad-hello":
        // The token is spent; the reconnect signs in again.
        this.session = "";
        this.lost();
        return;
    }
  }

  private pump(): void {
    if (!this.greeted || this.flight || this.settling || !this.state) return;
    const next = this.queue.shift();
    if (!next) return;
    this.flight = next;
    next.version = this.state.character.version;
    this.transmit(next);
  }

  private transmit(p: Pending): void {
    p.sent = this.send({
      t: "intent",
      seq: p.seq,
      intent: { id: p.id, version: p.version ?? 0, kind: p.kind, ...p.body },
    });
  }

  private send(msg: ClientMessage): boolean {
    if (!this.socket) return false;
    try {
      this.socket.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  private ping(): void {
    this.stopPing?.();
    this.stopPing = this.deps.after(PING_EVERY, () => {
      if (this.deps.now() - this.lastFrame > QUIET_MAX) {
        this.lost();
        return;
      }
      this.send({ t: "ping" });
      this.ping();
    });
  }

  private dropSocket(): void {
    this.stopPing?.();
    this.settling?.();
    this.settling = undefined;
    const socket = this.socket;
    this.socket = undefined;
    this.greeted = false;
    if (this.flight) this.flight.sent = false;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = null;
      try {
        socket.close();
      } catch {
        // Already closed.
      }
    }
  }

  private lost(): void {
    this.dropSocket();
    if (this.halted) return;
    this.deps.note?.("socket-close", { retryMs: this.retry });
    this.again();
  }

  // Tries again after a wait that doubles from half a second to fifteen.
  private again(): void {
    const wait = this.retry;
    this.retry = Math.min(this.retry * 2, RETRY_MAX);
    this.setLink({ phase: "retrying", inMs: wait });
    this.stopRetry = this.deps.after(wait, () => void this.connect());
  }

  private halt(reason: "no-character" | "replaced" | "sign-in", message: string): void {
    this.halted = true;
    this.dropSocket();
    this.setLink({ phase: "stopped", reason, message });
  }
}
