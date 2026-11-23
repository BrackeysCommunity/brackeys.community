package game

import (
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/guild"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// roadAtTile promotes a road on h as its line would, and lets the world
// lay it.
func roadAtTile(t *testing.T, g *Game, h hex.Hex) *emerge.RoadRec {
	t.Helper()
	at := h
	if _, err := g.promoteTrace(Promoting{Type: emerge.Road, Region: -1, At: &at}); err != nil {
		t.Fatal(err)
	}
	advance(t, g)
	rec, ok := g.roadAt(h)
	if !ok {
		t.Fatalf("no road on %s", h.Ref())
	}
	return rec
}

// slowStep is a step between neighbours near the first settlement whose
// ground costs more than a road.
func slowStep(t *testing.T, g *Game) (from, to hex.Hex) {
	t.Helper()
	road := g.r.Emerge.P.RoadEnterTicks
	for _, h := range openTiles(t, g, 300) {
		for _, n := range h.Neighbours() {
			if g.World.RegionAt(n) < 0 || g.slot(n) != "" || g.Emergence.Roads[n] != "" {
				continue
			}
			if c, ok := g.World.EnterTicks(h, n); ok && c > road {
				return h, n
			}
		}
	}
	t.Fatal("no step near the first settlement costs more than a road")
	return hex.Hex{}, hex.Hex{}
}

func roadGrant(t *testing.T, g *Game, c *Char, key, asset string, n int64) {
	t.Helper()
	if n == 0 {
		return
	}
	from, to := ledger.FromOperator, ledger.Char(c.C.ID)
	if n < 0 {
		from, to, n = to, ledger.ToOperator, -n
	}
	if err := g.receive(c, ledger.Move(key, "grant", g.Tick(), from, to, asset, n)); err != nil {
		t.Fatal(err)
	}
}

func TestRoadTakesOneTick(t *testing.T) {
	g := feedGame(t)
	p := g.r.Emerge.P
	from, to := slowStep(t, g)
	ground, _ := g.World.EnterTicks(from, to)
	c := feedChars(t, g, 1, from)[0]
	rec := roadAtTile(t, g, to)
	if cost, _, _ := g.EnterCost(c, from, to, g.Tick()); cost != p.RoadEnterTicks {
		t.Fatalf("an open road costs %d, ground %d", cost, ground)
	}
	// The step itself takes the road's tick.
	start := g.Tick()
	if _, err := g.Act(Command{Key: "road-step", Char: c.C.ID, Kind: Step, Dir: from.DirectionTo(to)}); err != nil {
		t.Fatal(err)
	}
	for i := 0; c.C.At != to && i < 50; i++ {
		advance(t, g)
	}
	if c.C.At != to || g.Tick()-start != p.RoadEnterTicks {
		t.Fatalf("the step took %d ticks", g.Tick()-start)
	}
	// A road-only mount cannot take it lower; on a cut road it does not
	// suit and the ground's cost is back.
	rider := feedChars(t, g, 1, from)[0]
	rider.C.Carry(char.Mount, 0, g.r.Mounts.NewMount("road-mount", "road-trike"))
	if cost, _, _ := g.EnterCost(rider, from, to, g.Tick()); cost != p.RoadEnterTicks {
		t.Fatalf("a mounted road step costs %d", cost)
	}
	rec.CutUntil = g.Tick()/sheets.TicksPerDay + p.CutDays
	if cost, _, _ := g.EnterCost(c, from, to, g.Tick()); cost != ground {
		t.Fatalf("a cut road costs %d, ground %d", cost, ground)
	}
	if g.ground(to, g.Tick()/sheets.TicksPerDay).Road {
		t.Fatal("a mount reads a cut road as a road")
	}
	// Without emergence a tile's road never changes the cost.
	plain := guardGame(t)
	plain.Emergence = nil
	plain.wireEmergence()
	pc := feedChars(t, plain, 1, from)[0]
	plain.Pending = append(plain.Pending, world.Action{Kind: world.ActRoad, Hex: to, Units: world.RoadTrack})
	advance(t, plain)
	if cost, _, _ := plain.EnterCost(pc, from, to, plain.Tick()); cost != ground {
		t.Fatalf("without emergence a road costs %d, ground %d", cost, ground)
	}
}

func TestRoadJoinsAndNames(t *testing.T) {
	g := feedGame(t)
	var a hex.Hex
	dir := -1
	for _, h := range openTiles(t, g, 300) {
		for d := range hex.Directions {
			line := []hex.Hex{h, h.Neighbour(d), h.Neighbour(d).Neighbour(d), h.Neighbour(d).Neighbour(d).Neighbour(d)}
			if !slices.ContainsFunc(line, func(x hex.Hex) bool { return g.World.RegionAt(x) < 0 || g.IsSettlement(x) }) {
				a, dir = h, d
				break
			}
		}
		if dir >= 0 {
			break
		}
	}
	if dir < 0 {
		t.Fatal("no four tiles in a line near the first settlement")
	}
	b, d := a.Neighbour(dir), a.Neighbour(dir).Neighbour(dir)
	far := d.Neighbour(dir)

	first := roadAtTile(t, g, a)
	n, _ := g.nearestOpen(a)
	name := g.promotionShown(first.ID)
	if want := "the " + g.settlementName(n) + " "; !strings.HasPrefix(name, want) || len(name) == len(want) {
		t.Fatalf("the road is named %q, want %q and a road word", name, want)
	}

	// A tile beside it joins it: no new promotion, a road.grew fact.
	roads := len(promotionsOf(g, emerge.Road))
	at := b
	if p, err := g.promoteTrace(Promoting{Type: emerge.Road, Region: -1, At: &at}); err != nil || p != nil {
		t.Fatalf("a tile beside a road was promoted: %+v %v", p, err)
	}
	grew := factsOf(g, factRoadGrew)
	if len(promotionsOf(g, emerge.Road)) != roads || g.Emergence.Roads[b] != first.ID || first.Tiles != 2 ||
		len(grew) != 1 || !slices.Contains(grew[0].Subjects, promotionRef(first.ID)) {
		t.Fatalf("the tile did not join: roads %v, grew %+v, record %+v", g.Emergence.Roads, grew, first)
	}

	// A road two tiles on is its own, until a tile between them meets both:
	// the older keeps its name and takes the younger's tiles.
	second := roadAtTile(t, g, far)
	if second.ID == first.ID || len(promotionsOf(g, emerge.Road)) != roads+1 {
		t.Fatal("a road apart from the first joined it")
	}
	at = d
	if p, err := g.promoteTrace(Promoting{Type: emerge.Road, Region: -1, At: &at}); err != nil || p != nil {
		t.Fatalf("the meeting tile was promoted: %+v %v", p, err)
	}
	advance(t, g)
	for _, h := range []hex.Hex{a, b, d, far} {
		if rec, ok := g.roadAt(h); !ok || rec.ID != first.ID {
			t.Fatalf("%s is not on the older road after they met", h.Ref())
		}
	}
	if g.Emergence.RoadRecs[second.ID] != nil || first.Tiles != 4 {
		t.Fatalf("the younger road was not folded in: %+v", first)
	}
}

func TestTollOncePerDay(t *testing.T) {
	g := feedGame(t)
	p := g.r.Emerge.P
	from, to := slowStep(t, g)
	rec := roadAtTile(t, g, to)
	day := g.Tick() / sheets.TicksPerDay
	rec.TollUntil = day + p.TollDays

	payer := feedChars(t, g, 1, from)[0]
	roadGrant(t, g, payer, "toll-coin", ledger.Coin, p.TollCoin*3)
	coin := payer.C.Coin
	if _, err := g.Act(Command{Key: "toll-step", Char: payer.C.ID, Kind: Step, Dir: from.DirectionTo(to)}); err != nil {
		t.Fatal(err)
	}
	for i := 0; payer.C.At != to && i < 50; i++ {
		advance(t, g)
	}
	if payer.C.Coin != coin-p.TollCoin || g.Ledger.Of(ledger.ToTolls, ledger.Coin) != p.TollCoin || len(factsOf(g, factRoadTollPaid)) != 1 {
		t.Fatalf("the crossing paid %d, tolls hold %d", coin-payer.C.Coin, g.Ledger.Of(ledger.ToTolls, ledger.Coin))
	}
	// Once a day a road: a second crossing that day is free, the next day's
	// is not.
	now := g.Tick()
	mustFeed(t, g.toll(payer, to, now))
	if payer.C.Coin != coin-p.TollCoin {
		t.Fatal("a second crossing the same day paid")
	}
	next := (now/sheets.TicksPerDay + 1) * sheets.TicksPerDay
	mustFeed(t, g.toll(payer, to, next))
	if payer.C.Coin != coin-2*p.TollCoin {
		t.Fatal("the next day's crossing did not pay")
	}

	// Short of coin, one unit of the first goods goes to the tile's pool.
	poor := feedChars(t, g, 1, to)[0]
	roadGrant(t, g, poor, "toll-strip", ledger.Coin, -poor.C.Coin)
	roadGrant(t, g, poor, "toll-goods", ledger.Material(g.r.Book.Materials[0].ID), 3)
	i := slices.IndexFunc(poor.C.Goods, func(s item.Spoil) bool { return s.Qty > 0 })
	mat, qty := poor.C.Goods[i].Material, poor.C.Goods[i].Qty
	mustFeed(t, g.toll(poor, to, now))
	if poor.C.Coin != 0 || poor.C.Goods[i].Qty != qty-1 || g.Ledger.Of(poolOf(to), ledger.Goods(mat)) != 1 {
		t.Fatalf("a toll in goods: %+v, pool %d", poor.C.Goods, g.Ledger.Of(poolOf(to), ledger.Goods(mat)))
	}

	// With neither, the crossing is free; a cut road takes no toll.
	bare := feedChars(t, g, 1, to)[0]
	roadGrant(t, g, bare, "toll-bare", ledger.Coin, -bare.C.Coin)
	paid := len(factsOf(g, factRoadTollPaid))
	mustFeed(t, g.toll(bare, to, now))
	rec.CutUntil = next/sheets.TicksPerDay + p.CutDays
	mustFeed(t, g.toll(payer, to, next+sheets.TicksPerDay))
	if len(factsOf(g, factRoadTollPaid)) != paid || payer.C.Coin != coin-2*p.TollCoin {
		t.Fatal("a free or cut crossing paid")
	}
	audit(t, g)
}

// TestTollEveryFollower: each member of a party stepping onto a tolled road
// pays its own toll, not only the leader.
func TestTollEveryFollower(t *testing.T) {
	g := feedGame(t)
	p := g.r.Emerge.P
	from, to := slowStep(t, g)
	rec := roadAtTile(t, g, to)
	rec.TollUntil = g.Tick()/sheets.TicksPerDay + p.TollDays
	cs := formParty(t, g, 2, from)
	lead, f := cs[0], cs[1]
	coins := map[string]int64{}
	for _, c := range cs {
		roadGrant(t, g, c, "toll-party-"+c.C.ID, ledger.Coin, p.TollCoin*2)
		coins[c.C.ID] = c.C.Coin
	}
	act(t, g, f, Follow, "")
	if _, err := g.Act(Command{Key: "toll-lead", Char: lead.C.ID, Kind: Step, Dir: from.DirectionTo(to)}); err != nil {
		t.Fatal(err)
	}
	for i := 0; lead.Long != nil && i < 50; i++ {
		advance(t, g)
	}
	if lead.C.At != to || f.C.At != to {
		t.Fatalf("leader at %s, follower at %s, want %s", lead.C.At.Ref(), f.C.At.Ref(), to.Ref())
	}
	if n := len(factsOf(g, factRoadTollPaid)); n != 2 {
		t.Fatalf("%d tolls paid for a party of two", n)
	}
	for _, c := range cs {
		if c.C.Coin != coins[c.C.ID]-p.TollCoin {
			t.Fatalf("%s paid %d, want %d", c.C.ID, coins[c.C.ID]-c.C.Coin, p.TollCoin)
		}
	}
	audit(t, g)
}

// TestRoadStopsAtTheMapEdge: a laid road ends where its path leaves the
// map, so one road id never lies in disconnected pieces.
func TestRoadStopsAtTheMapEdge(t *testing.T) {
	g := feedGame(t)
	var a, b hex.Hex
	found := false
	for _, h := range openTiles(t, g, 300) {
		for _, n := range h.Neighbours() {
			if g.World.RegionAt(n) >= 0 && !g.IsSettlement(n) && !g.IsSettlement(h) && g.Emergence.Roads[n] == "" && g.Emergence.Roads[h] == "" {
				a, b, found = h, n, true
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		t.Fatal("no two open tiles side by side near the first settlement")
	}
	off := hex.Hex{Q: 1 << 40, R: 1 << 40}
	if g.World.RegionAt(off) >= 0 {
		t.Fatal("the far tile is on the map")
	}
	after := b.Neighbour(0).Neighbour(0).Neighbour(0)
	if g.World.RegionAt(after) < 0 || g.Emergence.Roads[after] != "" {
		t.Fatal("the tile past the gap is not open ground")
	}
	if err := g.layRoad([]hex.Hex{a, b, off, after}, viaPattern, g.lastFact()); err != nil {
		t.Fatal(err)
	}
	advance(t, g)
	ra, okA := g.roadAt(a)
	rb, okB := g.roadAt(b)
	if !okA || !okB || ra.ID != rb.ID || ra.Tiles != 2 {
		t.Fatalf("the tiles before the gap: %+v %+v", ra, rb)
	}
	if g.Emergence.Roads[after] != "" {
		t.Fatal("the road went on past the map's edge")
	}
}

func TestPatrolledRoadBand(t *testing.T) {
	g := feedGame(t)
	p := g.r.Emerge.P
	home := homeRegion(g)
	bands := g.r.Book.RouteRisks
	var h hex.Hex
	found := false
	for _, x := range openTiles(t, g, 300) {
		if g.World.RegionAt(x) == home && len(g.Creatures(x)) > 0 {
			h, found = x, true
			break
		}
	}
	if !found {
		t.Fatal("no tile with creatures in the first settlement's region")
	}
	gaugeTo(t, g, home, gaugeThreat, bands[len(bands)-1].Threat)
	c := feedChars(t, g, 1, h)[0]
	_, base, ok := g.riskBand(c, h)
	if !ok || base == 0 {
		t.Fatalf("band %d at the top threat", base)
	}
	rec := roadAtTile(t, g, h)
	gaugeTo(t, g, home, gaugeThreat, bands[len(bands)-1].Threat)
	road := max(0, base+int(g.charScale(c, "road-risk", 0)))
	band := func() int {
		_, i, _ := g.riskBand(c, h)
		return i
	}
	if band() != road {
		t.Fatalf("an unpatrolled road's band %d, want %d", band(), road)
	}
	day := g.Tick() / sheets.TicksPerDay
	want := max(0, road+int(p.RoadPatrolRisk))

	// A road war's patrol won.
	rec.PatrolUntil = day + p.PatrolDays
	if band() != want {
		t.Fatalf("a patrolled road's band %d, want %d", band(), want)
	}
	// Cut, it is no road at all.
	rec.CutUntil = day + p.CutDays
	if band() != base {
		t.Fatalf("a cut road's band %d, want the ground's %d", band(), base)
	}
	rec.CutUntil, rec.PatrolUntil = 0, 0

	// A faction's patrol move, until the next day turn.
	f, err := g.r.weights.New(g.Tick(), factPatrolled, world.RegionRef(home), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	mustFeed(t, g.noteTraces([]fact.Fact{f}))
	if band() != want || rec.PatrolUntil != day+1 {
		t.Fatalf("a faction's patrol: band %d, until %d", band(), rec.PatrolUntil)
	}
	rec.PatrolUntil = 0

	// A guild's road patrol at a settlement in the region.
	g.Guilds = append(g.Guilds, &Guild{G: &guild.Guild{ID: "patrol-guild", Works: []guild.Work{{ID: "road-patrol", Settlement: 0}}}})
	mustFeed(t, roadsDay(g, day, g.Tick()))
	if band() != want {
		t.Fatalf("a guild's patrol: band %d, want %d", band(), want)
	}
	if g.roadPatrolled(h, day+1) {
		t.Fatal("a guild's patrol outlasted its day")
	}
}

func TestRaidCutsRoad(t *testing.T) {
	g := feedGame(t)
	p := g.r.Emerge.P
	from, to := slowStep(t, g)
	ground, _ := g.World.EnterTicks(from, to)
	rec := roadAtTile(t, g, to)
	day := g.Tick() / sheets.TicksPerDay
	rec.TollUntil = day + p.TollDays
	region := g.World.RegionAt(to)
	if rec.Region != region {
		t.Fatalf("the road's region %d, its tile's %d", rec.Region, region)
	}
	f, err := g.r.weights.New(g.Tick(), factRaided, world.RegionRef(region), nil, nil, fact.N("loot", 0))
	if err != nil {
		t.Fatal(err)
	}
	if f.ID, err = g.Log.Append(f); err != nil {
		t.Fatal(err)
	}
	mustFeed(t, g.noteTraces([]fact.Fact{f}))
	cut := factsOf(g, factRoadCut)
	if rec.CutUntil != day+p.CutDays || len(cut) != 1 || !slices.Contains(cut[0].Causes, f.ID) {
		t.Fatalf("the raid: record %+v, cut facts %+v", rec, cut)
	}
	if g.roadOpen(to) {
		t.Fatal("a cut road is open")
	}
	c := feedChars(t, g, 1, from)[0]
	roadGrant(t, g, c, "raid-coin", ledger.Coin, p.TollCoin)
	coin := c.C.Coin
	mustFeed(t, g.toll(c, to, g.Tick()))
	if cost, _, _ := g.EnterCost(c, from, to, g.Tick()); cost != ground || c.C.Coin != coin {
		t.Fatalf("a cut road costs %d ticks, ground %d, and took %d coin", cost, ground, coin-c.C.Coin)
	}
	// It stays a road and opens again once the cut is over.
	if _, ok := g.roadAt(to); !ok || !g.roadOpenOn(to, day+p.CutDays) || g.roadOpenOn(to, day+p.CutDays-1) {
		t.Fatal("the cut did not last exactly cut-days")
	}
}

func TestSpiralLaysRoad(t *testing.T) {
	g := feedGame(t)
	p := g.r.Emerge.P
	row := g.puzzleRow("frontier-spiral")
	if row == nil || !slices.ContainsFunc(row.Opens, func(o sheets.PatternOpen) bool { return o.Kind == openRoad && o.Waits == "" }) {
		t.Fatal("the frontier spiral opens no road")
	}
	home := g.SettlementHex(0)
	// A centre whose way home is shorter than the cap.
	most := p.PatternRoadMost
	var near hex.Hex
	var nearPath []hex.Hex
	for r := int64(5); r < most/2 && nearPath == nil; r++ {
		for _, h := range hex.Ring(home, r) {
			if g.World.RegionAt(h) < 0 || !g.r.Gen.Passable(g.r.Gen.Baseline(h).Terrain) {
				continue
			}
			if n, ok := g.nearestOpen(h); !ok || n != 0 {
				continue
			}
			if path, _, ok := g.World.Path(h, home); ok && int64(len(path)) < most {
				near, nearPath = h, path
				break
			}
		}
	}
	if nearPath == nil {
		t.Fatal("no pattern centre with a short way home")
	}
	// The solve cites the last mark set, here a creation.
	solve := func(g *Game, id string, at hex.Hex) error {
		mustCreate(t, g, "solver-"+id, "knife")
		return g.patternSolved(&Board{ID: id, Rule: row.ID, Centre: at}, row, g.lastFact(), g.Tick())
	}
	if err := solve(g, "spiral-near", near); err != nil {
		t.Fatal(err)
	}
	advance(t, g)
	ps := promotionsOf(g, emerge.Road)
	if len(ps) != 1 {
		t.Fatalf("%d road promotions", len(ps))
	}
	pf, _ := g.Log.Get(ps[0].Fact)
	if datumOf(pf.Data, datumVia) != viaPattern {
		t.Fatalf("the road's promotion: %+v", pf.Data)
	}
	for _, h := range nearPath {
		if rec, ok := g.roadAt(h); !ok || rec.ID != ps[0].ID {
			t.Fatalf("%s of the way home is not the spiral's road", h.Ref())
		}
	}
	if rec := g.Emergence.RoadRecs[ps[0].ID]; rec.Tiles != int64(len(nearPath)) {
		t.Fatalf("the road has %d tiles, the way %d", rec.Tiles, len(nearPath))
	}
	// A way home longer than the cap lays the cap's tiles from the centre.
	fg := feedGame(t)
	short := int64(len(nearPath)) - 2
	fg.r.Emerge.P.PatternRoadMost = short
	if err := solve(fg, "spiral-far", near); err != nil {
		t.Fatal(err)
	}
	fps := promotionsOf(fg, emerge.Road)
	if len(fps) != 1 || fg.Emergence.RoadRecs[fps[0].ID].Tiles != short || fg.Emergence.Roads[nearPath[short]] != "" ||
		fg.Emergence.Roads[nearPath[0]] != fps[0].ID {
		t.Fatalf("a long way home laid %+v", fg.Emergence.RoadRecs)
	}
	// Without emergence the opener lays nothing.
	plain := guardGame(t)
	plain.Emergence = nil
	plain.wireEmergence()
	if err := solve(plain, "spiral-plain", near); err != nil {
		t.Fatal(err)
	}
	if slices.ContainsFunc(plain.Pending, func(a world.Action) bool { return a.Kind == world.ActRoad }) {
		t.Fatal("a world without emergence laid a road")
	}
}

func TestRoadWhyPart(t *testing.T) {
	g := feedGame(t)
	p := g.r.Emerge.P
	from, to := slowStep(t, g)
	ground, _ := g.World.EnterTicks(from, to)
	c := feedChars(t, g, 1, from)[0]
	if _, why, _ := g.EnterCost(c, from, to, g.Tick()); len(why) == 0 || why[0] != (Part{"terrain", ground, unitTicks}) {
		t.Fatalf("off the road: %+v", why)
	}
	rec := roadAtTile(t, g, to)
	if _, why, _ := g.EnterCost(c, from, to, g.Tick()); !slices.Equal(why, []Part{{partRoad, p.RoadEnterTicks, unitTicks}}) {
		t.Fatalf("on the road: %+v", why)
	}
	c.C.Set(char.Hungry, 0)
	hungry := g.r.wp("hungry-enter-ticks")
	cost, why, _ := g.EnterCost(c, from, to, g.Tick())
	if cost != p.RoadEnterTicks+hungry || !slices.Equal(why, []Part{{partRoad, p.RoadEnterTicks, unitTicks}, {char.Hungry, hungry, unitTicks}}) {
		t.Fatalf("hungry on the road: %d %+v", cost, why)
	}
	c.C.Clear(char.Hungry)
	rec.CutUntil = g.Tick()/sheets.TicksPerDay + p.CutDays
	if _, why, _ := g.EnterCost(c, from, to, g.Tick()); why[0].Label != "terrain" || slices.ContainsFunc(why, func(x Part) bool { return x.Label == partRoad }) {
		t.Fatalf("on a cut road: %+v", why)
	}
}
