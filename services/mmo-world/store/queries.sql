-- name: GetWorld :one
SELECT * FROM mmo.world WHERE id = $1;

-- name: WorldTick :one
SELECT tick FROM mmo.world WHERE id = $1;

-- name: InsertWorld :exec
INSERT INTO mmo.world (id, key_version, key_check, rules_epoch, tick, sheets_digest, started_at, tick_seconds, sim, digest, disposable)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);

-- name: SaveWorld :execrows
-- Every save changes the digest, so a writer whose last save is not the
-- stored one matches no row.
UPDATE mmo.world SET tick = @tick, sim = @sim, digest = @digest, updated_at = now()
WHERE id = @id AND tick = @was AND digest = @was_digest;

-- name: RestampSheets :execrows
-- Moves a kept world onto new sheets only from the exact digest it ran on.
UPDATE mmo.world SET sheets_digest = @to_digest, updated_at = now()
WHERE id = @id AND sheets_digest = @from_digest;

-- name: RestampEpoch :execrows
-- Moves a kept world onto a new book and roll epoch together, only from the
-- exact stamp it ran on.
UPDATE mmo.world SET sheets_digest = @to_digest, rules_epoch = @to_epoch, updated_at = now()
WHERE id = @id AND sheets_digest = @from_digest AND rules_epoch = @from_epoch;

-- name: ListRegions :many
SELECT * FROM mmo.region_state WHERE world_id = $1 ORDER BY region;

-- name: UpsertRegion :exec
INSERT INTO mmo.region_state (world_id, region, lattice_i, lattice_j, body) VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (world_id, region) DO UPDATE SET lattice_i = excluded.lattice_i, lattice_j = excluded.lattice_j, body = excluded.body;

-- name: ListFactions :many
SELECT * FROM mmo.faction WHERE world_id = $1 ORDER BY idx;

-- name: UpsertFaction :exec
INSERT INTO mmo.faction (world_id, idx, body) VALUES ($1, $2, $3)
ON CONFLICT (world_id, idx) DO UPDATE SET body = excluded.body;

-- name: ListNotables :many
SELECT * FROM mmo.notable WHERE world_id = $1 ORDER BY faction, idx;

-- name: UpsertNotable :exec
INSERT INTO mmo.notable (world_id, faction, idx, body) VALUES ($1, $2, $3, $4)
ON CONFLICT (world_id, faction, idx) DO UPDATE SET body = excluded.body;

-- name: DeleteNotable :exec
DELETE FROM mmo.notable WHERE world_id = $1 AND faction = $2 AND idx = $3;

-- name: ListTiles :many
SELECT * FROM mmo.tile WHERE world_id = $1 ORDER BY seq;

-- name: UpsertTile :exec
INSERT INTO mmo.tile (world_id, q, r, seq, found_tick, body) VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (world_id, q, r) DO UPDATE SET seq = excluded.seq, found_tick = excluded.found_tick, body = excluded.body;

-- name: DeleteTile :exec
DELETE FROM mmo.tile WHERE world_id = $1 AND q = $2 AND r = $3;

-- name: ListCharacters :many
SELECT * FROM mmo.character WHERE world_id = $1 ORDER BY id;

-- A forgotten character's Discord id is a tombstone, 'forgotten:<id>'
-- (store.Tombstone): no read by or of a Discord id returns one.
-- name: CharacterByDiscord :one
SELECT id FROM mmo.character WHERE world_id = $1 AND discord_id = $2 AND discord_id NOT LIKE 'forgotten:%';

-- name: DiscordsOf :many
SELECT id, discord_id FROM mmo.character
WHERE world_id = @world_id AND id = ANY(@ids::text[]) AND discord_id NOT LIKE 'forgotten:%' ORDER BY id;

-- name: ForgetCharacterDiscord :one
-- Tombstones a character's Discord id and returns the id it held; no row
-- when it was forgotten before. The self-join reads the row as it was.
UPDATE mmo.character c SET discord_id = 'forgotten:' || c.id
FROM mmo.character o
WHERE c.world_id = @world_id AND c.id = @id AND o.world_id = c.world_id AND o.id = c.id AND c.discord_id NOT LIKE 'forgotten:%'
RETURNING o.discord_id;

