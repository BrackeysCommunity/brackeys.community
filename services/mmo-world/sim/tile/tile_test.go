package tile

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/fact"
)

func TestDecay(t *testing.T) {
	for _, c := range []struct{ v, pct, want int64 }{
		{1, 1, 0},
		{1, 10, 0},
		{50, 100, 0},
		{50, 0, 50},
		{0, 10, 0},
		{-3, 10, -3},
		{100, 10, 90},
		{99, 10, 89},
	} {
		if got := decay(c.v, c.pct); got != c.want {
			t.Errorf("decay(%d, %d) = %d, want %d", c.v, c.pct, got, c.want)
		}
	}
}

func TestDecayReachesZero(t *testing.T) {
	v := int64(1_000_000)
	for step := 0; v > 0; step++ {
		if step > 2000 {
			t.Fatalf("decay at 1%% still at %d after %d steps", v, step)
		}
		v = decay(v, 1)
	}
}

func TestTileRetainsRecentTracksAndHeavyEvents(t *testing.T) {
	p := Params{TracksKept: 2, EventRing: 2, HeavyFact: 60}
	var tile State
	who := fact.Ref{Kind: "character", ID: "traveller"}
	for i := int64(1); i <= 3; i++ {
		tile.Visit(p, who, i)
		tile.Remember(p, fact.Fact{ID: fact.ID(i), Weight: 60})
	}
	tile.Remember(p, fact.Fact{ID: 4, Weight: 59})
	if !slices.Equal(tile.Tracks, []Track{{Who: who, Tick: 2}, {Who: who, Tick: 3}}) || tile.Visits != 3 {
		t.Fatal(tile.Tracks, tile.Visits)
	}
	if !slices.Equal(tile.Events, []fact.ID{2, 3}) {
		t.Fatal(tile.Events)
	}
}

func TestDailyDecayAndSeasonReset(t *testing.T) {
	s := State{Rumours: []Rumour{{Fact: 1, Expires: 3}, {Fact: 2, Expires: 4}}}
	p := Params{decay: map[string]int64{CounterGathered: 50, CounterBattlesWon: 50, CounterPassage: 50}}
	s.Gather("ore", 4)
	s.Leave(2)
	s.Slay("hound")
	s.WonBeat("pack")
	s.Decay(p, 3)
	if s.Gathered["ore"] != 2 || len(s.BattlesWon) != 0 || s.Passage[2] != 0 || !slices.Equal(s.Rumours, []Rumour{{Fact: 2, Expires: 4}}) {
		t.Fatal(s)
	}
	if s.Slain["hound"] != 1 || s.Season[CounterGathered] != 4 || s.Season[CounterPassage] != 1 || s.Season[CounterBattlesWon] != 1 {
		t.Fatal(s.Season, s.Slain)
	}
	s.NewSeason()
	if len(s.Slain) != 0 || len(s.Season) != 0 || s.Empty() {
		t.Fatal(s)
	}
	s.Decay(p, 4)
	s.Decay(p, 5)
	s.Tidy()
	if !s.Empty() || s.Gathered != nil || s.BattlesWon != nil {
		t.Fatal(s)
	}
}
