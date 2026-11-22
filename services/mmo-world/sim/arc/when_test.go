package arc

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
)

var (
	siegeRow       = row("the-siege", ScopeWorld, "besieger", "faction", "holder", "faction", "holding", "holding", "seat", "settlement")
	successionRow  = row("the-succession", ScopeWorld, "faction", "faction", "claimant-a", "notable", "claimant-b", "notable", "seat", "settlement")
	coldRow        = row("the-long-cold", ScopeWorld, "front", "region", "seat", "settlement")
	openingRow     = row("the-opening", ScopeWorld, "core", "tile", "seat", "settlement")
	lastStandRow   = row("the-last-stand", ScopeWorld, "front", "region", "seat", "settlement")
	reckoningRow   = row("the-reckoning", ScopeWorld, "faction", "faction", "wronged", "faction", "seat", "settlement")
	rebuildingRow  = row("the-rebuilding", ScopeWorld, "place", "settlement", "seat", "settlement")
	frontRow       = row("the-corruption-front", Region, "source", "region", "seat", "settlement")
	rivalSeatRow   = row("the-rival-seat", Region, "seat-a", "settlement", "seat-b", "settlement")
	defectorRow    = row("the-defector", Region, "faction", "faction", "notable", "notable", "rival", "faction", "seat", "settlement")
	grudgeRow      = row("the-grudge", Region, "betrayer", "faction", "wronged", "faction", "seat", "settlement")
	overrunRow     = row("the-overrun", Region, "front", "region", "seat", "settlement")
	drySeamRow     = row("the-dry-seam", Region, "front", "region", "seat", "settlement")
	militant       = []string{tagMilitant}
	mercantile     = []string{"mercantile"}
	notableN       = func(id string) fact.Ref { return notableRef(id) }
	nearSettlement = hex.Hex{Q: 1}
)

// siegeWorld: militant f-0 holds r-1 at 100; mercantile f-1 holds r-2 at
// 40 and r-4; a place sits in r-2.
func siegeWorld() *fake {
	w := newFake(5)
	w.faction("wardens", militant, 1, 100, 1)
	w.faction("guild", mercantile, 4, 40, 2, 4)
	w.place(2, nearSettlement)
	return w
}

func TestSiegeEligible(t *testing.T) {
	w := siegeWorld()
	raid := w.remember(memRaided, 18, 2, FactionRef(0), FactionRef(1))
	c := one(t, run(t, w, "militant-borders-weaker", siegeRow))
	bound(t, c, "besieger", FactionRef(0))
	bound(t, c, "holder", FactionRef(1))
	bound(t, c, "holding", HoldingRef(2))
	bound(t, c, "seat", SettlementRef(0))
	if c.Pressure != 60 || !slices.Equal(c.Regions, []int{2}) || !slices.Equal(c.Causes, []fact.ID{raid}) {
		t.Fatalf("pressure %d regions %v causes %v", c.Pressure, c.Regions, c.Causes)
	}
}

func TestSiegeIneligible(t *testing.T) {
	w := siegeWorld()
	w.regions[2].defence = 100
	none(t, run(t, w, "militant-borders-weaker", siegeRow))

	w = siegeWorld()
	w.factions[0].Tags = mercantile
	none(t, run(t, w, "militant-borders-weaker", siegeRow))

	w = siegeWorld()
	w.setBusy(ScopeWorld, HoldingRef(2))
	none(t, run(t, w, "militant-borders-weaker", siegeRow))
}

func TestSiegeNeverTakesTheLastHolding(t *testing.T) {
	w := siegeWorld()
	w.factions[1].Holdings = []int{2}
	w.regions[4].holder = -1
	none(t, run(t, w, "militant-borders-weaker", siegeRow))
}

func TestSiegeBesiegerIsTheLargest(t *testing.T) {
	w := newFake(6)
	w.faction("wardens", militant, 1, 100, 1)
	w.faction("guild", mercantile, 4, 40, 2, 4)
	w.faction("compact", militant, 3, 90, 3, 5)
	w.place(2, nearSettlement)
	cs := run(t, w, "militant-borders-weaker", siegeRow)
	i := slices.IndexFunc(cs, func(c Candidate) bool { h, _ := c.Cast.Get("holding"); return h == HoldingRef(2) })
	if i < 0 {
		t.Fatal("r-2 is not besieged")
	}
	bound(t, cs[i], "besieger", FactionRef(2))
	if cs[i].Pressure != 50 {
		t.Fatalf("pressure %d", cs[i].Pressure)
	}
}