-- name: ForgetHouseLogDiscord :execrows
UPDATE mmo.house_log SET discord_id = ''
WHERE world_id = @world_id AND discord_id <> '' AND (character_id = @character_id OR (@discord_id::text <> '' AND discord_id = @discord_id::text));

-- name: InsertCharacter :exec
INSERT INTO mmo.character (world_id, id, discord_id, version, q, r, banned, body) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: SaveCharacter :execrows
UPDATE mmo.character SET version = @version, q = @q, r = @r, banned = @banned, body = @body
WHERE world_id = @world_id AND id = @id AND version = @was;

-- name: ListNPCs :many
SELECT * FROM mmo.npc WHERE world_id = $1 ORDER BY seq;

-- name: UpsertNPC :exec
INSERT INTO mmo.npc (world_id, seq, id, body) VALUES ($1, $2, $3, $4)
ON CONFLICT (world_id, seq) DO UPDATE SET body = excluded.body;

-- name: DeleteWorldNPCs :exec
DELETE FROM mmo.npc WHERE world_id = $1;

-- name: FactsAbout :many
SELECT * FROM mmo.fact WHERE world_id = @world_id AND tick > @since AND subjects @> @subject::jsonb
ORDER BY id DESC LIMIT @lim;

-- name: HeavyFactsSince :many
SELECT * FROM mmo.fact WHERE world_id = @world_id AND tick > @since AND weight >= @weight
ORDER BY id DESC LIMIT @lim;

-- Pin facts (GDD 14.5) and other characters' threads (GDD 12.8) reach no
-- public read: hidden is store.Hidden as LIKE patterns.
-- name: RecentFactsIn :many
SELECT * FROM mmo.fact WHERE world_id = @world_id AND region = @region AND NOT (kind LIKE ANY (@hidden::text[]))
ORDER BY id DESC LIMIT @lim;

-- name: FactByID :one
SELECT * FROM mmo.fact WHERE world_id = @world_id AND id = @id LIMIT 1;

-- name: FactsByIDs :many
SELECT * FROM mmo.fact WHERE world_id = @world_id AND id = ANY(@ids::bigint[]) ORDER BY id;

-- The chronicle's facts of ticks [from, to), heaviest first (GDD 12.7).
-- name: ChronicleDay :many
SELECT * FROM mmo.fact WHERE world_id = @world_id AND weight >= @min_weight AND tick >= @from_tick AND tick < @to_tick
AND NOT (kind LIKE ANY (@hidden::text[]))
ORDER BY weight DESC, id DESC;

-- name: StoryFactsSince :many
SELECT * FROM mmo.fact WHERE world_id = @world_id AND id > @after AND kind = ANY(@kinds::text[])
ORDER BY id LIMIT @lim;

-- name: FactsBetween :many
SELECT * FROM mmo.fact WHERE world_id = @world_id AND tick >= @from_tick AND tick < @upto_tick ORDER BY id;

-- name: InsertFacts :copyfrom
INSERT INTO mmo.fact (world_id, id, tick, kind, region, weight, subjects, data, causes, staged_by, at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);

-- name: LastFactID :one
SELECT coalesce(max(id), 0)::bigint FROM mmo.fact WHERE world_id = $1;

-- name: InsertLedgerTxns :copyfrom
INSERT INTO mmo.ledger_txn (world_id, txn, key, tick, kind, fact_id) VALUES ($1, $2, $3, $4, $5, $6);

-- name: InsertLedgerEntries :copyfrom
INSERT INTO mmo.ledger_entry (world_id, txn, leg, account, asset, units) VALUES ($1, $2, $3, $4, $5, $6);

-- name: LedgerBalances :many
SELECT account, asset, sum(units)::bigint AS units FROM mmo.ledger_entry
WHERE world_id = $1 GROUP BY account, asset HAVING sum(units) <> 0 ORDER BY account, asset;

-- name: UnbalancedTxns :many
SELECT txn, asset, sum(units)::bigint AS units FROM mmo.ledger_entry
WHERE world_id = $1 GROUP BY txn, asset HAVING sum(units) <> 0 ORDER BY txn, asset;

-- name: LedgerOf :many
SELECT t.tick, t.kind, e.asset, e.units FROM mmo.ledger_entry e
JOIN mmo.ledger_txn t ON t.world_id = e.world_id AND t.txn = e.txn
WHERE e.world_id = $1 AND e.account = $2 ORDER BY e.txn DESC, e.leg LIMIT $3;

