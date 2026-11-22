package gen

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/history"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

// nativeDraw is floor n by way as the native labels draw it, in the shape
// a drawn floor is stored in.
func nativeDraw(g *Gen, p Plan, n, way int64) FloorDraw {
	at := []draw.Part{draw.Str(p.Hex.Ref()), draw.Int(n), draw.Int(way)}
	f := FloorDraw{
		N: n, Way: way,
		Beats: g.d.Between(g.mp("floor-beats-min"), g.mp("floor-beats-max"), "dungeon.beats", at...),
		Pick:  int64(g.d.Below(pickRange, "dungeon.creature", at...)),
	}
	if n < p.Floors {
		k := g.kind(p.Kind)
		if f.Machine = g.d.Percent(g.mp("fork-machine-share"), "dungeon.fork-machine", at...); f.Machine && len(k.Families) > 0 {
			f.Family = k.Families[g.d.Below(uint64(len(k.Families)), "dungeon.fork-family", at...)]
		}
	}
	return f
}

// wayIn is the way into floor n by way, as floor() takes it.
func wayIn(ways func(n int64) [forkWays]Way, n, way int64) *Way {
	if n <= 1 || way < 0 || way >= forkWays {
		return nil
	}
	w := ways(n - 1)[way]
	return &w
}

// patternDungeons are a seed's first relay tower, as the seed makes it,
// and a plan of every dungeon kind on that tile.
func patternDungeons(t *testing.T, g *Gen, seed int) []Plan {
	t.Helper()
	rs := relays(g)
	if len(rs) == 0 {
		t.Fatalf("seed %d: no relay on the ring", seed)
	}
	h := rs[0].Hex
	p, ok := g.Dungeon(h)
	if !ok {
		t.Fatalf("seed %d: relay %v has no dungeon", seed, h)
	}
	out := []Plan{p}
	for i := range g.b.Dungeons {
		if k := &g.b.Dungeons[i]; k.Place == PlaceDungeon {
			out = append(out, g.planOf(h, k, g.nearestHome(h), "dungeon.floors", draw.Str(h.Ref())))
		}
	}
	return out
}

// FloorFrom given the native labels' draws builds exactly what the native
// floor does, for every floor, way and live tier, so a frozen dungeon need
// store no floors.
func TestNativeFloorFrom(t *testing.T) {
	b := dungeonBook(t)
	var floors atomic.Int64
	overSeeds(t, func(t *testing.T, seed int) {
		g := dungeonGen(t, b, fmt.Sprint("dungeons-", seed))
		for _, p := range patternDungeons(t, g, seed) {
			_, slot := g.Dungeon(p.Hex)
			slot = slot && g.Baseline(p.Hex).Site == g.kind(p.Kind).Place
			for n := int64(1); n <= p.Floors; n++ {
				ways := g.ways(p, n)
				for way := int64(-1); way < forkWays; way++ {
					f := nativeDraw(g, p, n, way)
					in := wayIn(func(n int64) [forkWays]Way { return g.ways(p, n) }, n, way)
					for tier := int64(1); tier <= scaffoldTierMost; tier++ {
						got := g.FloorFrom(p, f, in, &ways, tier)
						want := g.floor(p, g.tileTags(p.Hex), n, way, tier)
						if slot {
							want = g.FloorAt(p.Hex, n, way, tier)
						}
						if !reflect.DeepEqual(got, want) {
							t.Fatalf("seed %d %s at %v floor %d way %d tier %d:\n got %+v\nwant %+v", seed, p.Kind, p.Hex, n, way, tier, got, want)
						}
						floors.Add(1)
					}
				}
			}
		}
	})
	if floors.Load() == 0 {
		t.Fatal("no floor compared")
	}
}

// structural: the live tiers a floor is read at in these tests.
const scaffoldTierMost = 4

// structural: a thousand seeds, swept in parallel groups that each own
// their generators.
const (
	sweepSeeds  = 1000
	sweepGroups = 8
)

// overSeeds runs each seed of the sweep, and returns once all have run.
func overSeeds(t *testing.T, each func(t *testing.T, seed int)) {
	t.Run("seeds", func(t *testing.T) {
		for group := range sweepGroups {
			t.Run(fmt.Sprint(group), func(t *testing.T) {
				t.Parallel()
				for seed := group; seed < sweepSeeds; seed += sweepGroups {
					each(t, seed)
				}
			})
		}
	})
}

