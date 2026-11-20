package npc_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
)

func TestRouteAndVisitIndexesAfterReload(t *testing.T) {
	var book npc.Book
	home, first, next := hex.Hex{}, hex.Hex{Q: 1}, hex.Hex{R: 1}
	n := book.Save(npc.Stub{ID: "guide", Home: home}, 0)
	n.Route = []hex.Hex{home, first}
	book.Routed(n, nil)
	if got := book.Through(first); !slices.Equal(got, []*npc.NPC{n}) {
		t.Fatalf("initial route: %v", got)
	}
	old := n.Route
	n.Route = []hex.Hex{home, next}
	book.Routed(n, old)
	book.Queue(n, "visitor")
	book.Queue(n, "cleared")
	book.Visited(n, "cleared")

	reloaded := npc.Book{List: book.List}
	reloaded.Rebuild()
	for _, b := range []*npc.Book{&book, &reloaded} {
		if b.Get("guide") != n || len(b.Through(first)) != 0 || !slices.Equal(b.Through(next), []*npc.NPC{n}) {
			t.Fatal("the relaid route is missing or its former stop is still indexed")
		}
		if !slices.Equal(b.Visiting("visitor"), []*npc.NPC{n}) || len(b.Visiting("cleared")) != 0 {
			t.Fatal("the visit index lost the pending visit or kept the cleared one")
		}
	}
}

func TestDailyRouteAndMemory(t *testing.T) {
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	k := keys.Throwaway("npc-test")
	r := npc.New(b, k.Generation, k.Roll)
	home, first, far := hex.Hex{}, hex.Hex{Q: 1}, hex.Hex{Q: 2}
	n := &npc.NPC{Stub: npc.Stub{Home: home}, Route: []hex.Hex{home, first, far}}
	quarter := int64(sheets.TicksPerDay / 4)
	for i, want := range []hex.Hex{home, first, far, first, home} {
		if got := r.At(n, int64(i)*quarter); got != want {
			t.Fatalf("quarter %d: at %v, want %v", i, got, want)
		}
	}
	limit := r.Param("memory-cap")
	r.Remember(n, npc.Entry{Kind: "forgotten", Weight: 1}, 0)
	for range limit {
		r.Remember(n, npc.Entry{Kind: "important", Weight: 50}, 0)
	}
	if len(n.Memory) != int(limit) || n.Summary.Get("forgotten") != 1 {
		t.Fatalf("memory count %d, summary %v", len(n.Memory), n.Summary)
	}
}

func testRules(t *testing.T) *npc.Rules {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	k := keys.Throwaway("npc-test")
	return npc.New(b, k.Generation, k.Roll)
}

// TestRouteRelaidWeekly: a route stands a week, then its NPC keeps to its
// home until a meeting measures the road and relays it, and it walks the
// new route from the next morning.
func TestRouteRelaidWeekly(t *testing.T) {
	r := testRules(t)
	day := int64(sheets.TicksPerDay)
	week := r.Param("relay-days") * day
	step := int64(4)
	cost := func(_, _ hex.Hex) (int64, bool) { return step, true }
	n := &npc.NPC{Stub: npc.Stub{ID: "walker"}}
	r.LayRoute(n, 0, cost)
	if len(n.Route) < 2 || n.RouteTicks != step*int64(len(n.Route)-1) {
		t.Fatalf("laid %v in %d ticks", n.Route, n.RouteTicks)
	}
	noon := day / 2
	if r.Relay(n, week-1, cost) || r.At(n, week-day+noon) == n.Stub.Home {
		t.Fatal("a route under a week old was relaid, or its NPC stayed in at noon")
	}
	if !r.Due(n, week) || r.At(n, week+noon) != n.Stub.Home {
		t.Fatal("an NPC whose route is due is not at home")
	}
	step = 5
	met := week + noon
	if !r.Relay(n, met, cost) {
		t.Fatal("a due route was not relaid")
	}
	morning := (met/day + 1) * day
	if n.Longer != 25 || n.Laid != morning || n.RouteTicks != step*int64(len(n.Route)-1) {
		t.Fatalf("relaid: %d%% longer, laid %d (want %d), %d ticks", n.Longer, n.Laid, morning, n.RouteTicks)
	}
	if r.At(n, met) != n.Stub.Home || r.At(n, morning-1) != n.Stub.Home {
		t.Fatal("a relaid route moved its NPC before the next morning")
	}
	if r.At(n, morning+noon) == n.Stub.Home {
		t.Fatal("the relaid route is not walked the next day")
	}
	if r.Relay(n, morning+noon, cost) {
		t.Fatal("a fresh route was relaid")
	}
	r.Relay(n, morning+week, cost)
	if n.Longer != 0 {
		t.Fatalf("a road no slower than when it was laid reads %d%% longer", n.Longer)
	}
}

// TestGossipIsOneHopAtAShare: an NPC hears its neighbours' most salient
// memory at gossip-share of its salience, only of kinds npcs.gossip
// voices, and hearing it stores nothing to pass on again.
func TestGossipIsOneHopAtAShare(t *testing.T) {
	r := testRules(t)
	near := &npc.NPC{Stub: npc.Stub{ID: "near", Name: "Near"}}
	quiet := &npc.NPC{Stub: npc.Stub{ID: "quiet", Name: "Quiet"}}
	r.Remember(near, npc.Entry{Kind: "greeted", Player: "p", Weight: 30}, 0)
	r.Remember(near, npc.Entry{Kind: "wronged", Player: "p", Weight: 60}, 0)
	r.Remember(near, npc.Entry{Kind: "unvoiced", Weight: 90}, 0)
	if _, ok := r.GossipLine("unvoiced"); ok {
		t.Fatal("a kind with no row has a gossip line")
	}
	who, e, heard, ok := r.Heard([]*npc.NPC{quiet, near}, 0)
	if !ok || who != near || e.Kind != "wronged" || heard != 60*r.Param("gossip-share")/100 {
		t.Fatalf("heard %+v of %v at %d", e, who, heard)
	}
	if len(quiet.Memory) != 0 {
		t.Fatal("hearing gossip wrote a memory")
	}
	if _, _, _, ok := r.Heard([]*npc.NPC{quiet}, 0); ok {
		t.Fatal("gossip travelled a second hop")
	}
}

// TestHomedReadsTheRouteIndex: who lives on a tile is answered by the
// index, and follows a move.
func TestHomedReadsTheRouteIndex(t *testing.T) {
	r := testRules(t)
	var book npc.Book
	home, away := hex.Hex{}, hex.Hex{Q: 9}
	cost := func(_, _ hex.Hex) (int64, bool) { return 1, true }
	lives := book.Save(npc.Stub{ID: "lives", Home: home}, 0)
	passes := book.Save(npc.Stub{ID: "passes", Home: hex.Hex{Q: 1}}, 0)
	lives.Route, passes.Route = []hex.Hex{home}, []hex.Hex{{Q: 1}, home}
	book.Routed(lives, nil)
	book.Routed(passes, nil)
	if got := book.Homed(home); !slices.Equal(got, []*npc.NPC{lives}) {
		t.Fatalf("homed: %v", got)
	}
	old := lives.Route
	r.Move(lives, away, 0, cost)
	book.Routed(lives, old)
	if len(book.Homed(home)) != 0 || !slices.Equal(book.Homed(away), []*npc.NPC{lives}) || lives.Route[0] != away {
		t.Fatal("a move left the NPC indexed at its old home")
	}
}
