package service

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/mapview"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/store"
)

// The view pass keeps the live map's last-seen records (GDD 4.11): after a
// tick or a command is saved, each holder whose sight key changed records
// the tiles that left its sight. It reads the game and writes only its own
// tables, so no outcome, draw or digest depends on it.

// placeFacts are the facts of a command that hands, founds, raises or ruins
// a place, or ends a guild: guild sight may change for holders the command
// never named, so every holder is passed.
var placeFacts = []string{"settlement.founded", "settlement.chartered", "settlement.ruined", "city.raised", "city.fell-back",
	"faction.city", "guild.installed", "guild.left"}

// passHolders are the holders a saved command can have changed: the
// characters it told and their guilds, or nil (every holder) when it moved
// a place between guilds.
func passHolders(g *game.Game, res game.Result) []mapview.Holder {
	if slices.ContainsFunc(res.Facts, func(f fact.Fact) bool { return slices.Contains(placeFacts, f.Kind) }) {
		return nil
	}
	out := []mapview.Holder{}
	for _, id := range told(res) {
		out = append(out, mapview.Holder{Kind: mapview.HolderCharacter, ID: id})
		if c := g.Char(id); c != nil && c.C.Guild != "" {
			out = append(out, mapview.Holder{Kind: mapview.HolderGuild, ID: c.C.Guild})
		}
	}
	return out
}

// storedKey is a sight key as map_sight keeps it: one [q, r, radius] per
// disc.
type storedKey [][3]int64

func encodeKey(k mapview.Key) ([]byte, error) {
	out := make(storedKey, len(k))
	for i, d := range k {
		out[i] = [3]int64{d.Q, d.R, d.Radius}
	}
	return json.Marshal(out)
}

func decodeKey(b []byte) (mapview.Key, error) {
	var in storedKey
	if err := json.Unmarshal(b, &in); err != nil {
		return nil, err
	}
	out := make(mapview.Key, len(in))
	for i, d := range in {
		out[i] = mapview.Disc{Q: d[0], R: d[1], Radius: d[2]}
	}
	return out, nil
}

// sightRows are a pass as the store writes it.
func sightRows(g *game.Game, changes []mapview.Change, gone []mapview.Holder) ([]store.SeenRow, []store.SightRow, [][2]string, error) {
	chunkOf := g.World.Gen().ChunkOf
	var seen []store.SeenRow
	keys := make([]store.SightRow, 0, len(changes))
	for _, c := range changes {
		key, err := encodeKey(c.Key)
		if err != nil {
			return nil, nil, nil, err
		}
		keys = append(keys, store.SightRow{Kind: c.Holder.Kind, ID: c.Holder.ID, Key: key})
		for _, r := range c.Seen {
			live, err := json.Marshal(r.Live)
			if err != nil {
				return nil, nil, nil, err
			}
			cc := chunkOf(r.Hex)
			seen = append(seen, store.SeenRow{Kind: c.Holder.Kind, ID: c.Holder.ID, Q: r.Hex.Q, R: r.Hex.R, A: cc.A, B: cc.B,
				Left: r.Left, Live: live})
		}
	}
	out := make([][2]string, len(gone))
	for i, h := range gone {
		out[i] = [2]string{h.Kind, h.ID}
	}
	return seen, keys, out, nil
}

// keep moves keys onto a pass's result.
func keep(keys map[mapview.Holder]mapview.Key, changes []mapview.Change, gone []mapview.Holder) {
	for _, c := range changes {
		keys[c.Holder] = c.Key
	}
	for _, h := range gone {
		delete(keys, h)
	}
}

// viewHolders are the holders a viewer reads records of: their character
// and, when they have one, their guild.
func viewHolders(characterID, guildID string) []mapview.Holder {
	var out []mapview.Holder
	if characterID != "" {
		out = append(out, mapview.Holder{Kind: mapview.HolderCharacter, ID: characterID})
	}
	if guildID != "" {
		out = append(out, mapview.Holder{Kind: mapview.HolderGuild, ID: guildID})
	}
	return out
}

// loadSight reads, under mu, every holder's stored key. A row that does not
// read is left out, so its holder is keyed again with no records.
func (s *Server) loadSight(ctx context.Context) error {
	rows, err := s.st.Sights(ctx)
	if err != nil {
		s.sight = nil
		return fmt.Errorf("service: reading the map's sight keys: %w", err)
	}
	keys := make(map[mapview.Holder]mapview.Key, len(rows))
	for _, r := range rows {
		k, err := decodeKey(r.Key)
		if err != nil {
			s.cfg.Log.Warn("a stored sight key does not read; keying it again", "kind", r.Kind, "holder", r.ID, "err", err.Error())
			continue
		}
		keys[mapview.Holder{Kind: r.Kind, ID: r.ID}] = k
	}
	s.sight = keys
	return nil
}

