import { CANVAS_LIMITS, SYNC_LIMITS } from "../../../src/lib/canvas/limits.ts";
import {
  SYNC_CLOSE,
  syncClose,
  type SyncCloseCode,
} from "../../../src/lib/canvas/sync-channels.ts";

/**
 * A refusal Hocuspocus understands: thrown from `onAuthenticate` its
 * `reason` reaches the client as the permission-denied reason, and thrown
 * from `beforeHandleMessage` its `code` and `reason` close the connection.
 */
export class SyncRefusal extends Error {
  readonly code: number;
  readonly reason: string;
  constructor(
    code: SyncCloseCode,
    detail: string,
    readonly metric: RefusalReason,
  ) {
    const event = syncClose(code, detail);
    super(event.reason);
    this.code = event.code;
    this.reason = event.reason;
    // Hocuspocus logs every refusal; a stack adds nothing to a rate limit.
    this.stack = `SyncRefusal: ${event.reason}`;
  }
}

export type RefusalReason = "auth" | "size" | "rate" | "caps";

/** Messages per connection: `rate` a second sustained, `burst` at once. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly rate: number,
    private readonly burst: number,
    now: number,
  ) {
    this.tokens = burst;
    this.last = now;
  }

  take(now: number): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

const MESSAGE_SYNC = 0;
const MESSAGE_SYNC_REPLY = 4;
const SYNC_STEP_2 = 1;

/** Reads a lib0 varuint at `pos`; null past the end. */
function readVarUint(bytes: Uint8Array, pos: number): [value: number, next: number] | null {
  let value = 0;
  let shift = 0;
  for (let i = pos; i < bytes.length && shift < 35; i++) {
    const byte = bytes[i]!;
    value += (byte & 0x7f) * 2 ** shift;
    if (byte < 0x80) return [value, i + 1];
    shift += 7;
  }
  return null;
}

/**
 * Whether a raw Hocuspocus message is a sync step 2: a client's answer to
 * the server's state vector, carrying everything the server lacks. After an
 * offline stretch that is the whole backlog in one message.
 */
export function isSyncStep2(message: Uint8Array): boolean {
  const name = readVarUint(message, 0);
  if (!name) return false;
  const type = readVarUint(message, name[1] + name[0]);
  if (!type || (type[0] !== MESSAGE_SYNC && type[0] !== MESSAGE_SYNC_REPLY)) return false;
  return readVarUint(message, type[1])?.[0] === SYNC_STEP_2;
}

/**
 * The most one message may carry. A connection's first sync step 2 may hold
 * a whole canvas (the offline backlog); every later message gets the
 * message cap, so step 2 can't be replayed to push megabytes at a time.
 */
export function messageByteCap(message: Uint8Array, firstStep2: boolean): number {
  return firstStep2 && isSyncStep2(message)
    ? CANVAS_LIMITS.maxStateBytes
    : CANVAS_LIMITS.maxMessageBytes;
}

/** Checks one incoming message against its byte cap and its connection's bucket. */
export function createMessageLimiter(now: () => number) {
  const state = new WeakMap<object, { bucket: TokenBucket; step2Seen: boolean }>();
  return (connection: object, message: Uint8Array): void => {
    let entry = state.get(connection);
    if (!entry) {
      entry = {
        bucket: new TokenBucket(SYNC_LIMITS.messagesPerSecond, SYNC_LIMITS.messageBurst, now()),
        step2Seen: false,
      };
      state.set(connection, entry);
    }
    const cap = messageByteCap(message, !entry.step2Seen);
    if (isSyncStep2(message)) entry.step2Seen = true;
    if (message.byteLength > cap) {
      throw new SyncRefusal(SYNC_CLOSE.tooLarge, "message too large", "size");
    }
    if (!entry.bucket.take(now())) {
      throw new SyncRefusal(SYNC_CLOSE.rateLimited, "too many messages", "rate");
    }
  };
}

/**
 * Bounds a live doc between stores. The size cap is otherwise only checked
 * when the debounced store runs, and until then every accepted update is
 * held in memory and relayed to peers. Incoming bytes are counted per doc;
 * each time they add up to the cap the doc is measured, so a doc is encoded
 * at most once per cap's worth of traffic and never grows much past it.
 */
export class DocumentGrowth {
  private readonly since = new Map<string, number>();

  constructor(private readonly maxBytes: number = CANVAS_LIMITS.maxStateBytes) {}

  /** Counts an incoming update; true when the doc is already over the cap. */
  exceeds(documentName: string, bytes: number, measure: () => number): boolean {
    const total = (this.since.get(documentName) ?? 0) + bytes;
    if (total <= this.maxBytes) {
      this.since.set(documentName, total);
      return false;
    }
    if (measure() > this.maxBytes) return true;
    this.since.set(documentName, bytes);
    return false;
  }

  /** A store measured and wrote the doc; count from zero again. */
  stored(documentName: string): void {
    this.since.delete(documentName);
  }

  forget(documentName: string): void {
    this.since.delete(documentName);
  }
}

/** Other instances' connections for a user. Fails open: errors read as zero. */
export interface UserConnectionLedger {
  othersCount(userId: string): Promise<number>;
  /** Records this instance's live count for a user; zero clears it. */
  record(userId: string, count: number): Promise<void>;
  close(): Promise<void>;
}

export const localLedger: UserConnectionLedger = {
  othersCount: async () => 0,
  record: async () => {},
  close: async () => {},
};

