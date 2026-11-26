package store

import (
	"context"

	"jams.team/mmo-world/store/db"
)

// SeenRow is one last-seen record as stored.
type SeenRow struct {
	Kind, ID   string
	Q, R, A, B int64
	Left       int64
	Live       []byte // api.MapLive JSON
}

// SightRow is one holder's stored sight key.
type SightRow struct {
	Kind, ID string
	Key      []byte
	Tick     int64
}

// SaveSight writes one pass in one transaction: each holder's leaving
// tiles and new key, and the holders gone. A tile named twice for one
// holder keeps its last row, since one upsert cannot touch a row twice.
func (s *Store) SaveSight(ctx context.Context, tick int64, seen []SeenRow, keys []SightRow, gone [][2]string) error {
	type tile struct {
		kind, id string
		q, r     int64
	}
	type seenBatch struct {
		kind, id string
		left     int64
	}
	last := make(map[tile]int, len(seen))
	for i, x := range seen {
		last[tile{x.Kind, x.ID, x.Q, x.R}] = i
	}
	var order []seenBatch
	batches := map[seenBatch]*db.UpsertMapSeenParams{}
	for i, x := range seen {
		if last[tile{x.Kind, x.ID, x.Q, x.R}] != i {
			continue
		}
		k := seenBatch{x.Kind, x.ID, x.Left}
		p := batches[k]
		if p == nil {
			p = &db.UpsertMapSeenParams{WorldID: s.World, HolderKind: x.Kind, HolderID: x.ID, LeftTick: x.Left}
			batches[k] = p
			order = append(order, k)
		}
		p.Qs, p.Rs = append(p.Qs, x.Q), append(p.Rs, x.R)
		p.ChunkAs, p.ChunkBs = append(p.ChunkAs, x.A), append(p.ChunkBs, x.B)
		p.Lives = append(p.Lives, x.Live)
	}
	return s.tx(ctx, func(q *db.Queries) error {
		for _, k := range order {
			if err := q.UpsertMapSeen(ctx, *batches[k]); err != nil {
				return err
			}
		}
		for _, k := range keys {
			if err := q.UpsertMapSight(ctx, db.UpsertMapSightParams{WorldID: s.World, HolderKind: k.Kind, HolderID: k.ID, Key: k.Key, Tick: tick}); err != nil {
				return err
			}
		}
		for _, h := range gone {
			if err := q.DeleteMapHolderSeen(ctx, db.DeleteMapHolderSeenParams{WorldID: s.World, HolderKind: h[0], HolderID: h[1]}); err != nil {
				return err
			}
			if err := q.DeleteMapHolderSight(ctx, db.DeleteMapHolderSightParams{WorldID: s.World, HolderKind: h[0], HolderID: h[1]}); err != nil {
				return err
			}
		}
		return nil
	})
}

// SeenIn are a character's and a guild's records in some chunks, ordered
// by holder, then r, then q. An empty id matches no holder.
func (s *Store) SeenIn(ctx context.Context, characterID, guildID string, chunks [][2]int64) ([]SeenRow, error) {
	if len(chunks) == 0 || (characterID == "" && guildID == "") {
		return nil, nil
	}
	p := db.MapSeenInParams{WorldID: s.World, CharacterID: characterID, GuildID: guildID,
		ChunkAs: make([]int64, len(chunks)), ChunkBs: make([]int64, len(chunks))}
	for i, c := range chunks {
		p.ChunkAs[i], p.ChunkBs[i] = c[0], c[1]
	}
	rows, err := s.q.MapSeenIn(ctx, p)
	if err != nil {
		return nil, err
	}
	out := make([]SeenRow, len(rows))
	for i, x := range rows {
		out[i] = SeenRow{Kind: x.HolderKind, ID: x.HolderID, Q: x.Q, R: x.R, A: x.ChunkA, B: x.ChunkB, Left: x.LeftTick, Live: x.Live}
	}
	return out, nil
}

// Sights are every holder's stored key.
func (s *Store) Sights(ctx context.Context) ([]SightRow, error) {
	rows, err := s.q.MapSights(ctx, s.World)
	if err != nil {
		return nil, err
	}
	out := make([]SightRow, len(rows))
	for i, x := range rows {
		out[i] = SightRow{Kind: x.HolderKind, ID: x.HolderID, Key: x.Key, Tick: x.Tick}
	}
	return out, nil
}

// CountSeen is how many records the world keeps.
func (s *Store) CountSeen(ctx context.Context) (int64, error) {
	return s.q.CountMapSeen(ctx, s.World)
}
