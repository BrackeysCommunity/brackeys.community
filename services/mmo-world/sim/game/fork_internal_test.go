package game

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/puzzle"
)

// machineFork is a dungeon whose first fork has a machine behind way 1,
// other than those named.
func machineFork(t *testing.T, g *Game, not ...hex.Hex) hex.Hex {
	t.Helper()
	from := g.SettlementHex(0)
	for r := int64(1); r <= delveSearch; r++ {
		for _, h := range hex.Ring(from, r) {
			p, ok := g.r.Gen.Dungeon(h)
			if ok && !p.Up && p.Floors >= 3 && len(g.r.Gen.Creatures(h)) > 0 && g.r.Gen.FloorAt(h, 1, noWay, g.tierAt(h)).Machine && !slices.Contains(not, h) {
				return h
			}
		}
	}
	t.Fatal("no dungeon with a fork machine below floor 1")
	return hex.Hex{}
}

func TestForkThirdWayByKeyAndByMaster(t *testing.T) {
	g := guardGame(t)
	h := machineFork(t, g)
	c := mustCreate(t, g, "keyed", "knife")
	c.C.At = h
	explored(t, g, c)
	endFight(t, g, c, fight.Won, nil)
	if err := g.dungeonPushCheck(c, WayOption(gen.WayHidden)); !refusedAs(err, NoWay) {
		t.Fatalf("the third way opens with no key: %v", err)
	}
	c.Keys = []string{h.Ref()}
	read := g.Fork(c)
	if len(read.Ways) != 3 || !read.Ways[2].Open || read.Ways[1].Open || read.Ways[1].Machine == "" {
		t.Fatalf("with a key the fork reads %+v", read.Ways)
	}
	res := act(t, g, c, DungeonPush, WayOption(gen.WayHidden))
	if len(c.Keys) != 0 || !hasFact(res, "key.used") || !hasTrigger(res, TrigTheKey) {
		t.Fatalf("the key is not used: %v", c.Keys)
	}
	if c.Fight == nil || c.Delving.Way != gen.WayHidden || c.Fight.E.Hidden != g.fp("third-way-hidden") {
		t.Fatal("the third way does not lead down hidden")
	}

	m := mustCreate(t, g, "master", "knife")
	h2 := machineFork(t, g, h)
	m.C.At = h2
	explored(t, g, m)
	endFight(t, g, m, fight.Won, nil)
	_, sh := g.forkOf(m)
	if err := g.forkSolved(m, sh, puzzle.Result{Solved: true, Master: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := g.forkMachine(m); !refusedAs(err, Used) {
		t.Fatalf("a worked fork machine arms again: %v", err)
	}
	m.Keys = []string{h2.Ref()}
	act(t, g, m, DungeonPush, WayOption(gen.WayHidden))
	if len(m.Keys) != 1 {
		t.Fatal("a master's third way used up a key")
	}
}

// dungeonPushCheck is a push that must be refused, with the digest kept.
func (g *Game) dungeonPushCheck(c *Char, option string) error {
	before, _ := g.Digest()
	_, err := g.Act(Command{Key: "check-" + c.C.ID, Char: c.C.ID, Kind: DungeonPush, Option: option, Now: 1})
	if after, _ := g.Digest(); after != before {
		panic("a refused push changed the game")
	}
	return err
}

func hasFact(res Result, kind string) bool {
	return slices.ContainsFunc(res.Facts, func(f fact.Fact) bool { return f.Kind == kind })
}

func hasTrigger(res Result, id string) bool {
	return slices.ContainsFunc(res.Facts, func(f fact.Fact) bool {
		d, _ := f.Get("trigger")
		return f.Kind == "trigger.fired" && d.S == id
	})
}

func TestForkMachineHaulAndHaywire(t *testing.T) {
	g := guardGame(t)
	h := machineFork(t, g)
	c := mustCreate(t, g, "machinist", "knife")
	c.C.At = h
	explored(t, g, c)
	endFight(t, g, c, fight.Won, nil)
	_, sh := g.forkOf(c)
	fm, err := g.forkMachine(c)
	if err != nil || fm.Family == "" || fm.Level < 1 {
		t.Fatalf("no fork machine: %+v %v", fm, err)
	}
	if err := g.dungeonPushCheck(c, WayOption(gen.WayMachine)); !refusedAs(err, NoWay) {
		t.Fatalf("way 1 stands open before its machine is solved: %v", err)
	}
	if err := g.forkSolved(c, sh, puzzle.Result{Solved: true}); err != nil {
		t.Fatal(err)
	}
	act(t, g, c, DungeonPush, WayOption(gen.WayMachine))
	if c.Delving.Bonus != g.forkHaulPct() {
		t.Fatalf("a solved way 1 carries %d%% more, not %d", c.Delving.Bonus, g.forkHaulPct())
	}
	haul := []item.Spoil{{Material: someHaul(g)[0].Material, Qty: 8}}
	before := g.balance(c, "mat:"+haul[0].Material)
	endFight(t, g, c, fight.Won, haul)
	if got := g.balance(c, "mat:"+haul[0].Material) - before; got != fight.GrowHaul(haul, g.forkHaulPct())[0].Qty {
		t.Fatalf("the floor through a solved machine paid %d", got)
	}
	if c.Delving.Bonus != 0 {
		t.Fatal("the bonus outlives its floor")
	}

	w := mustCreate(t, g, "haywired", "knife")
	h2 := machineFork(t, g, h)
	w.C.At = h2
	explored(t, g, w)
	endFight(t, g, w, fight.Won, nil)
	_, sh2 := g.forkOf(w)
	if err := g.forkSolved(w, sh2, puzzle.Result{Haywire: "spark"}); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(sh2.Fork.Open, []int64{gen.WayOpen}) {
		t.Fatalf("a haywire leaves %v open", sh2.Fork.Open)
	}
	if err := g.dungeonPushCheck(w, WayOption(gen.WayMachine)); !refusedAs(err, NoWay) {
		t.Fatalf("way 1 after a haywire: %v", err)
	}
}

func TestForkMapperAndHoardSense(t *testing.T) {
	g := guardGame(t)
	h, _ := dungeonFor(t, g, "", 3)
	c := mustCreate(t, g, "mapper", "knife")
	c.C.At = h
	explored(t, g, c)
	endFight(t, g, c, fight.Won, nil)
	for _, w := range g.Fork(c).Ways {
		if len(w.Next) > 0 {
			t.Fatal("a way shows its next floor without Mapper")
		}
	}
	with(c, "delver", "mapper")
	if !g.Maps(c) {
		t.Skip("mapper is not live")
	}
	for _, w := range g.Fork(c).Ways {
		next := g.r.Gen.FloorAt(h, 2, w.Way, g.tierAt(h))
		if len(w.Next) == 0 || w.Next[len(w.Next)-1] != next.Creature {
			t.Fatalf("Mapper's way %d reads %v", w.Way, w.Next)
		}
	}
	if g.FloorPoolSeen(c, h, 2) != nil {
		t.Fatal("a pool shows without Hoard sense")
	}
}
