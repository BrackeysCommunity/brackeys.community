import * as Y from "yjs";

/** The origin updates arrive with from the simulated network. */
export const NET = Symbol("net");

/**
 * An in-memory network of docs with a seeded RNG: each local update is
 * queued for every peer and delivered in random order; links can be cut,
 * and a reconnect exchanges state vectors as a provider's sync step does.
 */
export class SimNetwork {
  readonly docs: Y.Doc[];
  private readonly inbox: { from: number; to: number; update: Uint8Array }[] = [];
  private readonly cut = new Set<string>();

  constructor(
    count: number,
    private readonly rand: () => number,
    seed?: Y.Doc,
  ) {
    this.docs = Array.from({ length: count }, (_, i) => {
      const doc = new Y.Doc();
      doc.clientID = 1000 + i;
      if (seed) Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed), NET);
      doc.on("update", (update: Uint8Array, origin: unknown) => {
        if (origin === NET) return;
        for (let to = 0; to < count; to++) if (to !== i) this.inbox.push({ from: i, to, update });
      });
      return doc;
    });
  }

  private link(a: number, b: number) {
    return a < b ? `${a}-${b}` : `${b}-${a}`;
  }

  /** Cuts every link between `group` and the rest. Queued messages across the cut are dropped. */
  partition(group: number[]): void {
    for (const a of group)
      for (let b = 0; b < this.docs.length; b++)
        if (!group.includes(b)) this.cut.add(this.link(a, b));
  }

  /** Restores every link and syncs each pair by state vector. */
  heal(): void {
    this.cut.clear();
    for (let a = 0; a < this.docs.length; a++)
      for (let b = 0; b < this.docs.length; b++) if (a !== b) this.syncPair(a, b);
  }

  private syncPair(a: number, b: number): void {
    const update = Y.encodeStateAsUpdate(this.docs[a]!, Y.encodeStateVector(this.docs[b]!));
    Y.applyUpdate(this.docs[b]!, update, NET);
  }

  /** Delivers up to `n` queued messages, picked at random. */
  deliver(n = 1): void {
    for (let i = 0; i < n && this.inbox.length > 0; i++) {
      const at = Math.floor(this.rand() * this.inbox.length);
      const [msg] = this.inbox.splice(at, 1);
      if (this.cut.has(this.link(msg!.from, msg!.to))) continue;
      Y.applyUpdate(this.docs[msg!.to]!, msg!.update, NET);
    }
  }

  /** Delivers everything, then heals, so every doc holds every update. */
  settle(): void {
    while (this.inbox.length > 0) this.deliver(this.inbox.length);
    this.heal();
  }

  get pending(): number {
    return this.inbox.length;
  }
}
