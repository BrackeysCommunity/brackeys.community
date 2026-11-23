package game

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/market"
	"jams.team/mmo-world/sim/world"
)

// structural: how far from the first settlement the test's second one
// stands, so the walk between them is short and crosses some ground.
const routeSpan = 5

// secondPlace charters a settlement routeSpan tiles from the first and
// returns its index.
func secondPlace(t *testing.T, g *Game) int {
	t.Helper()
	for _, h := range openTiles(t, g, 400) {
		if hex.Distance(h, g.SettlementHex(0)) != routeSpan {
			continue
		}
		if _, _, ok := g.World.Path(g.SettlementHex(0), h); !ok {
			continue
		}
		n := len(g.Places)
		g.Places = append(g.Places, &Place{N: n, Hex: h, Lattice: -1})
		return n
	}
	t.Fatal("no open tile for a second settlement")
	return -1
}

// routeGame is a game with a route between its first settlement and a
// second one, promoted as the haulage line promotes it.
func routeGame(t *testing.T) (*Game, *emerge.RouteRec, int) {
	t.Helper()
	g := feedGame(t)
	n := secondPlace(t, g)
	p, err := g.promoteTrace(Promoting{Type: emerge.Route, Region: homeRegion(g), Places: []int{0, n}, Cause: g.lastFact()})
	if err != nil || p == nil {
		t.Fatalf("no route promoted: %v", err)
	}
	rt := g.routeRec(p.ID)
	if rt == nil {
		t.Fatal("the route has no record")
	}
	return g, rt, n
}

// unitsOf is a fact's numeric datum.
func unitsOf(f fact.Fact, key string) int64 {
	d, _ := f.Get(key)
	return d.N
}

// toDay advances the world to the turn of a world day.
func toDay(t *testing.T, g *Game, day int64) {
	t.Helper()
	for g.Tick() < dayTick(day) {
		dirTick(t, g)
	}
}

// TestRouteLine: 2,000 load hauled between two settlements names a route
// "{A}–{B}" with the walk between them fixed and the regions it crosses;
// it runs its first caravan from its first place the next day. A walk
// over route-path-most tiles forms a route that runs none.
func TestRouteLine(t *testing.T) {
	g := feedGame(t)
	n := secondPlace(t, g)
	ln := line(g, emerge.Route)
	mat := someHaul(g)[0].Material
	c := feedChars(t, g, 1, g.SettlementHex(n))[0]
	haul := func(units int64, from, to int) {
		t.Helper()
		c.C.Goods = []item.Spoil{{Material: mat, Qty: units}}
		c.Visits = []Visit{{Settlement: from, Tick: g.Tick()}}
		c.C.At = g.SettlementHex(to)
		mustFeed(t, g.visited(c, c.C.At, g.Tick()))
	}
	haul(ln.Count-1, n, 0)
	if len(g.Emergence.Routes) != 0 {
		t.Fatal("a route under the line")
	}
	haul(1, 0, n)
	c.C.Goods = nil
	ps := promotionsOf(g, emerge.Route)
	if len(ps) != 1 || len(g.Emergence.Routes) != 1 {
		t.Fatalf("%d load made %d routes", ln.Count, len(ps))
	}
	p, rt := ps[0], g.Emergence.Routes[0]
	if want := emerge.RouteName(g.settlementName(0), g.settlementName(n)); p.Name != want {
		t.Fatalf("the route is named %q, not %q", p.Name, want)
	}
	f, _ := g.Log.Get(p.Fact)
	if a, _ := f.Get("a"); a.N != 0 {
		t.Fatalf("the route's fact names a = %d", a.N)
	}
	if b, _ := f.Get("b"); b.N != int64(n) {
		t.Fatalf("the route's fact names b = %d, not %d", b.N, n)
	}
	path, _, _ := g.World.Path(g.SettlementHex(0), g.SettlementHex(n))
	if rt.ID != p.ID || rt.A != 0 || rt.B != n || !rt.FromA || !slices.Equal(rt.Path, path) || !slices.Equal(rt.Regions, g.pathRegions(path)) {
		t.Fatalf("the route %+v, want the walk %v", rt, path)
	}
	if len(rt.Regions) == 0 || rt.Next != p.Tick/dayTick(1)+1 {
		t.Fatalf("the route crosses %v and runs on day %d", rt.Regions, rt.Next)
	}
	toDay(t, g, rt.Next)
	if len(g.Emergence.Caravans) != 1 || g.Emergence.Caravans[0].From != 0 || g.Emergence.Caravans[0].To != n {
		t.Fatalf("no caravan left the first place: %+v", g.Emergence.Caravans)
	}
	audit(t, g)

	// One tile over the cap: the route forms and keeps no walk.
	g.r.Emerge.P.RoutePathMost = int64(len(path)) - 1
	long, err := g.promoteTrace(Promoting{Type: emerge.Route, Region: -1, Places: []int{0, n}})
	if err != nil {
		t.Fatal(err)
	}
	lr := g.routeRec(long.ID)
	if lr == nil || lr.Path != nil || !slices.Equal(lr.Regions, g.pathRegions(path)) {
		t.Fatalf("a route over the cap kept %+v", lr)
	}
	before := len(g.Emergence.Caravans)
	toDay(t, g, lr.Next)
	for _, cv := range g.Emergence.Caravans[min(before, len(g.Emergence.Caravans)):] {
		if cv.Route == lr.ID {
			t.Fatal("a route over the cap ran a caravan")
		}
	}
	audit(t, g)
}

