package game

import (
	"errors"
	"fmt"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
)

// The quick hunt: a tier-1 creature a handful of knives bring down.
const quickHunt = "dust-runner-migration"

// huntTile is passable land next to the first settlement.
func huntTile(t *testing.T, g *Game) hex.Hex {
	t.Helper()
	for _, n := range g.SettlementHex(0).Neighbours() {
		if g.r.Gen.Passable(g.r.Gen.Baseline(n).Terrain) && g.World.RegionAt(n) >= 0 {
			return n
		}
	}
	t.Fatal("no passable land beside the first settlement")
	return hex.Hex{}
}

// openHunt opens a hunt of a row on a tile as the operator does.
func openHuntAt(t *testing.T, g *Game, row string, h hex.Hex) *Hunt {
	t.Helper()
	res, err := g.Act(Command{Key: "start-" + row, Kind: HuntStart, Asset: row, To: &h})
	if err != nil {
		t.Fatal(err)
	}
	if res.Char != nil || !slices.ContainsFunc(res.Facts, func(f fact.Fact) bool { return f.Kind == "hunt.opened" }) {
		t.Fatalf("hunt-start: %+v", res)
	}
	return g.Hunts[len(g.Hunts)-1]
}

// hunters are n characters with knives standing on h.
func hunters(t *testing.T, g *Game, n int, h hex.Hex) []*Char {
	t.Helper()
	var out []*Char
	for i := range n {
		c := mustCreate(t, g, fmt.Sprintf("hunter-%d-%d", len(g.Chars), i), "knife")
		c.C.At = h
		out = append(out, c)
	}
	return out
}

func press(g *Game, c *Char, x *Hunt, key string) (Result, error) {
	return g.Act(Command{Key: key, Char: c.C.ID, Kind: HuntPress, Target: x.H.ID, Option: "strike"})
}

func refusedAs(err error, code string) bool {
	var r *Refused
	return errors.As(err, &r) && r.Code == code
}