// contentDigests are three neighbourhoods: a quiet one, an overrun one
// and a prosperous, haunted one held by a guild at war.
func contentDigests(b *sheets.Book) []history.Digest {
	bands := func(gauge string, band int64) []int64 {
		out := make([]int64, len(b.Gauges))
		for i, g := range b.Gauges {
			if g.ID == gauge {
				out[i] = band
			}
		}
		return out
	}
	return []history.Digest{
		{},
		{Facts: []history.Count{{Kind: "region.overrun", N: 3}}, Bands: bands("threat", 3)},
		{
			Facts:   []history.Count{{Kind: "dungeon.haunted", N: 2}, {Kind: "faction.raided", N: 5}},
			Bands:   bands("prosperity", 1),
			Faction: history.Pressure{Holders: 1, Archetypes: []string{"guild"}, War: true},
			Pins:    []string{"pin-1"},
			Finds:   []history.Count{{Kind: "far-material", N: 1}},
		},
	}
}

// contentTiles are the tiles of the chunks round the origin that hold a
// slot, and every tenth other tile.
func contentTiles(g *Gen) []TileBaseline {
	var out []TileBaseline
	for a := int64(-1); a <= 1; a++ {
		for c := int64(-1); c <= 1; c++ {
			for i, tb := range g.Chunk(ChunkCoord{A: a, B: c}).Tiles {
				if tb.Site != "" || i%10 == 0 {
					out = append(out, tb)
				}
			}
		}
	}
	return out
}

// The same tile and digest give the same content, from a fresh generator
// or a used one; one more fact gives another key and so other draws.
func TestContentKeyed(t *testing.T) {
	b := dungeonBook(t)
	ds := contentDigests(b)
	plus := ds[1]
	plus.Facts = []history.Count{{Kind: "region.overrun", N: 4}}
	if plus.Key() == ds[1].Key() {
		t.Fatal("one more fact gives the same key")
	}
	if ds[0].Key() == ds[1].Key() || ds[1].Key() == ds[2].Key() {
		t.Fatal("different digests share a key")
	}
	moved, held, sites := 0, 0, 0
	for seed := range 3 {
		label := fmt.Sprint("content-", seed)
		g := dungeonGen(t, b, label)
		chunk := canonOf(t, g.Chunk(ChunkCoord{}))
		tiles := contentTiles(g)
		first := map[Hex][]Drawn{}
		for _, tb := range tiles {
			for _, d := range ds {
				c := g.Content(tb.Hex, tb.Site, d, d.Key())
				checkDrawn(t, g, tb, c)
				first[tb.Hex] = append(first[tb.Hex], c)
			}
			if tb.Site == SiteOrdinary || tb.Site == SiteEdge {
				sites++
			}
			if len(g.Archetypes(tb.Hex)) == 0 && len(g.Region(tb.Region).Materials) == 0 {
				continue
			}
			held++
			if !reflect.DeepEqual(g.Content(tb.Hex, tb.Site, ds[1], ds[1].Key()), g.Content(tb.Hex, tb.Site, plus, plus.Key())) {
				moved++
			}
		}
		fresh := dungeonGen(t, b, label)
		for _, tb := range slices.Backward(tiles) {
			for i := len(ds) - 1; i >= 0; i-- {
				if got := fresh.Content(tb.Hex, tb.Site, ds[i], ds[i].Key()); !reflect.DeepEqual(got, first[tb.Hex][i]) {
					t.Fatalf("seed %d %v digest %d: drawn %+v, then %+v", seed, tb.Hex, i, first[tb.Hex][i], got)
				}
				if got := g.Content(tb.Hex, tb.Site, ds[i], ds[i].Key()); !reflect.DeepEqual(got, first[tb.Hex][i]) {
					t.Fatalf("seed %d %v digest %d: drawn twice differently", seed, tb.Hex, i)
				}
			}
		}
		if canonOf(t, g.Chunk(ChunkCoord{})) != chunk || canonOf(t, fresh.Chunk(ChunkCoord{})) != chunk {
			t.Fatalf("seed %d: drawing content moved the scaffold", seed)
		}
	}
	if sites == 0 || held == 0 {
		t.Fatalf("%d site slots and %d tiles with content among those read", sites, held)
	}
	if moved*2 < held {
		t.Fatalf("one more fact changed %d of %d tiles' content", moved, held)
	}
}