// reloadSight is loadSight after the game was read again; a failure is
// logged, and the next pass reads the keys before it runs.
func (s *Server) reloadSight(ctx context.Context) {
	if err := s.loadSight(ctx); err != nil {
		s.cfg.Log.Error("map pass", "err", err.Error())
	}
}

// mapPass runs, under mu, the view pass for the holders named (nil: every
// holder) and writes it. The keys move only once the write is saved: a
// failure is logged and the next pass writes the same leaving tiles.
func (s *Server) mapPass(ctx context.Context, only []mapview.Holder) {
	if s.sight == nil {
		if err := s.loadSight(ctx); err != nil {
			s.cfg.Log.Error("map pass", "err", err.Error())
			return
		}
	}
	changes, gone := mapview.Pass(s.g, s.sight, only, mapview.ParamsOf(s.g.Rules().Book))
	if len(changes) == 0 && len(gone) == 0 {
		return
	}
	seen, keys, out, err := sightRows(s.g, changes, gone)
	if err == nil {
		err = s.st.SaveSight(ctx, s.g.Tick(), seen, keys, out)
	}
	if err != nil {
		s.cfg.Log.Error("map pass failed; retried next pass", "world", s.cfg.World, "tick", s.g.Tick(), "err", err.Error())
		return
	}
	keep(s.sight, changes, gone)
}

// mapAfter runs, under mu, the view pass after a saved command.
func (s *Server) mapAfter(ctx context.Context, out applied) {
	if out.ref != nil || out.dup {
		return
	}
	s.mapPass(ctx, passHolders(s.g, out.res))
}

// mapSeen are a viewer's character's and guild's records in some chunks,
// read from the store without the world's lock.
func (s *Server) mapSeen(ctx context.Context, characterID, guildID string, chunks []gen.ChunkCoord) ([]mapview.Record, error) {
	ids := make([][2]int64, len(chunks))
	for i, c := range chunks {
		ids[i] = [2]int64{c.A, c.B}
	}
	rows, err := s.st.SeenIn(ctx, characterID, guildID, ids)
	if err != nil {
		return nil, err
	}
	out := make([]mapview.Record, 0, len(rows))
	for _, r := range rows {
		rec := mapview.Record{Holder: mapview.Holder{Kind: r.Kind, ID: r.ID}, Hex: hex.Hex{Q: r.Q, R: r.R}, Left: r.Left}
		if err := json.Unmarshal(r.Live, &rec.Live); err != nil {
			return nil, fmt.Errorf("service: a last-seen record of %s %s at %d,%d: %w", r.Kind, r.ID, r.Q, r.R, err)
		}
		rec.Live.Q, rec.Live.R, rec.Live.Fog, rec.Live.Left = r.Q, r.R, api.FogSeen, r.Left
		out = append(out, rec)
	}
	return out, nil
}

// mapCount is how many last-seen records the world keeps.
func (s *Server) mapCount(ctx context.Context) (int64, error) { return s.st.CountSeen(ctx) }

// localSight is a Local's view pass: its keys and its records, in memory.
type localSight struct {
	keys map[mapview.Holder]mapview.Key
	seen mapview.MemSeen
}

// mapPass runs the view pass for the holders named (nil: every holder).
func (l *Local) mapPass(only []mapview.Holder) {
	if l.sight.keys == nil {
		l.sight.keys = map[mapview.Holder]mapview.Key{}
	}
	changes, gone := mapview.Pass(l.G, l.sight.keys, only, mapview.ParamsOf(l.G.Rules().Book))
	l.sight.seen.Apply(changes, gone)
	keep(l.sight.keys, changes, gone)
}

// mapSeen are a viewer's character's and guild's records in some chunks.
func (l *Local) mapSeen(_ context.Context, characterID, guildID string, chunks []gen.ChunkCoord) ([]mapview.Record, error) {
	return l.sight.seen.In(viewHolders(characterID, guildID), chunks, l.G.World.Gen().ChunkOf), nil
}

// mapCount is how many last-seen records the Local keeps.
func (l *Local) mapCount(context.Context) (int64, error) { return int64(l.sight.seen.Count()), nil }
