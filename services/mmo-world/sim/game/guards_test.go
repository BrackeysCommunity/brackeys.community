package game

import (
	"errors"
	"math"
	"slices"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
)

func guardGame(t *testing.T) *Game {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	r, err := NewRules(b, keys.Throwaway("guards"))
	if err != nil {
		t.Fatal(err)
	}
	g, err := New(r)
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func mustCreate(t *testing.T, g *Game, key, start string) *Char {
	t.Helper()
	res, err := g.Act(Command{Key: key, Kind: Create, Option: start})
	if err != nil {
		t.Fatal(err)
	}
	return res.Char
}

func audit(t *testing.T, g *Game) {
	t.Helper()
	if problems := ledger.Audit(g.Ledger.Balances, g.Holdings()); len(problems) > 0 {
		t.Fatal(problems)
	}
}

// TestRefusalsChangeNothing gives commands the rules must refuse, each
// against a state that would let a sloppier check through, and expects
// the digest unchanged.
func TestRefusalsChangeNothing(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	knife := c.C.In(char.Hand, 0)
	mat := g.r.Book.Materials[0].ID
	for _, cmd := range []Command{
		{Key: "b", Kind: Create, Option: "no-such-start"},
		{Key: "c", Char: c.C.ID, Kind: Buy, Asset: ledger.Provisions, Units: math.MaxInt64/3 + 1},
		{Key: "d", Char: c.C.ID, Kind: Buy, Asset: ledger.Provisions, Units: math.MaxInt64},
		{Key: "e", Char: c.C.ID, Kind: Equip, Item: knife.ID, Slot: char.Hand, Units: 1},
		{Key: "f", Char: c.C.ID, Kind: Equip, Item: knife.ID, Slot: char.Hand, Units: -1},
		{Key: "g", Char: c.C.ID, Kind: Craft, Recipe: &item.Recipe{Process: item.Alloy, Inputs: []item.Input{{Kind: mat, Qty: 1}, {Kind: mat, Qty: 1}}}},
		{Key: "h", Char: c.C.ID, Kind: Equip, Item: knife.ID, Slot: slotDeck},
	} {
		before, _ := g.Digest()
		var ref *Refused
		if _, err := g.Act(cmd); !errors.As(err, &ref) {
			t.Fatalf("%s %+v: %v, want a refusal", cmd.Kind, cmd, err)
		}
		if after, _ := g.Digest(); after != before {
			t.Fatalf("%s %+v was refused but changed the game", cmd.Kind, cmd)
		}
	}
	if len(g.Chars) != 1 {
		t.Fatalf("%d characters after a refused create", len(g.Chars))
	}
	c.C.Set(char.Down, 0)
	for _, kind := range []string{Sell, Buy, Feed, Talk, Choose} {
		var ref *Refused
		if _, err := g.Act(Command{Key: "down-" + kind, Char: c.C.ID, Kind: kind, Asset: ledger.Provisions, Units: 1}); !errors.As(err, &ref) || ref.Code != DownCode {
			t.Fatalf("%s while down: %v, want %s", kind, err, DownCode)
		}
	}
}

// TestChooseOncePerTopic answers a topic, then answers it again the same
// day: the second is refused, so its effect cannot be pressed twice.
func TestChooseOncePerTopic(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	people := g.PeopleHere(c, c.C.At)
	if len(people) == 0 {
		t.Fatal("nobody at the settlement")
	}
	for i, p := range people {
		if _, err := g.Act(Command{Key: "talk-" + p.ID, Char: c.C.ID, Kind: Talk, NPC: p.ID}); err != nil {
			t.Fatal(err)
		}
		conv, err := g.Converse(c, p.ID)
		if err != nil {
			t.Fatal(err)
		}
		for _, tp := range conv.Topics {
			for _, ch := range tp.Choices {
				opt := tp.ID + "/" + ch.ID
				if _, err := g.Act(Command{Key: "c1-" + tp.ID + ch.ID + p.ID, Char: c.C.ID, Kind: Choose, NPC: p.ID, Option: opt}); err != nil {
					continue
				}
				before, _ := g.Digest()
				var ref *Refused
				if _, err := g.Act(Command{Key: "c2-" + tp.ID + ch.ID + p.ID, Char: c.C.ID, Kind: Choose, NPC: p.ID, Option: opt}); !errors.As(err, &ref) {
					t.Fatalf("a second %s the same day: %v, want a refusal", opt, err)
				}
				if after, _ := g.Digest(); after != before {
					t.Fatal("a refused choice changed the game")
				}
				return
			}
		}
		if i == len(people)-1 {
			t.Skip("no topic with a choice the character could take")
		}
	}
}

// TestCacheKeepsExploit stashes a deck with an exploit loaded and has
// another character find it: the exploit moves with the deck, and the
// ledger agrees with what everyone holds after each step.
func TestCacheKeepsExploit(t *testing.T) {
	g := guardGame(t)
	owner := mustCreate(t, g, "a", "deck")
	finder := mustCreate(t, g, "b", "knife")
	deck := owner.C.In(char.OffHand, 0)
	if deck == nil || deck.Exploit == nil {
		t.Fatalf("the deck start carries no loaded deck: %+v", owner.C.Equipped)
	}
	owner.C.Equipped = slices.DeleteFunc(owner.C.Equipped, func(e char.Equipped) bool { return e.Item == deck.ID })
	if _, err := g.Act(Command{Key: "stash", Char: owner.C.ID, Kind: Stash, Item: deck.ID}); err != nil {
		t.Fatal(err)
	}
	audit(t, g)
	h := owner.C.At
	if g.Ledger.Of(poolOf(h), ledger.Item(deck.Exploit.ID)) != 1 {
		t.Fatal("the exploit stayed with its owner")
	}
	finder.C.Rumours = append(finder.C.Rumours, CacheRumour(h))
	if _, err := g.Act(Command{Key: "search", Char: finder.C.ID, Kind: Search}); err != nil {
		t.Fatal(err)
	}
	audit(t, g)
	if g.Ledger.Of(ledger.Char(finder.C.ID), ledger.Item(deck.Exploit.ID)) != 1 {
		t.Fatal("the finder holds the deck but not its exploit")
	}
}

// TestBrokenDeckWritesOffExploit breaks a loaded deck: the exploit in it
// is written off with it, so the ledger still agrees with the holdings.
func TestBrokenDeckWritesOffExploit(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "deck")
	deck := c.C.In(char.OffHand, 0)
	if deck == nil || deck.Exploit == nil {
		t.Fatal("the deck start carries no loaded deck")
	}
	before := slices.Clone(c.C.Pack)
	c.C.Drop(deck.ID)
	if err := g.lost(c, "press", before, g.Tick()); err != nil {
		t.Fatal(err)
	}
	audit(t, g)
}