func digestOf(t *testing.T, g *Game) canon.Sum {
	t.Helper()
	d, err := g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func factsOf(g *Game, kind string) []fact.Fact {
	var out []fact.Fact
	for _, f := range g.Log.Since(0) {
		if f.Kind == kind {
			out = append(out, f)
		}
	}
	return out
}

func goodsOf(c *Char, material string) int64 {
	for _, s := range c.C.Goods {
		if s.Material == material {
			return s.Qty
		}
	}
	return 0
}

// TestHuntTenPressersSplitTheRoll: ten characters bring a hunt down, the
// spoils roll once inside the row's bounds, and the parts paid sum to the
// roll exactly, line by line, through the hunt's pool (GDD 7.6).
func TestHuntTenPressersSplitTheRoll(t *testing.T) {
	g := guardGame(t)
	h := huntTile(t, g)
	x := openHuntAt(t, g, quickHunt, h)
	cs := hunters(t, g, 10, h)
	for i, c := range cs[5:] {
		c.C.At = h.Neighbours()[i]
	}
	before := map[string]map[string]int64{}
	row, _ := g.r.Fight.Hunt(quickHunt)
	for _, c := range cs {
		before[c.C.ID] = map[string]int64{}
		for _, s := range row.Spoils {
			before[c.C.ID][s.Material] = goodsOf(c, s.Material)
		}
	}
	for n := 0; !x.H.Over; n++ {
		for _, c := range cs {
			if x.H.Over {
				break
			}
			for _, in := range c.C.Pack {
				in.Repair()
			}
			if _, err := press(g, c, x, fmt.Sprintf("p-%d-%s", n, c.C.ID)); err != nil && !refusedAs(err, DownCode) {
				t.Fatal(err)
			}
		}
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	if !x.H.Slain || len(x.H.Removed) < 2 {
		t.Fatalf("the hunt was not brought down by several: slain %v, removed %v", x.H.Slain, x.H.Removed)
	}
	if x.H.Removed.Sum() != x.H.Max {
		t.Fatalf("removed %d of %d", x.H.Removed.Sum(), x.H.Max)
	}
	if len(x.Rolled) != len(row.Spoils) {
		t.Fatalf("rolled %v for %v", x.Rolled, row.Spoils)
	}
	parts := g.HuntParts(x)
	for i, s := range x.Rolled {
		top := row.Spoils[i].Quantity
		if s.Material != row.Spoils[i].Material || s.Qty < fixed.Ratio(top, 2).Int() || s.Qty > top {
			t.Fatalf("roll %v outside the row's %v", s, row.Spoils[i])
		}
		var paid, held int64
		for _, c := range cs {
			for _, p := range parts[c.C.ID] {
				if p.Material == s.Material {
					paid += p.Qty
				}
			}
			held += goodsOf(c, s.Material) - before[c.C.ID][s.Material]
		}
		if paid != s.Qty || held != s.Qty {
			t.Fatalf("%s: rolled %d, parts %d, paid into packs %d", s.Material, s.Qty, paid, held)
		}
		if n := g.Ledger.Of(ledger.HuntPool(x.H.ID), ledger.Material(s.Material)); n != 0 {
			t.Fatalf("%d %s left in the hunt's pool", n, s.Material)
		}
		if n := g.Ledger.Of(ledger.FromHunt, ledger.Material(s.Material)); n != -s.Qty {
			t.Fatalf("the hunt source minted %d %s for a roll of %d", -n, s.Material, s.Qty)
		}
	}
	slain := factsOf(g, "hunt.slain")
	if len(slain) != 1 {
		t.Fatalf("%d hunt.slain facts", len(slain))
	}
	for _, r := range x.H.Removed {
		if !slices.Contains(slain[0].Subjects, char.Ref(r.Key)) {
			t.Fatalf("hunt.slain does not name presser %s: %v", r.Key, slain[0].Subjects)
		}
	}
	for _, s := range x.Rolled {
		if d, ok := slain[0].Get("rolled:" + s.Material); !ok || d.N != s.Qty {
			t.Fatalf("hunt.slain carries %v for %v", d, s)
		}
	}
	audit(t, g)
}

// TestHuntLeftUnfinished: a hunt its window runs out on pays nothing,
// closes on the tick with hunt.left and the health left, and is gone
// after the next day turn.
func TestHuntLeftUnfinished(t *testing.T) {
	g := guardGame(t)
	h := huntTile(t, g)
	x := openHuntAt(t, g, "walking-factory", h)
	c := hunters(t, g, 1, h)[0]
	if _, err := press(g, c, x, "once"); err != nil {
		t.Fatal(err)
	}
	goods := slices.Clone(c.C.Goods)
	for !x.H.Over {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	if !x.H.Over || x.H.Slain || x.H.Closed != x.H.Ends {
		t.Fatalf("over %v slain %v closed %d ends %d", x.H.Over, x.H.Slain, x.H.Closed, x.H.Ends)
	}
	left := factsOf(g, "hunt.left")
	if len(left) != 1 || left[0].Tick != x.H.Ends {
		t.Fatalf("hunt.left: %+v", left)
	}
	if d, _ := left[0].Get("health"); d.N != x.H.Health || x.H.Health == 0 {
		t.Fatalf("hunt.left health %d, the hunt %d", d.N, x.H.Health)
	}
	if !slices.Equal(goods, c.C.Goods) || len(x.Rolled) > 0 || len(factsOf(g, "hunt.slain")) > 0 {
		t.Fatalf("an unfinished hunt paid: %v then %v, rolled %v", goods, c.C.Goods, x.Rolled)
	}
	for _, b := range g.Ledger.Balances() {
		if b.Account == ledger.FromHunt {
			t.Fatalf("the hunt source moved: %+v", b)
		}
	}
	if _, err := press(g, c, x, "late"); !refusedAs(err, NoHunt) {
		t.Fatalf("a closed hunt took a press: %v", err)
	}
	for g.Tick()%sheets.TicksPerDay != 0 || g.Tick() <= x.H.Closed {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	if g.HuntByID(x.H.ID) != nil {
		t.Fatal("a closed hunt outlived the day turn after it")
	}
	audit(t, g)
}

// TestHuntOnePressATickInReach: a second press in a tick is refused and
// changes nothing; so is one from two tiles off or from inside a dungeon.
func TestHuntOnePressATickInReach(t *testing.T) {
	g := guardGame(t)
	h := huntTile(t, g)
	x := openHuntAt(t, g, "walking-factory", h)
	cs := hunters(t, g, 3, h)
	if _, err := press(g, cs[0], x, "first"); err != nil {
		t.Fatal(err)
	}
	if at, ok := x.PressedAt(cs[0].C.ID); !ok || at != g.Tick() {
		t.Fatalf("pressed at %d %v", at, ok)
	}
	refused := func(c *Char, key, code string) {
		t.Helper()
		was := digestOf(t, g)
		if _, err := press(g, c, x, key); !refusedAs(err, code) {
			t.Fatalf("%s: %v, want %s", key, err, code)
		}
		if digestOf(t, g) != was {
			t.Fatalf("%s: a refused press changed the game", key)
		}
	}
	refused(cs[0], "again", Pressed)
	far := h
	for range 2 {
		far = far.Neighbours()[0]
	}
	cs[1].C.At = far
	refused(cs[1], "far", OutOfReach)
	cs[2].C.At, cs[2].C.Floor = h, 1
	refused(cs[2], "below", OutOfReach)
	cs[1].C.At, cs[2].C.Floor = h.Neighbours()[3], 0
	if _, err := press(g, cs[1], x, "near"); err != nil {
		t.Fatal(err)
	}
	if _, err := g.Advance(); err != nil {
		t.Fatal(err)
	}
	if !x.H.Over {
		if _, err := press(g, cs[0], x, "next"); err != nil && !refusedAs(err, DownCode) {
			t.Fatal(err)
		}
	}
}

// TestHuntSpawnRule: over 90 days of day turns the spawn rule opens hunts
// only where the row's creature stands at its line, never two of a row
// in one region, and keyed so a second world opens the same.
func TestHuntSpawnRule(t *testing.T) {
	run := func() ([]string, *Game) {
		g := guardGame(t)
		var opened []string
		for day := int64(1); day <= 90; day++ {
			g.World.Tick = day * sheets.TicksPerDay
			if err := g.huntsTurn(g.Tick()); err != nil {
				t.Fatal(err)
			}
			if err := g.huntsDay(day); err != nil {
				t.Fatal(err)
			}
			open := map[string]bool{}
			for _, x := range g.LiveHunts() {
				k := x.H.Row + "@" + x.Region
				if open[k] {
					t.Fatalf("day %d: two hunts of %s", day, k)
				}
				open[k] = true
				if x.H.Ends <= g.Tick() {
					continue
				}
				if x.Why == WhySpawn && x.H.Closed == 0 && !slices.Contains(opened, x.H.ID) {
					opened = append(opened, x.H.ID)
					row, _ := g.r.Fight.Hunt(x.H.Row)
					r, _ := regionIndex(g, x.Region)
					if _, pop, capacity := g.herd(r, row.Creature); !fixed.AtPercent(pop, capacity, row.SpawnLine) || g.World.Capacity(x.Hex, row.Creature) == 0 {
						t.Fatalf("%s opened on %v where %s stands at %d of %d", x.H.ID, x.Hex, row.Creature, pop, capacity)
					}
				}
			}
		}
		return opened, g
	}
	a, g := run()
	b, _ := run()
	if len(a) == 0 || !slices.Equal(a, b) {
		t.Fatalf("spawned %v then %v", a, b)
	}
	if len(factsOf(g, "hunt.left")) == 0 {
		t.Fatal("no spawned hunt ran out")
	}
}

func regionIndex(g *Game, ref string) (int, bool) {
	for r := range g.World.Regions {
		if fmt.Sprintf("r-%d", r) == ref {
			return r, true
		}
	}
	return 0, false
}

// TestHuntStartRefusals: an unknown row, a guardian's, and a second open
// hunt of a row in a region are refused and change nothing.
func TestHuntStartRefusals(t *testing.T) {
	g := guardGame(t)
	h := huntTile(t, g)
	openHuntAt(t, g, quickHunt, h)
	for _, tc := range []struct {
		row, code string
		to        *hex.Hex
	}{{"no-such", NoSuchRow, &h}, {"bunker-guardian", NoSuchRow, &h}, {quickHunt, OpenHunt, &h}, {quickHunt, BadArgs, nil}} {
		was := digestOf(t, g)
		if _, err := g.Act(Command{Key: "again", Kind: HuntStart, Asset: tc.row, To: tc.to}); !refusedAs(err, tc.code) {
			t.Fatalf("%s: %v, want %s", tc.row, err, tc.code)
		}
		if digestOf(t, g) != was {
			t.Fatalf("%s: a refused hunt-start changed the game", tc.row)
		}
	}
}

// guardianDungeon is the first dungeon with a guardian in the awake
// regions.
func guardianDungeon(t *testing.T, g *Game) hex.Hex {
	t.Helper()
	for _, r := range g.World.Regions {
		for _, h := range g.r.Gen.RegionTiles(r.Lattice) {
			if _, _, ok := g.guardianRow(h); ok {
				return h
			}
		}
	}
	t.Fatal("no dungeon with a guardian in the awake regions")
	return hex.Hex{}
}

// atGuardian is an encounter on the dungeon's bottom floor, already on its
// last beat, the guardian's, for the characters given.
func atGuardian(t *testing.T, g *Game, h hex.Hex, id string, cs ...*Char) *fight.Encounter {
	t.Helper()
	p, _, _ := g.guardianRow(h)
	site := fight.Site{ID: id, Place: machinePlace(h, p.Floors), Floor: p.Floors, Party: int64(len(cs)), Guardian: g.guardianPool(h, g.Tick()),
		Tags: g.World.Place(h).Tags()}
	e := g.r.Fight.Assemble(site, g.r.Fight.Spawn(g.reachFloor(h, p.Floors, 0, p.SeedTier, g.reachTick()).Creature, nil, site.Tags, nil))
	if e.Beats[len(e.Beats)-1] != fight.BeatGuardian {
		t.Fatalf("the bottom floor ends on %v", e.Beats)
	}
	e.At = len(e.Beats) - 1
	for _, c := range cs {
		c.C.At, c.C.Floor = h, p.Floors
		c.Fight = &Fight{E: e}
	}
	return e
}

// pressGuardian presses the guardian's beat once for everyone up, as the
// press paths do: the pool attached first, the press recorded after.
func pressGuardian(t *testing.T, g *Game, h hex.Hex, e *fight.Encounter, sh *Shared, pick string, cs ...*Char) {
	t.Helper()
	tick := g.Tick()
	g.attachPool(h, e, tick)
	var ms []*fight.Member
	for _, c := range cs {
		if !slices.Contains(e.Down, c.C.ID) {
			for _, in := range c.C.Pack {
				in.Repair()
			}
			ms = append(ms, &fight.Member{Ch: c.C, Kit: g.r.Fight.KitOf(c.C), Pick: pick})
		}
	}
	_, facts, err := g.r.Fight.Press(e, ms, tick)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range facts {
		if _, err := g.Log.Append(f); err != nil {
			t.Fatal(err)
		}
	}
	if err := g.guardianPressed(h, e, sh, tick); err != nil {
		t.Fatal(err)
	}
}

func guardianOf(g *Game, h hex.Hex) *tile.Guardian {
	if t := g.World.Tile(h); t != nil && t.Dungeon != nil {
		return t.Dungeon.Guardian
	}
	return nil
}

// veteran is the fight practice a party at the bottom is given, so a
// knife lands there often enough for a test to watch it.
const veteran = 20

// guardianParty is n fresh veteran hunters sharing one encounter on the
// guardian's beat.
func guardianParty(t *testing.T, g *Game, h hex.Hex, n int, id string) ([]*Char, *Shared, *fight.Encounter) {
	t.Helper()
	cs := hunters(t, g, n, h)
	sh := &Shared{ID: "sh-" + id, Hex: h}
	for _, c := range cs {
		sh.Members = append(sh.Members, c.C.ID)
		c.C.Practice = []char.Skill{{ID: "fight", Level: veteran}}
	}
	return cs, sh, atGuardian(t, g, h, id, cs...)
}

// pressOut presses a party's guardian beat until the encounter ends or
// done holds, and reports whether done came to hold.
func pressOut(t *testing.T, g *Game, h hex.Hex, e *fight.Encounter, sh *Shared, cs []*Char, done func() bool) bool {
	t.Helper()
	for i := 0; !e.Over && !done() && i < 100; i++ {
		pressGuardian(t, g, h, e, sh, "strike", cs...)
	}
	return done()
}

// tries runs a party at the guardian until one does what it is sent for:
// a party of knives falls more often than not against a bottom floor.
func tries(t *testing.T, what string, try func(n int) bool) {
	t.Helper()
	for n := range 20 {
		if try(n) {
			return
		}
	}
	t.Fatalf("no party %s", what)
}

// TestGuardianWornWholeAndBack: a party that fails leaves the pool worn
// for the next; unslain at its window's end it is whole; slain, it stays
// gone until the bottom floor refills, and the first kill makes namers
// (GDD 4.9).
func TestGuardianWornWholeAndBack(t *testing.T) {
	g := guardGame(t)
	h := guardianDungeon(t, g)
	full := *g.guardianPool(h, g.Tick())
	var gd *tile.Guardian
	tries(t, "wore the pool", func(n int) bool {
		cs, sh, e := guardianParty(t, g, h, 4, fmt.Sprintf("e-wear-%d", n))
		pressOut(t, g, h, e, sh, cs, func() bool { return false })
		gd = guardianOf(g, h)
		return e.Over && gd != nil && gd.Health < full.Max
	})
	if gd.Ends != g.Tick()+g.r.Fight.Window("bunker-guardian") {
		t.Fatalf("the window ends at %d, opened at %d", gd.Ends, g.Tick())
	}
	if len(factsOf(g, "guardian.worn")) == 0 {
		t.Fatal("no guardian.worn")
	}
	if p := g.guardianPool(h, g.Tick()); p == nil || p.Health != gd.Health {
		t.Fatalf("the next party meets %+v, the record says %d", p, gd.Health)
	}
	b := hunters(t, g, 1, h)[0]
	if e2 := atGuardian(t, g, h, "e-second", b); e2.Pool.Health != gd.Health {
		t.Fatalf("the second party's pool %d, worn to %d", e2.Pool.Health, gd.Health)
	}
	b.Fight = nil
	ends := gd.Ends
	g.World.Tick = ends - 1
	if err := g.huntsTurn(g.Tick()); err != nil || guardianOf(g, h) == nil {
		t.Fatalf("whole before its window ran out: %v", err)
	}
	g.World.Tick = ends
	if err := g.huntsTurn(g.Tick()); err != nil || guardianOf(g, h) != nil {
		t.Fatalf("not whole after its window: %v %+v", err, guardianOf(g, h))
	}
	if p := g.guardianPool(h, g.Tick()); p == nil || *p != full || len(factsOf(g, "guardian.whole")) != 1 {
		t.Fatalf("whole again as %+v, full %+v", p, full)
	}

	// Slain: worn to almost nothing, then brought down by a pair.
	g.World.DungeonAt(h).Guardian = &tile.Guardian{Health: 1, Max: full.Max, Ends: g.Tick() + 1, Marks: 3}
	row, _ := g.r.Fight.Hunt("bunker-guardian")
	var cs []*Char
	var e *fight.Encounter
	before := map[string]int64{}
	tries(t, "slew it", func(n int) bool {
		cs, _, e = guardianParty(t, g, h, 2, fmt.Sprintf("e-kill-%d", n))
		sh := &Shared{ID: "sh-kill", Hex: h, Members: []string{cs[0].C.ID, cs[1].C.ID}}
		for _, s := range row.Spoils {
			before[s.Material] = goodsOf(cs[0], s.Material) + goodsOf(cs[1], s.Material)
		}
		pressOut(t, g, h, e, sh, cs, func() bool { return false })
		return e.Result == fight.Won
	})
	gd = guardianOf(g, h)
	if e.Result != fight.Won || gd == nil || gd.Slain != g.Tick() || g.guardianPool(h, g.Tick()) != nil {
		t.Fatalf("result %s, record %+v", e.Result, gd)
	}
	slain := factsOf(g, "guardian.slain")
	if len(slain) != 1 || !slices.Contains(slain[0].Subjects, char.Ref(cs[0].C.ID)) || !slices.Contains(slain[0].Subjects, char.Ref(cs[1].C.ID)) {
		t.Fatalf("guardian.slain: %+v", slain)
	}
	if first := factsOf(g, "dungeon.slain-first"); len(first) != 1 || g.World.Tile(h).Dungeon.SlainAt != g.Tick() {
		t.Fatalf("dungeon.slain-first: %+v", first)
	}
	for _, s := range row.Spoils {
		got := goodsOf(cs[0], s.Material) + goodsOf(cs[1], s.Material) - before[s.Material]
		d, _ := slain[0].Get("rolled:" + s.Material)
		if got != d.N || got < fixed.Ratio(s.Quantity, 2).Int() || got > s.Quantity {
			t.Fatalf("%s: paid %d, rolled %d, row %d", s.Material, got, d.N, s.Quantity)
		}
		if n := g.Ledger.Of(ledger.HuntPool(GuardianID(h)), ledger.Material(s.Material)); n != 0 {
			t.Fatalf("%d %s left in the guardian's pool", n, s.Material)
		}
	}
	audit(t, g)

	// Back once the bottom floor, cleared at the kill, refills.
	p, _, _ := g.guardianRow(h)
	g.World.DungeonAt(h).Clear(p.Floors, 0, g.Tick())
	refill := g.r.wp("dungeon-refill-days") * sheets.TicksPerDay
	slainAt := gd.Slain
	g.World.Tick = slainAt + refill - 1
	if err := g.huntsTurn(g.Tick()); err != nil || guardianOf(g, h) == nil {
		t.Fatalf("back before the refill: %v", err)
	}
	g.World.Tick = slainAt + refill
	if err := g.huntsTurn(g.Tick()); err != nil || guardianOf(g, h) != nil || g.guardianPool(h, g.Tick()) == nil {
		t.Fatalf("not back after the refill: %v %+v", err, guardianOf(g, h))
	}
	if n := len(factsOf(g, "guardian.whole")); n != 2 {
		t.Fatalf("%d guardian.whole facts", n)
	}
}

// TestGuardianMarkStagesAMachine: the pool falling past a mark stages the
// row's machine on the guardian beat for the party, once a mark, and a
// solve's bonus makes every later blow of the encounter remove half as
// much again (GDD 7.11).
func TestGuardianMarkStagesAMachine(t *testing.T) {
	g := guardGame(t)
	h := guardianDungeon(t, g)
	full := *g.guardianPool(h, g.Tick())
	row, _ := g.r.Fight.Hunt("bunker-guardian")
	above := row.Marks[0]*full.Max/100 + 1
	bonus := g.r.Fight.Param("guardian-solve-bonus")
	tries(t, "passed the first mark and landed two blows after the solve", func(n int) bool {
		g.World.DungeonAt(h).Guardian = &tile.Guardian{Health: above, Max: full.Max, Ends: g.Tick() + g.r.Fight.Window(row.ID)}
		cs, sh, e := guardianParty(t, g, h, 4, fmt.Sprintf("e-marks-%d", n))
		if !pressOut(t, g, h, e, sh, cs, func() bool { return sh.Machine != nil }) {
			return false
		}
		m := sh.Machine
		if e.Over || m.Source != SourceGuardian || m.Armed() || m.Spec.Family != row.Family || m.Spec.Beat != int64(e.At) ||
			m.Spec.Place != machinePlace(h, e.Floor) || m.Spec.Level <= 0 || m.Spec.Attempt != 0 || guardianOf(g, h).Marks != 1 {
			t.Fatalf("staged %+v, record %+v, over %v", m, guardianOf(g, h), e.Over)
		}
		staged := m.Spec
		pressGuardian(t, g, h, e, sh, "strike", cs...)
		if guardianOf(g, h).Marks == 1 && (sh.Machine != m || sh.Machine.Spec != staged) {
			t.Fatalf("a press restaged the machine: %+v", sh.Machine)
		}

		// The machine path's solve: the bonus for the rest of the encounter.
		sh.Machine = nil
		e.Boost(bonus, g.r.Fight.Param("guardian-solve-beats"))
		wins := 0
		for i := 0; wins < 2 && !e.Over && i < 40; i++ {
			up := slices.IndexFunc(cs, func(c *Char) bool { return !slices.Contains(e.Down, c.C.ID) })
			if up < 0 {
				break
			}
			was := guardianOf(g, h).Health
			_, _, opts := g.r.Fight.Choices(e, cs[up].C, g.r.Fight.KitOf(cs[up].C), g.Tick())
			o, _ := fight.OptionByID(opts, "strike")
			pressGuardian(t, g, h, e, sh, "strike", cs[up])
			if took := was - guardianOf(g, h).Health; took > 0 {
				if want := fixed.PercentPlus(o.Score, bonus); took != min(want, was) {
					t.Fatalf("a blow took %d after the solve, want %d", took, want)
				}
				wins++
			}
		}
		return wins >= 2
	})
}

// TestThinHerdsDraftAHunt: with a hunt open near a settlement, the board
// suggests finishing it once the herds near the settlement thin, and the
// posted goal is met by the kill (GDD 8.6, 11.3).
func TestThinHerdsDraftAHunt(t *testing.T) {
	g := guardGame(t)
	h := huntTile(t, g)
	x := openHuntAt(t, g, quickHunt, h)
	if _, ok := g.huntDraft(0); ok {
		t.Fatal("a hunt drafted while the herds stand full")
	}
	r := g.RegionsNear(g.SettlementHex(0))[0]
	sp := g.r.Gen.Region(g.World.Regions[r].Lattice).Creature
	for _, at := range g.r.Gen.RegionTiles(g.World.Regions[r].Lattice) {
		if g.World.Capacity(at, sp) > 0 {
			g.World.DungeonAt(at)
			tl := g.World.Tile(at)
			tl.Dungeon, tl.Population = nil, map[string]int64{sp: 0}
		}
	}
	d, ok := g.huntDraft(0)
	if !ok || d.Spec.Cond.Verb != goal.Defeat || d.Spec.Cond.Kind != x.H.Creature.Archetype || d.Spec.Cond.At != goal.RegionRef(x.Region) {
		t.Fatalf("draft %+v %v", d, ok)
	}
	poster := mustCreate(t, g, "poster", "knife")
	if _, err := g.Act(Command{Key: "coin", Char: poster.C.ID, Kind: Correct, Asset: ledger.Coin, Units: 1000, Note: "a test purse"}); err != nil {
		t.Fatal(err)
	}
	if _, err := g.Act(Command{Key: "post", Char: poster.C.ID, Kind: PostGoal, Goal: &d.Spec}); err != nil {
		t.Fatal(err)
	}
	cs := hunters(t, g, 10, h)
	for n := 0; !x.H.Over; n++ {
		for _, c := range cs {
			for _, in := range c.C.Pack {
				in.Repair()
			}
			if _, err := press(g, c, x, fmt.Sprintf("d-%d-%s", n, c.C.ID)); err != nil && !refusedAs(err, DownCode) && !refusedAs(err, NoHunt) {
				t.Fatal(err)
			}
		}
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	if !x.H.Slain {
		t.Fatal("the hunt got away")
	}
	met := 0
	for _, y := range g.Goals {
		if y.Title == d.Spec.Title {
			if y.State != goal.Done {
				t.Fatalf("the hunt's kill left %s %s: %+v", y.ID, y.State, y.Progress)
			}
			met++
		}
	}
	if met != 1 {
		t.Fatalf("%d drafted goals met", met)
	}
}
