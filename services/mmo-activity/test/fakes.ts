import type {
  ActivityState,
  ClientMessage,
  IntentReply,
  ServerMessage,
  TokenReply,
  TokenRequest,
} from "../src/api.ts";
import { Session, type SessionDeps, type SocketLike } from "../src/session.ts";

/** Timers a test fires by moving the clock. */
export class FakeClock {
  now = 1_000_000;
  private timers: { at: number; f: () => void; id: number }[] = [];
  private ids = 0;

  after = (ms: number, f: () => void): (() => void) => {
    const id = ++this.ids;
    this.timers.push({ at: this.now + ms, f, id });
    return () => {
      this.timers = this.timers.filter((t) => t.id !== id);
    };
  };

  /** Moves time on, firing what falls due in order. */
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const next = this.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.timers = this.timers.filter((t) => t !== next);
      this.now = next.at;
      next.f();
    }
    this.now = end;
  }

  get pending(): number {
    return this.timers.length;
  }
}

export class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: { code?: number; reason?: string }) => void) | null = null;
  sent: ClientMessage[] = [];
  closed = false;

  send(data: string): void {
    if (this.closed) throw new Error("socket closed");
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closed = true;
  }

  /** The server accepts the connection. */
  accept(): void {
    this.onopen?.();
  }

  serve(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  /** The connection drops, or the gateway closes it with a word. */
  drop(code?: number, reason?: string): void {
    this.closed = true;
    this.onclose?.({ code, reason });
  }

  of(t: string): ClientMessage[] {
    return this.sent.filter((m) => m.t === t);
  }
}

export function stateAt(version: number, more: Partial<ActivityState> = {}): ActivityState {
  return {
    tick: 10,
    now: 5_000_000,
    context: { kind: "solo", id: "c-1" },
    character: {
      id: "c-1",
      version,
      at: { q: 0, r: 0 },
      coin: 0,
      provisions: 0,
      goods: [],
      conditions: [],
      practice: [],
      inFight: false,
      walked: 0,
      alignment: { value: 0, band: "unremarked", goodToday: 0, made: false },
    },
    place: {
      tile: {
        hex: { q: 0, r: 0 },
        terrain: "flats",
        water: "none",
        region: "r",
        road: 0,
        found: 1,
      },
      busy: 1,
    },
    ...more,
  };
}

export interface Rig {
  session: Session;
  clock: FakeClock;
  sockets: FakeSocket[];
  tokens: TokenRequest[];
  notes: string[];
  /** What the token route answers next; an Error is thrown. */
  answer: TokenReply | Error;
  socket(): FakeSocket;
  /** Accepts the newest socket and sends its first state. */
  greet(version?: number, more?: Partial<ActivityState>): FakeSocket;
  reply(reply: Partial<IntentReply> & { id: string }): void;
}

/** A session on a fake socket and a fake clock. */
export function rig(over: Partial<SessionDeps> = {}): Rig {
  const clock = new FakeClock();
  const sockets: FakeSocket[] = [];
  const tokens: TokenRequest[] = [];
  const notes: string[] = [];
  let ids = 0;
  const r: Rig = {
    clock,
    sockets,
    tokens,
    notes,
    answer: { session: "s-1", expires: 0, discordId: "d-1", characterId: "c-1" },
    session: undefined as unknown as Session,
    socket: () => sockets.at(-1)!,
    greet(version = 1, more = {}) {
      const s = r.socket();
      s.accept();
      s.serve({ t: "state", state: stateAt(version, more) });
      return s;
    },
    reply(reply) {
      r.socket().serve({ t: "reply", reply: { ok: true, ...reply } });
    },
  };
  r.session = new Session({
    signIn: async () => ({ dev: "d-1" }),
    token: async (req) => {
      tokens.push(req);
      if (r.answer instanceof Error) throw r.answer;
      return r.answer;
    },
    open: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    instance: "i-1",
    viewer: { compact: true },
    now: () => clock.now,
    after: clock.after,
    id: () => `intent-${++ids}`,
    note: (kind) => notes.push(kind),
    ...over,
  });
  return r;
}

/** Lets pending promise callbacks run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