func canonOf(t *testing.T, v any) string {
	t.Helper()
	d, err := canon.Digest(v)
	if err != nil {
		t.Fatal(err)
	}
	return d.String()
}

// checkDrawn holds a tile's drawn content to its slot and its sheets.
func checkDrawn(t *testing.T, g *Gen, tb TileBaseline, c Drawn) {
	t.Helper()
	who := fmt.Sprintf("%v (%s)", tb.Hex, tb.Site)
	if tb.Site == SiteOrdinary || tb.Site == SiteEdge {
		i := slices.IndexFunc(g.b.SiteKinds, func(k sheets.SiteKind) bool { return k.ID == c.SiteKind })
		if i < 0 || !slices.Contains(g.b.SiteKinds[i].Places, tb.Site) {
			t.Fatalf("%s: site kind %q", who, c.SiteKind)
		}
	} else if c.SiteKind != "" {
		t.Fatalf("%s: a site kind %q off a site slot", who, c.SiteKind)
	}
	if arch := g.Archetypes(tb.Hex); (len(arch) == 0) != (c.Lead == "") || (c.Lead != "" && !slices.Contains(arch, c.Lead)) {
		t.Fatalf("%s: lead %q among %v", who, c.Lead, arch)
	}
	mats := g.Region(tb.Region).Materials
	if len(c.Stock) != len(mats) {
		t.Fatalf("%s: stock %v for materials %v", who, c.Stock, mats)
	}
	for _, m := range mats {
		units, ok := c.Stock[m], false
		for _, s := range g.b.StockBands {
			if u, _ := g.StockUnits(s.ID); u == units {
				ok = true
			}
		}
		if !ok {
			t.Fatalf("%s: %s starts with %d, no band's units", who, m, units)
		}
	}
	if _, slot := g.Dungeon(tb.Hex); slot != (c.Dungeon != nil) {
		t.Fatalf("%s: dungeon %+v on a slot %v", who, c.Dungeon, slot)
	}
}

// A drawn plan keeps the native dungeon rules whatever the history: floors
// inside the kind and 3 to 7, the kind's guardian, distinct ways of the kind
// with one to three tags, and each floor's creature and machine from the
// kind.
func TestDrawnDungeonRules(t *testing.T) {
	b := dungeonBook(t)
	ds := contentDigests(b)
	var mu sync.Mutex
	kinds := map[string]int{}
	overSeeds(t, func(t *testing.T, seed int) {
		g := dungeonGen(t, b, fmt.Sprint("dungeons-", seed))
		rs := relays(g)
		if len(rs) == 0 {
			t.Fatalf("seed %d: no relay on the ring", seed)
		}
		for i, d := range ds {
			key := d.Key()
			for _, at := range []struct {
				h    Hex
				site string
			}{{rs[0].Hex, PlaceRelay}, {rs[0].Hex, PlaceDungeon}} {
				p, ok := g.DrawPlan(at.h, at.site, "", d, key)
				if !ok {
					t.Fatalf("seed %d digest %d: %s at %v draws no plan", seed, i, at.site, at.h)
				}
				if g.kind(p.Kind).Place != at.site {
					t.Fatalf("seed %d: %s on a %s slot", seed, p.Kind, at.site)
				}
				mu.Lock()
				kinds[p.Kind]++
				mu.Unlock()
				checkDrawnPlan(t, g, p, key, fmt.Sprintf("seed %d digest %d %v", seed, i, at.h))
			}
		}
		for _, k := range b.Dungeons {
			p, ok := g.DrawPlan(rs[0].Hex, PlaceDungeon, k.ID, ds[0], ds[0].Key())
			if ok != (k.Place == PlaceDungeon) || (ok && p.Kind != k.ID) {
				t.Fatalf("seed %d: a fixed %s on a dungeon slot gives %+v, %v", seed, k.ID, p, ok)
			}
		}
		if _, ok := g.DrawPlan(rs[0].Hex, SiteOrdinary, "", ds[0], ds[0].Key()); ok {
			t.Fatalf("seed %d: a plan on a site slot", seed)
		}
	})
	for _, k := range b.Dungeons {
		if kinds[k.ID] == 0 {
			t.Fatalf("no %s drawn in a thousand seeds: %v", k.ID, kinds)
		}
	}
}

