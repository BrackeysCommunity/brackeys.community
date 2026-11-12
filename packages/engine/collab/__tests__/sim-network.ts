import * as Y from "yjs";

import type { OpenDoc } from "../project-session";
import type { AwarenessLike } from "../types";

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

/** An awareness that holds only its own client's state. */
function soloAwareness(doc: Y.Doc): AwarenessLike {
  const states = new Map<number, Record<string, unknown>>();
  return {
    clientID: doc.clientID,
    getLocalState: () => states.get(doc.clientID) ?? null,
    setLocalStateField: (field, value) =>
      void states.set(doc.clientID, { ...states.get(doc.clientID), [field]: value }),
    getStates: () => states,
    on() {},
    off() {},
  };
}

/**
 * A project's docs on simulated networks: one `SimNetwork` per doc name,
 * all drawing on one RNG, each with `count` copies. Copy `i` of every doc
 * is client `i`'s; a partition cuts a client off on every doc, including
 * docs first opened while it holds.
 */
export class SimProject {
  private readonly nets = new Map<string, SimNetwork>();
  private readonly groups: number[][] = [];
  /** How many partitions there have been, so a test can tell its runs hit some. */
  partitions = 0;

  constructor(
    readonly count: number,
    readonly rand: () => number,
    private readonly initial: Readonly<Record<string, Y.Doc>> = {},
  ) {
    for (const name of Object.keys(initial)) this.net(name);
  }

  /** The network of one doc, made on first use from its initial state (empty when there is none). */
  net(name: string): SimNetwork {
    let net = this.nets.get(name);
    if (!net) {
      net = new SimNetwork(this.count, this.rand, this.initial[name]);
      for (const group of this.groups) net.partition(group);
      this.nets.set(name, net);
    }
    return net;
  }

  /** Client `i`'s copy of a doc. */
  doc(name: string, i: number): Y.Doc {
    return this.net(name).docs[i]!;
  }

  /** Client `i`'s `openDoc`, for a project session. */
  openDoc(i: number): OpenDoc {
    return async (name) => {
      const doc = this.doc(name, i);
      return { doc, awareness: soloAwareness(doc), close() {} };
    };
  }

  /** Delivers up to `n` queued messages on every doc's network. */
  deliver(n = 1): void {
    for (const net of this.nets.values()) net.deliver(n);
  }

  /** Cuts `group` off from the rest on every doc. */
  partition(group: number[]): void {
    this.groups.push(group);
    this.partitions++;
    for (const net of this.nets.values()) net.partition(group);
  }

  /** Restores every link on every doc and syncs each pair. */
  heal(): void {
    this.groups.length = 0;
    for (const net of this.nets.values()) net.heal();
  }

  /** One step of network weather: a few random deliveries, now and then a partition or a heal. */
  weather(partitionOdds = 0.1, healOdds = 0.1): void {
    this.deliver(Math.floor(this.rand() * 4));
    const roll = this.rand();
    if (roll < partitionOdds) this.partition([Math.floor(this.rand() * this.count)]);
    else if (roll < partitionOdds + healOdds) this.heal();
  }

  /** Delivers and heals until every copy of every doc holds every update, including writes the deliveries caused. */
  settle(): void {
    this.groups.length = 0;
    do for (const net of this.nets.values()) net.settle();
    while ([...this.nets.values()].some((net) => net.pending > 0));
  }
}