-- name: LastLedgerTxn :one
SELECT coalesce(max(txn), 0)::bigint FROM mmo.ledger_txn WHERE world_id = $1;

-- name: InsertAction :exec
INSERT INTO mmo.action (world_id, seq, interaction_id, after_tick, character_id, kind, command, reply)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: ActionReply :one
SELECT reply FROM mmo.action WHERE world_id = $1 AND interaction_id = $2;

-- name: ListActionsAfter :many
SELECT * FROM mmo.action WHERE world_id = @world_id AND seq > @seq AND after_tick < @upto ORDER BY seq;

-- name: ActionsBetween :many
SELECT * FROM mmo.action WHERE world_id = @world_id AND after_tick >= @from_tick AND after_tick < @upto_tick ORDER BY seq;

-- name: LastActionSeq :one
SELECT coalesce(max(seq), 0)::bigint FROM mmo.action WHERE world_id = $1;

-- The house log (GDD 14.8): one row per logged command, unique on its
-- interaction id, read in pages after an id.
-- name: InsertHouseLog :exec
INSERT INTO mmo.house_log (world_id, server, tick, key, character_id, discord_id, role, kind, what, points, at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);

-- name: HouseLogPage :many
SELECT * FROM mmo.house_log WHERE world_id = @world_id AND server = @server AND id > @after ORDER BY id LIMIT @lim;

-- name: HouseLogAll :many
SELECT * FROM mmo.house_log WHERE world_id = @world_id AND id > @after ORDER BY id LIMIT @lim;

-- Last-seen records of the live map, per holder (a character or a guild)
-- and tile, and each holder's sight key. Written by the view pass only.
-- name: UpsertMapSeen :exec
INSERT INTO mmo.map_seen (world_id, holder_kind, holder_id, q, r, chunk_a, chunk_b, left_tick, live)
SELECT @world_id, @holder_kind, @holder_id, unnest(@qs::bigint[]), unnest(@rs::bigint[]), unnest(@chunk_as::bigint[]),
       unnest(@chunk_bs::bigint[]), @left_tick, unnest(@lives::jsonb[])
ON CONFLICT (world_id, holder_kind, holder_id, q, r) DO UPDATE SET left_tick = EXCLUDED.left_tick, live = EXCLUDED.live,
  chunk_a = EXCLUDED.chunk_a, chunk_b = EXCLUDED.chunk_b;

-- name: MapSeenIn :many
SELECT * FROM mmo.map_seen WHERE world_id = @world_id
  AND ((holder_kind = 'character' AND holder_id = @character_id) OR (holder_kind = 'guild' AND holder_id = @guild_id))
  AND (chunk_a, chunk_b) IN (SELECT unnest(@chunk_as::bigint[]), unnest(@chunk_bs::bigint[]))
ORDER BY holder_kind, holder_id, r, q;

-- name: UpsertMapSight :exec
INSERT INTO mmo.map_sight (world_id, holder_kind, holder_id, key, tick) VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (world_id, holder_kind, holder_id) DO UPDATE SET key = EXCLUDED.key, tick = EXCLUDED.tick;

-- name: MapSights :many
SELECT * FROM mmo.map_sight WHERE world_id = $1 ORDER BY holder_kind, holder_id;

-- name: DeleteMapHolderSeen :exec
DELETE FROM mmo.map_seen WHERE world_id = $1 AND holder_kind = $2 AND holder_id = $3;

-- name: DeleteMapHolderSight :exec
DELETE FROM mmo.map_sight WHERE world_id = $1 AND holder_kind = $2 AND holder_id = $3;

-- name: CountMapSeen :one
SELECT count(*) FROM mmo.map_seen WHERE world_id = $1;

-- name: InsertTick :exec
INSERT INTO mmo.tick (world_id, tick, digest, facts, ms) VALUES ($1, $2, $3, $4, $5);

-- name: ListTicks :many
SELECT * FROM mmo.tick WHERE world_id = @world_id AND tick > @after AND tick <= @upto ORDER BY tick;

-- name: InsertSnapshot :exec
INSERT INTO mmo.snapshot (world_id, tick, seq, digest, body) VALUES ($1, $2, $3, $4, $5);

-- name: SnapshotAtOrBefore :one
SELECT * FROM mmo.snapshot WHERE world_id = $1 AND tick <= $2 ORDER BY tick DESC LIMIT 1;

