package mapview

import (
	"maps"
	"slices"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
)

// directionIDs name the hex directions in hex.Direction order.
var directionIDs = [hex.Directions]string{"e", "ne", "nw", "w", "sw", "se"}

// Viewer is who an overlay is for.
type Viewer struct {
	Kind string     // api.Viewer*
	Char *game.Char // nil unless Kind is character
}

// Overlay is a viewer's live layers over chunks; seen are the viewer's
// character's and guild's records in those chunks. sight true asks for the
// chunks the viewer's sight touches. Only a character's viewer gets tiles,
// fronts and Self; no hex leaves it that nobody has found, but the
// viewer's own tile. The service fills Names and Self.Cell.
func Overlay(g *game.Game, world string, v Viewer, chunks []gen.ChunkCoord, sight bool, seen []Record, p Params) api.MapOverlay {
	out := api.MapOverlay{World: world, Tick: g.Tick(), Viewer: v.Kind, Tiles: []api.MapLive{}, Fronts: []api.MapFront{}}
	c := v.Char
	if v.Kind != api.ViewerCharacter || c == nil {
		return out
	}
	chunkOf := g.World.Gen().ChunkOf
	in := Sights(g, c)
	want := map[gen.ChunkCoord]bool{}
	if sight {
		for h := range in {
			want[chunkOf(h)] = true
		}
	} else {
		for _, cc := range chunks {
			want[cc] = true
		}
	}
	own := c.C.At
	var lit []hex.Hex
	for h := range in {
		if h == own || (want[chunkOf(h)] && discovered(g, h)) {
			lit = append(lit, h)
		}
	}
	slices.SortFunc(lit, byRQ)
	tiles := make(map[hex.Hex]api.MapLive, len(lit))
	for _, h := range lit {
		tiles[h] = Live(g, h, p)
	}
	mine, guild := Holder{HolderCharacter, c.C.ID}, Holder{HolderGuild, c.C.Guild}
	for h, r := range newest(seen, mine, guild) {
		if in[h] || !want[chunkOf(h)] || !discovered(g, h) {
			continue
		}
		live := r.Live
		live.Q, live.R, live.Fog, live.Left = h.Q, h.R, api.FogSeen, r.Left
		tiles[h] = live
	}
	for _, h := range slices.SortedFunc(maps.Keys(tiles), byRQ) {
		out.Tiles = append(out.Tiles, tiles[h])
	}
	if c.C.Guild != "" {
		k, ok := KeyOf(g, guild)
		out.Guild = ok && len(k) > 0
	}
	out.Self = self(g, c)
	out.Fronts = fronts(g, lit)
	return out
}

// newest is, per tile, the record of the character or its guild that left
// sight last; on a tie, the character's.
func newest(seen []Record, mine, guild Holder) map[hex.Hex]Record {
	out := map[hex.Hex]Record{}
	for _, r := range seen {
		if r.Holder != mine && (guild.ID == "" || r.Holder != guild) {
			continue
		}
		best, ok := out[r.Hex]
		if !ok || r.Left > best.Left || (r.Left == best.Left && r.Holder == mine) {
			out[r.Hex] = r
		}
	}
	return out
}

// self is the viewer's own character, its route cut at the first tile
// nobody has found.
func self(g *game.Game, c *game.Char) *api.MapSelf {
	out := &api.MapSelf{Character: c.C.ID, Q: c.C.At.Q, R: c.C.At.R, Floor: c.C.Floor}
	if c.Long != nil {
		for _, h := range c.Long.Route {
			if !discovered(g, h) {
				break
			}
			out.Route = append(out.Route, api.Hex{Q: h.Q, R: h.R})
		}
	}
	return out
}

// fronts are the systems covering any lit tile, each drawn at the lit
// tile nearest its centre, so a centre over unknown ground stays hidden.
func fronts(g *game.Game, lit []hex.Hex) []api.MapFront {
	rules := g.World.WeatherRules()
	out := []api.MapFront{}
	for _, sys := range g.World.Sky.Systems {
		var at hex.Hex
		best := int64(-1)
		for _, h := range lit {
			if !rules.Covers(sys, h) {
				continue
			}
			if d := hex.Distance(sys.Centre, h); best < 0 || d < best {
				at, best = h, d
			}
		}
		if best < 0 {
			continue
		}
		out = append(out, api.MapFront{Kind: sys.Kind, Q: at.Q, R: at.R, Heading: directionIDs[((sys.Heading%hex.Directions)+hex.Directions)%hex.Directions]})
	}
	return out
}
