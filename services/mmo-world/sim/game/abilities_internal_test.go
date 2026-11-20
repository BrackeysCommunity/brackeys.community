package game

import (
	"testing"

	"jams.team/mmo-world/sim/class"
	"jams.team/mmo-world/sim/craft"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/guild"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

// with gives a character an active class and one of its abilities.
func with(c *Char, cls, ability string) {
	c.C.Classes = class.State{Earned: []class.Earned{{ID: cls}}, Active: []string{cls}, Abilities: []string{ability}}
}

func TestTinderSparesOneComponentAboveTheLeast(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	consumed := func(n int) *craft.Result {
		r := &craft.Result{}
		for range n {
			r.Consumed = append(r.Consumed, item.Spoil{Material: "x", Qty: 1})
		}
		return r
	}
	left := func(r *craft.Result) (n int64) {
		for _, s := range r.Consumed {
			n += s.Qty
		}
		return n
	}
	plain := consumed(3)
	g.spare(c, plain, 3)
	if left(plain) != 3 {
		t.Fatalf("without Tinder a Compose of 3 takes %d", left(plain))
	}
	with(c, "kindler", "tinder")
	three, two := consumed(3), consumed(2)
	g.spare(c, three, 3)
	g.spare(c, two, 2)
	if left(three) != 2 || three.Consumed[2].Qty != 0 || left(two) != 2 {
		t.Fatalf("with Tinder a Compose of 3 takes %d and of 2 takes %d", left(three), left(two))
	}
}

func TestHoldFastNeedsAWall(t *testing.T) {
	g := guardGame(t)
	bands := func(ts ...tags.Tag) int {
		effects, _ := tags.Apply(g.r.rules, tags.Plain(tags.Source{Note: "test"}, ts...), tags.Context{})
		return len(effects)
	}
	open := bands("option", "hold", "warden", "hold-fast")
	walled := bands("option", "hold", "warden", "hold-fast", class.TagWalled)
	if walled != open+1 {
		t.Fatalf("a Hold with Hold fast fires %d effects in the open and %d on a wall", open, walled)
	}
}

// A work spares its share of a cost until the day's stock is spent.
func TestAWorkGivesBackNoMoreThanItBurned(t *testing.T) {
	g := &Game{}
	row := &sheets.GuildWork{ID: "stoked-forge", By: fixed.Hundredths}
	w := &guild.Work{ID: row.ID, Left: 30}
	for _, want := range []int64{20, 10, 0} {
		got := spared(row, w, 20)
		if got != want {
			t.Fatalf("with %d left a work spared %d of 20, want %d", w.Left, got, want)
		}
		g.workGave(w, got)
	}
	if gave := g.WorkLedger.Gave.Get(row.ID); gave != 30 || w.Gave != 30 {
		t.Fatalf("the work gave back %d (its own count %d) against 30 burned", gave, w.Gave)
	}
}

// Prey is a kind of creature: a tag every archetype carries marks nothing.
func TestPreyIsATagSomeCreaturesLack(t *testing.T) {
	g := guardGame(t)
	held := map[string]int{}
	for _, c := range g.r.Book.Creatures {
		for _, tag := range c.Tags {
			held[tag]++
		}
	}
	for tag, n := range held {
		if got, want := g.isCreatureTag(tag), n < len(g.r.Book.Creatures); got != want {
			t.Fatalf("%q, carried by %d of %d archetypes, marks prey: %v", tag, n, len(g.r.Book.Creatures), got)
		}
	}
	if g.isCreatureTag("no-such-tag") {
		t.Fatal("a tag no creature carries marks prey")
	}
}