func checkDrawnPlan(t *testing.T, g *Gen, p Plan, key, who string) {
	t.Helper()
	k := g.kind(p.Kind)
	if p.Floors < 3 || p.Floors > 7 || p.Floors < k.FloorsMin || p.Floors > k.FloorsMax {
		t.Fatalf("%s: %s with %d floors", who, p.Kind, p.Floors)
	}
	if gd, ok := sheets.GuardianOf(g.b.Hunts, p.Kind); !ok || p.Guardian != gd.ID {
		t.Fatalf("%s: %s guarded by %q", who, p.Kind, p.Guardian)
	}
	if p.Up != k.Up || p.SeedTier != g.SeedTier(g.Baseline(p.Hex).HomeDist) {
		t.Fatalf("%s: up %v seed tier %d", who, p.Up, p.SeedTier)
	}
	var in *Way
	way := int64(-1)
	for n := int64(1); n <= p.Floors; n++ {
		ways := g.DrawWays(p, key, key, n)
		f := g.FloorFrom(p, g.DrawFloor(p, key, key, n, way), in, &ways, p.SeedTier)
		if f.N != n || f.Bottom != (n == p.Floors) || f.Beats < 1 || f.Beats > g.mp("floor-beats-max") {
			t.Fatalf("%s floor %d: %+v", who, n, f)
		}
		if c := g.creature(f.Creature); c == nil || c.Tier != f.Step.Tier || !slices.Contains(g.creaturePool(k, f.Step.Tier), f.Creature) {
			t.Fatalf("%s floor %d: creature %q at tier %d", who, n, f.Creature, f.Step.Tier)
		}
		for _, tg := range k.Tags {
			if !slices.Contains(f.Tags, tags.Tag(tg)) {
				t.Fatalf("%s floor %d: the kind's %s is missing from %v", who, n, tg, f.Tags)
			}
		}
		if in != nil {
			for _, tg := range in.Tags {
				if !slices.Contains(f.Tags, tg) {
					t.Fatalf("%s floor %d: the way in's %s is missing from %v", who, n, tg, f.Tags)
				}
			}
		}
		if f.Bottom {
			if !reflect.DeepEqual(ways, [forkWays]Way{}) || f.Machine || !reflect.DeepEqual(f.Ways, [forkWays]Way{}) {
				t.Fatalf("%s: a fork on the bottom floor", who)
			}
			break
		}
		seen := map[string]bool{}
		for i, w := range ways {
			fi := slices.IndexFunc(g.b.Forks, func(x sheets.Fork) bool { return x.ID == w.Fork })
			if fi < 0 || !slices.Contains(g.b.Forks[fi].Kinds, p.Kind) || seen[w.Fork] || len(w.Tags) < 1 || len(w.Tags) > 3 {
				t.Fatalf("%s floor %d way %d: %+v", who, n, i, ways)
			}
			seen[w.Fork] = true
		}
		if !reflect.DeepEqual(f.Ways, ways) {
			t.Fatalf("%s floor %d: built ways %+v, drawn %+v", who, n, f.Ways, ways)
		}
		if f.Machine && !slices.Contains(k.Families, f.Family) {
			t.Fatalf("%s floor %d: fork machine %q", who, n, f.Family)
		}
		way = (way + 1 + n) % forkWays
		in = &ways[way]
	}
}

