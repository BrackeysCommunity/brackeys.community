package game

import (
	"errors"
	"strings"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// TestPouches has Uncommon spoils come as a locked pouch only to a
// character who has worked a machine: the pouch holds exactly what the
// tile's pool lost, opening it pays exactly that, a failed lock keeps it
// shut, and nothing is ever minted (GDD 7.11, 8.6).
func TestPouches(t *testing.T) {
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	for i := range b.Triggers {
		if id := b.Triggers[i].ID; id == TrigSpoils || id == TrigPouch {
			b.Triggers[i].Chance = fixed.FromInt(1)
		}
	}
	for i := range b.FindRarities {
		b.FindRarities[i].Chance = 0
		if b.FindRarities[i].ID == rarityUncommon {
			b.FindRarities[i].Chance = fixed.FromInt(1)
		}
	}
	r, err := NewRules(b, keys.Throwaway("pouches"))
	if err != nil {
		t.Fatal(err)
	}
	g, err := New(r)
	if err != nil {
		t.Fatal(err)
	}
	n := 0
	act := func(c *Char, cmd Command) (Result, *Refused) {
		t.Helper()
		n++
		cmd.Key, cmd.Char = "k"+string(rune('a'+n%26))+string(rune('a'+n/26)), c.C.ID
		res, err := g.Act(cmd)
		var ref *Refused
		if err != nil && !errors.As(err, &ref) {
			t.Fatal(err)
		}
		return res, ref
	}
	mk := func() *Char {
		res, _ := act(&Char{C: &char.Character{}}, Command{Kind: Create, Option: "knife"})
		return res.Char
	}
	owner, finder, novice := mk(), mk(), mk()
	finder.Worked = 1
	home := owner.C.At
	field := home.Neighbour(0)
	for d := 0; !g.r.Gen.Passable(g.r.Gen.Baseline(field).Terrain); d++ {
		field = home.Neighbour(d)
	}
	// An Uncommon find is a material one tier above the tile's.
	rare := ""
	for _, m := range b.Materials {
		if tier, _ := g.r.Fight.D.Material(m.ID); tier == g.tierAt(field)+1 {
			rare = m.ID
			break
		}
	}
	if rare == "" {
		t.Fatal("no material a tier above the field's")
	}
	most := g.trigger(TrigSpoils).Magnitude
	fill := func(key string, units int64) {
		owner.C.At = field
		if err := g.drop(owner, key, []item.Spoil{{Material: rare, Qty: units}}, g.Tick()); err != nil {
			t.Fatal(err)
		}
		g.Pending = append(g.Pending, world.Action{Kind: world.ActFall, Hex: field, By: char.Ref(owner.C.ID)})
		owner.C.At = home
		owner.Dropped = nil
	}
	walk := func(c *Char, to hex.Hex) []fact.Fact {
		t.Helper()
		first := fact.ID(g.Log.Len())
		if _, ref := act(c, Command{Kind: Step, Dir: c.C.At.DirectionTo(to)}); ref != nil {
			t.Fatal(ref)
		}
		for c.Long != nil {
			if _, err := g.Advance(); err != nil {
				t.Fatal(err)
			}
		}
		return g.Log.Since(first)
	}
	has := func(facts []fact.Fact, kind string) bool {
		for _, f := range facts {
			if f.Kind == kind {
				return true
			}
		}
		return false
	}
	held := func(acc string) int64 { return g.Ledger.Of(acc, ledger.Material(rare)) }
	fill("lost-1", 2*most)
	if _, err := g.Advance(); err != nil {
		t.Fatal(err)
	}

	g.Flush()
	facts := walk(finder, field)
	_, found := g.Flush()
	for _, x := range found {
		for _, l := range x.Legs {
			tile, pouch := strings.HasPrefix(l.Account, ledger.Pool+"tile:"), strings.HasPrefix(l.Account, ledger.Pool+"pouch:")
			if x.Kind != "find" || (l.Units < 0 && !tile) || (l.Units > 0 && !pouch) {
				t.Fatalf("a pouch is found by moving goods from a tile's pool to its own: %+v", x)
			}
		}
	}
	if len(found) != 1 || len(finder.Pouches) != 1 || !has(facts, "pouch.found") || has(facts, "find.made") {
		t.Fatalf("the finder's Uncommon find: %d pouches, facts %+v", len(finder.Pouches), facts)
	}
	p := finder.Pouches[0]
	if p.ID != "p-"+finder.C.ID+"-1" || item.Total(p.Goods) != most || held(ledger.PouchPool(p.ID)) != most || held(poolOf(field)) != most || held(ledger.Char(finder.C.ID)) != 0 {
		t.Fatalf("pouch %+v: its pool holds %d, the tile's %d, the finder %d", p, held(ledger.PouchPool(p.ID)), held(poolOf(field)), held(ledger.Char(finder.C.ID)))
	}
	if (p.Family != puzzle.Pins && p.Family != puzzle.Maze) || p.Level < 1 || p.Tier != g.tierAt(field) {
		t.Fatalf("a pouch is locked by pins or a maze: %+v", p)
	}
	facts = walk(novice, field)
	if len(novice.Pouches) != 0 || !has(facts, "find.made") || held(ledger.Char(novice.C.ID)) != most {
		t.Fatalf("someone who never worked a machine found a pouch, or nothing: %d pouches, %d goods", len(novice.Pouches), held(ledger.Char(novice.C.ID)))
	}

	// A failed lock keeps the goods in: an alarm, or shut for the
	// lockdown's days.
	rig, ok := g.Rig(finder, Viewer{Pouch: p.ID})
	if !ok || rig.Source != SourcePouch || rig.Spec.Family != p.Family || rig.Countdown == 0 {
		t.Fatalf("the pouch's rig: %+v", rig.Spec)
	}
	armPouch := Command{Kind: MachineArm, Machine: &MachineCmd{Source: SourcePouch, Pouch: p.ID}}
	if _, ref := act(finder, armPouch); ref != nil {
		t.Fatal(ref)
	}
	pending := len(g.Pending)
	res, ref := act(finder, Command{Kind: MachineSolve, Machine: &MachineCmd{Log: &puzzle.Log{}}})
	if ref != nil || res.Machine.Solved || !has(res.Facts, "puzzle.haywire") || finder.Pouches[0].Tries != 1 || held(ledger.PouchPool(p.ID)) != most {
		t.Fatalf("a failed pouch lock: %+v %v, pouch %+v", res.Machine, ref, finder.Pouches[0])
	}
	if sk := finder.C.PracticeOf(p.Family); sk.Uses != g.puzzles().Param("haywire-uses") {
		t.Fatalf("%d uses from a failed pouch lock", sk.Uses)
	}
	switch g.puzzles().HaywireRow(res.Machine.Haywire).Effect {
	case effectAlarm:
		if len(g.Pending) != pending+1 || finder.Pouches[0].Shut != 0 {
			t.Fatalf("an alarm: pending %+v, shut %d", g.Pending, finder.Pouches[0].Shut)
		}
	default:
		if finder.Pouches[0].Shut != g.Tick()+g.lockdownDays()*sheets.TicksPerDay {
			t.Fatalf("shut until %d at tick %d", finder.Pouches[0].Shut, g.Tick())
		}
		before, _ := g.Digest()
		if _, ref := act(finder, armPouch); ref == nil || ref.Code != LockedDown {
			t.Fatalf("arming a shut pouch: %v", ref)
		}
		if after, _ := g.Digest(); after != before {
			t.Fatal("a refused arming changed the game")
		}
		finder.Pouches[0].Shut = 0
	}

	// The second try is a new machine; solving it pays what the pouch
	// holds and nothing more.
	again, _ := g.Rig(finder, Viewer{Pouch: p.ID})
	if again.Spec.Attempt != 1 {
		t.Fatalf("the second try is attempt %d", again.Spec.Attempt)
	}
	if _, ref := act(finder, armPouch); ref != nil {
		t.Fatal(ref)
	}
	log := g.puzzles().Solve(again.Layout)
	g.Flush()
	res, ref = act(finder, Command{Kind: MachineSolve, Machine: &MachineCmd{Log: &log}})
	if ref != nil || !res.Machine.Solved || !has(res.Facts, "pouch.opened") || has(res.Facts, "puzzle.haywire") {
		t.Fatalf("opening the pouch: %+v %v, facts %+v", res.Machine, ref, res.Facts)
	}
	if len(finder.Pouches) != 0 || held(ledger.PouchPool(p.ID)) != 0 || held(ledger.Char(finder.C.ID)) != most {
		t.Fatalf("an opened pouch: %d left in it, the finder holds %d of %d", held(ledger.PouchPool(p.ID)), held(ledger.Char(finder.C.ID)), most)
	}
	_, txns := g.Flush()
	if len(txns) != 1 || txns[0].Kind != "pouch" {
		t.Fatalf("opening a pouch posted %+v", txns)
	}
	live := g.puzzles().Param("live-solve-uses")
	if finder.C.PracticeOf(practiceLockpick).Uses != live || finder.C.PracticeOf(p.Family).Uses != live+g.puzzles().Param("haywire-uses") {
		t.Fatalf("practice after the pouch: %+v", finder.C.Practice)
	}

	// With as many pouches as it may carry, a find comes loose again.
	walk(finder, home)
	carry := sheets.IntParam(b.TileParams, "pouch-carry")
	for i := range carry {
		fill("lost-"+string(rune('b'+i)), most)
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
		walk(finder, field)
		walk(finder, home)
	}
	if int64(len(finder.Pouches)) != carry {
		t.Fatalf("%d pouches carried of %d", len(finder.Pouches), carry)
	}
	fill("lost-z", most)
	if _, err := g.Advance(); err != nil {
		t.Fatal(err)
	}
	loose := held(ledger.Char(finder.C.ID))
	if facts := walk(finder, field); !has(facts, "find.made") || int64(len(finder.Pouches)) != carry || held(ledger.Char(finder.C.ID)) != loose+most {
		t.Fatalf("a find with %d pouches carried: facts %+v", carry, facts)
	}
	// In an encounter no pouch is armed.
	finder.Fight = &Fight{}
	if _, ref := act(finder, Command{Kind: MachineArm, Machine: &MachineCmd{Source: SourcePouch, Pouch: finder.Pouches[0].ID}}); ref == nil || ref.Code != Busy {
		t.Fatalf("arming a pouch in an encounter: %v", ref)
	}
	finder.Fight = nil

	// Spoils are conserved: every find left a tile's pool, and the pools
	// and pouches hold what the finders do not.
	var pooled int64
	for _, bal := range g.Ledger.Balances {
		if strings.HasPrefix(bal.Account, ledger.Pool) && bal.Asset == ledger.Material(rare) {
			pooled += bal.Units
		}
	}
	dropped := 2*most + (carry+1)*most
	if got := pooled + held(ledger.Char(finder.C.ID)) + held(ledger.Char(novice.C.ID)); got != dropped {
		t.Fatalf("%d goods dropped; pools, pouches and finders hold %d", dropped, got)
	}
	if problems := ledger.Audit(g.Ledger.Balances, g.Holdings()); len(problems) > 0 {
		t.Fatal(problems)
	}
}
