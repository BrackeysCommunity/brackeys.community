package service

import (
	"cmp"
	"context"
	"errors"
	"maps"
	"slices"
	"sync"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/mapview"
	"jams.team/mmo-world/render"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

// localWorld is the world a Local's map names.
const localWorld = "local"

// mapCache is a world's map between reads: the shared base, rebuilt once
// the tick or the game moved, and the style and view numbers, rebuilt once
// the rules did. Its zero value is ready.
type mapCache struct {
	mu     sync.Mutex
	game   *game.Game
	base   *mapview.Base
	rules  *game.Rules
	style  api.MapStyle
	params mapview.Params
}

// styled is the style for the rules g runs on; c.mu is held.
func (c *mapCache) styled(g *game.Game) error {
	r := g.Rules()
	if c.rules == r {
		return nil
	}
	st, err := mapStyleOf(r.Book)
	if err != nil {
		return err
	}
	c.rules, c.style, c.params = r, st, mapview.ParamsOf(r.Book)
	return nil
}

// based is the base at g's tick, g held and c.mu held. Commands change the
// base between ticks; their changes show at the next tick's first read.
func (c *mapCache) based(g *game.Game, world string, tickSeconds int64) (*mapview.Base, error) {
	if err := c.styled(g); err != nil {
		return nil, err
	}
	if c.base == nil || c.game != g || c.base.Tick != g.Tick() || c.base.Index.Style != c.style.Rev {
		c.base, c.game = mapview.Build(g, world, tickSeconds, c.style.Rev), g
	}
	return c.base, nil
}

// mapStyleOf is the map's look as the clients draw it, from the setting
// pack: each entry under the id the map draws by.
func mapStyleOf(b *sheets.Book) (api.MapStyle, error) {
	if p := render.MapStyleProblems(b); len(p) > 0 {
		errs := make([]error, len(p))
		for i, s := range p {
			errs[i] = errors.New(s)
		}
		return api.MapStyle{}, errors.Join(errs...)
	}
	none := func(v string) string {
		if v == "none" {
			return ""
		}
		return v
	}
	out := api.MapStyle{Entries: make([]api.MapStyleEntry, len(b.MapStyle))}
	for i, e := range b.MapStyle {
		out.Entries[i] = api.MapStyleEntry{ID: e.MapID(), Colour: e.Colour, Alpha: e.Alpha, Glyph: none(e.Glyph), Pattern: none(e.Pattern)}
	}
	n := func(id string) int64 { return sheets.IntParam(b.MapView, id) }
	out.View = api.MapViewNumbers{SeenDim: n("seen-dim"), ZoomArea: n("zoom-area"), ZoomTile: n("zoom-tile"), ZoomMin: n("zoom-min"),
		ZoomMax: n("zoom-max"), BlendMax: n("blend-max")}
	out.Rev = mapview.Rev(out)
	return out, nil
}

// mapSource is a world as the map reads it: the held game, its cache, and
// where its last-seen records are.
type mapSource interface {
	held
	mapCached() *mapCache
	mapWorld() (id string, tickSeconds int64)
	mapSeen(ctx context.Context, characterID, guildID string, chunks []gen.ChunkCoord) ([]mapview.Record, error)
}

func (s *Server) mapCached() *mapCache        { return &s.maps }
func (s *Server) mapWorld() (string, int64)   { return s.cfg.World, int64(s.cfg.TickSeconds) }
func (h LocalHost) mapCached() *mapCache      { return &h.l.maps }
func (h LocalHost) mapWorld() (string, int64) { return localWorld, 0 }
func (h LocalHost) mapSeen(ctx context.Context, characterID, guildID string, chunks []gen.ChunkCoord) ([]mapview.Record, error) {
	return h.l.mapSeen(ctx, characterID, guildID, chunks)
}

// onBase runs f on the base at the world's tick, held.
func onBase[T any](ctx context.Context, w mapSource, f func(*mapview.Base) T) (T, error) {
	var zero T
	g, _, release, err := w.holdGame(ctx)
	if err != nil {
		return zero, err
	}
	defer release()
	c := w.mapCached()
	c.mu.Lock()
	defer c.mu.Unlock()
	id, secs := w.mapWorld()
	b, err := c.based(g, id, secs)
	if err != nil {
		return zero, err
	}
	return f(b), nil
}

func mapIndexIn(ctx context.Context, w mapSource) (api.MapIndex, error) {
	return onBase(ctx, w, func(b *mapview.Base) api.MapIndex { return b.Index })
}

func mapRegionsIn(ctx context.Context, w mapSource) (api.MapRegions, error) {
	return onBase(ctx, w, func(b *mapview.Base) api.MapRegions { return b.Regions })
}

func mapStyleIn(ctx context.Context, w mapSource) (api.MapStyle, error) {
	g, _, release, err := w.holdGame(ctx)
	if err != nil {
		return api.MapStyle{}, err
	}
	defer release()
	c := w.mapCached()
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.styled(g); err != nil {
		return api.MapStyle{}, err
	}
	return c.style, nil
}

func mapChunkIn(ctx context.Context, w mapSource, a, b int64, level string) (api.MapChunk, *api.Refusal, error) {
	if level != api.LevelArea && level != api.LevelTile {
		return api.MapChunk{}, &api.Refusal{Code: api.CodeBadJSON, Message: "a chunk's level is area or tile"}, nil
	}
	type found struct {
		c  api.MapChunk
		ok bool
	}
	got, err := onBase(ctx, w, func(base *mapview.Base) found {
		c, ok := base.Chunk(a, b, level)
		return found{c, ok}
	})
	switch {
	case err != nil:
		return api.MapChunk{}, nil, err
	case !got.ok:
		return api.MapChunk{}, &api.Refusal{Code: api.CodeNotFound, Message: "no such chunk"}, nil
	}
	return got.c, nil, nil
}

// checkOverlay refuses an overlay query that names no chunk and no sight,
// both, or more chunks than one request may.
func checkOverlay(q api.MapOverlayQuery) *api.Refusal {
	if q.Sight == (len(q.Chunks) > 0) || len(q.Chunks) > maxMapChunks {
		return &api.Refusal{Code: api.CodeBadJSON, Message: overlayShape}
	}
	return nil
}

// mapOverlayIn is a character's live layers, or an empty overlay for ""
// (anonymous) and for a character who is gone (a player). The records are
// read before the world is held, so the store is not read under its lock.
func mapOverlayIn(ctx context.Context, w mapSource, characterID string, q api.MapOverlayQuery) (api.MapOverlay, *api.Refusal, error) {
	if ref := checkOverlay(q); ref != nil {
		return api.MapOverlay{}, ref, nil
	}
	chunks := make([]gen.ChunkCoord, len(q.Chunks))
	for i, c := range q.Chunks {
		chunks[i] = gen.ChunkCoord{A: c.A, B: c.B}
	}
	var seen []mapview.Record
	if characterID != "" {
		guild, around, ok, err := overlayAsks(ctx, w, characterID, chunks, q.Sight)
		if err != nil {
			return api.MapOverlay{}, nil, err
		}
		if ok && len(around) > 0 {
			if seen, err = w.mapSeen(ctx, characterID, guild, around); err != nil {
				return api.MapOverlay{}, nil, err
			}
		}
	}
	g, _, release, err := w.holdGame(ctx)
	if err != nil {
		return api.MapOverlay{}, nil, err
	}
	defer release()
	c := w.mapCached()
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.styled(g); err != nil {
		return api.MapOverlay{}, nil, err
	}
	v := mapview.Viewer{Kind: api.ViewerAnonymous}
	if characterID != "" {
		v.Kind = api.ViewerPlayer
		if ch := g.Char(characterID); ch != nil {
			v = mapview.Viewer{Kind: api.ViewerCharacter, Char: ch}
		}
	}
	id, secs := w.mapWorld()
	out := mapview.Overlay(g, id, v, chunks, q.Sight, seen, c.params)
	if v.Char == nil {
		return out, nil, nil
	}
	if at := v.Char.C.At; out.Self != nil && !found(g, at) {
		cell := mapview.CellAt(g, at, api.LevelTile)
		out.Self.Cell = &cell
	}
	if server := v.Char.Server; server != "" && g.House(server) != nil {
		// The asked chunks, and the own tile's or the sight's.
		for _, t := range out.Tiles {
			chunks = append(chunks, g.World.Gen().ChunkOf(hex.Hex{Q: t.Q, R: t.R}))
		}
		b, err := c.based(g, id, secs)
		if err != nil {
			return api.MapOverlay{}, nil, err
		}
		out.Names = maskedIn(g, b, server, chunks)
	}
	return out, nil, nil
}

// overlayAsks are, for a character, its guild and the chunks whose
// records the overlay reads; ok is false when the character is gone.
func overlayAsks(ctx context.Context, w mapSource, characterID string, chunks []gen.ChunkCoord, sight bool) (string, []gen.ChunkCoord, bool, error) {
	g, _, release, err := w.holdGame(ctx)
	if err != nil {
		return "", nil, false, err
	}
	defer release()
	c := g.Char(characterID)
	if c == nil {
		return "", nil, false, nil
	}
	if !sight {
		return c.C.Guild, chunks, true, nil
	}
	chunkOf := g.World.Gen().ChunkOf
	in := map[gen.ChunkCoord]bool{}
	for h := range mapview.Sights(g, c) {
		in[chunkOf(h)] = true
	}
	return c.C.Guild, slices.SortedFunc(maps.Keys(in), compareChunks), true, nil
}

func compareChunks(x, y gen.ChunkCoord) int {
	return cmp.Or(cmp.Compare(x.A, y.A), cmp.Compare(x.B, y.B))
}

// maskedIn are the names a server masks among the refs the base's chunks
// carry: only those whose shown name differs from the written one (GDD
// 14.6), since the shared base carries the written names.
func maskedIn(g *game.Game, b *mapview.Base, server string, chunks []gen.ChunkCoord) map[string]string {
	written := map[string]string{}
	for _, cc := range chunks {
		if c, ok := b.Chunk(cc.A, cc.B, api.LevelTile); ok {
			maps.Copy(written, c.Names)
		}
	}
	shown := maps.Clone(written)
	maskNames(g, server, shown)
	var out map[string]string
	for ref, name := range shown {
		if name != written[ref] {
			if out == nil {
				out = map[string]string{}
			}
			out[ref] = name
		}
	}
	return out
}

// mapFocusIn is where a server's view centres (GDD 4.11): the discovered
// settlement of its guild's standing ones nearest their centroid, or the
// world's home. It is a camera, and grants no sight.
func mapFocusIn(ctx context.Context, w mapSource, server string) (api.MapFocus, error) {
	g, _, release, err := w.holdGame(ctx)
	if err != nil {
		return api.MapFocus{}, err
	}
	defer release()
	return focusOf(g, server), nil
}

func focusOf(g *game.Game, server string) api.MapFocus {
	out := api.MapFocus{}
	if len(g.Places) > 0 && found(g, g.Places[0].Hex) {
		out.Centre = apiHex(g.Places[0].Hex)
	}
	gd := g.ServerGuild(server)
	if gd == nil {
		return out
	}
	var at []hex.Hex
	var sumQ, sumR int64
	for _, p := range g.Places {
		if p.Guild == gd.G.ID && p.Ruined == 0 && p.Faction == nil {
			at = append(at, p.Hex)
			sumQ, sumR = sumQ+p.Hex.Q, sumR+p.Hex.R
		}
	}
	out.Settlements = int64(len(at))
	if len(at) == 0 {
		return out
	}
	mid := hex.Hex{Q: sumQ / out.Settlements, R: sumR / out.Settlements}
	best := int64(-1)
	for _, h := range at {
		if !found(g, h) {
			continue
		}
		if d := hex.Distance(mid, h); best < 0 || d < best {
			out.Centre, best = apiHex(h), d
		}
	}
	return out
}

// MapIndex is the map at the world's tick.
func (s *Server) MapIndex(ctx context.Context) (api.MapIndex, error) { return mapIndexIn(ctx, s) }

// MapStyle is the map's look, from the setting pack.
func (s *Server) MapStyle(ctx context.Context) (api.MapStyle, error) { return mapStyleIn(ctx, s) }

// MapRegions is the map's widest level.
func (s *Server) MapRegions(ctx context.Context) (api.MapRegions, error) { return mapRegionsIn(ctx, s) }

// MapChunk is one chunk's shared base at area or tile level.
func (s *Server) MapChunk(ctx context.Context, a, b int64, level string) (api.MapChunk, *api.Refusal, error) {
	return mapChunkIn(ctx, s, a, b, level)
}

// MapOverlay is one character's live layers; "" is an anonymous viewer.
func (s *Server) MapOverlay(ctx context.Context, characterID string, q api.MapOverlayQuery) (api.MapOverlay, *api.Refusal, error) {
	return mapOverlayIn(ctx, s, characterID, q)
}

// MapFocus is where a Discord server's view centres.
func (s *Server) MapFocus(ctx context.Context, server string) (api.MapFocus, error) {
	return mapFocusIn(ctx, s, server)
}

func (h LocalHost) MapIndex(ctx context.Context) (api.MapIndex, error) { return mapIndexIn(ctx, h) }

func (h LocalHost) MapStyle(ctx context.Context) (api.MapStyle, error) { return mapStyleIn(ctx, h) }

func (h LocalHost) MapRegions(ctx context.Context) (api.MapRegions, error) {
	return mapRegionsIn(ctx, h)
}

func (h LocalHost) MapChunk(ctx context.Context, a, b int64, level string) (api.MapChunk, *api.Refusal, error) {
	return mapChunkIn(ctx, h, a, b, level)
}

func (h LocalHost) MapOverlay(ctx context.Context, characterID string, q api.MapOverlayQuery) (api.MapOverlay, *api.Refusal, error) {
	return mapOverlayIn(ctx, h, characterID, q)
}

func (h LocalHost) MapFocus(ctx context.Context, server string) (api.MapFocus, error) {
	return mapFocusIn(ctx, h, server)
}