interface LiveConnections {
  forDocument(documentName: string): number;
  forUser(userId: string): number;
}

function tooManyForUser(): SyncRefusal {
  return new SyncRefusal(SYNC_CLOSE.rateLimited, "too many open canvases", "caps");
}

/** How long an admitted connection may wait for its document load to start, and then to be established once loaded, before its seat frees. */
export const RESERVATION_TTL_MS = 15_000;

/**
 * Connection caps. Live connections are counted from Hocuspocus's own
 * documents, so nothing here can drift from what is actually open; the only
 * state is a short reservation between admission and the connection being
 * established, so a burst of simultaneous connects can't all slip under the
 * cap. A reservation is freed when its connection is established, when its
 * socket closes, when its document fails to load, or when it expires. It
 * never expires while its document is loading, however long the load takes.
 */
export class ConnectionCaps {
  private readonly pending = new Map<
    string,
    { documentName: string; userId: string; expires: number; socket?: object; loading?: boolean }
  >();
  private readonly closedSockets = new WeakSet<object>();

  constructor(
    private readonly live: LiveConnections,
    private readonly ledger: UserConnectionLedger,
    private readonly now: () => number,
    private readonly limits: { perCanvas: number; perUser: number } = {
      perCanvas: SYNC_LIMITS.connectionsPerCanvas,
      perUser: SYNC_LIMITS.connectionsPerUser,
    },
  ) {}

  /** Expires stale reservations and rewrites their users' ledger counts, so other instances stop counting them. */
  private sweep(): void {
    const now = this.now();
    const expired = new Set<string>();
    for (const [key, entry] of this.pending) {
      if (entry.loading || entry.expires > now) continue;
      this.pending.delete(key);
      expired.add(entry.userId);
    }
    for (const userId of expired) void this.ledger.record(userId, this.localUserCount(userId));
  }

  private pendingFor(match: (entry: { documentName: string; userId: string }) => boolean): number {
    let count = 0;
    for (const entry of this.pending.values()) if (match(entry)) count++;
    return count;
  }

  documentCount(documentName: string): number {
    this.sweep();
    return (
      this.live.forDocument(documentName) + this.pendingFor((e) => e.documentName === documentName)
    );
  }

  localUserCount(userId: string): number {
    this.sweep();
    return this.live.forUser(userId) + this.pendingFor((e) => e.userId === userId);
  }

  pendingCount(): number {
    this.sweep();
    return this.pending.size;
  }

  /**
   * Admits a connection or throws a 4429 refusal. The seat is reserved
   * before the ledger round trip, so every connect arriving during it
   * counts the ones ahead of it. This instance's count, reservations
   * included, is written before the other instances' are read, so of two
   * instances admitting one user at once at least one sees the other.
   *
   * `socket` is whatever identifies the websocket the connect came in on;
   * once `socketClosed` has been called for it, nothing more is reserved.
   */
  async admit(seat: string, documentName: string, userId: string, socket?: object): Promise<void> {
    if (socket && this.closedSockets.has(socket)) return;
    if (this.documentCount(documentName) >= this.limits.perCanvas) {
      throw new SyncRefusal(SYNC_CLOSE.rateLimited, "too many people on this canvas", "caps");
    }
    if (this.localUserCount(userId) >= this.limits.perUser) {
      throw tooManyForUser();
    }
    this.pending.set(seat, {
      documentName,
      userId,
      expires: this.now() + RESERVATION_TTL_MS,
      socket,
    });
    void this.ledger.record(userId, this.localUserCount(userId));
    let admitted = false;
    try {
      const others = await this.ledger.othersCount(userId);
      const local = this.localUserCount(userId) - (this.pending.has(seat) ? 1 : 0);
      if (local + others >= this.limits.perUser) throw tooManyForUser();
      admitted = true;
    } finally {
      if (!admitted) this.drop(seat, userId);
    }
  }

  /** The connection is established and now counted live. */
  confirm(seat: string, userId: string): void {
    this.pending.delete(seat);
    void this.ledger.record(userId, this.localUserCount(userId));
  }

  /** Frees a seat whose connection will never be established. */
  drop(seat: string, userId: string): void {
    if (this.pending.delete(seat)) void this.ledger.record(userId, this.localUserCount(userId));
  }

  /** The seat's document is loading; it holds its seat until the load settles. */
  loadStarted(context: { seat?: string } | undefined): void {
    const entry = context?.seat ? this.pending.get(context.seat) : undefined;
    if (entry) entry.loading = true;
  }

  /** The seat's document loaded; the connection gets a fresh TTL to be established. */
  loaded(context: { seat?: string } | undefined): void {
    const entry = context?.seat ? this.pending.get(context.seat) : undefined;
    if (!entry) return;
    entry.loading = false;
    entry.expires = this.now() + RESERVATION_TTL_MS;
  }

  /** The seat's document failed to load, so its connection will never be established. */
  loadFailed(context: { seat?: string; userId?: string } | undefined): void {
    if (context?.seat && context.userId) this.drop(context.seat, context.userId);
  }

  /** A websocket closed: its seats still waiting for a connection free now. */
  socketClosed(socket: object): void {
    this.closedSockets.add(socket);
    for (const [seat, entry] of this.pending) {
      if (entry.socket === socket) this.drop(seat, entry.userId);
    }
  }

  released(userId: string): void {
    void this.ledger.record(userId, this.localUserCount(userId));
  }
}