func successionWorld() *fake {
	w := newFake(3)
	w.faction("wardens", militant, 1, 100, 1, 2)
	w.factions[0].Notables = []NotableView{
		{ID: "n-1", Role: roleLeader, Loyalty: 90, Dead: true},
		{ID: "n-2", Role: "captain", Loyalty: 80, Leading: true},
		{ID: "n-3", Role: "factor", Loyalty: 20},
		{ID: "n-4", Role: "captain", Loyalty: 50},
	}
	w.place(1, nearSettlement)
	return w
}

func TestSuccessionEligible(t *testing.T) {
	w := successionWorld()
	died := w.remember(memNotableDied, 15, 1, notableN("n-1"), FactionRef(0))
	c := one(t, run(t, w, "leader-died", successionRow))
	bound(t, c, "faction", FactionRef(0))
	bound(t, c, "claimant-a", notableN("n-2"))
	bound(t, c, "claimant-b", notableN("n-3"))
	bound(t, c, "seat", SettlementRef(0))
	if !slices.Equal(c.Causes, []fact.ID{died}) || !slices.Equal(c.Regions, []int{1, 2}) {
		t.Fatalf("causes %v regions %v", c.Causes, c.Regions)
	}
}

func TestSuccessionIneligible(t *testing.T) {
	w := successionWorld()
	w.factions[0].Notables[0].Role = "captain"
	w.remember(memNotableDied, 15, 1, notableN("n-1"), FactionRef(0))
	none(t, run(t, w, "leader-died", successionRow))

	w = successionWorld()
	w.remember(memNotableDied, w.day-params.LeaderDiedDays-1, 1, notableN("n-1"), FactionRef(0))
	none(t, run(t, w, "leader-died", successionRow))

	w = successionWorld()
	w.factions[0].Notables = w.factions[0].Notables[:2]
	w.remember(memNotableDied, 15, 1, notableN("n-1"), FactionRef(0))
	none(t, run(t, w, "leader-died", successionRow))

	w = successionWorld()
	w.remember(memNotableDied, 15, 1, notableN("n-1"), FactionRef(0))
	w.setBusy(ScopeWorld, FactionRef(0))
	none(t, run(t, w, "leader-died", successionRow))
}

func TestColdSnap(t *testing.T) {
	w := newFake(5)
	w.place(0, nearSettlement)
	for r, s := range []int64{5, 0, 7, 6, 4} {
		w.regions[r].streak[StreakCold] = s
	}
	c := one(t, run(t, w, "cold-snap", coldRow))
	bound(t, c, "front", RegionRef(2))
	if !slices.Equal(c.Regions, []int{0, 2, 3}) || c.Pressure != 18 {
		t.Fatalf("regions %v pressure %d", c.Regions, c.Pressure)
	}

	w.regions[3].streak[StreakCold] = 4
	none(t, run(t, w, "cold-snap", coldRow))
}

func TestCoreOpen(t *testing.T) {
	w := newFake(3)
	w.place(0, nearSettlement)
	w.core, w.open = hex.Hex{Q: 20}, true
	opened := w.remember(memCoreOpened, 17, 2)
	c := one(t, run(t, w, "core-open", openingRow))
	bound(t, c, "core", TileRef(w.core))
	bound(t, c, "seat", SettlementRef(0))
	if !slices.Equal(c.Regions, []int{0, 1, 2}) || !slices.Equal(c.Causes, []fact.ID{opened}) {
		t.Fatalf("regions %v causes %v", c.Regions, c.Causes)
	}

	w.remember(memArcCast, 18, 2, TileRef(w.core))
	none(t, run(t, w, "core-open", openingRow))

	w = newFake(3)
	w.place(0, nearSettlement)
	w.core = hex.Hex{Q: 20}
	none(t, run(t, w, "core-open", openingRow))
}

func TestPressureRegion(t *testing.T) {
	w := newFake(3)
	w.place(0, nearSettlement)
	w.regions[1].gauge[gaugeThreat] = 700
	w.regions[1].gauge[gaugeCorruption] = 550
	w.regions[2].gauge[gaugeThreat] = 500
	cs := run(t, w, "pressure-region", lastStandRow)
	c := one(t, cs)
	bound(t, c, "front", RegionRef(1))
	if c.Pressure != 150 {
		t.Fatalf("pressure %d", c.Pressure)
	}

	lapse := w.remember(memArcEnded, 18, 1, fact.Ref{Kind: scopeSubject, ID: ScopeWorld}, RegionRef(2))
	w.memory[len(w.memory)-1].N = lapsedN
	w.remember(memArcEnded, 18, 1, fact.Ref{Kind: scopeSubject, ID: Region}, RegionRef(1))
	w.memory[len(w.memory)-1].N = lapsedN
	cs = run(t, w, "pressure-region", lastStandRow)
	if len(cs) != 2 {
		t.Fatalf("got %d candidates", len(cs))
	}
	bound(t, cs[0], "front", RegionRef(2))
	if cs[0].Pressure != params.FinaleLapseBonus || !slices.Contains(cs[0].Causes, lapse) || cs[1].Pressure != 150 {
		t.Fatalf("pressures %d %d causes %v", cs[0].Pressure, cs[1].Pressure, cs[0].Causes)
	}

	none(t, run(t, plain{w}, "pressure-region", lastStandRow))
}

