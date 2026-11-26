package mapview_test

import (
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/mapview"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/settle"
)

// allEdges is the mask of a tile with no discovered neighbour.
const allEdges = 1<<hex.Directions - 1

func TestFrontierEdge(t *testing.T) {
	m := newBaseWorld(t)
	b := m.build()
	cells := map[hex.Hex]api.MapCell{}
	for _, c := range baseChunks(t, b) {
		for _, cell := range c.Cells {
			h := baseCellHex(cell)
			var want int64
			for d := range hex.Directions {
				if !m.found(h.Neighbour(d)) {
					want |= 1 << d
				}
			}
			if cell.Edge != want {
				t.Fatalf("%v edge %06b, want %06b", h, cell.Edge, want)
			}
			cells[h] = cell
		}
	}
	if e := cells[m.home].Edge; e != 0 {
		t.Fatalf("home, inside the disc, has edge %06b", e)
	}
	if e := cells[m.lone].Edge; e != allEdges {
		t.Fatalf("the lone tile has edge %06b, want all six", e)
	}
	// The disc's east corner faces the unknown east, north-east and
	// south-east, in hex.go's direction order.
	east := m.home.Add(hex.Direction(0).Scale(baseDisc))
	if e := cells[east].Edge; e != 1<<0|1<<1|1<<5 {
		t.Fatalf("the east corner has edge %06b", e)
	}
	west := m.home.Add(hex.Direction(3).Scale(baseDisc))
	if e := cells[west].Edge; e != 1<<2|1<<3|1<<4 {
		t.Fatalf("the west corner has edge %06b", e)
	}

	m.discover(t, east.Neighbour(0))
	c, ok := mapview.Cell(m.g, east, api.LevelArea)
	if !ok || c.Edge != 1<<1|1<<5 {
		t.Fatalf("after its east neighbour is found, the corner has edge %06b", c.Edge)
	}
}

func TestBasePlaces(t *testing.T) {
	m := newBaseWorld(t)
	g := m.g
	claim := []hex.Hex{m.home.Neighbour(0), m.home.Neighbour(1)}
	g.Places[0].City = &settle.City{Raised: 1, Tiles: append([]hex.Hex{m.home}, claim...)}
	faction := 0
	ruinAt, factionAt := m.home.Add(hex.Direction(2).Scale(5)), m.home.Add(hex.Direction(4).Scale(5))
	g.Places = append(g.Places,
		&game.Place{N: 1, Hex: ruinAt, Lattice: -1, Ruined: 1},
		&game.Place{N: 2, Hex: factionAt, Lattice: -1, Faction: &faction})
	b := m.build()

	want := map[hex.Hex][3]string{
		m.home:    {api.PlaceCity, "settlement:0", "guild:g-1"},
		claim[0]:  {api.PlaceCityTile, "settlement:0", "guild:g-1"},
		claim[1]:  {api.PlaceCityTile, "settlement:0", "guild:g-1"},
		ruinAt:    {api.PlaceRuin, "settlement:1", ""},
		factionAt: {api.PlaceFaction, "settlement:2", ""},
	}
	for h, w := range want {
		tile, _ := mapview.Cell(g, h, api.LevelTile)
		if got := [3]string{tile.Place, tile.PlaceRef, tile.Guild}; got != w {
			t.Fatalf("%v at tile level: %v, want %v", h, got, w)
		}
		area, _ := mapview.Cell(g, h, api.LevelArea)
		if area.Place != w[0] || area.PlaceRef != "" || area.Guild != "" {
			t.Fatalf("%v at area level: %+v", h, area)
		}
	}
	dots := map[hex.Hex]string{}
	for _, d := range b.Regions.Places {
		dots[hex.Hex{Q: d.Q, R: d.R}] = d.Place
	}
	if len(dots) != 2 || dots[m.home] != api.PlaceCity || dots[factionAt] != api.PlaceFaction {
		t.Fatalf("dots: %v, want the city and the faction city only", dots)
	}

	// A ruin claims none of its old city's tiles.
	g.Places[0].City, g.Places[0].Ruined, g.Places[0].Guild = nil, 1, ""
	if c, _ := mapview.Cell(g, claim[0], api.LevelTile); c.Place != "" || c.PlaceRef != "" {
		t.Fatalf("a ruined place still claims %v: %+v", claim[0], c)
	}
}

func TestCellAt(t *testing.T) {
	m := newBaseWorld(t)
	unknown := m.home.Add(hex.Direction(5).Scale(baseFar))
	if _, ok := mapview.Cell(m.g, unknown, api.LevelTile); ok {
		t.Fatal("Cell gave an undiscovered tile")
	}
	c := mapview.CellAt(m.g, unknown, api.LevelTile)
	if c.Q != unknown.Q || c.R != unknown.R || c.Terrain == "" || c.Found != 0 || c.Edge != allEdges {
		t.Fatalf("CellAt of an undiscovered tile: %+v", c)
	}
	known, ok := mapview.Cell(m.g, m.home, api.LevelTile)
	if !ok {
		t.Fatal("Cell refused home")
	}
	if at := mapview.CellAt(m.g, m.home, api.LevelTile); at.Q != known.Q || at.Place != known.Place || at.Found != known.Found {
		t.Fatalf("CellAt %+v differs from Cell %+v on a found tile", at, known)
	}
}

func TestMerge(t *testing.T) {
	cell := api.MapCell{Q: 1, R: 2, Terrain: "plain"}
	if v := mapview.Merge(cell, nil); v.Fog != api.FogDiscovered || v.Live != nil || v.Cell.Terrain != "plain" {
		t.Fatalf("merge with no live layer: %+v", v)
	}
	live := &api.MapLive{Q: 1, R: 2, Fog: api.FogSeen, Left: 7, Threat: 3}
	v := mapview.Merge(cell, live)
	if v.Fog != api.FogSeen || v.Live == nil || *v.Live != *live {
		t.Fatalf("merge with a record: %+v", v)
	}
	live.Threat = 9
	if v.Live.Threat != 3 {
		t.Fatal("the merged view shares the live layer it was given")
	}
}
