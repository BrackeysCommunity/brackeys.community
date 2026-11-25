package game

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/world"
)

// groundTerrain is the first map.terrain row that keep takes.
func groundTerrain(t *testing.T, g *Game, keep func(*sheets.Terrain) bool) string {
	t.Helper()
	for i := range g.r.Book.Terrain {
		if ter := &g.r.Book.Terrain[i]; keep(ter) {
			return ter.ID
		}
	}
	t.Fatal("no terrain row fits")
	return ""
}

// groundSite is an unreached, awake, passable tile near the first
// settlement, dry and not within two tiles of skip, that takes a
// designer's ground pin of terrain.
func groundSite(t *testing.T, g *Game, terrain string, skip ...hex.Hex) hex.Hex {
	t.Helper()
	fix := tile.Fix{Ground: &tile.GroundFix{Terrain: terrain}}
	by := world.PinBy{Role: world.PinDesigner}
	for r := int64(3); r <= 30; r++ {
		for _, h := range hex.Ring(g.SettlementHex(0), r) {
			b := g.r.Gen.Baseline(h)
			if slices.ContainsFunc(skip, func(s hex.Hex) bool { return hex.Distance(s, h) < 3 }) ||
				!g.r.Gen.Passable(b.Terrain) || b.Water != gen.WaterNone || b.Fertility >= fertilityScale ||
				g.World.RegionAt(h) < 0 || g.World.Content(h) != nil {
				continue
			}
			if g.World.CheckPin(h, 1, fix, by, false) == nil {
				return h
			}
		}
	}
	t.Fatalf("no tile takes ground of %s", terrain)
	return hex.Hex{}
}

func pinGround(t *testing.T, g *Game, at hex.Hex, terrain string) {
	t.Helper()
	cmd := Command{Key: "ground-" + at.Ref(), Kind: PinReserve, Pin: &PinCmd{At: at, Reach: 1, Fix: tile.Fix{Ground: &tile.GroundFix{Terrain: terrain}}}}
	if _, err := g.Act(cmd); err != nil {
		t.Fatal(err)
	}
	if err := g.Reach(at); err != nil {
		t.Fatal(err)
	}
	if c := g.World.Content(at); c == nil || c.Ground == nil || c.Ground.Terrain != terrain {
		t.Fatalf("ground of %s did not land on %s: %+v", terrain, at.Ref(), c)
	}
}

// forageDeltas are the provisions each tick of a forage on h brought c.
func forageDeltas(t *testing.T, g *Game, c *Char, h hex.Hex) []int64 {
	t.Helper()
	if err := g.Teleport(c, h); err != nil {
		t.Fatal(err)
	}
	ticks := g.r.wp("gather-ticks-min")
	if _, err := g.Act(Command{Key: "forage-" + h.Ref(), Char: c.C.ID, Kind: Forage, Ticks: ticks}); err != nil {
		t.Fatal(err)
	}
	var out []int64
	held := g.Ledger.Of(ledger.Char(c.C.ID), ledger.Provisions)
	for range ticks + 2 {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
		now := g.Ledger.Of(ledger.Char(c.C.ID), ledger.Provisions)
		if now > held {
			out = append(out, now-held)
		}
		held = now
	}
	if len(out) == 0 {
		t.Fatalf("a forage on %s found nothing", h.Ref())
	}
	return out
}

