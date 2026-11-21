package game

import (
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
)

func wayOutOf(t *testing.T, g *Game, c *Char) string {
	t.Helper()
	_, opts := g.beat(c, g.Tick())
	for _, o := range opts {
		if o.Kind == fight.WayOut {
			return o.ID
		}
	}
	t.Skip("the beat offers no way out")
	return ""
}

func TestDelveBackedOutMemberDoesNotFollowThePush(t *testing.T) {
	g := guardGame(t)
	h, _ := dungeonFor(t, g, "", 3)
	cs := formParty(t, g, 3, h)
	explored(t, g, cs[0])
	leaver := cs[2]
	e := cs[0].Fight.E
	out := wayOutOf(t, g, leaver)
	cautious := g.r.Fight.Cautious()
	act(t, g, cs[0], Press, cautious)
	act(t, g, cs[1], Press, cautious)
	act(t, g, leaver, Press, out)
	if e.Over {
		t.Skip("the beat ended the encounter")
	}
	if leaver.Long == nil || leaver.Long.Kind != Climb {
		t.Fatalf("the member who backed out is not climbing: floor %d, %+v", leaver.C.Floor, leaver.Long)
	}
	endFight(t, g, cs[0], fight.Won, someHaul(g))
	for _, c := range cs[:2] {
		act(t, g, c, DungeonPush, WayOption(gen.WayOpen))
	}
	if leaver.C.Floor > 1 {
		t.Fatalf("the leaver was carried down to floor %d", leaver.C.Floor)
	}
	advance(t, g)
	if leaver.C.Floor != 0 || leaver.Delving != nil {
		t.Fatalf("the leaver is not out: floor %d", leaver.C.Floor)
	}
}

func TestDelveCloseSpendsOnlyItsOwnBonus(t *testing.T) {
	g := guardGame(t)
	h, _ := dungeonFor(t, g, "", 3)
	a := mustCreate(t, g, "first", "knife")
	b := mustCreate(t, g, "second", "knife")
	a.C.At, b.C.At = h, h
	explored(t, g, a)
	explored(t, g, b)
	if a.C.Floor != b.C.Floor || a.Delving == nil || b.Delving == nil {
		t.Fatalf("not on one floor: %d, %d", a.C.Floor, b.C.Floor)
	}
	a.Delving.Bonus, b.Delving.Bonus = 25, 25
	endFight(t, g, a, fight.Won, someHaul(g))
	if a.Delving.Bonus != 0 {
		t.Fatal("the closed context kept its bonus")
	}
	if b.Delving.Bonus != 25 {
		t.Fatalf("another context's bonus was spent: %d", b.Delving.Bonus)
	}
}

func TestDelveCrawledOutMemberLeavesTheForkRecord(t *testing.T) {
	g := guardGame(t)
	h, _ := dungeonFor(t, g, "", 3)
	cs := formParty(t, g, 2, h)
	sh := toFork(t, g, cs)
	d, other := cs[1], cs[0]
	d.C.Set(char.Down, 0)
	act(t, g, d, Crawl, "")
	for d.Long != nil {
		advance(t, g)
	}
	if d.C.Floor != 0 || g.sharedOf(d) != nil {
		t.Fatalf("the crawled-out member is still among %v on floor %d", g.sharedOf(d), d.C.Floor)
	}
	act(t, g, other, DungeonLeave, "")
	advance(t, g)
	d.C.Clear(char.Wounded)
	h2 := otherDungeon(t, g, h)
	d.C.At, other.C.At = h2, h2
	explored(t, g, d)
	now := g.sharedOf(d)
	if d.Fight == nil || d.Fight.Shared == "" || now == nil || now == sh || g.sharedOf(other) != now {
		t.Fatalf("no fresh shared encounter for the returned member: %+v", d.Fight)
	}
	if _, err := g.Act(Command{Key: "pick-after-crawl", Char: d.C.ID, Kind: Press, Option: g.r.Fight.Cautious(), Now: 1}); err != nil {
		t.Fatalf("a press after the crawl: %v", err)
	}
}

// otherDungeon is the nearest dungeon to the first settlement that is not
// h and not a relay tower.
func otherDungeon(t *testing.T, g *Game, h hex.Hex) hex.Hex {
	t.Helper()
	from := g.SettlementHex(0)
	for r := int64(1); r <= delveSearch; r++ {
		for _, x := range hex.Ring(from, r) {
			p, ok := g.r.Gen.Dungeon(x)
			if ok && !p.Up && x != h && len(g.r.Gen.Creatures(x)) > 0 {
				return x
			}
		}
	}
	t.Fatal("no second dungeon")
	return h
}
