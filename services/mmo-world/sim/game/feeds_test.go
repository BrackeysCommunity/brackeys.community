package game

import (
	"fmt"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
	"jams.team/mmo-world/sim/world"
)

func feedGame(t *testing.T) *Game {
	t.Helper()
	g := guardGame(t)
	if g.Emergence == nil || g.r.Emerge == nil {
		t.Fatal("a new game has no emergence")
	}
	return g
}

// feedChars are n new characters standing on h.
func feedChars(t *testing.T, g *Game, n int, h hex.Hex) []*Char {
	t.Helper()
	var out []*Char
	for i := range n {
		c := mustCreate(t, g, fmt.Sprintf("feed-%d-%d", len(g.Chars), i), "knife")
		c.C.At = h
		out = append(out, c)
	}
	return out
}

func promotionsOf(g *Game, ty emerge.Type) []emerge.Promotion {
	var out []emerge.Promotion
	for _, p := range g.Emergence.Promotions {
		if p.Type == ty {
			out = append(out, p)
		}
	}
	return out
}

func dayTick(day int64) int64 { return day * sheets.TicksPerDay }

func line(g *Game, ty emerge.Type) emerge.LineRow { return g.r.Emerge.Lines[string(ty)] }

// openTiles are passable land tiles in the awake regions near the first
// settlement that hold no settlement, no road and no site.
func openTiles(t *testing.T, g *Game, n int) []hex.Hex {
	t.Helper()
	var out []hex.Hex
	for r := int64(1); r < 30 && len(out) < n; r++ {
		for _, h := range hex.Ring(g.SettlementHex(0), r) {
			if len(out) < n && g.r.Gen.Passable(g.r.Gen.Baseline(h).Terrain) && g.World.RegionAt(h) >= 0 && g.slot(h) == "" {
				out = append(out, h)
			}
		}
	}
	if len(out) < n {
		t.Fatalf("%d open tiles near the first settlement", len(out))
	}
	return out
}

// siteTile is an overland site near the first settlement that is no
// dungeon, reached, with creatures.
func siteTile(t *testing.T, g *Game) hex.Hex {
	t.Helper()
	for r := int64(1); r < delveSearch; r++ {
		for _, h := range hex.Ring(g.SettlementHex(0), r) {
			if g.r.Gen.Baseline(h).Site == "" || g.World.RegionAt(h) < 0 {
				continue
			}
			reachAt(t, g, h)
			if g.slot(h) != "" && !g.IsDungeon(h) && !g.IsSettlement(h) && len(g.Creatures(h)) > 0 {
				return h
			}
		}
	}
	t.Fatal("no overland site near the first settlement")
	return hex.Hex{}
}

func dungeonTile(t *testing.T, g *Game) hex.Hex {
	t.Helper()
	h, _, ok := entrances(t, g, g.SettlementHex(0), func(hex.Hex, gen.Plan) bool { return true })
	if !ok {
		t.Fatal("no dungeon entrance")
	}
	return h
}

