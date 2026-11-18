package gen_test

import (
	"fmt"
	"testing"

	"jams.team/mmo-world/harness"
	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
)

func book(t *testing.T) *sheets.Book {
	t.Helper()
	b, err := harness.LoadBook(harness.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func newGen(t *testing.T, b *sheets.Book, label string) *gen.Gen {
	t.Helper()
	g, err := gen.New(b, keys.Throwaway(label).Generation)
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func TestHexBasics(t *testing.T) {
	if n := len(gen.Ring(gen.Hex{}, 24)); n != 144 {
		t.Fatalf("ring of 24 has %d tiles", n)
	}
	for _, h := range gen.Ring(gen.Hex{Q: 3, R: -1}, 5) {
		if gen.Distance(h, gen.Hex{Q: 3, R: -1}) != 5 {
			t.Fatalf("%v is not 5 steps out", h)
		}
	}
	if n := len(gen.Disc(25)); n != 1951 || gen.DiscSize(25) != 1951 {
		t.Fatalf("disc of 25 has %d tiles", n)
	}
	line := gen.Line(gen.Hex{}, gen.Hex{Q: 7, R: -3})
	for i := 1; i < len(line); i++ {
		if gen.Distance(line[i-1], line[i]) != 1 {
			t.Fatalf("line skips at %d: %v", i, line)
		}
	}
	h := gen.Hex{Q: 5, R: -2}
	if h.Rotate(6) != h || h.Rotate(3) != h.Scale(-1) || h.Mirror().Mirror() != h || h.Rotate(1).Len() != h.Len() {
		t.Fatal("rotate or mirror is wrong")
	}
}

// Chunks tile the plane: every tile is in exactly one, within its radius.
func TestChunksTile(t *testing.T) {
	g := newGen(t, book(t), "chunks")
	n := g.ChunkRadius()
	seen := map[gen.Hex]gen.ChunkCoord{}
	for _, cc := range []gen.ChunkCoord{{0, 0}, {1, 0}, {0, 1}, {-1, 1}, {2, -3}, {-4, 5}} {
		c := g.Chunk(cc)
		if int64(len(c.Tiles)) != gen.DiscSize(n) {
			t.Fatalf("chunk %v has %d tiles", cc, len(c.Tiles))
		}
		for _, tile := range c.Tiles {
			if other, dup := seen[tile.Hex]; dup {
				t.Fatalf("%v is in chunks %v and %v", tile.Hex, other, cc)
			}
			seen[tile.Hex] = cc
			if g.ChunkOf(tile.Hex) != cc {
				t.Fatalf("%v maps to %v, not %v", tile.Hex, g.ChunkOf(tile.Hex), cc)
			}
		}
	}
	for _, h := range gen.Disc(60) {
		if gen.Distance(g.ChunkCentre(g.ChunkOf(h)), h) > n {
			t.Fatalf("%v is outside its chunk", h)
		}
	}
}

// The same tile gives the same baseline whatever was generated first.
func TestChunkOrder(t *testing.T) {
	b := book(t)
	var order []gen.ChunkCoord
	for a := int64(-3); a <= 3; a++ {
		for c := int64(-3); c <= 3; c++ {
			order = append(order, gen.ChunkCoord{A: a, B: c})
		}
	}
	digest := func(g *gen.Gen, cc gen.ChunkCoord) string {
		d, err := canon.Digest(g.Chunk(cc))
		if err != nil {
			t.Fatal(err)
		}
		return d.String()
	}
	forward := newGen(t, b, "order")
	want := map[gen.ChunkCoord]string{}
	for _, cc := range order {
		want[cc] = digest(forward, cc)
	}
	d := draw.NewDrawer(keys.Throwaway("order-shuffle").Roll)
	for round := range 3 {
		g := newGen(t, b, "order")
		for _, k := range d.Shuffle(len(order), "shuffle", draw.Int(int64(round))) {
			if got := digest(g, order[k]); got != want[order[k]] {
				t.Fatalf("round %d: chunk %v differs when generated in another order", round, order[k])
			}
		}
	}
	for _, cc := range order[:4] {
		if got := digest(newGen(t, b, "order"), cc); got != want[cc] {
			t.Fatalf("chunk %v differs when generated alone", cc)
		}
	}
}

func TestPatterns(t *testing.T) {
	b := book(t)
	for seed := range 4 {
		g := newGen(t, b, fmt.Sprintf("patterns-%d", seed))
		// Walk in a wider disc than is checked: a place near the edge may
		// reach the spine through a node outside the checked disc.
		a := g.DiscArea(gen.Hex{}, 70+50)
		relays, pylons, vaults := 0, 0, 0
		for _, p := range a.Points {
			switch p.Rule {
			case "ring-of-eight":
				relays++
				if p.Hex.Len() != 24 {
					t.Fatalf("seed %d: relay %v is %d from the origin", seed, p.Hex, p.Hex.Len())
				}
			case "triangle-of-pylons":
				if p.Place == "pylon" {
					pylons++
				} else {
					vaults++
					if d := p.Hex.Len(); d != 40 {
						t.Fatalf("seed %d: vault %d from the origin", seed, d)
					}
				}
			}
		}
		if relays != 8 || pylons != 3 || vaults != 1 {
			t.Fatalf("seed %d: %d relays, %d pylons, %d vaults", seed, relays, pylons, vaults)
		}
		// Opening order is nearest first, and none starts in the Eye.
		last := int64(0)
		for n := range 12 {
			s := g.Settlement(n)
			if s.Hex.Len() < last || s.Hex.Len() <= 24 {
				t.Fatalf("seed %d: settlement %d at %v out of order or in the Eye", seed, n, s.Hex)
			}
			last = s.Hex.Len()
		}
		// Everything placed is reachable from every starting settlement:
		// walking is symmetric, so one walk from one settlement shows it.
		var homes []int
		for _, h := range a.Settlements() {
			if a.Tiles[h].Hex.Len() <= 70 {
				homes = append(homes, h)
			}
		}
		if len(homes) < 3 {
			t.Fatalf("seed %d: %d settlements within 70 tiles", seed, len(homes))
		}
		walk := a.Walk(homes[:1])
		for _, p := range a.Points {
			if p.Hex.Len() <= 70 && walk[a.Index(p.Hex)] < 0 {
				t.Fatalf("seed %d: %+v unreachable", seed, p)
			}
		}
		for _, h := range homes {
			if walk[h] < 0 {
				t.Fatalf("seed %d: settlement %v unreachable", seed, a.Tiles[h].Hex)
			}
		}
		// Tier comes from the open settlements: 1 at an open one, the
		// ceiling far from all of them, and never higher as more open.
		first := g.Settlement(0).Hex
		if g.TierAt(first, 1) != 1 || g.TierAt(gen.Hex{Q: 400}, 1) != 4 {
			t.Fatalf("seed %d: tier %d at the first settlement, %d far off", seed, g.TierAt(first, 1), g.TierAt(gen.Hex{Q: 400}, 1))
		}
		for _, tile := range a.Tiles[:2000] {
			t1, t3 := g.TierAt(tile.Hex, 1), g.TierAt(tile.Hex, 3)
			if t1 < 1 || t1 > 4 || t3 > t1 {
				t.Fatalf("seed %d: %v tier %d with one open, %d with three", seed, tile.Hex, t1, t3)
			}
		}
	}
}

// A path over an area costs what the area's walk says.
func TestAreaPath(t *testing.T) {
	g := newGen(t, book(t), "area-path")
	a := g.DiscArea(g.Settlement(0).Hex, 20)
	homes := a.Settlements()
	walk := a.Walk(homes[:1])
	checked := 0
	for j := range a.Tiles {
		if j%37 != 0 {
			continue
		}
		path, cost, ok := a.Path(homes[0], j)
		if ok != (walk[j] >= 0) || (ok && cost != walk[j]) {
			t.Fatalf("tile %d: path %v cost %d, walk %d", j, ok, cost, walk[j])
		}
		if ok && (path[0] != homes[0] || path[len(path)-1] != j) {
			t.Fatalf("tile %d: path does not run from the start to it", j)
		}
		checked++
	}
	if checked == 0 {
		t.Fatal("nothing checked")
	}
}

// A chunk from a fresh generator, which pays for its neighbourhood.
func BenchmarkColdChunk(b *testing.B) {
	bk, err := harness.LoadBook(harness.ModuleRoot())
	if err != nil {
		b.Fatal(err)
	}
	i := 0
	for b.Loop() {
		g, err := gen.New(bk, keys.Throwaway(fmt.Sprint("cold-", i)).Generation)
		if err != nil {
			b.Fatal(err)
		}
		g.Chunk(gen.ChunkCoord{A: int64(i%5) + 2, B: -int64(i % 3)})
		i++
	}
}

// Pass two fills every baseline field: water classes, cover in range, ore
// higher in the hills than on the plain, landmarks and region materials.
func TestPassTwo(t *testing.T) {
	b := book(t)
	g := newGen(t, b, "pass-two")
	a := g.DiscArea(g.Settlement(0).Hex, 80)
	water := map[string]int{}
	marks := 0
	oreBy := map[string][2]int64{}
	for _, tile := range a.Tiles {
		water[tile.Water]++
		if tile.Cover < 0 || tile.Cover > 100 || tile.Ore < 0 || tile.Ore > 100 || tile.Fertility < 0 || tile.Fertility > 100 {
			t.Fatalf("%v: cover %d ore %d fertility %d out of range", tile.Hex, tile.Cover, tile.Ore, tile.Fertility)
		}
		if tile.Landmark != "" {
			marks++
		}
		o := oreBy[tile.Terrain]
		oreBy[tile.Terrain] = [2]int64{o[0] + tile.Ore, o[1] + 1}
	}
	for _, w := range []string{gen.WaterNone, gen.WaterCoast} {
		if water[w] == 0 {
			t.Errorf("no %s tiles in %v", w, water)
		}
	}
	if water[gen.WaterRiver]+water[gen.WaterStream] == 0 {
		t.Errorf("no running water in %v", water)
	}
	if water[gen.WaterLake]+water[gen.WaterSea] == 0 {
		t.Errorf("no open water in %v", water)
	}
	if marks == 0 {
		t.Error("no landmarks")
	}
	mean := func(k string) int64 { return oreBy[k][0] / max(oreBy[k][1], 1) }
	if oreBy["hills"][1] > 0 && oreBy["plain"][1] > 0 && mean("hills") <= mean("plain") {
		t.Errorf("ore in hills %d, on the plain %d", mean("hills"), mean("plain"))
	}
	tables := 0
	for _, r := range a.Regions {
		if r.Base.Creature != "" {
			if c := g.Creatures(r.Base.Centre); len(c) > 0 {
				tables++
			}
		}
		if n := len(r.Base.Materials); r.Base.Materials != nil && (n < 3 || n > 5) {
			t.Fatalf("region %v holds %d materials", r.Base.ID, n)
		}
	}
	if tables == 0 {
		t.Error("no tile has a creature table")
	}
}
