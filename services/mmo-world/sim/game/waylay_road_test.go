package game

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/settle"
	"jams.team/mmo-world/sim/sheets"
)

// A waylay on the open road is seen at the kind's own witness, a single
// base part, like one in a settlement.
func TestWaylayOnTheRoad(t *testing.T) {
	g, rt, _ := routeGame(t)
	c := mustCreate(t, g, "raider", "knife")
	toDay(t, g, rt.Next)
	if g.Emergence == nil || len(g.Emergence.Caravans) == 0 {
		t.Fatal("no caravan left")
	}
	cv := g.Emergence.Caravans[0]
	span := cv.Arrive - cv.Depart
	for shift := int64(1); shift < span && g.IsSettlement(g.caravanAt(cv, g.Tick())); shift++ {
		cv.Depart, cv.Arrive = cv.Depart-1, cv.Arrive-1
	}
	at := g.caravanAt(cv, g.Tick())
	if g.IsSettlement(at) {
		t.Fatal("the caravan never leaves a settlement")
	}
	c.C.At = at
	i := slices.IndexFunc(g.StealTargets(c), func(st StealTarget) bool { return st.Kind == KindWaylay && st.Caravan == cv.ID })
	if i < 0 {
		t.Fatalf("no waylay of %s on the road at %v", cv.ID, at)
	}
	st := g.StealTargets(c)[i]
	if st.Witness != fixed.Hundredths || len(st.Parts) != 1 || st.Parts[0].Label != partBase || st.Parts[0].Value != fixed.Hundredths {
		t.Fatalf("a waylay on the road is seen at %d from %+v", st.Witness, st.Parts)
	}
}

// A den born in a city that was never a starting settlement outlives the
// city's ruin though nobody met its fence, and the next world day moves it
// on under the same fence.
func TestRuinedCityDenMoves(t *testing.T) {
	g := storyGame(t)
	city := plainPlace(t, g, g.SettlementHex(0), 6)
	plainPlace(t, g, city.Hex, 6)
	city.City = &settle.City{Raised: g.Tick()}
	d, ok := g.DenAt(city.Hex)
	if !ok || g.Places[d.Place].Lattice >= 0 {
		t.Fatal("the city holds no den of its own")
	}
	if g.NPCs.Get(d.Fence) != nil {
		t.Fatal("the city's fence was met before the ruin")
	}
	if err := g.ruin(city.N, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if !slices.ContainsFunc(g.Dens(), func(x Den) bool { return x.Fence == d.Fence }) {
		t.Fatal("the ruined city's den vanished before the world day")
	}
	toDay(t, g, g.Tick()/sheets.TicksPerDay+1)
	i := slices.IndexFunc(g.Dens(), func(x Den) bool { return x.Fence == d.Fence })
	if i < 0 {
		t.Fatal("the den is gone after the world day")
	}
	moved := g.Dens()[i]
	if moved.At == city.Hex || moved.Place == city.N || !g.IsSettlement(moved.At) || g.Places[moved.Place].Ruined != 0 {
		t.Fatalf("the den stands at %+v", moved)
	}
	audit(t, g)
}