// TestCaravanRuns: a caravan leaves with caravan-load of its origin
// region's first material minted into its pool, walks its path on its
// clock, and at its arrival hands the goods to the destination's faction
// and opens the caravan occasion there, whose bids stand that day. The
// next leaves from the other end caravan-days later. The audit is clean
// throughout.
func TestCaravanRuns(t *testing.T) {
	g, rt, n := routeGame(t)
	rt.FromA = false // from the second place to the first, which has a market
	p := g.r.Emerge.P
	toDay(t, g, rt.Next)
	if len(g.Emergence.Caravans) != 1 {
		t.Fatalf("%d caravans left", len(g.Emergence.Caravans))
	}
	cv := g.Emergence.Caravans[0]
	mat, _ := g.manifestOf(n)
	pool := ledger.CaravanPool(cv.ID)
	if cv.From != n || cv.To != 0 || cv.Depart != g.Tick() || g.Ledger.Of(pool, ledger.Goods(mat)) != p.CaravanLoad {
		t.Fatalf("the caravan %+v carries %d %s", cv, g.Ledger.Of(pool, ledger.Goods(mat)), mat)
	}
	if mat != g.Materials(g.SettlementHex(n))[0] {
		t.Fatalf("the manifest is %s", mat)
	}
	dep := lastFact(t, g, factCaravanDeparted)
	if datumS(dep, "id") != cv.ID || datumS(dep, "route") != rt.ID || datumS(dep, "name") != g.promotionShown(rt.ID) {
		t.Fatalf("caravan.departed %+v", dep)
	}
	if !rt.FromA || rt.Next != cv.Depart/dayTick(1)+p.CaravanDays {
		t.Fatalf("the next caravan leaves day %d from A %v", rt.Next, rt.FromA)
	}
	legs := g.legs(orient(rt, n), cv.Depart/dayTick(1))
	if cv.Arrive != cv.Depart+legs[len(legs)-1] {
		t.Fatalf("arrives at %d, the path costs %d", cv.Arrive, legs[len(legs)-1])
	}
	walked := orient(rt, n)
	if g.caravanAt(cv, cv.Depart) != walked[0] || g.caravanAt(cv, cv.Arrive) != walked[len(walked)-1] {
		t.Fatal("the caravan does not start and end at its places")
	}
	last := 0
	for tk := cv.Depart; tk <= cv.Arrive; tk++ {
		i := slices.Index(walked, g.caravanAt(cv, tk))
		if i < last {
			t.Fatalf("the caravan walked back at %d", tk)
		}
		last = i
	}
	audit(t, g)

	sunk := g.Ledger.Of(ledger.ToFaction, ledger.Goods(mat))
	toDay(t, g, rt.Next-p.CaravanDays+1)
	now := g.Tick()
	if len(g.Emergence.Caravans) != 0 || len(g.caravanGoods(cv)) != 0 {
		t.Fatal("the caravan did not come in")
	}
	if got := g.Ledger.Of(ledger.ToFaction, ledger.Goods(mat)) - sunk; got != p.CaravanLoad {
		t.Fatalf("the faction took %d of %d", got, p.CaravanLoad)
	}
	arr := lastFact(t, g, factCaravanArrived)
	if datumS(arr, "id") != cv.ID || unitsOf(arr, "units") != p.CaravanLoad || arr.Tick != now {
		t.Fatalf("caravan.arrived %+v", arr)
	}
	o := g.storyAt(0).Occasion
	if o == nil || o.Kind != occasionCaravan || o.Began != now || o.Ends != now+dayTick(1) {
		t.Fatalf("the caravan occasion %+v", o)
	}
	began := lastFact(t, g, "occasion.began")
	if !slices.Contains(began.Causes, arr.ID) {
		t.Fatal("the occasion does not name the caravan's arrival")
	}
	budgets := g.Budgets()
	budget := max(budgets[0]-g.bountyHeld(0)-g.sideHelds(budgets)[0], 0)
	bids := g.caravanBids(0, budget, g.r.Values.Wants(g.buyers()), now)
	if len(bids) == 0 {
		t.Fatalf("a caravan come in with %d to spend bids for nothing", budget)
	}
	for _, b := range bids {
		book := g.BookOf(0, b.want.Material)
		if book == nil || !slices.ContainsFunc(book.Bids, func(o market.Order) bool { return o.Faction != nil && o.Placed == now }) {
			t.Fatalf("no caravan bid for %s stands", b.want.Material)
		}
	}
	audit(t, g)

	toDay(t, g, rt.Next)
	if len(g.Emergence.Caravans) != 1 || g.Emergence.Caravans[0].From != 0 || g.Emergence.Caravans[0].To != n {
		t.Fatalf("the next caravan did not leave from the other end: %+v", g.Emergence.Caravans)
	}
	if g.storyAt(0).Occasion != nil {
		t.Fatal("the caravan occasion outstayed its day")
	}
	audit(t, g)
}