// TestChooseNeedsTheNPCHere meets an NPC, then leaves: its choices are
// refused from anywhere else.
func TestChooseNeedsTheNPCHere(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	people := g.PeopleHere(c, c.C.At)
	if len(people) == 0 {
		t.Fatal("nobody at the settlement")
	}
	p := people[0]
	if _, err := g.Act(Command{Key: "talk", Char: c.C.ID, Kind: Talk, NPC: p.ID}); err != nil {
		t.Fatal(err)
	}
	c.C.At = c.C.At.Add(hex.Hex{Q: 40})
	var ref *Refused
	if _, err := g.Act(Command{Key: "choose", Char: c.C.ID, Kind: Choose, NPC: p.ID, Option: "any/any"}); !errors.As(err, &ref) || ref.Code != NotHere {
		t.Fatalf("a choice from away: %v, want %s", err, NotHere)
	}
}

func TestSimultaneousGatherersShareRemainingStock(t *testing.T) {
	g := guardGame(t)
	a := mustCreate(t, g, "a", "knife")
	b := mustCreate(t, g, "b", "knife")
	h := a.C.At
	mat := g.Materials(h)[0]
	g.World.Tile(h).Gather(mat, g.StockLeft(h, mat)-1)
	for _, c := range []*Char{a, b} {
		if _, err := g.Act(Command{Key: "gather-" + c.C.ID, Char: c.C.ID, Kind: Gather, Material: mat, Ticks: 1}); err != nil {
			t.Fatal(err)
		}
	}
	facts, err := g.Advance()
	if err != nil {
		t.Fatal(err)
	}
	asset := ledger.Material(mat)
	if got := g.Ledger.Of(ledger.Char(a.C.ID), asset) + g.Ledger.Of(ledger.Char(b.C.ID), asset); got != 1 {
		t.Fatalf("gathered %d units from a node with one unit left", got)
	}
	var exhausted int
	for _, f := range facts {
		if f.Kind == "node.worked-out" {
			exhausted++
		}
	}
	if exhausted != 1 {
		t.Fatalf("got %d depletion facts, want one", exhausted)
	}
	audit(t, g)
}
