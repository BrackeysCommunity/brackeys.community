package game

import (
	"strconv"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/world"
)

// sureSpoils is a game whose Spoils of war always rolls a find.
func sureSpoils(t *testing.T) *Game {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	for i := range b.Triggers {
		if b.Triggers[i].ID == TrigSpoils {
			b.Triggers[i].Chance = fixed.FromInt(1)
		}
	}
	r, err := NewRules(b, keys.Throwaway("windows"))
	if err != nil {
		t.Fatal(err)
	}
	g, err := New(r)
	if err != nil {
		t.Fatal(err)
	}
	return g
}

// lostOn has c lose qty of a material of the tile's tier, which a common
// find may take, on a passable tile next to its own.
func lostOn(t *testing.T, g *Game, c *Char, qty int64) (hex.Hex, string) {
	t.Helper()
	home := c.C.At
	field := home.Neighbour(0)
	for d := 0; !g.r.Gen.Passable(g.r.Gen.Baseline(field).Terrain); d++ {
		field = home.Neighbour(d)
	}
	c.C.At = field
	m := ""
	for _, mt := range g.r.Book.Materials {
		if tier, ok := g.r.Fight.D.Material(mt.ID); ok && tier == g.tierAt(field) {
			m = mt.ID
			break
		}
	}
	if m == "" {
		t.Fatalf("no material of tier %d", g.tierAt(field))
	}
	if err := g.drop(c, "lost-"+c.C.ID, []item.Spoil{{Material: m, Qty: qty}}, g.Tick()); err != nil {
		t.Fatal(err)
	}
	return field, m
}

// Spoils of war reads battles in its window only, however many there were
// (GDD 8.6).
func TestSpoilsOnlyInTheWindow(t *testing.T) {
	g := sureSpoils(t)
	owner, stranger := mustCreate(t, g, "a", "knife"), mustCreate(t, g, "b", "knife")
	h, _ := lostOn(t, g, owner, 9)
	g.Pending = append(g.Pending, world.Action{Kind: world.ActFall, Hex: h, By: char.Ref(owner.C.ID)})
	advance(t, g)
	tl := g.World.Tile(h)
	tl.BattlesLost, tl.LastBattle = 50, 10
	window := g.trigger(TrigSpoils).Window
	if err := g.spoils(stranger, h, "late", 10+window+1); err != nil {
		t.Fatal(err)
	}
	if len(stranger.Finds) != 0 {
		t.Fatal("a find from battles past the window")
	}
	tl.BattlesLost, tl.BattlesWon = 0, nil
	if err := g.spoils(stranger, h, "inside", 10+window); err != nil {
		t.Fatal(err)
	}
	if len(stranger.Finds) != 1 {
		t.Fatal("no find from a battle inside the window once its counters decayed")
	}
}

// What fell here gives back at most its magnitude an arrival and keeps the
// rest claimable; a claim past the window lapses.
func TestFellKeepsTheRestAndLapses(t *testing.T) {
	g := sureSpoils(t)
	c := mustCreate(t, g, "a", "knife")
	tr := g.trigger(TrigFell)
	h, m := lostOn(t, g, c, tr.Magnitude+10)
	pool := poolOf(h)
	arrive := func(n int) {
		t.Helper()
		if err := g.fell(c, h, "arrive-"+strconv.Itoa(n), g.Tick()); err != nil {
			t.Fatal(err)
		}
	}
	arrive(1)
	if got := g.Ledger.Of(ledger.Char(c.C.ID), ledger.Material(m)); got != tr.Magnitude {
		t.Fatalf("the first arrival gave back %d, want %d", got, tr.Magnitude)
	}
	if len(c.Dropped) != 1 || c.Dropped[0].Lost[0].Qty != 10 {
		t.Fatalf("the claim after one arrival: %+v", c.Dropped)
	}
	arrive(2)
	if g.Ledger.Of(pool, ledger.Material(m)) != 0 || len(c.Dropped) != 0 {
		t.Fatalf("pool %d, claim %+v after the second arrival", g.Ledger.Of(pool, ledger.Material(m)), c.Dropped)
	}

	c.C.At = h
	if err := g.drop(c, "lost-again", []item.Spoil{{Material: m, Qty: 5}}, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if err := g.fell(c, h, "too-late", g.Tick()+tr.Window+1); err != nil {
		t.Fatal(err)
	}
	if len(c.Dropped) != 0 || g.Ledger.Of(pool, ledger.Material(m)) != 5 {
		t.Fatalf("a lapsed claim: %+v, pool %d", c.Dropped, g.Ledger.Of(pool, ledger.Material(m)))
	}
}