func TestPressureFaction(t *testing.T) {
	w := newFake(4)
	w.place(0, nearSettlement)
	w.faction("guild", mercantile, 0, 50, 0)
	w.faction("clans", nil, 2, 50, 2)
	w.faction("order", nil, 3, 50, 3)
	none(t, run(t, w, "pressure-faction", reckoningRow))

	w.factions[1].Grudge[0], w.factions[2].Grudge[0] = 10, 4
	betrayed := w.remember(memBetrayed, 12, 0, FactionRef(0), FactionRef(1))
	c := one(t, run(t, w, "pressure-faction", reckoningRow))
	bound(t, c, "faction", FactionRef(0))
	bound(t, c, "wronged", FactionRef(1))
	if c.Pressure != 14 || !slices.Equal(c.Causes, []fact.ID{betrayed}) {
		t.Fatalf("pressure %d causes %v", c.Pressure, c.Causes)
	}
}

func TestPressureSettlement(t *testing.T) {
	w := newFake(3)
	a := w.place(0, nearSettlement)
	a.Lost = 2
	w.place(2, nearSettlement)
	w.place(1, nearSettlement)
	c := one(t, run(t, w, "pressure-settlement", rebuildingRow))
	bound(t, c, "place", SettlementRef(0))
	bound(t, c, "seat", SettlementRef(2))
	if c.Pressure != 2*params.FinaleLossWeight {
		t.Fatalf("pressure %d", c.Pressure)
	}

	w.places[0].Ruined = true
	none(t, run(t, w, "pressure-settlement", rebuildingRow))
	w.places[0].Ruined, w.places[0].Lost = false, 0
	none(t, run(t, w, "pressure-settlement", rebuildingRow))
}

func frontWorld() *fake {
	w := newFake(5)
	w.place(2, nearSettlement)
	for r, c := range []int64{0, 550, 800, 600, 0} {
		w.regions[r].gauge[gaugeCorruption] = c
		w.regions[r].lines[lineCorruption] = c > 500
	}
	return w
}

func TestCorruptionFront(t *testing.T) {
	w := frontWorld()
	c := one(t, run(t, w, "corruption-front", frontRow))
	bound(t, c, "source", RegionRef(2))
	if !slices.Equal(c.Regions, []int{1, 2, 3}) || c.Pressure != 800 {
		t.Fatalf("regions %v pressure %d", c.Regions, c.Pressure)
	}

	w = frontWorld()
	w.regions[3].lines[lineCorruption] = false
	none(t, run(t, w, "corruption-front", frontRow))

	w = frontWorld()
	w.setBusy(Region, RegionRef(3))
	none(t, run(t, w, "corruption-front", frontRow))
}

// rivalWorld: two places of different guilds 6 tiles apart, each raised
// a structure 3 days ago.
func rivalWorld() *fake {
	w := newFake(2)
	raised := (w.day - 3) * 144
	a := w.place(0, nearSettlement)
	a.Guild, a.Structures, a.Raised = "g-1", 3, raised
	b := w.place(0, hex.Hex{Q: 7})
	b.Guild, b.Structures, b.Raised = "g-2", 5, raised
	return w
}

func TestRivalSeats(t *testing.T) {
	c := one(t, run(t, rivalWorld(), "rival-seats", rivalSeatRow))
	bound(t, c, "seat-a", SettlementRef(1))
	bound(t, c, "seat-b", SettlementRef(0))
	if c.Seat != (hex.Hex{Q: 7}) || c.Pressure != 8 {
		t.Fatalf("seat %v pressure %d", c.Seat, c.Pressure)
	}
}

