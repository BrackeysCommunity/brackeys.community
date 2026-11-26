package mapview

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/settle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/weather"
)

// sighted is a game with one character from a server, whose guild runs
// the first settlement, and a disc of discovered tiles round home.
type sighted struct {
	g    *game.Game
	b    *sheets.Book
	c    *game.Char
	home hex.Hex
	p    Params
}

func newSighted(t *testing.T, radius int64) *sighted {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	r, err := game.NewRules(b, sightKeys())
	if err != nil {
		t.Fatal(err)
	}
	g, err := game.New(r)
	if err != nil {
		t.Fatal(err)
	}
	res, err := g.Act(game.Command{Key: "a", Kind: game.Create, Server: "srv-1", Note: "Tinkers"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := g.Advance(); err != nil {
		t.Fatal(err)
	}
	s := &sighted{g: g, b: b, c: res.Char, home: g.Places[0].Hex, p: ParamsOf(b)}
	if g.Places[0].Guild != s.c.C.Guild || s.c.C.Guild == "" {
		t.Fatalf("the character's guild %q does not run home (%q)", s.c.C.Guild, g.Places[0].Guild)
	}
	for _, h := range hex.DiscAt(s.home, radius) {
		s.discover(t, h)
	}
	s.g.World.Sky.Systems = nil
	return s
}

func (s *sighted) discover(t *testing.T, h hex.Hex) {
	t.Helper()
	if err := s.g.World.Discover(s.g.Log, h, char.Ref(s.c.C.ID)); err != nil {
		t.Fatal(err)
	}
}

func (s *sighted) create(t *testing.T, key string) *game.Char {
	t.Helper()
	res, err := s.g.Act(game.Command{Key: key, Kind: game.Create})
	if err != nil {
		t.Fatal(err)
	}
	return res.Char
}

func (s *sighted) charKey() Key {
	k, _ := KeyOf(s.g, Holder{HolderCharacter, s.c.C.ID})
	return k
}

func (s *sighted) guild() Holder { return Holder{HolderGuild, s.c.C.Guild} }

// find is the nearest passable tile to home that ok accepts.
func (s *sighted) find(t *testing.T, radius int64, ok func(hex.Hex) bool) hex.Hex {
	t.Helper()
	for _, h := range hex.DiscAt(s.home, radius) {
		ter := s.g.World.Gen().Terrain(s.g.World.Baseline(h).Terrain)
		if ter != nil && ter.Passable && s.g.PlaceAt(h) == nil && ok(h) {
			return h
		}
	}
	t.Fatal("no tile fits")
	return hex.Hex{}
}

func (s *sighted) sky(kind string, at hex.Hex) {
	s.g.World.Sky.Systems = []weather.System{{ID: 1, Kind: kind, Centre: at}}
}

func (s *sighted) weatherRow(t *testing.T, kind string) sheets.WeatherKind {
	t.Helper()
	i := slices.IndexFunc(s.b.Weather, func(w sheets.WeatherKind) bool { return w.ID == kind })
	if i < 0 {
		t.Fatalf("no weather %s", kind)
	}
	return s.b.Weather[i]
}

// changed reports whether a pass over prev names h as changed.
func (s *sighted) changed(prev map[Holder]Key, h Holder) bool {
	changes, _ := Pass(s.g, prev, nil, s.p)
	return slices.ContainsFunc(changes, func(c Change) bool { return c.Holder == h })
}

// Every source of sight GDD 4.12 names moves a key; a quiet tick moves
// none.
func TestSightKeyChanges(t *testing.T) {
	s := newSighted(t, 12)
	mine := Holder{HolderCharacter, s.c.C.ID}

	prev := Keys(s.g)
	if _, err := s.g.Advance(); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.g.World.Weather(s.c.C.At); ok {
		t.Fatal("weather formed over home on a quiet tick; the test needs a clear sky")
	}
	if changes, gone := Pass(s.g, prev, nil, s.p); len(changes) != 0 || len(gone) != 0 {
		t.Fatalf("a quiet tick changed %v, gone %v", changes, gone)
	}

	t.Run("step", func(t *testing.T) {
		prev := Keys(s.g)
		was := s.c.C.At
		s.c.C.At = s.find(t, 2, func(h hex.Hex) bool { return hex.Distance(h, was) == 1 })
		defer func() { s.c.C.At = was }()
		if slices.Equal(prev[mine], s.charKey()) || !s.changed(prev, mine) {
			t.Error("a step left the key as it was")
		}
	})

	fog := s.weatherRow(t, "fog")
	t.Run("fog", func(t *testing.T) {
		was := s.c.C.At
		s.c.C.At = s.find(t, 12, func(h hex.Hex) bool { return s.g.World.Sight(h) > fog.Sight })
		defer func() { s.c.C.At, s.g.World.Sky.Systems = was, nil }()
		prev := Keys(s.g)
		s.sky(fog.ID, s.c.C.At)
		k := s.charKey()
		if k[0].Radius != fog.Sight || !s.changed(prev, mine) {
			t.Errorf("fog over the tile left sight %d, want %d", k[0].Radius, fog.Sight)
		}
	})

	clear := s.weatherRow(t, "clear")
	high := sheets.IntParam(s.b.WorldParams, "high-elevation")
	t.Run("high ground", func(t *testing.T) {
		was := s.c.C.At
		s.c.C.At = s.find(t, 40, func(h hex.Hex) bool { return s.g.World.Baseline(h).Elevation >= high })
		defer func() { s.c.C.At, s.g.World.Sky.Systems = was, nil }()
		prev := Keys(s.g)
		s.sky(clear.ID, s.c.C.At)
		if s.charKey()[0].Radius != prev[mine][0].Radius+clear.HighSight || !s.changed(prev, mine) {
			t.Errorf("clear sky on high ground gave %v from %v", s.charKey(), prev[mine])
		}
	})

	t.Run("beacon", func(t *testing.T) {
		if s.g.Story == nil {
			t.Fatal("no story")
		}
		prev := Keys(s.g)
		r := s.g.World.RegionAt(s.c.C.At)
		was := s.g.Story.Sight
		s.g.Story.Sight = []game.RegionBonus{{Region: r, N: 1}}
		defer func() { s.g.Story.Sight = was }()
		if s.charKey()[0].Radius != prev[mine][0].Radius+1 || !s.changed(prev, mine) || !s.changed(prev, s.guild()) {
			t.Error("a beacon's region bonus left the keys as they were")
		}
	})

	var founded *game.Place
	t.Run("founded", func(t *testing.T) {
		prev := Keys(s.g)
		at := s.find(t, 12, func(h hex.Hex) bool { return hex.Distance(h, s.home) >= 6 })
		founded = &game.Place{N: len(s.g.Places), Hex: at, Lattice: -1, Guild: s.c.C.Guild, Founded: s.g.Tick()}
		s.g.Places = append(s.g.Places, founded)
		k, _ := KeyOf(s.g, s.guild())
		if !slices.Contains(k, Disc{Q: at.Q, R: at.R, Radius: s.g.Sight(at)}) || !s.changed(prev, s.guild()) {
			t.Errorf("a settlement founded left the guild's key %v", k)
		}
		if s.changed(prev, mine) {
			t.Error("a settlement founded moved the character's key")
		}
	})

	t.Run("city", func(t *testing.T) {
		if founded == nil {
			t.Skip("nothing founded")
		}
		prev := Keys(s.g)
		n := founded.Hex.Neighbour(0)
		founded.City = &settle.City{Raised: s.g.Tick(), Tiles: []hex.Hex{n}}
		k, _ := KeyOf(s.g, s.guild())
		if !slices.Contains(k, Disc{Q: n.Q, R: n.R, Radius: s.g.Sight(n)}) || !s.changed(prev, s.guild()) {
			t.Errorf("a city raised left the guild's key %v", k)
		}
	})

	t.Run("ruined", func(t *testing.T) {
		if founded == nil {
			t.Skip("nothing founded")
		}
		prev := Keys(s.g)
		founded.Ruined = s.g.Tick()
		k, _ := KeyOf(s.g, s.guild())
		if slices.ContainsFunc(k, func(d Disc) bool { return d.Q == founded.Hex.Q && d.R == founded.Hex.R }) || !s.changed(prev, s.guild()) {
			t.Errorf("a ruin kept its sight in %v", k)
		}
	})

	t.Run("joining changes no key", func(t *testing.T) {
		prev := Keys(s.g)
		other := s.create(t, "b")
		other.C.Guild = s.c.C.Guild
		changes, _ := Pass(s.g, prev, nil, s.p)
		for _, c := range changes {
			if c.Holder != (Holder{HolderCharacter, other.C.ID}) {
				t.Errorf("joining a guild changed %v", c.Holder)
			}
		}
	})
}

// A character on a dungeon floor sees only its entrance tile, and a
// guild's sight joins its member's.
func TestSightsFloorAndGuild(t *testing.T) {
	s := newSighted(t, 12)
	if k := s.charKey(); k[0].Radius != s.g.Sight(s.c.C.At) {
		t.Fatalf("sight %v", k)
	}
	s.c.C.At = s.find(t, 12, func(h hex.Hex) bool { return hex.Distance(h, s.home) == 9 })
	s.c.C.Floor = 1
	if k := s.charKey(); len(k) != 1 || k[0].Radius != 0 {
		t.Fatalf("a floor's key is %v", k)
	}
	in := Sights(s.g, s.c)
	gk, _ := KeyOf(s.g, s.guild())
	want := Set(s.g, gk)
	for _, h := range want {
		if !in[h] {
			t.Fatalf("guild sight %v missing from the member's", h)
		}
	}
	if !in[s.c.C.At] || len(in) != len(want)+1 {
		t.Errorf("sights hold %d tiles, want the guild's %d and the entrance", len(in), len(want))
	}
}

func sightKeys() keys.Set { return keys.Throwaway("mapview-sight") }