-- name: SnapshotsBetween :many
SELECT * FROM mmo.snapshot WHERE world_id = @world_id AND tick >= @from_tick AND tick < @upto_tick ORDER BY tick;

-- name: WorldCounts :one
SELECT
  (SELECT count(*) FROM mmo.fact f WHERE f.world_id = @world_id)::bigint AS facts,
  (SELECT count(*) FROM mmo.ledger_txn t WHERE t.world_id = @world_id)::bigint AS ledger_txns,
  (SELECT count(*) FROM mmo.ledger_entry e WHERE e.world_id = @world_id)::bigint AS ledger_entries,
  (SELECT count(*) FROM mmo.action a WHERE a.world_id = @world_id)::bigint AS actions,
  (SELECT count(*) FROM mmo.tick k WHERE k.world_id = @world_id)::bigint AS ticks,
  (SELECT count(*) FROM mmo.snapshot s WHERE s.world_id = @world_id)::bigint AS snapshots,
  (SELECT coalesce(max(s.tick), -1) FROM mmo.snapshot s WHERE s.world_id = @world_id)::bigint AS last_snapshot_tick,
  (SELECT count(*) FROM mmo.character c WHERE c.world_id = @world_id)::bigint AS characters,
  (SELECT count(*) FROM mmo.house_log h WHERE h.world_id = @world_id)::bigint AS house_log;

-- A rules epoch's notes, one row per world and season (GDD 18.5). A second
-- write of a season's notes keeps the first one's time.
-- name: UpsertEpochNote :exec
INSERT INTO mmo.epoch_note (world_id, season, from_digest, to_digest, roll_from, roll_to, notes)
VALUES (@world_id, @season, @from_digest, @to_digest, @roll_from, @roll_to, @notes)
ON CONFLICT (world_id, season) DO UPDATE SET from_digest = EXCLUDED.from_digest, to_digest = EXCLUDED.to_digest,
  roll_from = EXCLUDED.roll_from, roll_to = EXCLUDED.roll_to, notes = EXCLUDED.notes;

-- name: EpochNoteFor :one
SELECT * FROM mmo.epoch_note WHERE world_id = @world_id AND season = @season;

-- name: TryLockWorld :one
SELECT pg_try_advisory_lock(hashtextextended(@world_id::text, 0));

-- name: UnlockWorld :one
SELECT pg_advisory_unlock(hashtextextended(@world_id::text, 0));

-- A world's rows, children first, then the world row.

-- name: DeleteWorldFacts :exec
DELETE FROM mmo.fact WHERE world_id = $1;

-- name: DeleteWorldLedgerEntries :exec
DELETE FROM mmo.ledger_entry WHERE world_id = $1;

-- name: DeleteWorldLedgerTxns :exec
DELETE FROM mmo.ledger_txn WHERE world_id = $1;

-- name: DeleteWorldActions :exec
DELETE FROM mmo.action WHERE world_id = $1;

-- name: DeleteWorldHouseLog :exec
DELETE FROM mmo.house_log WHERE world_id = $1;

-- name: DeleteWorldMapSeen :exec
DELETE FROM mmo.map_seen WHERE world_id = $1;

-- name: DeleteWorldMapSight :exec
DELETE FROM mmo.map_sight WHERE world_id = $1;

-- name: DeleteWorldEpochNotes :exec
DELETE FROM mmo.epoch_note WHERE world_id = $1;

-- name: DeleteWorldTicks :exec
DELETE FROM mmo.tick WHERE world_id = $1;

-- name: DeleteWorldSnapshots :exec
DELETE FROM mmo.snapshot WHERE world_id = $1;

-- name: DeleteWorldCharacters :exec
DELETE FROM mmo.character WHERE world_id = $1;

-- name: DeleteWorldTiles :exec
DELETE FROM mmo.tile WHERE world_id = $1;

-- name: DeleteWorldNotables :exec
DELETE FROM mmo.notable WHERE world_id = $1;

-- name: DeleteWorldFactions :exec
DELETE FROM mmo.faction WHERE world_id = $1;

-- name: DeleteWorldRegions :exec
DELETE FROM mmo.region_state WHERE world_id = $1;

-- name: DeleteWorld :exec
DELETE FROM mmo.world WHERE id = $1;