func mustFeed(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func TestFeedRoadLineDistinct(t *testing.T) {
	g := feedGame(t)
	ln := line(g, emerge.Road)
	tiles := openTiles(t, g, 1)
	h := tiles[0]
	cs := feedChars(t, g, int(ln.Distinct), h)
	tick := g.Tick()
	// One short of the distinct count, crossing well past the count.
	for i := range ln.Count + ln.Distinct {
		mustFeed(t, g.notePassage(cs[i%(ln.Distinct-1)], h, tick))
	}
	sp := g.Emergence.Passage[h]
	if sp == nil || sp.Done != "" || len(promotionsOf(g, emerge.Road)) != 0 {
		t.Fatalf("%d crossers made a road: %+v", ln.Distinct-1, sp)
	}
	mustFeed(t, g.notePassage(cs[ln.Distinct-1], h, tick))
	if sp.Done == "" || len(promotionsOf(g, emerge.Road)) != 1 {
		t.Fatalf("%d crossers made no road: %+v", ln.Distinct, sp)
	}
}

func TestFeedRoadLineCount(t *testing.T) {
	g := feedGame(t)
	ln := line(g, emerge.Road)
	h := openTiles(t, g, 1)[0]
	cs := feedChars(t, g, int(ln.Distinct), h)
	tick := g.Tick()
	for i := range ln.Count - 1 {
		mustFeed(t, g.notePassage(cs[i%ln.Distinct], h, tick))
	}
	if sp := g.Emergence.Passage[h]; sp.Done != "" {
		t.Fatalf("%d crossings made a road", ln.Count-1)
	}
	mustFeed(t, g.notePassage(cs[0], h, tick))
	if sp := g.Emergence.Passage[h]; sp.Done == "" {
		t.Fatalf("%d crossings made no road", ln.Count)
	}
	p := promotionsOf(g, emerge.Road)
	if len(p) != 1 || p[0].At == nil || *p[0].At != h || p[0].Region != g.World.RegionAt(h) || p[0].First != "" {
		t.Fatalf("the road's promotion: %+v", p)
	}
}

func TestFeedRoadLineWindow(t *testing.T) {
	g := feedGame(t)
	ln := line(g, emerge.Road)
	h := openTiles(t, g, 1)[0]
	cs := feedChars(t, g, int(ln.Distinct), h)
	half := ln.Count / 2
	for i := range half {
		mustFeed(t, g.notePassage(cs[i%ln.Distinct], h, dayTick(0)))
	}
	// The first half falls out of the window the day the rest come.
	for i := range ln.Count - half {
		mustFeed(t, g.notePassage(cs[i%ln.Distinct], h, dayTick(ln.WindowDays)))
	}
	if g.Emergence.Passage[h].Done != "" {
		t.Fatal("crossings outside the window made a road")
	}
}

func TestFeedCampLine(t *testing.T) {
	g := feedGame(t)
	ln := line(g, emerge.Camp)
	h := siteTile(t, g)
	c := feedChars(t, g, 1, h)[0]
	won := &fight.Encounter{Result: fight.Won}
	for range ln.Count - 1 {
		mustFeed(t, g.noteClearing(c, won, g.Tick()))
	}
	if g.Emergence.Clearing[h].Done != "" || len(promotionsOf(g, emerge.Camp)) != 0 {
		t.Fatalf("%d clearings made a camp", ln.Count-1)
	}
	mustFeed(t, g.noteClearing(c, &fight.Encounter{Result: fight.Lost}, g.Tick()))
	if g.Emergence.Clearing[h].Done != "" {
		t.Fatal("a lost encounter counted as a clearing")
	}
	mustFeed(t, g.noteClearing(c, won, g.Tick()))
	p := promotionsOf(g, emerge.Camp)
	if g.Emergence.Clearing[h].Done == "" || len(p) != 1 || p[0].At == nil || *p[0].At != h {
		t.Fatalf("%d clearings made no camp: %+v", ln.Count, p)
	}
}

func TestFeedHauntLine(t *testing.T) {
	g := feedGame(t)
	ln := line(g, emerge.Haunt)
	h := siteTile(t, g)
	c := feedChars(t, g, 1, h)[0]
	down := &fight.Encounter{Result: fight.Lost}
	// One character down again and again: the line counts downs.
	for range ln.Count - 1 {
		mustFeed(t, g.noteLoss(c, down, g.Tick()))
	}
	if g.Emergence.Loss[h].Done != "" {
		t.Fatalf("%d downs made a haunt", ln.Count-1)
	}
	mustFeed(t, g.noteLoss(c, down, g.Tick()))
	if g.Emergence.Loss[h].Done == "" || len(promotionsOf(g, emerge.Haunt)) != 1 {
		t.Fatalf("%d downs made no haunt", ln.Count)
	}
	rt := g.Emergence.Regions[g.World.RegionAt(h)]
	if day, season := g.traceAt(g.Tick()); rt == nil || rt.Downs.At(day, season, g.r.Emerge.Decay[emerge.Loss]).Int() != ln.Count {
		t.Fatalf("the region's downs: %+v", rt)
	}
	// Off a site a down is the region's only.
	open := openTiles(t, g, 1)[0]
	c.C.At = open
	mustFeed(t, g.noteLoss(c, down, g.Tick()))
	if g.Emergence.Loss[open] != nil {
		t.Fatal("a down off a site was counted at its tile")
	}
}

func TestFeedFloorsAndEntrancesNotCounted(t *testing.T) {
	g := feedGame(t)
	site := siteTile(t, g)
	d := dungeonTile(t, g)
	c := feedChars(t, g, 1, site)[0]
	floor := &fight.Encounter{Result: fight.Won, Floor: 1}
	mustFeed(t, g.noteClearing(c, floor, g.Tick()))
	mustFeed(t, g.noteLoss(c, &fight.Encounter{Result: fight.Lost, Floor: 1}, g.Tick()))
	if g.Emergence.Clearing[site] != nil || g.Emergence.Loss[site] != nil {
		t.Fatal("a floor's encounter counted at the site")
	}
	c.C.At = d
	mustFeed(t, g.noteClearing(c, &fight.Encounter{Result: fight.Won}, g.Tick()))
	mustFeed(t, g.noteLoss(c, &fight.Encounter{Result: fight.Lost}, g.Tick()))
	if g.Emergence.Clearing[d] != nil || g.Emergence.Loss[d] != nil {
		t.Fatal("a dungeon's entrance counted as a site")
	}
	home := g.SettlementHex(0)
	c.C.At = home
	mustFeed(t, g.noteClearing(c, &fight.Encounter{Result: fight.Won}, g.Tick()))
	if g.Emergence.Clearing[home] != nil {
		t.Fatal("a settlement counted as a site")
	}
}

// TestFeedSharedWinOnce closes a party's won encounter at a site: one
// encounter is one clearing however many won it.
func TestFeedSharedWinOnce(t *testing.T) {
	g := feedGame(t)
	h := siteTile(t, g)
	cs := formParty(t, g, 3, h)
	if err := g.begin(cs[0], false, 0); err != nil {
		t.Fatal(err)
	}
	if cs[0].Fight == nil || cs[0].Fight.Shared == "" {
		t.Fatal("the party is in no shared encounter")
	}
	endFight(t, g, cs[0], fight.Won, nil)
	sp := g.Emergence.Clearing[h]
	if day, season := g.traceAt(g.Tick()); sp == nil || sp.Window.Sum(day, season, line(g, emerge.Camp).WindowDays) != 1 {
		t.Fatalf("a shared win counted as %+v", sp)
	}
	// A solo win through close counts too.
	c := feedChars(t, g, 1, h)[0]
	if err := g.begin(c, false, 0); err != nil {
		t.Fatal(err)
	}
	endFight(t, g, c, fight.Won, nil)
	if day, season := g.traceAt(g.Tick()); sp.Window.Sum(day, season, line(g, emerge.Camp).WindowDays) != 2 {
		t.Fatal("a solo win was not a clearing")
	}
}

// stagedGoods is a material only a staged source makes, for the test.
const stagedGoods = "test-staged-goods"

func TestFeedRouteLine(t *testing.T) {
	g := feedGame(t)
	if len(g.Places) < 2 {
		g.Places = append(g.Places, &Place{N: len(g.Places), Hex: openTiles(t, g, 1)[0], Lattice: -1})
	}
	ln := line(g, emerge.Route)
	g.r.matTags[stagedGoods] = []string{tagStaged}
	mat := someHaul(g)[0].Material
	c := feedChars(t, g, 1, g.SettlementHex(0))[0]
	haul := func(units int64, from, to int) {
		t.Helper()
		c.C.Goods = []item.Spoil{{Material: mat, Qty: units}, {Material: stagedGoods, Qty: ln.Count}}
		c.Visits = []Visit{{Settlement: from, Tick: g.Tick()}}
		c.C.At = g.SettlementHex(to)
		mustFeed(t, g.visited(c, c.C.At, g.Tick()))
	}
	haul(ln.Count-1, 0, 1)
	k := emerge.PairOf(0, 1)
	if p := g.Emergence.Pairs[k]; p == nil || p.Done != "" {
		t.Fatalf("%d load made a route (staged goods counted?): %+v", ln.Count-1, p)
	}
	// Standing again where it last stood moves nothing.
	mustFeed(t, g.visited(c, c.C.At, g.Tick()))
	if g.Emergence.Pairs[k].Done != "" {
		t.Fatal("a second visit counted as haulage")
	}
	haul(1, 1, 0)
	p := promotionsOf(g, emerge.Route)
	if g.Emergence.Pairs[k].Done == "" || len(p) != 1 || !slices.Equal(p[0].Places, []int{0, 1}) {
		t.Fatalf("%d load made no route: %+v", ln.Count, p)
	}
}

// styleOption is a won press's option keyed on the first trait: a style.
func styleOption(g *Game) (fight.Option, string) {
	trait := tags.Tag(g.r.Book.Traits[0].Tag)
	o := fight.Option{ID: "test-strike", Axis: g.r.Book.Axes[0].ID, Tags: []tags.Tag{tags.Tag(g.r.Book.Axes[0].ID + "-led")},
		Gear: &fight.Gear{Tags: []tags.Tag{trait}}}
	id, _, _, _ := g.r.Emerge.Styles.StyleOf(o.Axis, o.Tags, o.Gear.Tags)
	return o, id
}

func TestFeedStyleLine(t *testing.T) {
	g := feedGame(t)
	ln := line(g, emerge.Style)
	h := openTiles(t, g, 1)[0]
	region := g.World.RegionAt(h)
	o, id := styleOption(g)
	if id == "" {
		t.Fatal("the option has no style")
	}
	cs := feedChars(t, g, int(ln.Distinct), h)
	e := &fight.Encounter{Creature: fight.Creature{Archetype: g.Creatures(h)[0]}}
	win := func(c *Char, day int64) {
		t.Helper()
		mustFeed(t, g.noteReliance(c, e, o, dayTick(day)))
	}
	// Every character's first win falls just outside the window.
	last := ln.WindowDays
	for _, c := range cs {
		win(c, 0)
	}
	for _, c := range cs {
		for range ln.PerCharacter - 1 {
			win(c, last)
		}
	}
	k := emerge.StyleKey{Region: region, Style: id}
	if st := g.Emergence.Styles[k]; st == nil || st.Done != "" {
		t.Fatalf("wins outside %d days named a style: %+v", ln.WindowDays, st)
	}
	// One more win each brings every tenth win inside; the last makes it.
	for _, c := range cs[:len(cs)-1] {
		win(c, last)
	}
	if g.Emergence.Styles[k].Done != "" {
		t.Fatalf("%d characters named a style", ln.Distinct-1)
	}
	win(cs[len(cs)-1], last)
	st := g.Emergence.Styles[k]
	p := promotionsOf(g, emerge.Style)
	if st.Done == "" || len(p) != 1 || p[0].Of != id || p[0].Region != region || p[0].First != cs[0].C.ID {
		t.Fatalf("%d characters named no style: %+v %+v", ln.Distinct, st, p)
	}
	rt := g.Emergence.Regions[region]
	if rt.Today.On(last) != ln.Distinct*ln.PerCharacter {
		t.Fatalf("the region's wins today: %+v", rt.Today)
	}
	// Named, it tallies what it beats.
	win(cs[0], last)
	if st.Beaten[e.Creature.Archetype] != 1 || st.Today.On(last) != ln.Distinct*ln.PerCharacter+1 {
		t.Fatalf("beaten %v, today %+v", st.Beaten, st.Today)
	}
}

func TestFeedNoStyleWithoutAxis(t *testing.T) {
	g := feedGame(t)
	h := openTiles(t, g, 1)[0]
	c := feedChars(t, g, 1, h)[0]
	e := &fight.Encounter{Creature: fight.Creature{Archetype: g.Creatures(h)[0]}}
	mustFeed(t, g.noteReliance(c, e, fight.Option{ID: "brace"}, g.Tick()))
	if len(g.Emergence.Styles) != 0 || g.Emergence.Regions[g.World.RegionAt(h)] == nil {
		t.Fatalf("an option with no axis: styles %v", g.Emergence.Styles)
	}
}

func TestFeedRoadLoad(t *testing.T) {
	g := feedGame(t)
	h := openTiles(t, g, 1)[0]
	g.Pending = append(g.Pending, world.Action{Kind: world.ActRoad, Hex: h, Units: world.RoadTrack})
	advance(t, g)
	c := feedChars(t, g, 1, h)[0]
	mat := someHaul(g)[0].Material
	g.r.matTags[stagedGoods] = []string{tagStaged}
	c.C.Goods = []item.Spoil{{Material: mat, Qty: 7}, {Material: stagedGoods, Qty: 5}}
	mustFeed(t, g.notePassage(c, h, g.Tick()))
	rl := g.Emergence.RoadLoad[g.World.RegionAt(h)]
	if day, season := g.traceAt(g.Tick()); rl == nil || rl.Window.Sum(day, season, g.r.Emerge.P.RoadWarDays) != 7 || rl.Busiest != h {
		t.Fatalf("road load: %+v", rl)
	}
	if c.C.Deeds.Get(char.DeedRoadSteps) != 1 {
		t.Fatal("a road step was not a deed")
	}
}

// TestFeedStagedCrossings: crossings made while a staged command is
// applied leave no trace.
func TestFeedStagedCrossings(t *testing.T) {
	g := feedGame(t)
	h := openTiles(t, g, 1)[0]
	c := feedChars(t, g, 1, h)[0]
	done := g.stagingFor(Command{Key: "staged-correct", Kind: Correct, Char: c.C.ID})
	mustFeed(t, g.notePassage(c, h, g.Tick()))
	done()
	if g.Emergence.Passage[h] != nil {
		t.Fatal("a staged command's crossing was counted")
	}
	mustFeed(t, g.notePassage(c, h, g.Tick()))
	if g.Emergence.Passage[h] == nil {
		t.Fatal("a plain crossing was not counted")
	}
}

func TestFeedOffIsMM9(t *testing.T) {
	g := feedGame(t)
	g.Emergence = nil
	h := openTiles(t, g, 1)[0]
	c := feedChars(t, g, 1, h)[0]
	mustFeed(t, g.notePassage(c, h, g.Tick()))
	mustFeed(t, g.noteLoss(c, &fight.Encounter{Result: fight.Lost}, g.Tick()))
	if g.leadItem(c) != nil {
		t.Fatal("a world without emergence names a lead item")
	}
}

// TestFeedLeadItem: the heavy deeds a character presses name the item it
// leads with.
func TestFeedLeadItem(t *testing.T) {
	g := feedGame(t)
	c := feedChars(t, g, 1, g.SettlementHex(0))[0]
	ref := g.leadItem(c)
	in := c.C.In(char.Hand, 0)
	if in == nil {
		t.Skip("the knife start equips nothing")
	}
	if ref == nil || *ref != (fact.Ref{Kind: renownItem, ID: in.ID}) {
		t.Fatalf("lead item %v, hand %s", ref, in.ID)
	}
	subjects := g.withLead(c, []fact.Ref{char.Ref(c.C.ID)})
	if len(subjects) != 2 || subjects[1] != *ref {
		t.Fatalf("subjects %v", subjects)
	}
}

// TestFeedJourneyCrossings walks a journey of one step onto a road tile:
// the step is a crossing, a road step and road load at the source.
func TestFeedJourneyCrossings(t *testing.T) {
	g := feedGame(t)
	home := g.SettlementHex(0)
	n := huntTile(t, g)
	g.Pending = append(g.Pending, world.Action{Kind: world.ActRoad, Hex: n, Units: world.RoadTrack})
	advance(t, g)
	c := feedChars(t, g, 1, home)[0]
	if _, err := g.Act(Command{Key: "feed-walk", Char: c.C.ID, Kind: Step, Dir: home.DirectionTo(n)}); err != nil {
		t.Fatal(err)
	}
	for i := 0; c.C.At != n && i < 50; i++ {
		advance(t, g)
	}
	if c.C.At != n {
		t.Fatal("the journey did not arrive")
	}
	sp := g.Emergence.Passage[n]
	if sp == nil || !slices.ContainsFunc(sp.Who.IDs, func(s emerge.Seen) bool { return s.ID == c.C.ID }) {
		t.Fatalf("the step was not a crossing: %+v", sp)
	}
	if c.C.Deeds.Get(char.DeedRoadSteps) != 1 || g.Emergence.RoadLoad[g.World.RegionAt(n)] == nil {
		t.Fatal("the road step was not counted")
	}
}
