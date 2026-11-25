package world

import (
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/weather"
)

// TerrainTags is what a terrain gives a place: its tags, then its place
// tags. A fight site off the map reads the same.
func TerrainTags(t *sheets.Terrain) []tags.Tag {
	return append(tags.Of(t.Tags), tags.Of(t.PlaceTags)...)
}

// Place is what rules read of a tile as a place (GDD 4.12, 8.6): its
// terrain's tags and place tags, its ecotone's tags, the weather over it
// and what the weather leaves, and what its stored state says (fire,
// corruption, local weather). Each tag says where it came from.
func (s *State) Place(h hex.Hex) tags.TagSet {
	t := s.Baseline(h)
	ter := s.terrain(t.Terrain)
	var set tags.TagSet
	add := func(from tags.Source, ts ...string) {
		for _, x := range ts {
			set.Add(tags.Held{Tag: tags.Tag(x), From: from})
		}
	}
	for _, x := range TerrainTags(ter) {
		set.Add(tags.Held{Tag: x, From: tags.Source{Note: "terrain:" + t.Terrain}})
	}
	if e, ok := s.ecotones[t.Edge]; ok {
		add(tags.Source{Note: "ecotone:" + e.ID}, "edge", e.Tag)
	}
	if e, kind := s.weatherAt(h); kind != "" {
		add(tags.Source{Note: "weather:" + kind}, e.TileTags...)
	}
	if st := s.Tile(h); st != nil {
		add(tags.Source{Note: "tile:" + "weather"}, st.WeatherTags...)
		if st.Fire.State == tile.FireBurning {
			add(tags.Source{Note: "tile:" + "fire"}, "burning")
		}
		if st.Corruption >= LineAt(s.b, "corrupted-nodes") {
			add(tags.Source{Note: "tile:" + "corruption"}, "corrupted")
		}
	}
	if r := s.RegionAt(h); r >= 0 && s.Past(h, "corrupted-nodes") {
		add(tags.Source{Note: "region:" + RegionRef(r)}, "corrupted")
	}
	return set
}

// CreatureTags is what the weather over a tile adds to creatures there.
func (s *State) CreatureTags(h hex.Hex) []string {
	e, _ := s.weatherAt(h)
	return e.CreatureTags
}

// weatherAt is the effects of the weather over h and its kind; none gives
// zero effects and an empty kind.
func (s *State) weatherAt(h hex.Hex) (weather.Effects, string) {
	sys, ok := s.Weather(h)
	if !ok {
		return weather.Effects{}, ""
	}
	return s.sky.Effects(sys.Kind, sys.Strength), sys.Kind
}

func (s *State) terrain(id string) *sheets.Terrain {
	if t := s.g.Terrain(id); t != nil {
		return t
	}
	panic("world: no terrain " + id)
}

// Sight is how many tiles round a character on h are revealed: its
// terrain's sight, cut by a dead zone, lengthened on high ground under a
// clear sky.
func (s *State) Sight(h hex.Hex) int64 {
	t := s.Baseline(h)
	sight := s.terrain(t.Terrain).Sight
	if e, kind := s.weatherAt(h); kind != "" {
		if e.Sight > 0 {
			sight = min(sight, e.Sight)
		}
		if t.Elevation >= s.wp("high-elevation") {
			sight += e.HighSight
		}
	}
	return sight
}

// EnterTicks is the cost on foot of stepping from one tile onto a
// neighbour now: the baseline, the weather's crossing cost on rivers and
// wet ground, plus its drag. ok is false onto impassable terrain.
func (s *State) EnterTicks(from, to hex.Hex) (cost int64, ok bool) {
	t := s.Baseline(to)
	ter := s.terrain(t.Terrain)
	if !ter.Passable {
		return 0, false
	}
	cost = s.g.StepTicks(t.Terrain, t.River && s.Baseline(from).River, t.River)
	if e, kind := s.weatherAt(to); kind != "" {
		if e.CrossTicks > 0 && (t.River || ter.Wet()) {
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
