package world

import (
	"slices"

	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
	"jams.team/mmo-world/sim/tile"
)

// Place is what rules read of a tile as a place (GDD 4.12, 8.6): its
// terrain's tags and place tags, its ecotone's tags, the weather over it
// and what the weather leaves, and what its stored state says (fire,
// corruption, local weather). Each tag says where it came from.
func (s *State) Place(h hex.Hex) tags.TagSet {
	t := s.g.Baseline(h)
	ter := s.terrain(t.Terrain)
	var set tags.TagSet
	add := func(from tags.Source, ts ...string) {
		for _, x := range ts {
			set.Add(tags.Held{Tag: tags.Tag(x), From: from})
		}
	}
	add(tags.Source{Note: "terrain:" + t.Terrain}, ter.Tags...)
	add(tags.Source{Note: "terrain:" + t.Terrain}, ter.PlaceTags...)
	if t.Edge != "" {
		for _, e := range s.b.Ecotones {
			if e.ID == t.Edge {
				add(tags.Source{Note: "ecotone:" + e.ID}, "edge", e.Tag)
			}
		}
	}
	if sys, ok := s.Weather(h); ok {
		add(tags.Source{Note: "weather:" + sys.Kind}, s.sky.Effects(sys.Kind, sys.Strength).TileTags...)
	}
	if st := s.Tile(h); st != nil {
		add(tags.Source{Note: "tile:" + "weather"}, st.WeatherTags...)
		if st.Fire.State == tile.FireBurning {
			add(tags.Source{Note: "tile:" + "fire"}, "burning")
		}
		if st.Corruption >= lineAt(s.b, "corrupted-nodes") {
			add(tags.Source{Note: "tile:" + "corruption"}, "corrupted")
		}
	}
	if r := s.RegionAt(h); r >= 0 && s.Regions[r].Gauge[s.gaugeIndex("corruption")] >= lineAt(s.b, "corrupted-nodes") {
		add(tags.Source{Note: "region:" + regionRef(r)}, "corrupted")
	}
	return set
}

// CreatureTags is what the weather over a tile adds to creatures there.
func (s *State) CreatureTags(h hex.Hex) []string {
	if sys, ok := s.Weather(h); ok {
		return s.sky.Effects(sys.Kind, sys.Strength).CreatureTags
	}
	return nil
}

func (s *State) terrain(id string) *sheets.Terrain {
	for i := range s.b.Terrain {
		if s.b.Terrain[i].ID == id {
			return &s.b.Terrain[i]
		}
	}
	panic("world: no terrain " + id)
}

// Sight is how many tiles round a character on h are revealed: its
// terrain's sight, cut by a dead zone, lengthened on high ground under a
// clear sky.
func (s *State) Sight(h hex.Hex) int64 {
	t := s.g.Baseline(h)
	sight := s.terrain(t.Terrain).Sight
	if sys, ok := s.Weather(h); ok {
		e := s.sky.Effects(sys.Kind, sys.Strength)
		if e.Sight > 0 {
			sight = min(sight, e.Sight)
		}
		if t.Elevation >= s.wp("high-elevation") {
			sight += e.HighSight
		}
	}
	return sight
}

// EnterTicks is what stepping from one tile onto a neighbour costs on
// foot now: the baseline cost, a strong storm's drag, and a cold snap
// freezing rivers and wet ground to one tick. Impassable is false.
func (s *State) EnterTicks(from, to hex.Hex) (int64, bool) {
	t := s.g.Baseline(to)
	ter := s.terrain(t.Terrain)
	if !ter.Passable {
		return 0, false
	}
	cost := ter.EnterTicks
	if t.River {
		if s.g.Baseline(from).River {
			cost = sheets.IntParam(s.b.MapParams, "river-along-ticks")
		} else {
			cost = max(sheets.IntParam(s.b.MapParams, "river-across-ticks"), cost)
		}
	}
	if sys, ok := s.Weather(to); ok {
		e := s.sky.Effects(sys.Kind, sys.Strength)
		if e.CrossTicks > 0 && (t.River || slices.Contains(ter.Tags, "wet")) {
			cost = e.CrossTicks
		}
		cost += e.EnterTicks
	}
	return cost, true
}

// Path is the quickest walk now between two tiles inside the horizon.
func (s *State) Path(a, b hex.Hex) ([]hex.Hex, int64, bool) {
	step := func(from, to hex.Hex) (int64, bool) {
		if s.RegionAt(to) < 0 {
			return 0, false
		}
		return s.EnterTicks(from, to)
	}
	return hex.Path(a, b, step, 1, 0)
}
