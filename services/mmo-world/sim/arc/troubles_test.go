package arc

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/sheets"
)

var (
	troubleRow   = func(id string) Row { return Row{ID: id, Scope: Settlement} }
	migrationRow = Row{ID: "migration", Scope: Settlement, Occasion: &sheets.OccasionRow{ID: "migration", Hunt: "dust-runner-migration"}}
)

// troubleWorld is three regions with a standing place in the middle one.
func troubleWorld() *fake {
	w := newFake(3)
	w.place(1, nearSettlement)
	return w
}

// skipsFallenAndBusy checks a trouble predicate eligible on w leaves out a
// ruined place, a closed one and a busy one.
func skipsFallenAndBusy(t *testing.T, id string, w *fake) {
	t.Helper()
	one(t, run(t, w, id, troubleRow(id)))
	w.places[0].Ruined = true
	none(t, run(t, w, id, troubleRow(id)))
	w.places[0].Ruined, w.places[0].Open = false, false
	none(t, run(t, w, id, troubleRow(id)))
	w.places[0].Open = true
	w.setBusy(Settlement, SettlementRef(0))
	none(t, run(t, w, id, troubleRow(id)))
}

func TestRaidNear(t *testing.T) {
	w := troubleWorld()
	none(t, run(t, w, "raid-near", troubleRow("raid")))

	w.regions[0].lines[lineRaid], w.regions[0].gauge[gaugeThreat] = true, 820
	w.regions[2].lines[lineRaid], w.regions[2].gauge[gaugeThreat] = true, 870
	raids := w.remember(memRaids, 19, 2)
	c := one(t, run(t, w, "raid-near", troubleRow("raid")))
	bound(t, c, "place", SettlementRef(0))
	bound(t, c, "source", RegionRef(2))
	if c.Place != 0 || c.Pressure != 870 || !slices.Equal(c.Regions, []int{1}) || !slices.Equal(c.Causes, []fact.ID{raids}) {
		t.Fatalf("place %d pressure %d regions %v causes %v", c.Place, c.Pressure, c.Regions, c.Causes)
	}
	skipsFallenAndBusy(t, "raid-near", w)
}

func TestFireRisk(t *testing.T) {
	w := troubleWorld()
	none(t, run(t, w, "fire-risk", troubleRow("fire")))
	w.regions[1].lines[lineFire], w.regions[1].gauge[gaugeUnrest] = true, 720
	c := one(t, run(t, w, "fire-risk", troubleRow("fire")))
	if c.Pressure != 720 {
		t.Fatalf("pressure %d", c.Pressure)
	}
	skipsFallenAndBusy(t, "fire-risk", w)
}

func TestFireAfterARaidIgnoresRest(t *testing.T) {
	w := troubleWorld()
	w.followed[0] = (w.day - 1) * sheets.TicksPerDay
	lost := w.remember(memTroubleLost, w.day-1, 1)
	w.memory[len(w.memory)-1].At = w.places[0].Hex
	w.setBusy(Settlement, SettlementRef(0))
	c := one(t, run(t, w, "fire-risk", troubleRow("fire")))
	if !slices.Contains(c.Causes, lost) {
		t.Fatalf("causes %v", c.Causes)
	}

	w.followed[0] = (w.day - 2) * sheets.TicksPerDay
	none(t, run(t, w, "fire-risk", troubleRow("fire")))
	w.followed[0] = (w.day - 1) * sheets.TicksPerDay
	none(t, run(t, plain{w}, "fire-risk", troubleRow("fire")))
}

func TestCorruptionNextDoor(t *testing.T) {
	w := troubleWorld()
	w.regions[1].lines[lineCorruption] = true
	none(t, run(t, w, "corruption-next-door", troubleRow("corruption")))

	w.regions[2].lines[lineCorruption], w.regions[2].gauge[gaugeCorruption] = true, 640
	c := one(t, run(t, w, "corruption-next-door", troubleRow("corruption")))
	bound(t, c, "source", RegionRef(2))
	if !slices.Equal(c.Regions, []int{2}) || c.Pressure != 640 {
		t.Fatalf("regions %v pressure %d", c.Regions, c.Pressure)
	}
	skipsFallenAndBusy(t, "corruption-next-door", w)
}

func TestScarcityHigh(t *testing.T) {
	w := troubleWorld()
	w.regions[0].lines[lineYields] = true
	none(t, run(t, w, "scarcity-high", troubleRow("shortage")))
	w.regions[1].lines[lineYields] = true
	skipsFallenAndBusy(t, "scarcity-high", w)
}

