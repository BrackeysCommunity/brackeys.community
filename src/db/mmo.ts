import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * The Discord MMO's game state (`services/mmo-world`), written only by the
 * world service. No table is shared with the site, and nothing here is
 * secret: the world row holds a key version, never a key or a seed.
 */
export const mmoSchema = pgSchema("mmo");

const worldId = () => text("world_id").notNull();
const big = (name: string) => bigint(name, { mode: "number" });

/** One row per world: its clock and the world-level state. */
export const mmoWorld = mmoSchema.table("world", {
  id: text("id").primaryKey(),
  keyVersion: integer("key_version").notNull(),
  // HMAC under the world's keys: a service with the wrong master secret refuses the world.
  keyCheck: text("key_check").notNull(),
  rulesEpoch: integer("rules_epoch").notNull(),
  tick: big("tick").notNull().default(0),
  season: integer("season").notNull().default(0),
  // A disposable world may be wiped: by an operator's reset, or at start-up when its sheets changed.
  disposable: boolean("disposable").notNull().default(true),
  sheetsDigest: text("sheets_digest").notNull(),
  // Tick n falls due at startedAt + n * tickSeconds.
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  tickSeconds: integer("tick_seconds").notNull(),
  // Everything of the game not in the tables below, as the sim's JSON.
  sim: jsonb("sim").notNull(),
  digest: text("digest").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A region inside the horizon: its gauges, holder and weather. */
export const mmoRegionState = mmoSchema.table(
  "region_state",
  {
    worldId: worldId(),
    region: integer("region").notNull(),
    latticeI: integer("lattice_i").notNull(),
    latticeJ: integer("lattice_j").notNull(),
    body: jsonb("body").notNull(),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.region] })],
);

export const mmoFaction = mmoSchema.table(
  "faction",
  {
    worldId: worldId(),
    idx: integer("idx").notNull(),
    body: jsonb("body").notNull(),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.idx] })],
);

export const mmoNotable = mmoSchema.table(
  "notable",
  {
    worldId: worldId(),
    faction: integer("faction").notNull(),
    idx: integer("idx").notNull(),
    body: jsonb("body").notNull(),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.faction, t.idx] })],
);

/** A tile that differs from its baseline, by axial coordinates (GDD 4.10). */
export const mmoTile = mmoSchema.table(
  "tile",
  {
    worldId: worldId(),
    q: integer("q").notNull(),
    r: integer("r").notNull(),
    // The order the world first stored it in, which its digest depends on.
    seq: big("seq").notNull(),
    foundTick: big("found_tick"),
    body: jsonb("body").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.worldId, t.q, t.r] }),
    index("tile_world_seq_idx").on(t.worldId, t.seq),
  ],
);

/**
 * A character. The Discord user id lives here and nowhere else in the game
 * (GDD 14.9): facts and the ledger name the character.
 */
export const mmoCharacter = mmoSchema.table(
  "character",
  {
    worldId: worldId(),
    id: text("id").notNull(),
    discordId: text("discord_id").notNull(),
    version: big("version").notNull(),
    q: integer("q").notNull(),
    r: integer("r").notNull(),
    banned: boolean("banned").notNull().default(false),
    body: jsonb("body").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.worldId, t.id] }),
    unique("character_world_discord_uq").on(t.worldId, t.discordId),
  ],
);

/**
 * A saved NPC (GDD 4.18): an NPC exists as a keyed draw until its first
 * conversation, when it gets a row. Rows change only when someone meets it.
 */
export const mmoNpc = mmoSchema.table(
  "npc",
  {
    worldId: worldId(),
    seq: big("seq").notNull(),
    id: text("id").notNull(),
    body: jsonb("body").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.worldId, t.seq] }),
    unique("npc_world_id_uq").on(t.worldId, t.id),
  ],
);

/**
 * The fact log (GDD 12.1), append-only. The migration partitions it by month
 * of `at`; the world service creates each month's partition ahead of time.
 */
export const mmoFact = mmoSchema.table(
  "fact",
  {
    worldId: worldId(),
    id: big("id").notNull(),
    tick: big("tick").notNull(),
    kind: text("kind").notNull(),
    region: text("region"),
    weight: integer("weight").notNull(),
    subjects: jsonb("subjects").notNull(),
    data: jsonb("data").notNull(),
    causes: jsonb("causes").notNull(),
    stagedBy: jsonb("staged_by"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.worldId, t.id, t.at] }),
    index("fact_world_tick_idx").on(t.worldId, t.tick),
    index("fact_world_weight_idx").on(t.worldId, t.weight, t.tick),
    index("fact_world_region_idx").on(t.worldId, t.region, t.id.desc()),
    index("fact_subjects_idx").using("gin", t.subjects.op("jsonb_path_ops")),
  ],
);

/** A ledger transaction (GDD 10.1): unique on its idempotency key. */
export const mmoLedgerTxn = mmoSchema.table(
  "ledger_txn",
  {
    worldId: worldId(),
    txn: big("txn").notNull(),
    key: text("key").notNull(),
    tick: big("tick").notNull(),
    kind: text("kind").notNull(),
    factId: big("fact_id"),
  },
  (t) => [
    primaryKey({ columns: [t.worldId, t.txn] }),
    unique("ledger_txn_world_key_uq").on(t.worldId, t.key),
  ],
);

