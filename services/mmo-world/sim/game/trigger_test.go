package game

import (
	"strings"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/world"
)

// TestFindsNeverMint drops a lost haul on a fought-over tile, then has a
// stranger and its owner arrive: every find moves goods out of the tile's
// pool, none comes from a source, and the pool never gives more than it
// took (GDD 8.6).
func TestFindsNeverMint(t *testing.T) {
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	for i := range b.Triggers {
		if b.Triggers[i].ID == TrigSpoils {
			b.Triggers[i].Chance = fixed.FromInt(1)
		}
	}
	r, err := NewRules(b, keys.Throwaway("finds"))
	if err != nil {
		t.Fatal(err)
	}
	g, err := New(r)
	if err != nil {
		t.Fatal(err)
	}
	mk := func(key string) *Char {
		res, err := g.Act(Command{Key: key, Kind: Create, Option: "knife"})
		if err != nil {
			t.Fatal(err)
		}
		return res.Char
	}
	owner, stranger := mk("a"), mk("b")
	home := owner.C.At
	field := home.Neighbour(0)
	for d := 0; !g.r.Gen.Passable(g.r.Gen.Baseline(field).Terrain); d++ {
		field = home.Neighbour(d)
	}
	owner.C.At = field
	m := g.Materials(field)[0]
	if err := g.drop(owner, "lost-1", []item.Spoil{{Material: m, Qty: 9}}, g.Tick()); err != nil {
		t.Fatal(err)
	}
	g.Pending = append(g.Pending, world.Action{Kind: world.ActFall, Hex: field, By: char.Ref(owner.C.ID)})
	owner.C.At = home
	if _, err := g.Advance(); err != nil {
		t.Fatal(err)
	}
	_, pre := g.Flush()
	var in int64
	for _, x := range pre {
		for _, l := range x.Legs {
			if strings.HasPrefix(l.Account, ledger.Pool) && l.Units > 0 {
				in += l.Units
			}
		}
	}
	walk := func(c *Char, key string) {
		if _, err := g.Act(Command{Key: key, Char: c.C.ID, Kind: Step, Dir: home.DirectionTo(field)}); err != nil {
			t.Fatal(err)
		}
		for c.Long != nil {
			if _, err := g.Advance(); err != nil {
				t.Fatal(err)
			}
		}
	}
	walk(stranger, "s1")
	walk(owner, "o1")
	_, txns := g.Flush()
	var out int64
	finds := 0
	for _, x := range txns {
		if x.Kind != "find" {
			continue
		}
		finds++
		for _, l := range x.Legs {
			if l.Units < 0 {
				if !strings.HasPrefix(l.Account, ledger.Pool+"tile:") {
					t.Fatalf("a find gave from %s", l.Account)
				}
				out -= l.Units
			}
		}
	}
	if finds != 2 || out != in || g.Ledger.Of(poolOf(field), ledger.Material(m)) != 0 {
		t.Fatalf("%d finds took %d of %d pooled; %d left", finds, out, in, g.Ledger.Of(poolOf(field), ledger.Material(m)))
	}
	if g.Ledger.Of(ledger.Char(stranger.C.ID), ledger.Material(m)) == 0 || g.Ledger.Of(ledger.Char(owner.C.ID), ledger.Material(m)) == 0 {
		t.Fatal("the stranger and the owner should each have found some")
	}
	if problems := ledger.Audit(g.Ledger.Balances(), g.Holdings()); len(problems) > 0 {
		t.Fatal(problems)
	}
}
