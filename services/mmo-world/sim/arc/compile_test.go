package arc

import (
	"strings"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/sheets"
)

func registerForTest(t *testing.T, id string, p Predicate) {
	t.Helper()
	if _, ok := Predicates[id]; ok {
		t.Fatalf("predicate %q is already registered", id)
	}
	Predicates[id] = p
	t.Cleanup(func() { delete(Predicates, id) })
}

func TestCompileOrderAndRows(t *testing.T) {
	none := func(World, Row, Params) []Candidate { return nil }
	registerForTest(t, "compile-test-a", none)
	registerForTest(t, "compile-test-b", none)
	b := &sheets.Book{
		Arcs: []sheets.ArcRow{
			{ID: "arc-two", Scope: ScopeWorld, When: "compile-test-b", Chance: 40, Cast: []sheets.CastRow{{Role: "seat", Kind: "settlement", Pick: "nearest"}}},
			{ID: "arc-one", Scope: Region, When: "compile-test-a", Chance: 10},
		},
		Troubles:  []sheets.TroubleRow{{ID: "raid", When: "compile-test-a", Chance: 50}},
		Occasions: []sheets.OccasionRow{{ID: "caravan", When: "compile-test-b", Chance: 30}},
	}
	ts, err := Compile(b)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, tm := range ts {
		ids = append(ids, tm.Row.ID+"/"+tm.Row.Scope)
		if tm.When == nil {
			t.Fatalf("%s has no predicate", tm.Row.ID)
		}
	}
	if got, want := strings.Join(ids, ","), "arc-two/world,arc-one/region,raid/settlement,caravan/settlement"; got != want {
		t.Fatalf("order %s, want %s", got, want)
	}
	if ts[0].Row.Chance != 40 || len(ts[0].Row.Cast) != 1 || ts[0].Row.Trouble != nil || ts[0].Row.Occasion != nil {
		t.Fatalf("arc row %+v", ts[0].Row)
	}
	if ts[2].Row.Trouble != &b.Troubles[0] || ts[2].Row.Chance != 50 {
		t.Fatal("a trouble's row should point at its sheet row")
	}
	if ts[3].Row.Occasion != &b.Occasions[0] || ts[3].Row.Chance != 30 {
		t.Fatal("an occasion's row should point at its sheet row")
	}
}

func TestCompileRefusesAnUnknownPredicate(t *testing.T) {
	for name, b := range map[string]*sheets.Book{
		"arc":      {Arcs: []sheets.ArcRow{{ID: "the-mystery", Scope: ScopeWorld, When: "no-such-predicate"}}},
		"trouble":  {Troubles: []sheets.TroubleRow{{ID: "flood", When: "no-such-predicate"}}},
		"occasion": {Occasions: []sheets.OccasionRow{{ID: "fair", When: "no-such-predicate"}}},
		"empty":    {Arcs: []sheets.ArcRow{{ID: "the-blank", Scope: ScopeWorld}}},
	} {
		if ts, err := Compile(b); err == nil || ts != nil {
			t.Errorf("%s: compiled %v with no error", name, ts)
		} else if !strings.Contains(err.Error(), "predicate") {
			t.Errorf("%s: error %q does not name the predicate", name, err)
		}
	}
}

func shippedBook(t *testing.T) *sheets.Book {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// Every template the shipped book carries has its predicate here.
func TestCompileShippedBook(t *testing.T) {
	b := shippedBook(t)
	ts, err := Compile(b)
	if err != nil {
		t.Fatal(err)
	}
	if want := len(b.Arcs) + len(b.Troubles) + len(b.Occasions); len(ts) != want || want == 0 {
		t.Fatalf("%d templates from %d rows", len(ts), want)
	}
}

// Params holds every story.params cell, at the values the design set.
func TestParamsOfShippedBook(t *testing.T) {
	b := shippedBook(t)
	p := ParamsOf(b)
	read := map[string]bool{}
	for _, c := range []struct {
		name      string
		got, want int64
	}{
		{"chronicle-min-weight", p.ChronicleMinWeight, 60}, {"chronicle-lines", p.ChronicleLines, 8},
		{"season-days", p.SeasonDays, 42}, {"season-zero-days", p.SeasonZeroDays, 14},
		{"active-days", p.ActiveDays, 7}, {"mark-floor-characters", p.MarkFloorCharacters, 2},
		{"stage-days-least", p.StageDaysLeast, 2}, {"stage-days-most", p.StageDaysMost, 5},
		{"side-pay", p.SidePay, 50}, {"side-pay-other", p.SidePayOther, 50},
		{"side-budget-share", p.SideBudgetShare, 50}, {"beat-coin", p.BeatCoin, 1},
		{"standing-for", p.StandingFor, 20}, {"standing-against", p.StandingAgainst, 60},
		{"shunned-below", p.ShunnedBelow, -50}, {"marked-ambush", p.MarkedAmbush, 150},
		{"memory-weight", p.MemoryWeight, 40}, {"memory-kept", p.MemoryKept, 512},
		{"memory-days", p.MemoryDays, 30}, {"pending-kept", p.PendingKept, 64},
		{"kept-arc-days", p.KeptArcDays, 14}, {"raid-mark", p.RaidMark, 7},
		{"keeper-watch", p.KeeperWatch, 10}, {"keeper-mend", p.KeeperMend, 10},
		{"ruin-troubles", p.RuinTroubles, 3}, {"front-joined", p.FrontJoined, 2},
		{"front-spread", p.FrontSpread, 60}, {"front-spread-days", p.FrontSpreadDays, 5},
		{"cold-share", p.ColdShare, 50}, {"cold-days", p.ColdDays, 5}, {"cold-regions", p.ColdRegions, 3},
		{"wet-share", p.WetShare, 50}, {"wet-days", p.WetDays, 3}, {"wet-scarcity", p.WetScarcity, 500},
		{"seam-below", p.SeamBelow, 100}, {"seam-stock", p.SeamStock, 40}, {"seam-radius", p.SeamRadius, 3},
		{"panic-starving-days", p.PanicStarvingDays, 3}, {"caravan-passages", p.CaravanPassages, 40},
		{"caravan-share", p.CaravanShare, 20}, {"caravan-premium", p.CaravanPremium, 120},
		{"fees-raised", p.FeesRaised, 200}, {"prices-cut", p.PricesCut, 80}, {"sick-share", p.SickShare, 200},
		{"rival-distance", p.RivalDistance, 12}, {"rival-growth-days", p.RivalGrowthDays, 14},
		{"defector-loyalty", p.DefectorLoyalty, 30}, {"betrayal-days", p.BetrayalDays, 30},
		{"leader-died-days", p.LeaderDiedDays, 30}, {"return-days", p.ReturnDays, 14},
		{"thread-standing", p.ThreadStanding, 50}, {"thread-mark", p.ThreadMark, 25},
		{"finale-lapse-bonus", p.FinaleLapseBonus, 200}, {"finale-loss-weight", p.FinaleLossWeight, 100},
		{"haywire-least", p.HaywireLeast, 200}, {"haywire-most", p.HaywireMost, 400},
		{"beacon-cost", p.BeaconCost, 20}, {"chain-distance", p.ChainDistance, 40}, {"chain-tries", p.ChainTries, 6},
		{"stocked-wall-defence", p.StockedWallDefence, 20},
	} {
		read[c.name] = true
		if c.got != c.want {
			t.Errorf("%s = %d, want %d", c.name, c.got, c.want)
		}
	}
	for _, r := range b.StoryParams {
		if !read[r.ID] {
			t.Errorf("story.params %s is not in arc.Params", r.ID)
		}
	}
}
