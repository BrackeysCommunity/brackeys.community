package game

import (
	"reflect"
	"slices"
	"strconv"
	"testing"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

// heavyAt writes and notes a located heavy fact on h now, as a raid
// there would, so later digests of its neighbourhood differ.
func heavyAt(t *testing.T, g *Game, h hex.Hex) {
	t.Helper()
	id, err := g.worldFact(h, "faction.raided", nil, nil, fact.At(h)...)
	if err != nil {
		t.Fatal(err)
	}
	g.World.Note(g.Log.Since(id - 1)...)
}

func TestCreaturesFromContent(t *testing.T) {
	g := guardGame(t)
	from := g.SettlementHex(0)
	led, checked := 0, 0
	for r := int64(1); r <= 20; r++ {
		for _, h := range hex.Ring(from, r) {
			arch := g.r.Gen.Archetypes(h)
			if len(arch) < 2 || g.World.Content(h) != nil {
				continue
			}
			reachAt(t, g, h)
			c, ok := g.Content(h)
			if !ok || !slices.Contains(arch, c.Lead) {
				t.Fatalf("%s holds lead %q among %v", h.Ref(), c.Lead, arch)
			}
			got := g.Creatures(h)
			want := append([]string{c.Lead}, slices.DeleteFunc(slices.Clone(arch), func(a string) bool { return a == c.Lead })...)
			if !slices.Equal(got, want) {
				t.Fatalf("%s reads %v, stored lead %q over %v", h.Ref(), got, c.Lead, arch)
			}
			native := g.r.Gen.Creatures(h)
			if !slices.Equal(slices.Sorted(slices.Values(got)), slices.Sorted(slices.Values(native))) {
				t.Fatalf("%s holds %v, the seed %v", h.Ref(), got, native)
			}
			if got[0] != native[0] {
				led++
			}
			checked++
		}
	}
	if checked == 0 || led == 0 {
		t.Fatalf("%d tiles drawn, %d leading other than the region's creature: the lead is not read from content", checked, led)
	}

	// A frozen tile's lead is the seed's, and reads exactly as it.
	h := huntTile(t, g)
	reachAt(t, g, h)
	c, _ := g.Content(h)
	c.Lead = g.r.Gen.Native(h).Lead
	if !slices.Equal(g.Creatures(h), g.r.Gen.Creatures(h)) {
		t.Fatalf("a native lead reads %v, the seed %v", g.Creatures(h), g.r.Gen.Creatures(h))
	}

	// An encounter meets one of the tile's creatures.
	site, ok := g.Suggest(from)
	if !ok {
		t.Skip("no site to explore near the first settlement")
	}
	x := mustCreate(t, g, "meets", "knife")
	if err := g.Teleport(x, site.At); err != nil {
		t.Fatal(err)
	}
	explored(t, g, x)
	if !slices.Contains(g.Creatures(site.At), x.Fight.E.Creature.Archetype) && x.C.Floor == 0 {
		t.Fatalf("met %s on a tile holding %v", x.Fight.E.Creature.Archetype, g.Creatures(site.At))
	}
}

func TestFloorsAtFirstReach(t *testing.T) {
	g := guardGame(t)
	h, plan := dungeonFor(t, g, "", 3)
	tp, _, key, ok := g.drawnPlan(h)
	if !ok {
		t.Fatal("a dungeon reached in a world drawing from history holds no drawn plan")
	}
	tier := g.tierAt(h)
	if len(tp.Drawn) != 0 || len(tp.Ways) != 0 || g.FloorAt(h, 1, noWay, tier).N != 0 {
		t.Fatalf("floors stored before anyone went down: %+v", tp)
	}
	a := mustCreate(t, g, "first-down", "knife")
	if err := g.Teleport(a, h); err != nil {
		t.Fatal(err)
	}
	explored(t, g, a)
	f, ok := tp.Floor(1, noWay)
	if !ok || len(tp.Drawn) != 1 {
		t.Fatalf("the first descent stored %+v", tp.Drawn)
	}
	if _, ok := tp.WaysOf(1); !ok || len(tp.Ways) != 1 {
		t.Fatalf("floor 1's ways down are not stored: %+v", tp.Ways)
	}
	first := *f
	fp := g.FloorAt(h, 1, noWay, tier)
	if fp.N != 1 || a.Fight.E.Floor != 1 || fp.Ways[gen.WayOpen].Fork == "" {
		t.Fatalf("floor 1 reads %+v", fp)
	}

	// Later history would draw it otherwise; the stored floor stands.
	heavyAt(t, g, h)
	advance(t, g)
	later := g.r.Gen.DrawFloor(plan, key, g.World.DigestAt(h, g.reachTick()).Key(), 1, noWay)
	if later == genDraw(first) {
		t.Fatal("the raid moved nothing a floor is drawn from")
	}
	b := mustCreate(t, g, "second-down", "knife")
	if err := g.Teleport(b, h); err != nil {
		t.Fatal(err)
	}
	explored(t, g, b)
	if f, _ := tp.Floor(1, noWay); len(tp.Drawn) != 1 || *f != first || b.Fight.E.Floor != 1 {
		t.Fatalf("the second party drew floor 1 again: %+v, was %+v", tp.Drawn, first)
	}
	if !reflect.DeepEqual(g.FloorAt(h, 1, noWay, tier), fp) {
		t.Fatal("floor 1 reads otherwise for the second party")
	}

	// The fork opens on floor 1's stored ways; floor 2 waits for a push.
	endFight(t, g, a, fight.Won, nil)
	if fork := g.Fork(a); fork == nil || fork.Ways[0].Fork != fp.Ways[gen.WayOpen].Fork {
		t.Fatalf("the fork reads %+v over floor 1's ways %+v", fork, fp.Ways)
	}
	if len(tp.Drawn) != 1 {
		t.Fatalf("floor 2 drawn before anyone pushed on: %+v", tp.Drawn)
	}
	act(t, g, a, DungeonPush, WayOption(gen.WayOpen))
	f2, ok := tp.Floor(2, gen.WayOpen)
	if !ok || len(tp.Drawn) != 2 || a.C.Floor != 2 {
		t.Fatalf("the push down stored %+v", tp.Drawn)
	}
	fp2 := g.FloorAt(h, 2, gen.WayOpen, tier)
	for _, tag := range fp.Ways[gen.WayOpen].Tags {
		if !slices.Contains(fp2.Tags, tag) {
			t.Fatalf("floor 2 lacks the way in's tag %s: %v", tag, fp2.Tags)
		}
	}
	if fp2.Beats != f2.Beats {
		t.Fatalf("floor 2 reads %d beats, stored %d", fp2.Beats, f2.Beats)
	}
}

func TestNativeReadsUnreached(t *testing.T) {
	g := guardGame(t)
	from := g.SettlementHex(0)
	var tiles []hex.Hex
	dungeons := 0
	for r := int64(25); r <= 40 && dungeons < 3; r++ {
		for _, h := range hex.Ring(from, r) {
			if g.World.Tile(h) != nil {
				continue
			}
			if _, ok := g.r.Gen.Dungeon(h); ok {
				dungeons++
			} else if len(g.r.Gen.Creatures(h)) == 0 || r%5 != 0 {
				continue
			}
			tiles = append(tiles, h)
		}
	}
	if dungeons == 0 {
		t.Fatal("no unreached dungeon to read")
	}
	before, err := g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	stored := len(g.World.Tiles)
	for _, h := range tiles {
		if _, ok := g.Content(h); ok {
			t.Fatalf("%s holds content nobody reached", h.Ref())
		}
		if !slices.Equal(g.Creatures(h), g.r.Gen.Creatures(h)) || g.SiteKind(h) != "" || g.Placed(h) != nil ||
			g.SiteAt(h) != g.r.Gen.Baseline(h).Site {
			t.Fatalf("%s reads other than the seed", h.Ref())
		}
		for _, m := range g.Materials(h) {
			if g.Stock(h, m) != g.tp("node-stock") || g.StockLeft(h, m) != g.tp("node-stock") {
				t.Fatalf("%s holds %d %s", h.Ref(), g.Stock(h, m), m)
			}
		}
		np, nok := g.r.Gen.Dungeon(h)
		p, ok := g.Plan(h)
		if p != np || ok != nok || g.IsDungeon(h) != nok {
			t.Fatalf("%s plans %+v, the seed %+v", h.Ref(), p, np)
		}
		g.CanExplore(h)
		g.DungeonName(h)
		g.KeyCost(h)
		for n := int64(1); n <= np.Floors; n++ {
			for way := int64(noWay); way <= gen.WayHidden; way++ {
				if !reflect.DeepEqual(g.FloorAt(h, n, way, 2), g.r.Gen.FloorAt(h, n, way, 2)) ||
					!reflect.DeepEqual(g.Floor(h, n, way), g.r.Gen.Floor(h, n, way)) {
					t.Fatalf("%s floor %d by %d reads other than the seed", h.Ref(), n, way)
				}
			}
		}
	}
	g.Suggest(tiles[0])
	if after, _ := g.Digest(); after != before || len(g.World.Tiles) != stored {
		t.Fatal("reading unreached tiles stored something")
	}
}

func TestStockConserved(t *testing.T) {
	g := guardGame(t)
	from := g.SettlementHex(0)
	node := g.tp("node-stock")
	var h hex.Hex
	var mat string
	for r := int64(1); r <= 12 && mat == ""; r++ {
		for _, x := range hex.Ring(from, r) {
			if g.IsSettlement(x) || !g.r.Gen.Passable(g.r.Gen.Baseline(x).Terrain) || g.World.Content(x) != nil {
				continue
			}
			reachAt(t, g, x)
			for _, m := range g.Materials(x) {
				if g.Stock(x, m) < node {
					h, mat = x, m
				}
			}
			if mat != "" {
				break
			}
		}
	}
	if mat == "" {
		t.Fatal("no reached tile holds a material under node-stock")
	}
	c, _ := g.Content(h)
	stock := c.Stock[mat]
	if g.StockLeft(h, mat) != stock {
		t.Fatalf("a fresh node holds %d %s, stored %d", g.StockLeft(h, mat), mat, stock)
	}
	var cs []*Char
	for i := range 3 {
		x := mustCreate(t, g, "gatherer-"+strconv.Itoa(i), "knife")
		if err := g.Teleport(x, h); err != nil {
			t.Fatal(err)
		}
		cs = append(cs, x)
	}
	day := g.Tick() / sheets.TicksPerDay
	for range 40 {
		for _, x := range cs {
			if x.Long == nil && !g.WorkedOut(h, mat) {
				key := "gather-" + x.C.ID + "-" + strconv.FormatInt(g.Tick(), decimal)
				if _, err := g.Act(Command{Key: key, Char: x.C.ID, Kind: Gather, Material: mat, Ticks: g.r.wp("gather-ticks-max")}); err != nil {
					t.Fatal(err)
				}
			}
		}
		advance(t, g)
		if gathered := g.World.Tile(h).Gathered[mat]; gathered > stock || g.StockLeft(h, mat) != stock-gathered {
			t.Fatalf("gathered %d %s of a node of %d", gathered, mat, stock)
		}
	}
	var got int64
	for _, x := range cs {
		got += g.balance(x, ledger.Material(mat))
	}
	if g.Tick()/sheets.TicksPerDay == day && (got != stock || !g.WorkedOut(h, mat)) {
		t.Fatalf("three gatherers took %d %s from a node of %d", got, mat, stock)
	}
	if got > stock {
		t.Fatalf("three gatherers took %d %s from a node of %d", got, mat, stock)
	}
}
