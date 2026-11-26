package service

import (
	"context"
	"maps"
	"slices"

	"jams.team/mmo-world/mapview"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/gen"
)

// Game is the held game, for a test that sets a scene no command reaches.
func (s *Server) Game() *game.Game { return s.g }

// Hold takes the world as a tick being saved would, until the returned
// func lets it go.
func (s *Server) Hold() func() {
	s.mu.Lock()
	return s.mu.Unlock
}

// PlayerFacts is the reply filter that drops pin and thread facts and
// what the actor may not read.
var PlayerFacts = playerFacts

// VariantSeen is the name and row a fight shows for a region's variant.
var VariantSeen = variantSeen

// ScrubFirsts drops other characters from the FirstKinds facts a reply holds.
var ScrubFirsts = scrubFirsts

// VaultMarks is a machine's vault place and who staged it.
var VaultMarks = vaultMarks

// MapPass runs the view pass over every holder, as a saved tick does.
func (s *Server) MapPass(ctx context.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.mapPass(ctx, nil)
}

// MapCount is how many last-seen records the world keeps.
func (s *Server) MapCount(ctx context.Context) (int64, error) { return s.mapCount(ctx) }

// MapKeys are the sight keys the last saved pass kept; the caller holds
// the world (Hold).
func (s *Server) MapKeys() map[mapview.Holder]mapview.Key { return cloneKeys(s.sight.saved) }

// MapOwed is how many passes wait to be written; the caller holds the
// world (Hold).
func (s *Server) MapOwed() int { return len(s.sight.owed) }

// SightOwedMost is how many passes may be owed before they are dropped.
const SightOwedMost = sightOwedMost

// MapSeen are a viewer's records in some chunks, as the map reads them.
func (s *Server) MapSeen(ctx context.Context, characterID, guildID string, chunks []gen.ChunkCoord) ([]mapview.Record, error) {
	return s.mapSeen(ctx, characterID, guildID, chunks)
}

// MapCount is how many last-seen records the Local keeps.
func (l *Local) MapCount(ctx context.Context) (int64, error) { return l.mapCount(ctx) }

// MapKeys are the sight keys the Local's last pass kept.
func (l *Local) MapKeys() map[mapview.Holder]mapview.Key { return cloneKeys(l.sight.keys) }

// MapSeen are a viewer's records in some chunks, as the map reads them.
func (l *Local) MapSeen(ctx context.Context, characterID, guildID string, chunks []gen.ChunkCoord) ([]mapview.Record, error) {
	return l.mapSeen(ctx, characterID, guildID, chunks)
}

// DecodeSightKey and EncodeSightKey read and write a sight key as
// map_sight stores it.
var (
	DecodeSightKey = decodeKey
	EncodeSightKey = encodeKey
)

func cloneKeys(keys map[mapview.Holder]mapview.Key) map[mapview.Holder]mapview.Key {
	out := make(map[mapview.Holder]mapview.Key, len(keys))
	for h, k := range maps.All(keys) {
		out[h] = slices.Clone(k)
	}
	return out
}