/** One leg of a transaction; a transaction's legs sum to zero per asset. */
export const mmoLedgerEntry = mmoSchema.table(
  "ledger_entry",
  {
    worldId: worldId(),
    txn: big("txn").notNull(),
    leg: integer("leg").notNull(),
    account: text("account").notNull(),
    asset: text("asset").notNull(),
    units: big("units").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.worldId, t.txn, t.leg] }),
    index("ledger_entry_world_account_idx").on(t.worldId, t.account),
  ],
);

/**
 * Every accepted command, in order, with the tick it came after: what a
 * replay re-runs. Unique on the interaction id, so a double press writes once
 * and gets the stored reply.
 */
export const mmoAction = mmoSchema.table(
  "action",
  {
    worldId: worldId(),
    seq: big("seq").notNull(),
    interactionId: text("interaction_id").notNull(),
    afterTick: big("after_tick").notNull(),
    characterId: text("character_id").notNull(),
    kind: text("kind").notNull(),
    command: jsonb("command").notNull(),
    reply: jsonb("reply").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.worldId, t.seq] }),
    unique("action_world_interaction_uq").on(t.worldId, t.interactionId),
    index("action_world_tick_idx").on(t.worldId, t.afterTick),
  ],
);

/**
 * The public log of every staff, admin and operator command (GDD 14.8),
 * written in the same transaction as its action row. Unique on the
 * interaction id, so a command sent twice logs once. Every row is kept.
 */
export const mmoHouseLog = mmoSchema.table(
  "house_log",
  {
    worldId: worldId(),
    id: bigserial("id", { mode: "number" }).notNull(),
    // "" for an operator command, which speaks for no server.
    server: text("server").notNull(),
    tick: big("tick").notNull(),
    key: text("key").notNull(),
    characterId: text("character_id").notNull().default(""),
    discordId: text("discord_id").notNull().default(""),
    role: text("role").notNull(),
    kind: text("kind").notNull(),
    what: text("what").notNull(),
    points: big("points").notNull().default(0),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.worldId, t.id] }),
    uniqueIndex("house_log_world_key_uq").on(t.worldId, t.key),
    index("house_log_world_server_idx").on(t.worldId, t.server, t.id),
  ],
);

/**
 * Last-seen records of the live map (GDD 4.11): per character or guild and
 * tile, the live layers as last seen and the tick the tile left sight.
 * Written only when the holder's sight key changes; a view, never game state.
 */
export const mmoMapSeen = mmoSchema.table(
  "map_seen",
  {
    worldId: worldId(),
    holderKind: text("holder_kind").notNull(),
    holderId: text("holder_id").notNull(),
    q: big("q").notNull(),
    r: big("r").notNull(),
    chunkA: big("chunk_a").notNull(),
    chunkB: big("chunk_b").notNull(),
    leftTick: big("left_tick").notNull(),
    live: jsonb("live").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.worldId, t.holderKind, t.holderId, t.q, t.r] }),
    index("map_seen_world_holder_chunk_idx").on(
      t.worldId,
      t.holderKind,
      t.holderId,
      t.chunkA,
      t.chunkB,
    ),
  ],
);

/** Each holder's sight key, so a restart knows what it last saw. */
export const mmoMapSight = mmoSchema.table(
  "map_sight",
  {
    worldId: worldId(),
    holderKind: text("holder_kind").notNull(),
    holderId: text("holder_id").notNull(),
    key: jsonb("key").notNull(),
    tick: big("tick").notNull(),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.holderKind, t.holderId] })],
);

/** Each tick run: the digest it reached, for replays to compare. */
export const mmoTick = mmoSchema.table(
  "tick",
  {
    worldId: worldId(),
    tick: big("tick").notNull(),
    digest: text("digest").notNull(),
    facts: integer("facts").notNull(),
    ms: integer("ms").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.tick] })],
);

/** The whole game at a world day's turn: where a replay starts. */
export const mmoSnapshot = mmoSchema.table(
  "snapshot",
  {
    worldId: worldId(),
    tick: big("tick").notNull(),
    // The action seq the snapshot includes, so a replay starts after it.
    seq: big("seq").notNull(),
    digest: text("digest").notNull(),
    body: jsonb("body").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.tick] })],
);

/**
 * A rules epoch's notes (GDD 18.5), one per world and season: the books and
 * roll epochs before and after, and the changes players are told of. Kept
 * because the old book is gone once the operator moves the world onto the
 * new one.
 */
export const mmoEpochNote = mmoSchema.table(
  "epoch_note",
  {
    worldId: worldId(),
    season: big("season").notNull(),
    fromDigest: text("from_digest").notNull(),
    toDigest: text("to_digest").notNull(),
    rollFrom: integer("roll_from").notNull(),
    rollTo: integer("roll_to").notNull(),
    notes: jsonb("notes").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.worldId, t.season] })],
);
