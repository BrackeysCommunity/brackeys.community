package gen

import (
	"fmt"
	"slices"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

func dungeonBook(t *testing.T) *sheets.Book {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func dungeonGen(t *testing.T, b *sheets.Book, label string) *Gen {
	t.Helper()
	g, err := New(b, keys.Throwaway(label).Generation)
	if err != nil {
		t.Fatal(err)
	}
	return g
}

// relays are the ring's relay places, from the patterns alone.
func relays(g *Gen) []PatternPoint {
	var out []PatternPoint
	for _, cc := range g.ch.Near(Hex{}, ringRadius+g.p.chunk) {
		for _, p := range g.Patterns(cc) {
			if p.Place == PlaceRelay && !slices.ContainsFunc(out, func(q PatternPoint) bool { return q.Hex == p.Hex }) {
				out = append(out, p)
			}
		}
	}
	return out
}

// structural: the ring of eight stands this far from the origin.
const ringRadius = 24

// checkPlan holds a dungeon and every floor of it to the GDD's shape:
// 3 to 7 floors inside its kind's range, a guardian, two ways and a
// hidden third above the bottom, none on it.
func checkPlan(t *testing.T, g *Gen, p Plan, entrance []tags.Tag, who string) {
	t.Helper()
	k := g.kind(p.Kind)
	if p.Floors < 3 || p.Floors > 7 || p.Floors < k.FloorsMin || p.Floors > k.FloorsMax {
		t.Fatalf("%s: %s with %d floors", who, p.Kind, p.Floors)
	}
	if gd, ok := sheets.GuardianOf(g.b.Hunts, p.Kind); !ok || p.Guardian != gd.ID {
		t.Fatalf("%s: %s guarded by %q", who, p.Kind, p.Guardian)
	}
	if p.Up != k.Up || p.SeedTier < 1 || p.SeedTier > g.p.tierCeiling {
		t.Fatalf("%s: up %v seed tier %d", who, p.Up, p.SeedTier)
	}
	way := int64(-1)
	for n := int64(1); n <= p.Floors; n++ {
		f := g.floor(p, entrance, n, way, p.SeedTier)
		if f.N != n || f.Steps != n-1 || f.Bottom != (n == p.Floors) || f.Creature == "" {
			t.Fatalf("%s floor %d: %+v", who, n, f)
		}
		if f.Beats < 1 || f.Beats > g.mp("floor-beats-max") {
			t.Fatalf("%s floor %d: %d beats", who, n, f.Beats)
		}
		if c := g.creature(f.Creature); c == nil || c.Tier != f.Step.Tier {
			t.Fatalf("%s floor %d: creature %s at stepped tier %d", who, n, f.Creature, f.Step.Tier)
		}
		if f.Bottom {
			if f.Ways[0].Fork != "" || f.Ways[WayHidden].Fork != "" || f.Machine {
				t.Fatalf("%s: a fork on the bottom floor", who)
			}
			break
		}
		seen := map[string]bool{}
		for i, w := range f.Ways {
			if w.Fork == "" || seen[w.Fork] || len(w.Tags) < 1 || len(w.Tags) > 3 {
				t.Fatalf("%s floor %d way %d: %+v", who, n, i, f.Ways)
			}
			seen[w.Fork] = true
		}
		if f.Machine && !slices.Contains(k.Families, f.Family) {
			t.Fatalf("%s floor %d: fork machine %q", who, n, f.Family)
		}
		way = (way + 1 + n) % forkWays
	}
}

// A thousand seeds: every relay of the ring is a relay tower, every
// dungeon drawn there would be well formed, and each dungeon kind turns
// up by its share.
func TestDungeonThousandSeeds(t *testing.T) {
	b := dungeonBook(t)
	kinds := map[string]int{}
	floors := map[int64]int{}
	for seed := range 1000 {
		g := dungeonGen(t, b, fmt.Sprint("dungeons-", seed))
		rs := relays(g)
		if len(rs) == 0 {
			t.Fatalf("seed %d: no relay on the ring", seed)
		}
		for _, r := range rs {
			p, ok := g.plan(r.Hex, PlaceRelay, g.nearestHome(r.Hex))
			if !ok || p.Kind != "relay-tower" || !p.Up {
				t.Fatalf("seed %d: relay %v gives %+v", seed, r.Hex, p)
			}
			checkPlan(t, g, p, nil, fmt.Sprintf("seed %d relay %v", seed, r.Hex))
		}
		h := rs[0].Hex
		p, ok := g.plan(h, PlaceDungeon, g.nearestHome(h))
		if !ok || p.Up {
			t.Fatalf("seed %d: a dungeon place gives %+v", seed, p)
		}
		checkPlan(t, g, p, nil, fmt.Sprintf("seed %d dungeon %v", seed, h))
		kinds[p.Kind]++
		floors[p.Floors]++
	}
	for _, k := range b.Dungeons {
		if k.Place == PlaceDungeon && kinds[k.ID] == 0 {
			t.Fatalf("no %s in a thousand seeds: %v", k.ID, kinds)
		}
	}
	if len(floors) < 4 {
		t.Fatalf("floor counts %v", floors)
	}
}

// realDungeons are the dungeon and relay places of the chunks round the
// origin, as generation leaves them.
func realDungeons(g *Gen, around int64) []Hex {
	var out []Hex
	for a := -around; a <= around; a++ {
		for c := -around; c <= around; c++ {
			for _, tb := range g.Chunk(ChunkCoord{A: a, B: c}).Tiles {
				if tb.Site == PlaceDungeon || tb.Site == PlaceRelay {
					out = append(out, tb.Hex)
				}
			}
		}
	}
	return out
}

func dungeonDigest(t *testing.T, g *Gen, h Hex) string {
	t.Helper()
	p, ok := g.Dungeon(h)
	if !ok {
		t.Fatalf("%v: no dungeon", h)
	}
	all := []any{p}
	for n := int64(1); n <= p.Floors; n++ {
		for way := int64(-1); way < forkWays; way++ {
			all = append(all, g.Floor(h, n, way))
		}
	}
	d, err := canon.Digest(all)
	if err != nil {
		t.Fatal(err)
	}
	return d.String()
}

// A dungeon is the same whatever was generated first, and alone; asking
// for dungeons first leaves every chunk as it was.
func TestDungeonChunkOrder(t *testing.T) {
	b := dungeonBook(t)
	forward := dungeonGen(t, b, "order")
	hs := realDungeons(forward, 2)
	if len(hs) == 0 {
		t.Fatal("no dungeon or relay near the origin")
	}
	want := map[Hex]string{}
	for _, h := range hs {
		want[h] = dungeonDigest(t, forward, h)
	}
	d := draw.NewDrawer(keys.Throwaway("order-shuffle").Roll)
	for round := range 3 {
		g := dungeonGen(t, b, "order")
		for _, k := range d.Shuffle(len(hs), "shuffle", draw.Int(int64(round))) {
			if got := dungeonDigest(t, g, hs[k]); got != want[hs[k]] {
				t.Fatalf("round %d: dungeon %v differs in another order", round, hs[k])
			}
		}
	}
	for _, h := range hs[:min(len(hs), 3)] {
		if got := dungeonDigest(t, dungeonGen(t, b, "order"), h); got != want[h] {
			t.Fatalf("dungeon %v differs alone", h)
		}
	}
	chunk := func(g *Gen, cc ChunkCoord) string {
		d, err := canon.Digest(g.Chunk(cc))
		if err != nil {
			t.Fatal(err)
		}
		return d.String()
	}
	first := dungeonGen(t, b, "order")
	for _, h := range hs {
		dungeonDigest(t, first, h)
	}
	for a := int64(-2); a <= 2; a++ {
		for c := int64(-2); c <= 2; c++ {
			cc := ChunkCoord{A: a, B: c}
			if chunk(first, cc) != chunk(dungeonGen(t, b, "order"), cc) {
				t.Fatalf("chunk %v moved once dungeons were asked for", cc)
			}
		}
	}
}

// Relay places give relay towers that go up; dungeon places give one of
// the other kinds; a tile with neither gives none.
func TestRelayPlaces(t *testing.T) {
	b := dungeonBook(t)
	for seed := range 3 {
		g := dungeonGen(t, b, fmt.Sprint("relay-places-", seed))
		var relay, dungeon int
		for _, h := range append(realDungeons(g, 3), g.Settlement(0).Hex) {
			p, ok := g.Dungeon(h)
			switch g.Baseline(h).Site {
			case PlaceRelay:
				relay++
				if !ok || p.Kind != "relay-tower" || !p.Up {
					t.Fatalf("seed %d relay %v: %+v", seed, h, p)
				}
			case PlaceDungeon:
				dungeon++
				if !ok || p.Kind == "relay-tower" || p.Up {
					t.Fatalf("seed %d dungeon %v: %+v", seed, h, p)
				}
			default:
				if ok {
					t.Fatalf("seed %d: a dungeon at %v", seed, h)
				}
			}
			if ok {
				checkPlan(t, g, p, g.tileTags(h), fmt.Sprintf("seed %d %v", seed, h))
			}
		}
		if relay == 0 || dungeon == 0 {
			t.Fatalf("seed %d: %d relays, %d dungeons near the origin", seed, relay, dungeon)
		}
	}
}

// A floor half way to the next tier keeps the lower tier; past the
// ceiling the tier stays and the whole tiers beyond it count.
func TestSteps(t *testing.T) {
	g := dungeonGen(t, dungeonBook(t), "steps")
	c := g.p.tierCeiling
	for _, x := range []struct {
		tier, steps int64
		want        Step
	}{
		{1, 0, Step{Tier: 1}},
		{1, 1, Step{Tier: 1, Half: true}},
		{1, 2, Step{Tier: 2}},
		{c - 1, 3, Step{Tier: c, Half: true}},
		{c, 2, Step{Tier: c, Beyond: 1}},
		{c, 5, Step{Tier: c, Half: true, Beyond: 2}},
	} {
		if got := g.Steps(x.tier, x.steps); got != x.want {
			t.Fatalf("tier %d, %d half steps: %+v, want %+v", x.tier, x.steps, got, x.want)
		}
	}
}

// The way taken in adds its tags to the floor below; the third way cuts
// a beat and hides the party.
func TestFloorWays(t *testing.T) {
	g := dungeonGen(t, dungeonBook(t), "floor-ways")
	h := relays(g)[0].Hex
	p, _ := g.plan(h, PlaceDungeon, g.nearestHome(h))
	one := g.floor(p, g.tileTags(h), 1, -1, p.SeedTier)
	for way := range int64(forkWays) {
		two := g.floor(p, g.tileTags(h), 2, way, p.SeedTier)
		for _, tg := range one.Ways[way].Tags {
			if !slices.Contains(two.Tags, tg) {
				t.Fatalf("way %d's %s is not on floor 2: %v", way, tg, two.Tags)
			}
		}
		if (two.Hidden > 0) != (way == WayHidden) {
			t.Fatalf("way %d: hidden %d", way, two.Hidden)
		}
	}
	for _, tg := range g.kind(p.Kind).Tags {
		if !slices.Contains(one.Tags, tags.Tag(tg)) {
			t.Fatalf("the kind's %s is not on floor 1: %v", tg, one.Tags)
		}
	}
}
