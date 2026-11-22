package game

import (
	"errors"
	"strings"
	"testing"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/sheets"
)

// A world arc cast once the season has fewer stage bands left than the
// arc has stages is refused, the game unchanged; the finale is still cast
// on the finale band's first day.
func TestWorldArcTooLateForItsStages(t *testing.T) {
	g := guardGame(t)
	c, tb, ok := g.Season()
	if !ok || tb.StageEnds(0) == 0 {
		t.Fatal("season zero has no stage bands")
	}
	late := (c.Start + tb.StageEnds(0)) * sheets.TicksPerDay
	for g.Tick() < late {
		advance(t, g)
	}
	for _, a := range g.openArcs(arc.ScopeWorld) {
		t.Fatalf("%s already holds the world slot", a.ID)
	}
	before, err := g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	_, err = g.CastArc("the-siege", siegeCast(t, g), g.SettlementHex(0), ByOperator, g.Tick())
	var ref *Refused
	if !errors.As(err, &ref) || ref.Code != SlotBusy || !strings.Contains(ref.Error(), "stage bands") {
		t.Fatalf("a siege cast after the first stage band: %v, want %s", err, SlotBusy)
	}
	if after, _ := g.Digest(); after != before {
		t.Fatal("the late cast was refused but changed the game")
	}
	// Nothing presses in a world nobody plays, so a region's threat is
	// raised over its line for the finale to be cast from.
	finaleDay := c.Start + tb.FinaleFrom() - 1
	for g.Tick() < finaleDay*sheets.TicksPerDay-1 {
		advance(t, g)
	}
	gi, ok := g.World.GaugeOf(gaugeThreat)
	r := g.World.RegionAt(g.SettlementHex(0))
	if !ok || r < 0 {
		t.Fatal("no threat gauge at the first settlement")
	}
	g.World.Regions[r].Gauge[gi] = 2 * max(g.storyView().LineFrom(gaugeThreat), 1)
	for g.Tick() <= finaleDay*sheets.TicksPerDay {
		advance(t, g)
	}
	var finale *Arc
	for _, a := range g.Story.Arcs {
		if a.Scope == arc.ScopeWorld && a.By == ByFinale {
			finale = a
		}
	}
	if finale == nil || finale.Began != finaleDay*sheets.TicksPerDay {
		t.Fatalf("the finale band's first day cast %+v", finale)
	}
}
