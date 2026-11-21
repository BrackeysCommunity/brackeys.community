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
		c.C.At = cs[0].C.At
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
// its entrance.
func Delving(t testing.TB, g *game.Game, cs []*game.Char, floor int64) hex.Hex {
	t.Helper()
	h, ok := Dungeon(g, floor)
	if !ok {
		t.Fatalf("no dungeon of %d floors near the first settlement", floor)
	}
	for _, c := range cs {
		c.C.At, c.C.Floor, c.Long, c.Fight = h, floor, nil, nil
		c.Delving = &game.Delving{Dungeon: h.Ref(), Way: -1}
	}
	return h
}

// Dungeon is the nearest dungeon entrance to the first settlement with at
// least so many floors.
func Dungeon(g *game.Game, floors int64) (hex.Hex, bool) {
	from := g.SettlementHex(0)
	for r := int64(1); r <= dungeonSearch; r++ {
		for _, h := range hex.Ring(from, r) {
			if p, ok := g.Rules().Gen.Dungeon(h); ok && p.Floors >= floors {
				return h, true
			}
		}
	}
	return hex.Hex{}, false
}

// dungeonSearch is how far Dungeon looks, in tiles.
const dungeonSearch = 60

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