// Every condition kind shifts its row by shift × min(count, most), rows of
// other tables and other rows stay put, a weight floors at 0, and weights
// that all come to 0 give the base back.
func TestWeights(t *testing.T) {
	src := dungeonBook(t)
	b := *src
	g := dungeonGen(t, &b, "weights")
	most := g.mp("history-kind-most")
	gauge := func(id string) int {
		return slices.IndexFunc(b.Gauges, func(x sheets.Gauge) bool { return x.ID == id })
	}
	bands := make([]int64, len(b.Gauges))
	bands[gauge("threat")] = 2
	d := history.Digest{
		Facts:   []history.Count{{Kind: "faction.raided", N: 3}, {Kind: "region.overrun", N: most + 4}},
		Bands:   bands,
		Faction: history.Pressure{Holders: 2, Archetypes: []string{"guild", "order"}, War: true},
		Pins:    []string{"pin-1", "pin-2"},
		Finds:   []history.Count{{Kind: "far-material", N: 5}},
	}
	row := func(id, table, r string, shift, upTo int64, set func(*sheets.ContentWeight)) sheets.ContentWeight {
		w := sheets.ContentWeight{ID: id, Table: table, Row: r, Shift: shift, Most: upTo}
		set(&w)
		return w
	}
	fact := func(f string) func(*sheets.ContentWeight) { return func(w *sheets.ContentWeight) { w.Fact = f } }
	cases := []struct {
		name  string
		rows  []sheets.ContentWeight
		table string
		ids   []string
		base  []int64
		lead  string
		want  []int64
	}{
		{"fact", []sheets.ContentWeight{row("a", TableSite, "x", 40, 0, fact("faction-raided"))}, TableSite, []string{"x", "y"}, []int64{10, 10}, "", []int64{10 * (100 + 120), 10 * 100}},
		{"fact capped by its row", []sheets.ContentWeight{row("a", TableSite, "x", 40, 2, fact("faction-raided"))}, TableSite, []string{"x"}, []int64{3}, "", []int64{3 * (100 + 80)}},
		{"fact capped by history-kind-most", []sheets.ContentWeight{row("a", TableSite, "x", 10, 0, fact("region-overrun"))}, TableSite, []string{"x"}, []int64{1}, "", []int64{100 + 10*most}},
		{"fact absent", []sheets.ContentWeight{row("a", TableSite, "x", 40, 0, fact("hunt-opened"))}, TableSite, []string{"x"}, []int64{7}, "", []int64{700}},
		{"band reached", []sheets.ContentWeight{row("a", TableDungeon, "x", 50, 0, func(w *sheets.ContentWeight) { w.Gauge, w.Band = "threat", 2 })}, TableDungeon, []string{"x"}, []int64{4}, "", []int64{4 * 150}},
		{"band not reached", []sheets.ContentWeight{row("a", TableDungeon, "x", 50, 0, func(w *sheets.ContentWeight) { w.Gauge, w.Band = "threat", 3 })}, TableDungeon, []string{"x"}, []int64{4}, "", []int64{400}},
		{"dormant gauge", []sheets.ContentWeight{row("a", TableDungeon, "x", 50, 0, func(w *sheets.ContentWeight) { w.Gauge, w.Band = "prosperity", 1 })}, TableDungeon, []string{"x"}, []int64{4}, "", []int64{400}},
		{"war", []sheets.ContentWeight{row("a", TableStock, "x", 30, 0, func(w *sheets.ContentWeight) { w.Faction = FactionWar })}, TableStock, []string{"x"}, []int64{2}, "", []int64{260}},
		{"not starving", []sheets.ContentWeight{row("a", TableStock, "x", 30, 0, func(w *sheets.ContentWeight) { w.Faction = FactionStarving })}, TableStock, []string{"x"}, []int64{2}, "", []int64{200}},
		{"archetype", []sheets.ContentWeight{row("a", TableRole, "x", 25, 0, func(w *sheets.ContentWeight) { w.Archetype = "order" }), row("b", TableRole, "x", 25, 0, func(w *sheets.ContentWeight) { w.Archetype = "clans" })}, TableRole, []string{"x"}, []int64{1}, "", []int64{125}},
		{"find", []sheets.ContentWeight{row("a", TableTrait, "x", 10, 3, func(w *sheets.ContentWeight) { w.Find = "far-material" })}, TableTrait, []string{"x"}, []int64{1}, "", []int64{130}},
		{"pins", []sheets.ContentWeight{row("a", TableSite, "x", 20, 0, func(w *sheets.ContentWeight) { w.Pins = true })}, TableSite, []string{"x"}, []int64{1}, "", []int64{140}},
		{"summed", []sheets.ContentWeight{row("a", TableSite, "x", 20, 0, func(w *sheets.ContentWeight) { w.Pins = true }), row("b", TableSite, "x", -30, 0, fact("faction-raided"))}, TableSite, []string{"x"}, []int64{1}, "", []int64{100 + 40 - 90}},
		{"floored at 0", []sheets.ContentWeight{row("a", TableSite, "x", -50, 0, fact("faction-raided"))}, TableSite, []string{"x", "y"}, []int64{5, 5}, "", []int64{0, 500}},
		{"all 0 gives the base", []sheets.ContentWeight{row("a", TableSite, "x", -50, 0, fact("faction-raided")), row("b", TableSite, "y", -100, 0, func(w *sheets.ContentWeight) { w.Pins = true })}, TableSite, []string{"x", "y"}, []int64{5, 6}, "", []int64{5, 6}},
		{"another table", []sheets.ContentWeight{row("a", TableTrait, "x", 40, 0, fact("faction-raided"))}, TableSite, []string{"x"}, []int64{3}, "", []int64{300}},
		{"the region's creature", []sheets.ContentWeight{row("a", TableLead, sheets.LeadRegion, 100, 0, func(w *sheets.ContentWeight) { w.Gauge, w.Band = "threat", 1 })}, TableLead, []string{"p", "q"}, []int64{3, 1}, "q", []int64{300, 200}},
		{"no region creature", []sheets.ContentWeight{row("a", TableLead, sheets.LeadRegion, 100, 0, func(w *sheets.ContentWeight) { w.Gauge, w.Band = "threat", 1 })}, TableLead, []string{"p", "q"}, []int64{3, 1}, "", []int64{300, 100}},
		{"region outside the lead table", []sheets.ContentWeight{row("a", TableSite, sheets.LeadRegion, 100, 0, func(w *sheets.ContentWeight) { w.Pins = true })}, TableSite, []string{"q"}, []int64{1}, "q", []int64{100}},
	}
	for _, c := range cases {
		b.ContentWeights = c.rows
		if got := g.Weights(c.table, c.ids, c.base, d, c.lead); !slices.Equal(got, c.want) {
			t.Fatalf("%s: weights %v, want %v", c.name, got, c.want)
		}
	}

	b.ContentWeights = src.ContentWeights
	for _, s := range b.StockBands {
		pct, ok := g.StockPercent(s.ID)
		units, uok := g.StockUnits(s.ID)
		if !ok || !uok || pct != s.Percent || units != fixed.PercentFloor(g.nodeStock(), s.Percent) {
			t.Fatalf("stock band %s: %d%% (%v), %d units (%v)", s.ID, pct, ok, units, uok)
		}
	}
	if _, ok := g.StockPercent("no-such-band"); ok {
		t.Fatal("an unknown stock band has a percent")
	}
	if _, ok := g.StockUnits("no-such-band"); ok {
		t.Fatal("an unknown stock band has units")
	}
}

