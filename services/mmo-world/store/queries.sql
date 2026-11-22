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

-- name: CharacterByDiscord :one
SELECT id FROM mmo.character WHERE world_id = $1 AND discord_id = $2;

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

-- name: RecentFactsIn :many
SELECT * FROM mmo.fact WHERE world_id = @world_id AND region = @region AND kind NOT LIKE 'pin.%'
ORDER BY id DESC LIMIT @lim;

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

-- name: LastActionSeq :one
SELECT coalesce(max(seq), 0)::bigint FROM mmo.action WHERE world_id = $1;

-- name: InsertTick :exec
INSERT INTO mmo.tick (world_id, tick, digest, facts, ms) VALUES ($1, $2, $3, $4, $5);

-- name: ListTicks :many
SELECT * FROM mmo.tick WHERE world_id = @world_id AND tick > @after AND tick <= @upto ORDER BY tick;

-- name: InsertSnapshot :exec
INSERT INTO mmo.snapshot (world_id, tick, seq, digest, body) VALUES ($1, $2, $3, $4, $5);

-- name: SnapshotAtOrBefore :one
SELECT * FROM mmo.snapshot WHERE world_id = $1 AND tick <= $2 ORDER BY tick DESC LIMIT 1;

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
