package harness

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"jams.team/mmo-world/harness/agent"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

func crimeBook(t *testing.T) *sheets.Book {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// TestCrimeSoak: ten players, one a thief, over ten world days: the
// ledger audits clean, no theft takes from what a theft may not, no fence
// or trader pays past its slice, and the report's readings name every
// crime target.
func TestCrimeSoak(t *testing.T) {
	b := crimeBook(t)
	r, err := soakCrime(b, 10, 10, true)
	if err != nil {
		t.Fatal(err)
	}
	w := r.watch
	if n := len(w.thieves()); n != 1 {
		t.Fatalf("%d thieves among 10 players, want 1", n)
	}
	if len(r.audit) > 0 || !w.mints() {
		t.Fatalf("audit %v, refused sources %v, slices overspent %v", r.audit, w.bad, w.over)
	}
	if w.mostDay > agent.NewThief(b, &agent.Earner{}).PerDay {
		t.Fatalf("a thief made %d thefts in a world day", w.mostDay)
	}
	var doc lineDoc
	got := map[string]bool{}
	for _, m := range crimeReport(doc.p, b, []crimeSoak{r}, 10) {
		got[m.Target] = true
	}
	for _, id := range []string{"theft-never-mints", "thieves-hold-band", "coin-drift", "invitation-days", "road-war-city-slip"} {
		if !got[id] {
			t.Errorf("no reading for %s", id)
		}
	}
	if !strings.Contains(doc.b.String(), "| theft-never-mints |") {
		t.Error("the report has no readings table")
	}
}

// TestThievesSteal: thieves at a settlement whose NPCs hold coin steal at
// once, no more than three times a world day, through the service as
// chat sends it; every haul leaves an NPC's purse and the audit holds.
func TestThievesSteal(t *testing.T) {
	b := crimeBook(t)
	tw, err := newTheftWorld(b, "crime-test", 0)
	if err != nil {
		t.Fatal(err)
	}
	g := tw.g
	local := service.NewLocal(g)
	bands := agent.Bands(b)
	var players []*agent.Player
	for i := range 10 {
		e := &agent.Earner{Role: agent.Gatherer, BandOrder: bands, Comfort: 400}
		players = append(players, &agent.Player{Discord: fmt.Sprintf("thief-%d", i), Start: "hook", Policy: agent.NewThief(b, e)})
	}
	sw := &soakWorld{g: g, local: local, client: local, players: players}
	w := &crimeWatch{}
	script := agent.NewScript(w.open(sw), players, "crime-test")
	ctx := context.Background()
	if err := script.Turn(ctx, 0); err != nil {
		t.Fatal(err)
	}
	for _, p := range players {
		c := g.Char(p.Character)
		if c == nil {
			t.Fatalf("%s made no character", p.Discord)
		}
		if err := g.Teleport(c, tw.home); err != nil {
			t.Fatal(err)
		}
		tw.cs = append(tw.cs, c)
	}
	if err := tw.fund(); err != nil {
		t.Fatal(err)
	}
	for tick := int64(1); tick < 2*sheets.TicksPerDay; tick++ {
		if err := script.Turn(ctx, tick); err != nil {
			t.Fatal(err)
		}
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
		g.Flush()
		w.tick(g, local.Txns())
		if g.Tick()%sheets.TicksPerDay == 0 {
			local.Forget()
			w.day(g)
		}
	}
	w.close(ledger.Audit(g.Ledger.Balances(), g.Holdings()))
	if len(w.first) == 0 || w.begun() == 0 || w.thefts == 0 {
		t.Fatalf("no theft: %d thieves stole, %d thefts, %d hauls; refused %v", len(w.first), w.begun(), w.thefts, w.refusals)
	}
	if w.mostDay > players[0].Policy.(*agent.Thief).PerDay {
		t.Fatalf("a thief made %d thefts in a world day", w.mostDay)
	}
	if !w.mints() {
		t.Fatalf("refused sources %v, slices overspent %v, audit %v", w.bad, w.over, w.audit)
	}
	if w.stolen == 0 {
		t.Fatal("no lift took coin from a purse")
	}
	t.Logf("%d thefts by %d thieves (%d won, %d caught), %d coin taken, at most %d by one in a day", w.begun(), len(w.first), w.outcome(theftWon), w.outcome(theftLost), w.stolen, w.mostDay)
}