// RegionSites and RegionLandmark agree with the baseline and hand out
// copies a caller cannot spoil.
func TestRegionSlots(t *testing.T) {
	g := dungeonGen(t, dungeonBook(t), "region-slots")
	sites, marks := 0, 0
	seen := map[LatticeID]bool{}
	for _, tb := range contentTiles(g) {
		if seen[tb.Region] {
			continue
		}
		seen[tb.Region] = true
		rs := g.RegionSites(tb.Region)
		for h, s := range rs {
			if g.Baseline(h).Site != s {
				t.Fatalf("%v: region site %s, baseline %s", h, s, g.Baseline(h).Site)
			}
			sites++
			rs[h] = "spoiled"
		}
		for h, s := range g.RegionSites(tb.Region) {
			if s == "spoiled" {
				t.Fatalf("%v: RegionSites handed out its own map", h)
			}
		}
		if id, at, ok := g.RegionLandmark(tb.Region); ok {
			if g.Baseline(at).Landmark != id {
				t.Fatalf("region %v: landmark %s at %v, baseline %q", tb.Region, id, at, g.Baseline(at).Landmark)
			}
			marks++
		}
	}
	if sites == 0 || marks == 0 {
		t.Fatalf("%d sites, %d landmarks read", sites, marks)
	}
}

// Generation never sees a pin or the world that holds them, so no pin can
// move the scaffold or another tile's content (GDD 4.17).
func TestGenKnowsNoPins(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	read := 0
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, name, nil, parser.SkipObjectResolution)
		if err != nil {
			t.Fatal(err)
		}
		read++
		for _, im := range f.Imports {
			path, _ := strconv.Unquote(im.Path.Value)
			if strings.HasSuffix(path, "/sim/world") || strings.HasSuffix(path, "/sim/tile") {
				t.Fatalf("%s imports %s", name, path)
			}
		}
		ast.Inspect(f, func(n ast.Node) bool {
			if sel, ok := n.(*ast.SelectorExpr); ok {
				if x, ok := sel.X.(*ast.Ident); ok && (x.Name == "world" || (x.Name == "tile" && sel.Sel.Name == "Fix")) {
					t.Fatalf("%s: %s.%s at %v", name, x.Name, sel.Sel.Name, fset.Position(sel.Pos()))
				}
			}
			return true
		})
	}
	if read == 0 {
		t.Fatal("no source read")
	}
}
