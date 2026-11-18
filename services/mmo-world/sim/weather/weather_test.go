package weather_test

import (
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/weather"
)

// ground is plain everywhere except where told.
type ground map[hex.Hex]string

func (g ground) Terrain(h hex.Hex) string {
	if t, ok := g[h]; ok {
		return t
	}
	return "plain"
}
func (g ground) Elevation(h hex.Hex) int64 {
	if g.Terrain(h) == "mountain" {
		return 70
	}
	return 40 + h.R
}

func rules(t *testing.T) *weather.Rules {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	return weather.NewRules(b)
}

func run(r *weather.Rules, s *weather.Sky, g weather.Ground, n int) {
	for range n {
		s.Tick(r, g)
	}
}

// A system moves with its heading, at its pace, and steers round a
// mountain instead of entering it.
func TestMovesAndSteers(t *testing.T) {
	r := rules(t)
	g := ground{}
	for q := int64(-3); q <= 3; q++ {
		g[hex.Hex{Q: 5, R: q}] = "mountain"
	}
	s := &weather.Sky{Systems: []weather.System{{ID: 1, Kind: "frost", Strength: 40, Life: 1000, Wait: 1}}}
	for range 200 {
		s.Tick(r, g)
		if g.Terrain(s.Systems[0].Centre) == "mountain" {
			t.Fatalf("centre entered a mountain at %v", s.Systems[0].Centre)
		}
	}
	if s.Systems[0].Centre.Q <= 4 && s.Systems[0].Centre.Len() < 5 {
		t.Fatalf("system did not get past the range: %v", s.Systems[0].Centre)
	}
}

// Storms gain strength over water; a storm meeting a cold snap leaves a
// cold snap of half its strength; a storm reaching an ash front ends it.
func TestStrengthAndMeetings(t *testing.T) {
	r := rules(t)
	water := ground{}
	for _, h := range hex.Disc(40) {
		water[h] = "deep-water"
	}
	s := &weather.Sky{Systems: []weather.System{{ID: 1, Kind: "storm", Strength: 30, Life: 5000, Wait: 1}}, NextID: 2}
	run(r, s, water, 100)
	if s.Systems[0].Strength <= 30 {
		t.Fatalf("storm over water stayed at %d", s.Systems[0].Strength)
	}
	s = &weather.Sky{NextID: 3, Systems: []weather.System{
		{ID: 1, Kind: "storm", Strength: 60, Life: 500, Wait: 100},
		{ID: 2, Kind: "frost", Centre: hex.Hex{Q: 3}, Strength: 20, Life: 500, Wait: 100},
	}}
	ev := s.Tick(r, ground{})
	if len(ev) != 1 || ev[0].Kind != weather.EventLeft || ev[0].System.Kind != "frost" || ev[0].System.Strength != 30 {
		t.Fatalf("meeting gave %+v", ev)
	}
	if ev = s.Tick(r, ground{}); len(ev) != 0 {
		t.Fatalf("a pair met twice: %+v", ev)
	}
	s = &weather.Sky{NextID: 3, Systems: []weather.System{
		{ID: 1, Kind: "storm", Strength: 60, Life: 500, Wait: 100},
		{ID: 2, Kind: "drought", Centre: hex.Hex{Q: 2}, Strength: 20, Life: 500, Wait: 100},
	}}
	s.Tick(r, ground{})
	if len(s.Systems) != 1 || s.Systems[0].Kind != "storm" {
		t.Fatalf("ash front survived a storm: %+v", s.Systems)
	}
}

// Systems form up to the cap, where the cell favours them, and the
// forecast is the same run carried forward.
func TestFormAndForecast(t *testing.T) {
	r := rules(t)
	d := draw.NewDrawer(keys.Throwaway("weather").Roll)
	var cells []weather.Cell
	for i := range int64(40) {
		cells = append(cells, weather.Cell{I: i, Centre: hex.Hex{Q: i * 20}, Terrain: "marsh"})
	}
	s := &weather.Sky{}
	g := ground{}
	formed := 0
	for day := int64(1); day <= 30; day++ {
		for _, e := range s.Day(r, d, g, day, cells, 60) {
			if e.Kind == weather.EventFormed {
				formed++
			}
		}
		if len(s.Systems) > 10 {
			t.Fatalf("day %d: %d systems for 60 regions", day, len(s.Systems))
		}
		run(r, s, g, 144)
	}
	if formed == 0 {
		t.Fatal("nothing formed")
	}
	s.Day(r, d, g, 31, cells, 60)
	if len(s.Systems) == 0 {
		t.Skip("no live system to forecast")
	}
	f := s.Forecast(r, g, r.Exact())
	run(r, s, g, int(r.Exact()))
	last := f[len(f)-1]
	if len(last) != len(s.Systems) {
		t.Fatalf("forecast has %d systems, the run %d", len(last), len(s.Systems))
	}
	for i := range last {
		if last[i].Centre != s.Systems[i].Centre || last[i].Strength != s.Systems[i].Strength {
			t.Fatalf("forecast %+v, run %+v", last[i], s.Systems[i])
		}
	}
	e := r.Effects("storm", 60)
	if e.EnterTicks != 1 || e.TileTags[0] != "storm" {
		t.Fatalf("storm effects %+v", e)
	}
	if r.Effects("storm", 59).EnterTicks != 0 {
		t.Fatal("a weak storm slows travel")
	}
}
