package game

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

func TestNamingByTheFirstSlayers(t *testing.T) {
	g := guardGame(t)
	h, _ := dungeonFor(t, g, "", 3)
	cs := formParty(t, g, 2, h)
	other := mustCreate(t, g, "outsider", "knife")
	if err := g.firstSlain(h, []string{cs[0].C.ID, cs[1].C.ID}, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if len(factsOf(g, "dungeon.slain-first")) != 1 {
		t.Fatal("no dungeon.slain-first")
	}
	if err := g.firstSlain(h, []string{other.C.ID}, g.Tick()); err != nil || g.recordOf(h).Namers[0] != cs[0].C.ID {
		t.Fatal("a second slaying takes the naming")
	}
	name := func(c *Char, note string) error {
		_, err := g.Act(Command{Key: "name-" + c.C.ID + "-" + note, Char: c.C.ID, Kind: DungeonName, Note: note, To: &h})
		return err
	}
	before := digestOf(t, g)
	if err := name(cs[1], "Second Hold"); !refusedAs(err, NotLeader) {
		t.Fatalf("a namer who does not lead names it: %v", err)
	}
	if err := name(other, "Their Hold"); !refusedAs(err, NotLeader) {
		t.Fatalf("an outsider names it: %v", err)
	}
	if len(g.r.Book.Words) > 0 {
		if err := name(cs[0], "the "+g.r.Book.Words[0].ID+" pit"); !refusedAs(err, BadName) {
			t.Fatalf("a screened name: %v", err)
		}
	}
	if err := name(cs[0], ""); !refusedAs(err, BadName) {
		t.Fatalf("no name: %v", err)
	}
	if digestOf(t, g) != before {
		t.Fatal("a refused name changed the game")
	}
	if err := name(cs[0], "The Long Dark"); err != nil {
		t.Fatal(err)
	}
	d := g.recordOf(h)
	if g.DungeonName(h) != "The Long Dark" || len(d.NamedBy) != 2 || len(d.Namers) != 0 {
		t.Fatalf("named: %+v", d)
	}
	if err := name(cs[0], "Again"); !refusedAs(err, Named) {
		t.Fatalf("named twice: %v", err)
	}
	if _, err := g.Act(Command{Key: "hide-name", Char: cs[0].C.ID, Kind: HideName, To: &h, Note: "rude"}); err != nil {
		t.Fatal(err)
	}
	plan, _ := g.r.Gen.Dungeon(h)
	if g.DungeonName(h) != g.r.Name("map.dungeons:"+plan.Kind) {
		t.Fatal("a hidden name still shows")
	}
}

func TestNamePackNamesAnUnnamedDungeon(t *testing.T) {
	g := guardGame(t)
	h, _ := dungeonFor(t, g, "", 3)
	c := mustCreate(t, g, "slayer", "knife")
	if err := g.firstSlain(h, []string{c.C.ID}, g.Tick()); err != nil {
		t.Fatal(err)
	}
	for g.Tick() <= g.fp("name-window-days")*sheets.TicksPerDay {
		advance(t, g)
	}
	d := g.recordOf(h)
	f := factsOf(g, "dungeon.named")
	if d.Name == "" || d.NamedBy[0] != c.C.ID || len(f) != 1 {
		t.Fatalf("not named by the pack: %+v", d)
	}
	if held, _ := f[0].Get("first-held"); held.N != 1 {
		t.Fatal("the slayers are not first held")
	}
}

func TestKeyMaker(t *testing.T) {
	g := guardGame(t)
	h, plan := dungeonFor(t, g, "", 3)
	c := mustCreate(t, g, "keysmith", "knife")
	c.C.At = h
	mk := func() error {
		_, err := g.Act(Command{Key: "key-" + c.C.ID + "-" + string(rune('a'+len(c.Keys))) + string(rune('a'+int(g.Tick()%26))), Char: c.C.ID, Kind: KeyMake})
		return err
	}
	if err := mk(); !refusedAs(err, NoKeyMaker) {
		t.Fatalf("a key without Key-maker: %v", err)
	}
	with(c, "delver", "key-maker")
	if !g.keyMaker(c) {
		t.Skip("key-maker is not live")
	}
	if err := mk(); !refusedAs(err, NotHere) {
		t.Fatalf("a key for a dungeon never reached the bottom of: %v", err)
	}
	c.C.Deepest.Bump(h.Ref(), plan.Floors)
	if err := mk(); !refusedAs(err, Short) {
		t.Fatalf("a key with no materials: %v", err)
	}
	m, n, _ := g.KeyCost(h)
	if _, err := g.Act(Command{Key: "grant-key-goods", Char: c.C.ID, Kind: Correct, Asset: ledger.Material(m), Units: n, Note: "test"}); err != nil {
		t.Fatal(err)
	}
	if err := mk(); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(c.Keys, []string{h.Ref()}) || g.balance(c, ledger.Material(m)) != 0 {
		t.Fatalf("keys %v, %d %s left", c.Keys, g.balance(c, ledger.Material(m)), m)
	}
	audit(t, g)
}

func TestFloorFindsConserveThePool(t *testing.T) {
	g := guardGame(t)
	h, _ := dungeonFor(t, g, "", 3)
	lost := mustCreate(t, g, "loser", "knife")
	lost.C.At = h
	explored(t, g, lost)
	mat := someHaul(g)[0].Material
	endFight(t, g, lost, fight.Won, []item.Spoil{{Material: mat, Qty: 20}})
	act(t, g, lost, DungeonPush, WayOption(gen.WayOpen))
	lost.Fight.E.Down = append(lost.Fight.E.Down, lost.C.ID)
	lost.C.Set(char.Down, 0)
	endFight(t, g, lost, fight.Lost, nil)
	pool := ledger.FloorPool(h.Ref(), 2)
	inPool := g.Ledger.Of(pool, ledger.Material(mat))
	if inPool != 20 {
		t.Fatalf("floor 2's pool holds %d", inPool)
	}
	total := func(cs ...*Char) int64 {
		n := g.Ledger.Of(pool, ledger.Material(mat))
		for _, c := range cs {
			n += g.balance(c, ledger.Material(mat))
		}
		return n
	}
	whole := total(lost)
	var finders []*Char
	for i := range delveSearch {
		if g.Ledger.Of(pool, ledger.Material(mat)) < inPool {
			break
		}
		f := mustCreate(t, g, "finder-"+string(rune('a'+i%26))+string(rune('a'+i/26)), "knife")
		f.C.At, f.C.Floor = h, 1
		f.Delving = &Delving{Dungeon: h.Ref(), Way: noWay}
		finders = append(finders, f)
		if err := g.floorFinds(f, h, 2, "find-"+f.C.ID, nil); err != nil {
			t.Fatal(err)
		}
		advance(t, g)
	}
	if g.Ledger.Of(pool, ledger.Material(mat)) == inPool {
		t.Fatal("no find from floor 2's pool")
	}
	if total(append(finders, lost)...) != whole {
		t.Fatal("a floor find made goods")
	}
	audit(t, g)
}

func TestTriggerOldFriendsOnAFloor(t *testing.T) {
	g := guardGame(t)
	h, _ := dungeonFor(t, g, "", 3)
	cs := formParty(t, g, 2, h)
	cs[0].C.Meet(char.Met{Who: cs[1].C.ID, How: char.MetRescued}, g.r.limits)
	explored(t, g, cs[0])
	if !slices.Contains(cs[0].Fight.E.Site, g.oldFriendsTag()[0]) || !slices.ContainsFunc(factsOf(g, "trigger.fired"), func(f fact.Fact) bool {
		d, _ := f.Get("trigger")
		return d.S == TrigOldFriends
	}) {
		t.Fatal("old friends do not fire for a party of two who rescued one another")
	}
	if !slices.ContainsFunc(g.Choose(cs[0]).Fight.Options, func(o fight.Option) bool {
		return slices.ContainsFunc(o.Why.Rules.Steps, func(s tags.Step) bool { return s.Rule == "old-friends-holds" })
	}) {
		t.Fatal("old friends do not make holding better")
	}
	g2 := guardGame(t)
	three := formParty(t, g2, 3, h)
	three[0].C.Meet(char.Met{Who: three[1].C.ID, How: char.MetRescued}, g2.r.limits)
	if g2.oldFriends(three) {
		t.Fatal("old friends fire for a party of three")
	}
}

func TestGoalReachNeedsADungeon(t *testing.T) {
	c := goal.Condition{Verb: goal.Reach, Floor: 3, Count: 1}
	g := &goal.Goal{Title: "x", Mode: goal.First, Lifetime: goal.Standing, Turnover: goal.Keep, Cond: c}
	if goal.Valid(g, 0, goal.Limits{TitleLen: 10}) == nil {
		t.Fatal("a floor to reach with no dungeon is valid")
	}
	at := hex.Hex{Q: 1, R: 2}
	c.Dungeon = at.Ref()
	e := goal.Event{Verb: goal.Reach, Dungeon: at.Ref(), Floor: 2}
	if c.Matches(e) {
		t.Fatal("floor 2 meets a Reach of floor 3")
	}
	e.Floor = 3
	if !c.Matches(e) {
		t.Fatal("floor 3 does not meet a Reach of floor 3")
	}
}
