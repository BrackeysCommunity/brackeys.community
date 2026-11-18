package world

import (
	"slices"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/weather"
)

// Landfall records that a system has reached a settlement, so it is told
// once.
type Landfall struct {
	System     int64 `json:"system"`
	Settlement int   `json:"settlement"`
}

// ground lets weather read raw terrain: cheap, and the same for tiles
// nobody has generated a chunk for.
type ground struct{ g *gen.Gen }

func (gr ground) Terrain(h hex.Hex) string  { return gr.g.RawTerrain(h) }
func (gr ground) Elevation(h hex.Hex) int64 { return gr.g.RawElevation(h) }

// Weather is the system over a tile, if any.
func (s *State) Weather(h hex.Hex) (weather.System, bool) { return s.Sky.At(s.sky, h) }

// Forecast is the sky over the next ticks: exact for the forecast's
// first ticks, a widening cone after.
func (s *State) Forecast(ticks int64) [][]weather.System {
	return s.Sky.Forecast(s.sky, ground{s.g}, ticks)
}

// WeatherRules are the weather sheets the world runs on.
func (s *State) WeatherRules() *weather.Rules { return s.sky }

func (d *day) weatherTick() {
	s := d.s
	for _, e := range s.Sky.Tick(s.sky, ground{s.g}) {
		if e.Kind == weather.EventLeft {
			d.emit("weather.left", "", nil, nil, fact.S("kind", e.System.Kind), fact.N("strength", e.System.Strength))
		}
	}
	d.landfall()
}

// landfall: a system whose footprint first covers an open settlement's
// tile makes a fact.
func (d *day) landfall() {
	s := d.s
	for _, sys := range s.Sky.Systems {
		for n := range s.Opened {
			h := s.g.Settlement(n).Hex
			if !s.sky.Covers(sys, h) || slices.Contains(s.Landfalls, Landfall{sys.ID, n}) {
				continue
			}
			s.Landfalls = append(s.Landfalls, Landfall{sys.ID, n})
			d.emit("weather.landfall", s.refAt(h), nil, nil, fact.S("kind", sys.Kind), fact.N("strength", sys.Strength), fact.N("settlement", int64(n)))
		}
	}
	live := s.Landfalls[:0]
	for _, l := range s.Landfalls {
		if slices.ContainsFunc(s.Sky.Systems, func(x weather.System) bool { return x.ID == l.System }) {
			live = append(live, l)
		}
	}
	s.Landfalls = live
}

// weatherShares sets each awake region's share of tiles under each kind.
func (d *day) weatherShares() {
	s := d.s
	for i := range s.Regions {
		clear(s.Regions[i].Weather)
	}
	if len(s.Sky.Systems) == 0 {
		return
	}
	kinds := make(map[string]int, len(s.b.Weather))
	for k, w := range s.b.Weather {
		kinds[w.ID] = k
	}
	for i := range s.Regions {
		r := &s.Regions[i]
		c := s.centre(i)
		tiles := s.g.RegionTiles(r.Lattice)
		for _, sys := range s.Sky.Systems {
			if hex.Distance(c, sys.Centre) > s.sky.Radius(sys)+s.wp("weather-reach") {
				continue
			}
			n := int64(0)
			for _, h := range tiles {
				if top, ok := s.Sky.At(s.sky, h); ok && top.ID == sys.ID {
					n++
				}
			}
			r.Weather[kinds[sys.Kind]] += n * percent / int64(max(1, len(tiles)))
		}
	}
}

// weatherDay forms new systems in the spine cells the horizon holds, and
// lets systems that have drifted far past it leave the map.
func (d *day) weatherDay() {
	s := d.s
	reach := s.wp("weather-reach")
	kept := s.Sky.Systems[:0]
	for _, sys := range s.Sky.Systems {
		near := false
		for i := range s.Regions {
			if hex.Distance(s.centre(i), sys.Centre) <= reach {
				near = true
				break
			}
		}
		if near {
			kept = append(kept, sys)
		}
	}
	s.Sky.Systems = kept
	for _, e := range s.Sky.Day(s.sky, s.d, ground{s.g}, s.Day, s.cells(), len(s.Regions)) {
		if e.Kind == weather.EventFormed {
			d.emit("weather.formed", s.refAt(e.System.Centre), nil, nil, fact.S("kind", e.System.Kind), fact.N("strength", e.System.Strength))
		}
	}
}

// cells are the spine cells nearest the awake regions' centres, each with
// the terrain most of its regions share.
func (s *State) cells() []weather.Cell {
	type tally struct {
		cell  weather.Cell
		count map[string]int
	}
	var out []tally
	for i := range s.Regions {
		id, at := s.g.SpineCell(s.centre(i))
		k := slices.IndexFunc(out, func(t tally) bool { return t.cell.I == id.I && t.cell.J == id.J })
		if k < 0 {
			out = append(out, tally{cell: weather.Cell{I: id.I, J: id.J, Centre: at, Low: s.g.RawElevation(at) <= s.wp("low-elevation")}, count: map[string]int{}})
			k = len(out) - 1
		}
		out[k].count[s.g.Region(s.Regions[i].Lattice).Terrain]++
	}
	cells := make([]weather.Cell, len(out))
	for k, t := range out {
		best := ""
		for _, ter := range s.b.Terrain {
			if t.count[ter.ID] > t.count[best] {
				best = ter.ID
			}
		}
		t.cell.Terrain = best
		cells[k] = t.cell
	}
	slices.SortFunc(cells, func(a, b weather.Cell) int {
		return gen.CompareIDs(gen.LatticeID{I: a.I, J: a.J}, gen.LatticeID{I: b.I, J: b.J})
	})
	return cells
}