// raid writes a raid on a region and lets the trace hooks read it.
func raid(t *testing.T, g *Game, region int) fact.Fact {
	t.Helper()
	f, err := g.r.weights.New(g.Tick(), factRaided, world.RegionRef(region), nil, nil, fact.N("loot", 0))
	if err != nil {
		t.Fatal(err)
	}
	if f.ID, err = g.Log.Append(f); err != nil {
		t.Fatal(err)
	}
	if err := g.noteTraces([]fact.Fact{f}); err != nil {
		t.Fatal(err)
	}
	return f
}

// TestCaravanRobbed: a raid on the region a caravan is crossing takes
// raid-caravan-share of its goods to the spoils of the tile it is on; a
// raid elsewhere takes nothing. The audit is clean after.
func TestCaravanRobbed(t *testing.T) {
	g, rt, _ := routeGame(t)
	toDay(t, g, rt.Next)
	cv := g.Emergence.Caravans[0]
	mat, _ := g.manifestOf(cv.From)
	asset, pool := ledger.Goods(mat), ledger.CaravanPool(cv.ID)
	at := g.caravanAt(cv, g.Tick())
	other := slices.IndexFunc(g.World.Regions, func(r world.Region) bool { return r.ID != g.World.RegionAt(at) })
	raid(t, g, other)
	if g.Ledger.Of(pool, asset) != g.r.Emerge.P.CaravanLoad || len(factsOf(g, factCaravanRobbed)) != 0 {
		t.Fatal("a raid elsewhere robbed the caravan")
	}
	f := raid(t, g, g.World.RegionAt(at))
	took := fixed.PercentFloor(g.r.Emerge.P.CaravanLoad, g.r.Emerge.P.RaidCaravanShare)
	if took <= 0 || g.Ledger.Of(pool, asset) != g.r.Emerge.P.CaravanLoad-took || g.Ledger.Of(poolOf(at), asset) != took {
		t.Fatalf("the raid took %d; the tile holds %d", g.r.Emerge.P.CaravanLoad-g.Ledger.Of(pool, asset), g.Ledger.Of(poolOf(at), asset))
	}
	rb := lastFact(t, g, factCaravanRobbed)
	h, ok := fact.HexOf(rb)
	if !ok || h != at || unitsOf(rb, "units") != took || !slices.Contains(rb.Causes, f.ID) || rb.Subjects[0] != promotionRef(rt.ID) {
		t.Fatalf("caravan.robbed %+v", rb)
	}
	audit(t, g)
	toDay(t, g, rt.Next-g.r.Emerge.P.CaravanDays+1)
	if a := lastFact(t, g, factCaravanArrived); unitsOf(a, "units") != g.r.Emerge.P.CaravanLoad-took || len(g.Emergence.Caravans) != 0 {
		t.Fatalf("the robbed caravan came in with %d", unitsOf(a, "units"))
	}
	audit(t, g)
}

