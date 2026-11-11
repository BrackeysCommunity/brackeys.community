import * as Y from "yjs";

/**
 * Which seed a doc grew from. The server that seeds a doc stamps it with one
 * item written by a client id of its own (`SEED_ROOT`'s keys), so every
 * client that synced from that seed holds the item, and a client whose doc
 * came from another seed (its history from before the server reseeded the
 * doc: a lost cache, a reset row) doesn't. Such a client is refused before
 * either side merges the other's state, and resets to the server's.
 */

/** The root map holding a doc's seed stamps: each key is a stamp's client id. */
export const SEED_ROOT = "seed";

/** The close code a server refuses a client from another seed with. */
export const SEED_STALE_CODE = 4409;

/** Its close reason, as a doc's close message carries it (the per-doc close loses the code). */
export const SEED_STALE_REASON = `${SEED_STALE_CODE} seed-stale`;

/** The y-protocols sync step that carries a client's state vector. */
const SYNC_STEP_1 = 0;

/**
 * - `empty`: the client holds nothing yet.
 * - `unstamped`: the server's doc carries no stamp, so nothing can be judged.
 * - `same`: the client holds one of the doc's stamps.
 * - `stale`: the client holds history, none of it from this doc's seed.
 */
export type SeedVerdict = "empty" | "unstamped" | "same" | "stale";

export class SeedStaleError extends Error {
  /** Read by Hocuspocus when it closes the connection over a thrown hook. */
  readonly code = SEED_STALE_CODE;
  readonly reason = SEED_STALE_REASON;
  constructor(documentName?: string) {
    super(
      `${documentName ?? "the doc"}: the client's copy came from another seed; it resets to the server's`,
    );
    this.name = "SeedStaleError";
    this.stack = `SeedStaleError: ${this.message}`;
  }
}

/** The client ids of a doc's seed stamps; more than one only where two seeds were merged before. */
export function seedsOf(doc: Y.Doc): number[] {
  const out: number[] = [];
  for (const key of doc.getMap(SEED_ROOT).keys()) {
    const client = Number(key);
    if (Number.isInteger(client) && client > 0) out.push(client);
  }
  return out.sort((a, b) => a - b);
}

const svOf = (sv: Uint8Array | ReadonlyMap<number, number>): ReadonlyMap<number, number> =>
  sv instanceof Uint8Array ? Y.decodeStateVector(sv) : sv;

/** Whether a client with state vector `sv` holds history from the seed `doc` grew from. */
export function seedVerdict(doc: Y.Doc, sv: Uint8Array | ReadonlyMap<number, number>): SeedVerdict {
  const held = svOf(sv);
  let any = false;
  for (const clock of held.values()) if (clock > 0) any = true;
  if (!any) return "empty";
  const seeds = seedsOf(doc);
  if (seeds.length === 0) return "unstamped";
  return seeds.some((client) => (held.get(client) ?? 0) > 0) ? "same" : "stale";
}

/** FNV-1a over a canonical state vector: equal seeds get equal stamps on every server. */
function stampClient(sv: ReadonlyMap<number, number>): number {
  const text = [...sv]
    .sort((a, b) => a[0] - b[0])
    .map(([client, clock]) => `${client}:${clock}`)
    .join(",");
  let salt = 0;
  for (;;) {
    let hash = 0x811c9dc5;
    for (const ch of `${SEED_ROOT}\n${salt}\n${text}`) {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    if (hash !== 0 && !sv.has(hash)) return hash;
    salt++;
  }
}

/** The update that stamps a doc whose state vector is `sv`, written as the stamp's own client. */
function stampUpdate(sv: ReadonlyMap<number, number>): { client: number; update: Uint8Array } {
  const client = stampClient(sv);
  const scratch = new Y.Doc();
  scratch.clientID = client;
  scratch.getMap(SEED_ROOT).set(String(client), true);
  return { client, update: Y.encodeStateAsUpdate(scratch) };
}

/**
 * Stamps a freshly loaded doc with its seed, unless it carries a stamp
 * already (one persisted with its state). The stamp's client id derives
 * from the doc's state vector, so two servers stamping one seed write the
 * same item. Returns whether it stamped. Call before any client syncs.
 */
export function stampSeed(doc: Y.Doc, origin?: unknown): boolean {
  if (seedsOf(doc).length > 0) return false;
  const { update } = stampUpdate(Y.decodeStateVector(Y.encodeStateVector(doc)));
  Y.applyUpdate(doc, update, origin);
  return true;
}

/** `stampSeed` over an encoded state: the same bytes when it carries a stamp already. */
export function stampSeedState(state: Uint8Array): Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return stampSeed(doc) ? Y.encodeStateAsUpdate(doc) : state;
}

/**
 * A server's `beforeSync` check: throws `SeedStaleError` for a client's
 * first sync step whose state vector holds history but none of the doc's
 * seed, before the server answers it or merges anything back.
 */
export function assertSameSeed(message: {
  type: number;
  payload: Uint8Array;
  document: Y.Doc;
  documentName?: string;
}): void {
  if (message.type !== SYNC_STEP_1) return;
  if (seedVerdict(message.document, message.payload) === "stale")
    throw new SeedStaleError(message.documentName);
}

/** Whether a doc's close is a server refusing this client's copy as another seed's. */
export function isSeedStaleClose(code: number | null, reason?: string): boolean {
  return code === SEED_STALE_CODE || (reason ?? "").startsWith(SEED_STALE_REASON);
}
