package arc

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
)

// emergent is a fake World with roads, caravans, legends and contests.
type emergent struct {
	*fake
	asleep   map[int]bool
	load     map[int]int64
	busiest  map[int]hex.Hex
	raider   map[int]int
	caravans []CaravanView
	cut      map[int]bool
	in       map[int]bool
	legends  []LegendView
	contests []ContestView
}

func withEmergence(f *fake) *emergent {
	return &emergent{fake: f, asleep: map[int]bool{}, load: map[int]int64{}, busiest: map[int]hex.Hex{},
		raider: map[int]int{}, cut: map[int]bool{}, in: map[int]bool{}}
}

func (e *emergent) Awake() []int {
	return slices.DeleteFunc(e.fake.Awake(), func(r int) bool { return e.asleep[r] })
}

func (e *emergent) RoadLoad(r int) (int64, hex.Hex, bool) {
	l, ok := e.load[r]
	return l, e.busiest[r], ok
}

func (e *emergent) Raider(r int) (int, bool) {
	f, ok := e.raider[r]
	return f, ok
}

func (e *emergent) Caravans() []CaravanView { return e.caravans }
func (e *emergent) RoadCut(n int) bool      { return e.cut[n] }
func (e *emergent) RoadIn(n int) bool       { return e.in[n] }
func (e *emergent) Legends() []LegendView   { return e.legends }
func (e *emergent) Contests() []ContestView { return e.contests }

var (
	roadWarRow      = row("the-road-war", Region, "road", "tile", "raider", "faction", "seat", "settlement")
	lostCaravanRow  = row("the-lost-caravan", Region, "caravan", "caravan", "front", "region", "seat", "settlement")
	rivalClaimsRow  = row("the-rival-claims", Region, "seat-a", "settlement", "seat-b", "settlement", "front", "region")
	legendWakesRow  = row("the-legend-wakes", Region, "legend", "legend", "front", "region", "seat", "settlement")
	roadTile        = hex.Hex{Q: 12, R: 1}
	caravanTileNear = hex.Hex{Q: 1, R: 1}
)

// roadWarWorld: f-0 holds r-1, where the place stands; f-1 holds r-3 and
// raids r-1's road.
func roadWarWorld() (*fake, *emergent) {
	w := newFake(4)
	w.faction("wardens", militant, 1, 50, 1)
	w.faction("guild", mercantile, 3, 50, 3)
	w.place(1, nearSettlement)
	e := withEmergence(w)
	e.busiest[1] = roadTile
	e.raider[1] = 1
	return w, e
}

func TestRoadBusy(t *testing.T) {
	w, e := roadWarWorld()
	e.load[1] = params.RoadWarLoad - 1
	none(t, run(t, e, "road-busy", roadWarRow))

	e.load[1] = params.RoadWarLoad
	raided := w.remember(memRaided, 18, 1, FactionRef(1))
	w.remember(memRaided, 18, 2, FactionRef(1))
	none(t, run(t, w, "road-busy", roadWarRow))
	c := one(t, run(t, e, "road-busy", roadWarRow))
	bound(t, c, "road", TileRef(roadTile))
	bound(t, c, "raider", FactionRef(1))
	bound(t, c, "seat", SettlementRef(0))
	if c.Pressure != params.RoadWarLoad || c.Seat != w.places[0].Hex || !slices.Equal(c.Regions, []int{1}) ||
		!slices.Equal(c.Causes, []fact.ID{raided}) || c.Place != -1 {
		t.Fatalf("pressure %d seat %v regions %v causes %v place %d", c.Pressure, c.Seat, c.Regions, c.Causes, c.Place)
	}

	e.asleep[1] = true
	none(t, run(t, e, "road-busy", roadWarRow))
	e.asleep[1] = false

	e.raider[1] = 0
	none(t, run(t, e, "road-busy", roadWarRow))
	delete(e.raider, 1)
	none(t, run(t, e, "road-busy", roadWarRow))
	e.raider[1] = 1
	w.factions[1].Fallen = true
	none(t, run(t, e, "road-busy", roadWarRow))
	w.factions[1].Fallen = false

	w.setBusy(Region, FactionRef(1))
	none(t, run(t, e, "road-busy", roadWarRow))
	w.busy = map[string]bool{}
	w.setBusy(Region, RegionRef(1))
	none(t, run(t, e, "road-busy", roadWarRow))
	w.busy = map[string]bool{}
	w.setBusy(Region, SettlementRef(0))
	one(t, run(t, e, "road-busy", roadWarRow))
}