// TestCaravanHaltsInArc: a caravan an arc holds stands where it stopped
// and does not come in; set going again it walks on from that tile and
// arrives as late as it was held.
func TestCaravanHaltsInArc(t *testing.T) {
	g, rt, _ := routeGame(t)
	toDay(t, g, rt.Next)
	cv := g.Emergence.Caravans[0]
	span := cv.Arrive - cv.Depart
	for g.Tick() < cv.Depart+span/2 {
		dirTick(t, g)
	}
	stop := g.Tick()
	at := g.caravanAt(cv, stop)
	cv.Halted, cv.Arc = stop, "arc-test"
	toDay(t, g, cv.Arrive/dayTick(1)+2)
	if g.castCaravan(cv.ID) == nil || g.caravanAt(cv, g.Tick()) != at || len(factsOf(g, factCaravanArrived)) != 0 {
		t.Fatal("a halted caravan moved or came in")
	}
	held := g.Tick() - stop
	wantArrive := cv.Arrive + held
	g.resumeCaravan(cv, g.Tick())
	if cv.Halted != 0 || cv.Arc != "" || cv.Arrive != wantArrive || cv.Arrive-cv.Depart != span {
		t.Fatalf("resumed %+v, want arrival %d", cv, wantArrive)
	}
	if g.caravanAt(cv, g.Tick()) != at {
		t.Fatal("the caravan did not walk on from where it stopped")
	}
	if ahead := g.caravanAhead(cv, at); len(ahead) == 0 || ahead[0] != g.World.RegionAt(at) {
		t.Fatalf("ahead of the caravan %v", ahead)
	}
	toDay(t, g, wantArrive/dayTick(1)+1)
	if g.castCaravan(cv.ID) != nil || len(factsOf(g, factCaravanArrived)) != 1 {
		t.Fatal("the resumed caravan did not come in")
	}
	audit(t, g)
}

// TestCaravansNeedBothPlaces: a route whose place has fallen sends no
// caravan until it stands again.
func TestCaravansNeedBothPlaces(t *testing.T) {
	g, rt, n := routeGame(t)
	g.Places[n].Ruined = max(g.Tick(), 1)
	toDay(t, g, rt.Next)
	if len(g.Emergence.Caravans) != 0 || len(factsOf(g, factCaravanDeparted)) != 0 {
		t.Fatal("a caravan left for a ruin")
	}
	g.Places[n].Ruined = 0
	toDay(t, g, rt.Next+1)
	if len(g.Emergence.Caravans) != 1 {
		t.Fatal("no caravan once the place stood again")
	}
	audit(t, g)
}
