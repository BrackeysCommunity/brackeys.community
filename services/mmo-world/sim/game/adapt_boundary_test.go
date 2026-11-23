package game

import (
	"testing"

	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fight"
)

// A press resolved on the day boundary counts toward the new day before
// the day turn runs; the turn must still read the day just ended.
func TestAdaptationReadsYesterdayAfterABoundaryPress(t *testing.T) {
	g := feedGame(t)
	p := g.r.Emerge.P
	h := openTiles(t, g, 1)[0]
	st := nameStyle(t, g, h, keenCut())
	c := feedChars(t, g, 1, h)[0]
	eel := &fight.Encounter{Creature: fight.Creature{Archetype: wireEel}}
	plain := fight.Option{ID: "test-plain", Axis: "edge"}
	day := int64(3)
	for range 7 {
		mustFeed(t, g.noteReliance(c, eel, keenCut(), dayTick(day)))
	}
	for range 3 {
		mustFeed(t, g.noteReliance(c, eel, plain, dayTick(day)))
	}
	share := int64(70)
	if share < p.AdaptFloor {
		t.Fatalf("the test's share %d is under adapt-floor %d", share, p.AdaptFloor)
	}
	mustFeed(t, g.noteReliance(c, eel, keenCut(), dayTick(day+1)))
	if err := adaptationDay(g, day+1, 0); err != nil {
		t.Fatal(err)
	}
	if want := emerge.Adapted(0, share, p); st.Adapt != want {
		t.Fatalf("adaptation %d after a boundary press, want %d", st.Adapt, want)
	}
}
