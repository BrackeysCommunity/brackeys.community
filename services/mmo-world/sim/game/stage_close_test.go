package game

import (
	"testing"

	"jams.team/mmo-world/sim/sheets"
)

// TestStageClosesAtEnds: a drop opened mid-day takes a crate-open the tick
// before its end and refuses one at its end.
func TestStageClosesAtEnds(t *testing.T) {
	g, c, home := houseGame(t)
	for g.Tick()%sheets.TicksPerDay == 0 {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	at := stageTile(t, g, home)
	mustAct(t, g, stageOrder("d1", c, "a", true, false, StageCmd{Template: "drop-small", Settlement: home, At: at, Days: 1}))
	st := g.StageByID("st-1")
	if !st.Open || st.Ends%sheets.TicksPerDay == 0 {
		t.Fatalf("want a drop open now and ending mid-day, got %+v", st)
	}
	x := joinA(t, g, 1)[0]
	if err := g.Teleport(x, at); err != nil {
		t.Fatal(err)
	}
	for g.Tick() < st.Ends-1 {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	mustAct(t, g, Command{Key: "last", Char: x.C.ID, Kind: CrateOpen, Target: st.ID})
	if _, err := g.Advance(); err != nil {
		t.Fatal(err)
	}
	if g.Tick() != st.Ends || !st.Closed {
		t.Fatalf("at tick %d (ends %d) the stage reads closed %v", g.Tick(), st.Ends, st.Closed)
	}
	stageRefused(t, g, Command{Key: "late", Char: x.C.ID, Kind: CrateOpen, Target: st.ID}, NoStage)
	audit(t, g)
}