func TestRivalSeatsSkipsKeepersAndRuins(t *testing.T) {
	for name, edit := range map[string]func(w *fake){
		"keeper-run": func(w *fake) { w.places[0].Guild = "" },
		"ruined":     func(w *fake) { w.places[1].Ruined = true },
		"same guild": func(w *fake) { w.places[1].Guild = "g-1" },
		"too far":    func(w *fake) { w.places[1].Hex = hex.Hex{Q: 40} },
		"stale":      func(w *fake) { w.places[1].Raised = (w.day - params.RivalGrowthDays - 1) * 144 },
		"busy":       func(w *fake) { w.setBusy(Region, RegionRef(0)) },
	} {
		t.Run(name, func(t *testing.T) {
			w := rivalWorld()
			edit(w)
			none(t, run(t, w, "rival-seats", rivalSeatRow))
		})
	}
}

func defectorWorld() *fake {
	w := newFake(4)
	w.faction("guild", mercantile, 0, 50, 0, 1)
	w.faction("clans", nil, 3, 50, 3)
	w.faction("order", nil, 2, 50, 2)
	w.factions[0].Notables = []NotableView{{ID: "n-1", Role: roleLeader, Loyalty: 10, Leading: true}, {ID: "n-2", Role: "captain", Loyalty: 20}}
	w.factions[1].Disposition[0] = -10
	w.factions[2].Disposition[0] = -40
	w.place(0, nearSettlement)
	w.place(2, nearSettlement)
	return w
}

func TestDefector(t *testing.T) {
	c := one(t, run(t, defectorWorld(), "notable-wavers", defectorRow))
	bound(t, c, "notable", notableN("n-2"))
	bound(t, c, "rival", FactionRef(2))
	bound(t, c, "seat", SettlementRef(1))
	if c.Pressure != 10 || !slices.Equal(c.Regions, []int{0, 1, 2}) {
		t.Fatalf("pressure %d regions %v", c.Pressure, c.Regions)
	}

	w := defectorWorld()
	w.factions[0].Notables[1].Loyalty = params.DefectorLoyalty
	none(t, run(t, w, "notable-wavers", defectorRow))

	w = defectorWorld()
	w.factions[0].Notables[1].Dead = true
	none(t, run(t, w, "notable-wavers", defectorRow))
}

func TestBetrayal(t *testing.T) {
	w := newFake(5)
	w.faction("guild", mercantile, 0, 50, 0)
	w.faction("clans", nil, 4, 50, 4)
	w.place(0, nearSettlement)
	w.place(2, nearSettlement)
	w.factions[1].Grudge[0] = 9
	b := w.remember(memBetrayed, 10, 4, FactionRef(0), FactionRef(1))
	c := one(t, run(t, w, "betrayal", grudgeRow))
	bound(t, c, "betrayer", FactionRef(0))
	bound(t, c, "wronged", FactionRef(1))
	bound(t, c, "seat", SettlementRef(1))
	if c.Pressure != 9 || !slices.Equal(c.Causes, []fact.ID{b}) {
		t.Fatalf("pressure %d causes %v", c.Pressure, c.Causes)
	}

	w.factions[1].Fallen = true
	none(t, run(t, w, "betrayal", grudgeRow))
	w.factions[1].Fallen = false
	w.day += params.BetrayalDays
	none(t, run(t, w, "betrayal", grudgeRow))
}

func TestOverrun(t *testing.T) {
	w := newFake(4)
	w.regions[1].lines[lineOverrun] = true
	w.regions[1].gauge[gaugeThreat] = 950
	none(t, run(t, w, "overrun", overrunRow))

	w.place(3, nearSettlement)
	none(t, run(t, w, "overrun", overrunRow))

	w.place(1, nearSettlement)
	w.place(2, nearSettlement)
	c := one(t, run(t, w, "overrun", overrunRow))
	bound(t, c, "front", RegionRef(1))
	bound(t, c, "seat", SettlementRef(2))
	if c.Pressure != 950 || !slices.Equal(c.Regions, []int{0, 1, 2}) {
		t.Fatalf("pressure %d regions %v", c.Pressure, c.Regions)
	}
}

func TestDryRegion(t *testing.T) {
	w := newFake(3)
	w.regions[1].lines[lineYields] = true
	w.regions[1].gauge[gaugeScarcity] = 750
	w.place(0, nearSettlement)
	none(t, run(t, w, "dry-region", drySeamRow))

	w.place(1, nearSettlement)
	c := one(t, run(t, w, "dry-region", drySeamRow))
	bound(t, c, "front", RegionRef(1))
	bound(t, c, "seat", SettlementRef(1))
	if !slices.Equal(c.Regions, []int{0, 1, 2}) {
		t.Fatalf("regions %v", c.Regions)
	}

	w.places[1].Ruined = true
	none(t, run(t, w, "dry-region", drySeamRow))
}