func TestRoadBusyUnheldRegion(t *testing.T) {
	w, e := roadWarWorld()
	w.regions[1].holder = -1
	e.load[1] = params.RoadWarLoad
	bound(t, one(t, run(t, e, "road-busy", roadWarRow)), "raider", FactionRef(1))
}

func TestCaravanThreatened(t *testing.T) {
	w := newFake(4)
	w.place(0, nearSettlement)
	e := withEmergence(w)
	e.caravans = []CaravanView{{ID: "caravan:1", At: caravanTileNear, Ahead: []int{1, 2, 3}, To: 0}}
	w.regions[2].gauge[gaugeThreat] = params.CaravanThreat - 1
	w.regions[3].gauge[gaugeThreat] = params.CaravanThreat + 100
	raids := w.remember(memRaids, 19, 3)
	c := one(t, run(t, e, "caravan-threatened", lostCaravanRow))
	bound(t, c, "front", RegionRef(3))
	if c.Pressure != params.CaravanThreat+100 || !slices.Equal(c.Causes, []fact.ID{raids}) {
		t.Fatalf("pressure %d causes %v", c.Pressure, c.Causes)
	}

	w.regions[2].gauge[gaugeThreat] = params.CaravanThreat
	c = one(t, run(t, e, "caravan-threatened", lostCaravanRow))
	bound(t, c, "caravan", CaravanRef("caravan:1"))
	bound(t, c, "front", RegionRef(2))
	bound(t, c, "seat", SettlementRef(0))
	if c.Pressure != params.CaravanThreat || !slices.Equal(c.Regions, []int{0, 2}) || len(c.Causes) != 0 {
		t.Fatalf("pressure %d regions %v causes %v", c.Pressure, c.Regions, c.Causes)
	}

	e.asleep[2] = true
	bound(t, one(t, run(t, e, "caravan-threatened", lostCaravanRow)), "front", RegionRef(3))
	e.asleep[3] = true
	none(t, run(t, e, "caravan-threatened", lostCaravanRow))
	e.asleep = map[int]bool{}

	e.caravans[0].Halted = true
	none(t, run(t, e, "caravan-threatened", lostCaravanRow))
	e.caravans[0].Halted = false
	e.caravans[0].Ahead = []int{1}
	none(t, run(t, e, "caravan-threatened", lostCaravanRow))
	e.caravans[0].Ahead = []int{2}

	w.setBusy(Region, CaravanRef("caravan:1"))
	none(t, run(t, e, "caravan-threatened", lostCaravanRow))
	w.busy = map[string]bool{}
	none(t, run(t, w, "caravan-threatened", lostCaravanRow))
}

func TestOpposedGoals(t *testing.T) {
	w := newFake(3)
	w.place(0, nearSettlement).Guild = "g-1"
	w.place(1, nearSettlement).Guild = "g-2"
	w.regions[1].gauge[gaugeUnrest] = 300
	e := withEmergence(w)
	claim := ContestView{A: "goal:1", B: "goal:2", SeatA: 0, SeatB: 1, Region: 1, Tag: "metal"}
	e.contests = []ContestView{claim, claim}
	none(t, run(t, w, "opposed-goals", rivalClaimsRow))
	c := one(t, run(t, e, "opposed-goals", rivalClaimsRow))
	bound(t, c, "seat-a", SettlementRef(0))
	bound(t, c, "seat-b", SettlementRef(1))
	bound(t, c, "front", RegionRef(1))
	if c.Pressure != 300 || c.Seat != w.places[0].Hex || !slices.Equal(c.Regions, []int{0, 1}) {
		t.Fatalf("pressure %d seat %v regions %v", c.Pressure, c.Seat, c.Regions)
	}

	e.contests = append(e.contests, ContestView{A: "goal:3", B: "goal:4", SeatA: 1, SeatB: 0, Region: 0})
	if cs := run(t, e, "opposed-goals", rivalClaimsRow); len(cs) != 2 || cs[0].Pressure != 300 {
		t.Fatalf("want both contests, unrest first: %d", len(cs))
	}
	e.contests = []ContestView{{A: "goal:5", B: "goal:6", SeatA: 1, SeatB: 1, Region: 1}}
	none(t, run(t, e, "opposed-goals", rivalClaimsRow))

	e.contests = []ContestView{claim}
	w.places[1].Ruined = true
	none(t, run(t, e, "opposed-goals", rivalClaimsRow))
	w.places[1].Ruined = false
	w.setBusy(Region, SettlementRef(1))
	none(t, run(t, e, "opposed-goals", rivalClaimsRow))
}

