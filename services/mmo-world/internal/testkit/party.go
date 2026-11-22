package testkit

import (
	"strconv"
	"testing"

	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
)

// Party is n new characters standing on one tile, formed into one party
// by invitation: the first leads, the rest join in order.
func Party(t testing.TB, g *game.Game, n int) []*game.Char {
	t.Helper()
	var cs []*game.Char
	for i := range n {
		res, err := g.Act(game.Command{Key: "party-create-" + strconv.Itoa(len(g.Chars)) + "-" + strconv.Itoa(i), Kind: game.Create})
		if err != nil {
			t.Fatal(err)
		}
		cs = append(cs, res.Char)
	}
	for _, c := range cs[1:] {
		if err := g.Teleport(c, cs[0].C.At); err != nil {
			t.Fatal(err)
		}
	}
	for i, c := range cs[1:] {
		key := "party-" + cs[0].C.ID + "-" + strconv.Itoa(i)
		if _, err := g.Act(game.Command{Key: key + "-invite", Char: cs[0].C.ID, Kind: game.PartyInvite, Target: c.C.ID}); err != nil {
			t.Fatal(err)
		}
		if _, err := g.Act(game.Command{Key: key + "-join", Char: c.C.ID, Kind: game.PartyJoin, Target: cs[0].C.ID}); err != nil {
			t.Fatal(err)
		}
	}
	if p := g.PartyOf(cs[0]); n > 1 && (p == nil || len(p.Members) != n) {
		t.Fatalf("a party of %d did not form", n)
	}
	return cs
}

// Delving stands characters on a floor of the nearest dungeon to the
// first settlement with that many floors, each delving it, and returns
// its entrance. Every floor down to it is reached first, by the way the
// characters are put there with.
func Delving(t testing.TB, g *game.Game, cs []*game.Char, floor int64) hex.Hex {
	t.Helper()
	h, ok := Dungeon(g, floor)
	if !ok {
		t.Fatalf("no dungeon of %d floors near the first settlement", floor)
	}
	reachFloors(g, h, floor)
	for _, c := range cs {
		c.Long, c.Fight = nil, nil
		if err := g.Teleport(c, h); err != nil {
			t.Fatal(err)
		}
		c.C.Floor = floor
		c.Delving = &game.Delving{Dungeon: h.Ref(), Way: noWay}
	}
	return h
}

// reachFloors reaches floors 1 to n of the dungeon at h by the way in
// from the entrance, as a party first descending would.
func reachFloors(g *game.Game, h hex.Hex, n int64) {
	for f := int64(1); f <= n; f++ {
		g.ReachFloor(h, f, noWay)
	}
}

// Dungeon is the nearest dungeon entrance to the first settlement with at
// least so many floors. A plan is drawn at its entrance's first reach, so
// every entrance it looks at is reached.
func Dungeon(g *game.Game, floors int64) (hex.Hex, bool) {
	from := g.SettlementHex(0)
	for r := int64(1); r <= dungeonSearch; r++ {
		for _, h := range hex.Ring(from, r) {
			if _, ok := g.Rules().Gen.Dungeon(h); !ok {
				continue
			}
			if err := g.World.Reach(g.Log, h, g.Tick()+1); err != nil {
				return hex.Hex{}, false
			}
			if p, ok := g.Plan(h); ok && p.Floors >= floors {
				return h, true
			}
		}
	}
	return hex.Hex{}, false
}

// dungeonSearch is how far Dungeon looks, in tiles; noWay is the way in
// of a floor reached from the entrance.
const (
	dungeonSearch = 60
	noWay         = -1
)

// PartyMachineBeat is game.FacePartyMachine for characters who count as
// having worked a machine, so the beat is the family asked for.
func PartyMachineBeat(t testing.TB, g *game.Game, cs []*game.Char, family string, level int64) *game.Shared {
	t.Helper()
	if g.Puzzles().Family(family) == nil {
		t.Fatalf("no machine family %q", family)
	}
	for _, c := range cs {
		c.Worked = max(c.Worked, 1)
	}
	return g.FacePartyMachine(cs, family, level)
}