// A landed ground patch is what hunts, steps, gathers and the creatures
// living there read, while a twin world without the pin reads the
// scaffold on the same tiles.
func TestLandedGroundReads(t *testing.T) {
	g, twin := guardGame(t), guardGame(t)
	wall := groundTerrain(t, g, func(ter *sheets.Terrain) bool { return !ter.Passable })
	bog := groundTerrain(t, g, func(ter *sheets.Terrain) bool { return ter.Passable && ter.Wet() && ter.EnterTicks > 1 })
	high := groundSite(t, g, wall)
	wet := groundSite(t, g, bog, high)
	pinGround(t, g, high, wall)
	pinGround(t, g, wet, bog)
	for _, h := range []hex.Hex{high, wet} {
		if err := twin.Reach(h); err != nil {
			t.Fatal(err)
		}
	}

	if _, err := g.OpenHunt(quickHunt, high, g.Tick(), WhyOperator); !refusedAs(err, BadArgs) {
		t.Fatalf("a hunt opened on %s ground: %v", wall, err)
	}
	if _, err := twin.OpenHunt(quickHunt, high, twin.Tick(), WhyOperator); err != nil {
		t.Fatalf("the scaffold's tile refused a hunt: %v", err)
	}

	c := mustCreate(t, g, "walker", "knife")
	tc := mustCreate(t, twin, "walker", "knife")
	from, ok := hex.Hex{}, false
	for _, n := range high.Neighbours() {
		if g.r.Gen.Passable(g.World.Baseline(n).Terrain) && n != wet {
			from, ok = n, true
			break
		}
	}
	if !ok {
		t.Fatalf("nothing passable beside %s", high.Ref())
	}
	if _, _, ok := g.EnterCost(c, from, high, g.Tick()); ok {
		t.Fatalf("a step onto %s ground was allowed", wall)
	}
	if _, _, ok := twin.EnterCost(tc, from, high, twin.Tick()); !ok {
		t.Fatal("a step onto the scaffold's tile was refused")
	}

	want := slices.Sorted(slices.Values(g.r.Gen.ArchetypesOf(bog)))
	if got := slices.Sorted(slices.Values(g.livesOn(wet))); !slices.Equal(got, want) {
		t.Fatalf("%s ground holds %v, want %v", bog, got, want)
	}

	pinned, pure := g.ForageYield(wet), twin.ForageYield(wet)
	if pinned != pure+1 {
		t.Fatalf("a forage on %s ground yields %d, want one over the scaffold's %d", bog, pinned, pure)
	}
	for name, run := range map[string]struct {
		g    *Game
		c    *Char
		each int64
	}{"pinned": {g, c, pinned}, "twin": {twin, tc, pure}} {
		for i, d := range forageDeltas(t, run.g, run.c, wet) {
			if d != run.each {
				t.Fatalf("%s: forage tick %d brought %d, want %d", name, i, d, run.each)
			}
		}
	}
}

// A ground patch guards the pattern boards the world cannot see: it is
// refused over a scaffold board's clue not yet stored, and while it waits
// to land no placed board or vault may stand on its ring.
func TestGroundPinGuardsBoards(t *testing.T) {
	g := guardGame(t)
	wall := groundTerrain(t, g, func(ter *sheets.Terrain) bool { return !ter.Passable })
	var clue hex.Hex
	found := false
	for r := int64(0); r <= 60 && !found; r += 4 {
		for _, h := range hex.Ring(g.SettlementHex(0), r) {
			for _, c := range g.scaffoldClues(g.r.Gen.ChunkOf(h)) {
				if bs, _ := g.cluesAt(c); len(bs) > 0 && !g.stored(bs[0]) {
					clue, found = c, true
					break
				}
			}
			if found {
				break
			}
		}
	}
	if !found {
		t.Fatal("no scaffold clue near the first settlement")
	}
	cmd := Command{Key: "ground-clue", Kind: PinReserve, Pin: &PinCmd{At: clue, Reach: 1, Fix: tile.Fix{Ground: &tile.GroundFix{Terrain: wall}}}}
	before, err := g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := g.Act(cmd); !refusedAs(err, world.CodePinGround) {
		t.Fatalf("ground over the scaffold clue on %s: %v", clue.Ref(), err)
	}
	if after, err := g.Digest(); err != nil || after != before {
		t.Fatalf("a refused pin changed the game: %v", err)
	}

	bog := groundTerrain(t, g, func(ter *sheets.Terrain) bool { return ter.Passable && ter.Wet() })
	fix := tile.Fix{Ground: &tile.GroundFix{Terrain: bog, Ring: true}}
	by := world.PinBy{Role: world.PinDesigner}
	for r := int64(3); r <= 30; r++ {
		for _, h := range hex.Ring(g.SettlementHex(0), r) {
			ring := slices.IndexFunc(hex.Ring(h, 1), g.chainFree)
			if ring < 0 || g.World.Content(h) != nil || g.World.CheckPin(h, 1, fix, by, false) != nil {
				continue
			}
			side := hex.Ring(h, 1)[ring]
			if _, err := g.Act(Command{Key: "ground-ring", Kind: PinReserve, Pin: &PinCmd{At: h, Reach: 1, Fix: fix}}); err != nil {
				continue
			}
			if !g.World.GroundPending(side) || g.chainFree(side) {
				t.Fatalf("%s waits under ground of %s, yet a placed board may stand there", side.Ref(), bog)
			}
			return
		}
	}
	t.Fatal("no tile takes ground with its ring")
}