func TestWetAndScarce(t *testing.T) {
	w := troubleWorld()
	w.regions[1].streak[StreakWet] = params.WetDays
	w.regions[1].gauge[gaugeScarcity] = params.WetScarcity
	none(t, run(t, w, "wet-and-scarce", troubleRow("sickness")))
	w.regions[1].gauge[gaugeScarcity]++
	skipsFallenAndBusy(t, "wet-and-scarce", w)
	w.regions[1].streak[StreakWet]--
	w.busy = map[string]bool{}
	none(t, run(t, w, "wet-and-scarce", troubleRow("sickness")))
}

func TestFactionCollapsing(t *testing.T) {
	w := troubleWorld()
	w.faction("guild", mercantile, 2, 50, 2, 0)
	none(t, run(t, w, "faction-collapsing", troubleRow("panic")))

	w.factions[0].StarvingDays = params.PanicStarvingDays
	c := one(t, run(t, w, "faction-collapsing", troubleRow("panic")))
	bound(t, c, "faction", FactionRef(0))

	w.factions[0].StarvingDays = 0
	w.factions[0].Holdings = []int{2}
	w.regions[0].holder = -1
	none(t, run(t, w, "faction-collapsing", troubleRow("panic")))
	w.remember(memHoldingFell, 1, 0, FactionRef(0), FactionRef(1))
	none(t, run(t, w, "faction-collapsing", troubleRow("panic")))
	w.remember(memHoldingFell, 1, 0, FactionRef(1), FactionRef(0))
	one(t, run(t, w, "faction-collapsing", troubleRow("panic")))
	skipsFallenAndBusy(t, "faction-collapsing", w)

	w.busy = map[string]bool{}
	w.factions[0].Fallen = true
	none(t, run(t, w, "faction-collapsing", troubleRow("panic")))
}

func TestProspersRoad(t *testing.T) {
	w := troubleWorld()
	w.regions[1].lines[lineCaravans] = true
	none(t, run(t, w, "prospers-road", troubleRow("caravan")))

	w.passages[0] = params.CaravanPassages
	one(t, run(t, w, "prospers-road", troubleRow("caravan")))
	none(t, run(t, plain{w}, "prospers-road", troubleRow("caravan")))

	w.places[0].City = true
	one(t, run(t, plain{w}, "prospers-road", troubleRow("caravan")))
	skipsFallenAndBusy(t, "prospers-road", w)

	w.busy = map[string]bool{}
	w.regions[1].lines[lineCaravans] = false
	none(t, run(t, w, "prospers-road", troubleRow("caravan")))
}

func TestSeasonTurn(t *testing.T) {
	w := newFake(4)
	w.place(0, nearSettlement)
	w.place(2, nearSettlement)
	w.herd[0], w.herd[2], w.herd[3] = 30, 50, 90
	none(t, run(t, w, "season-turn", migrationRow))

	began := w.remember(memSeasonBegan, w.day, -1)
	c := one(t, run(t, w, "season-turn", migrationRow))
	bound(t, c, "place", SettlementRef(1))
	if c.Pressure != 50 || !slices.Equal(c.Regions, []int{2}) || !slices.Equal(c.Causes, []fact.ID{began}) {
		t.Fatalf("pressure %d regions %v causes %v", c.Pressure, c.Regions, c.Causes)
	}

	none(t, run(t, plain{w}, "season-turn", migrationRow))
	w.setBusy(Settlement, SettlementRef(1))
	none(t, run(t, w, "season-turn", migrationRow))

	w.busy = map[string]bool{}
	w.day++
	none(t, run(t, w, "season-turn", migrationRow))
}

func TestScarcityLow(t *testing.T) {
	w := troubleWorld()
	w.regions[1].streak[StreakLow] = 2
	none(t, run(t, w, "scarcity-low", troubleRow("seam")))
	w.regions[1].streak[StreakLow] = 1
	w.regions[1].gauge[gaugeScarcity] = 70
	c := one(t, run(t, w, "scarcity-low", troubleRow("seam")))
	if c.Pressure != params.SeamBelow-70 {
		t.Fatalf("pressure %d", c.Pressure)
	}
	skipsFallenAndBusy(t, "scarcity-low", w)
}

// TestEveryTemplateHasAPredicate holds the sheets' when ids to the
// registry, so a renamed predicate fails here and not at load.
func TestEveryTemplateHasAPredicate(t *testing.T) {
	for _, id := range []string{
		"militant-borders-weaker", "leader-died", "cold-snap", "core-open", "pressure-region", "pressure-faction",
		"pressure-settlement", "corruption-front", "rival-seats", "notable-wavers", "betrayal", "overrun", "dry-region",
		"npc-owed", "came-back", "vow-broken", "lost-to-them",
		"raid-near", "fire-risk", "corruption-next-door", "scarcity-high", "wet-and-scarce", "faction-collapsing",
		"prospers-road", "season-turn", "scarcity-low",
		"road-busy", "caravan-threatened", "opposed-goals", "legend-near",
	} {
		if Predicates[id] == nil {
			t.Errorf("no predicate %q", id)
		}
	}
}