func TestLegendNear(t *testing.T) {
	w := newFake(3)
	w.place(1, nearSettlement)
	w.regions[1].gauge[gaugeThreat] = 420
	e := withEmergence(w)
	e.legends = []LegendView{{ID: "legend:1", Region: 1, At: w.regions[1].at.Add(hex.Hex{Q: 3})}}
	none(t, run(t, w, "legend-near", legendWakesRow))
	c := one(t, run(t, e, "legend-near", legendWakesRow))
	bound(t, c, "legend", LegendRef("legend:1"))
	bound(t, c, "front", RegionRef(1))
	bound(t, c, "seat", SettlementRef(0))
	if c.Pressure != 420 || !slices.Equal(c.Regions, []int{1}) || c.Seat != w.places[0].Hex {
		t.Fatalf("pressure %d regions %v seat %v", c.Pressure, c.Regions, c.Seat)
	}

	e.legends[0].Rested = true
	none(t, run(t, e, "legend-near", legendWakesRow))
	e.legends[0].Rested = false
	e.asleep[1] = true
	none(t, run(t, e, "legend-near", legendWakesRow))
	e.asleep[1] = false
	w.places[0].Open = false
	none(t, run(t, e, "legend-near", legendWakesRow))
	w.places[0].Open = true

	e.legends = append(e.legends, LegendView{ID: "legend:2", Region: 2, At: w.regions[2].at})
	bound(t, one(t, run(t, e, "legend-near", legendWakesRow)), "legend", LegendRef("legend:1"))
	w.setBusy(Region, LegendRef("legend:1"))
	none(t, run(t, e, "legend-near", legendWakesRow))
}

// TestShortageOnCutRoad: a cut road brings the shortage without the
// yields line, and only to a World with roads.
func TestShortageOnCutRoad(t *testing.T) {
	w := troubleWorld()
	w.regions[1].gauge[gaugeScarcity] = 250
	e := withEmergence(w)
	none(t, run(t, e, "scarcity-high", troubleRow("shortage")))
	e.cut[0] = true
	none(t, run(t, w, "scarcity-high", troubleRow("shortage")))
	if c := one(t, run(t, e, "scarcity-high", troubleRow("shortage"))); c.Pressure != 250 {
		t.Fatalf("pressure %d", c.Pressure)
	}
	w.places[0].Ruined = true
	none(t, run(t, e, "scarcity-high", troubleRow("shortage")))
	w.places[0].Ruined = false
	w.setBusy(Settlement, SettlementRef(0))
	none(t, run(t, e, "scarcity-high", troubleRow("shortage")))

	w.busy = map[string]bool{}
	e.cut[0] = false
	w.regions[1].lines[lineYields] = true
	one(t, run(t, e, "scarcity-high", troubleRow("shortage")))
	one(t, run(t, w, "scarcity-high", troubleRow("shortage")))
}

// TestCaravanOccasionRoadIn: with roads, a road in replaces the passages
// proxy; without them the proxy stands as before.
func TestCaravanOccasionRoadIn(t *testing.T) {
	w := troubleWorld()
	w.regions[1].lines[lineCaravans] = true
	w.regions[1].gauge[gaugeProsperity] = 640
	w.passages[0] = params.CaravanPassages
	e := withEmergence(w)
	one(t, run(t, w, "prospers-road", troubleRow("caravan")))
	none(t, run(t, e, "prospers-road", troubleRow("caravan")))

	e.in[0] = true
	w.passages[0] = 0
	none(t, run(t, w, "prospers-road", troubleRow("caravan")))
	if c := one(t, run(t, e, "prospers-road", troubleRow("caravan"))); c.Pressure != 640 {
		t.Fatalf("pressure %d", c.Pressure)
	}
	w.regions[1].lines[lineCaravans] = false
	none(t, run(t, e, "prospers-road", troubleRow("caravan")))

	w.regions[1].lines[lineCaravans] = true
	e.in[0] = false
	w.places[0].City = true
	one(t, run(t, e, "prospers-road", troubleRow("caravan")))
	w.setBusy(Settlement, SettlementRef(0))
	none(t, run(t, e, "prospers-road", troubleRow("caravan")))
}

func TestEmergenceParamsOfShippedBook(t *testing.T) {
	p := ParamsOf(shippedBook(t))
	if p.RoadWarLoad != 2000 || p.CaravanThreat != 800 {
		t.Fatalf("road-war-load %d caravan-threat %d", p.RoadWarLoad, p.CaravanThreat)
	}
}
