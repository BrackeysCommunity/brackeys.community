package game

import (
	"testing"

	"jams.team/mmo-world/sim/fact"
)

func TestRecapRanksAndDeduplicatesNews(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "reader", "hook")
	c.Seen = 4
	cost := fact.Fact{ID: 10, Tick: 5, Kind: "item.broke", Weight: g.NewsWeight(), Data: fact.At(c.C.At)}
	paid := fact.Fact{ID: 12, Tick: 6, Kind: "order.filled"}
	local := fact.Fact{ID: 16, Tick: 7, Weight: g.NewsWeight(), Data: fact.At(c.C.At)}
	own := []fact.Fact{paid, cost, {ID: 4, Tick: 4, Kind: "character.down"}}
	heavy := []fact.Fact{cost, local, {ID: 19, Tick: 8, Weight: 100}, {ID: 18, Tick: 8, Weight: 100}, {ID: 20, Tick: 9, Weight: 99}, {ID: 21, Tick: 9, Weight: g.NewsWeight() - 1, Data: fact.At(c.C.At)}}
	got := g.Recap(c, own, heavy)
	want := []struct {
		rule int
		id   fact.ID
	}{{RecapCost, 10}, {RecapPaid, 12}, {RecapNear, 16}, {RecapLargest, 19}}
	if got.Since != 4 || got.More != 0 || len(got.Lines) != len(want) {
		t.Fatal(got)
	}
	for i, w := range want {
		if l := got.Lines[i]; l.Rule != w.rule || l.Fact.ID != w.id {
			t.Fatalf("line %d: %+v, want %+v", i, l, w)
		}
	}
}

func TestRecapCountsOverflowAndKeepsNewestFirst(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "reader", "hook")
	limit := int(g.r.wp("recap-lines"))
	own := make([]fact.Fact, limit+2)
	for i := range own {
		own[i] = fact.Fact{ID: fact.ID(i + 1), Tick: 1, Kind: "gather.done"}
	}
	got := g.Recap(c, own, nil)
	if len(got.Lines) != limit || got.More != 2 {
		t.Fatal(got)
	}
	for i, line := range got.Lines {
		if line.Fact.ID != fact.ID(len(own)-i) {
			t.Fatal(got.Lines)
		}
	}
}
