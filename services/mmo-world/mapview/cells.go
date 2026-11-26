package mapview

import (
	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/world"
)

// placeAt is the place a tile shows: its kind, the open settlement's index
// and the guild running it.
type placeAt struct {
	kind  string
	n     int
	guild string
}

// reader reads base cells from a game, with its places indexed by tile.
type reader struct {
	g      *game.Game
	places map[hex.Hex]placeAt
}

func newReader(g *game.Game) *reader {
	r := &reader{g: g, places: make(map[hex.Hex]placeAt, len(g.Places))}
	for n, p := range g.Places {
		switch {
		case p.Ruined != 0:
			r.places[p.Hex] = placeAt{kind: api.PlaceRuin, n: n}
		case p.Faction != nil:
			r.places[p.Hex] = placeAt{kind: api.PlaceFaction, n: n}
		case p.City != nil:
			r.places[p.Hex] = placeAt{kind: api.PlaceCity, n: n, guild: p.Guild}
		default:
			r.places[p.Hex] = placeAt{kind: api.PlaceSettlement, n: n, guild: p.Guild}
		}
	}
	// A place's own tile wins over another city's claim on it.
	for n, p := range g.Places {
		if p.City == nil || p.Ruined != 0 {
			continue
		}
		for _, h := range p.City.Tiles {
			if _, ok := r.places[h]; !ok {
				r.places[h] = placeAt{kind: api.PlaceCityTile, n: n, guild: p.Guild}
			}
		}
	}
	return r
}

func (r *reader) discovered(h hex.Hex) bool {
	st := r.g.World.Tile(h)
	return st != nil && st.Discovered != nil
}

// edge is the frontier mask: bit d is set when the neighbour in direction
// d is undiscovered.
func (r *reader) edge(h hex.Hex) int64 {
	var m int64
	for d, n := range h.Neighbours() {
		if !r.discovered(n) {
			m |= 1 << d
		}
	}
	return m
}

func (r *reader) cell(h hex.Hex, level string) api.MapCell {
	g := r.g
	b := g.World.Baseline(h)
	c := api.MapCell{Q: h.Q, R: h.R, Terrain: b.Terrain, Edge: r.edge(h)}
	if b.Blend > 0 && b.Secondary != "" {
		c.Secondary, c.Blend = b.Secondary, b.Blend
	}
	if b.Water != gen.WaterNone {
		c.Water = b.Water
	}
	if i := g.World.RegionAt(h); i >= 0 {
		c.Region = world.RegionRef(i)
	}
	st := g.World.Tile(h)
	if st != nil {
		c.Road = st.Road
	}
	p, placed := r.places[h]
	if placed {
		c.Place = p.kind
	}
	if level != api.LevelTile {
		return c
	}
	if placed {
		c.PlaceRef = goal.SettlementRef(p.n)
		if p.guild != "" {
			c.Guild = guildRef(p.guild)
		}
	}
	c.Site, c.Landmark = g.SiteAt(h), b.Landmark
	if ct, ok := g.Content(h); ok {
		c.SiteKind = ct.SiteKind
		if ct.Landmark != "" {
			c.Landmark = ct.Landmark
		}
	}
	c.RoadName, _, _ = g.RoadState(h)
	if st != nil {
		for _, s := range st.Structures {
			c.Structures = append(c.Structures, s.Kind)
		}
		if st.Discovered != nil {
			c.Found = st.Discovered.Tick
		}
	}
	return c
}

func guildRef(id string) string { return game.RefGuild + ":" + id }

// Cell is a discovered tile's base at a level; false when nobody found it.
func Cell(g *game.Game, h hex.Hex, level string) (api.MapCell, bool) {
	r := newReader(g)
	if !r.discovered(h) {
		return api.MapCell{}, false
	}
	return r.cell(h, level), true
}

// CellAt is a tile's base whether or not anybody found it: only for the
// tile the asking character stands on.
func CellAt(g *game.Game, h hex.Hex, level string) api.MapCell {
	return newReader(g).cell(h, level)
}

// Merge is a tile as a viewer may see it.
func Merge(cell api.MapCell, live *api.MapLive) api.MapTileView {
	if live == nil {
		return api.MapTileView{Cell: cell, Fog: api.FogDiscovered}
	}
	l := *live
	return api.MapTileView{Cell: cell, Fog: l.Fog, Live: &l}
}
