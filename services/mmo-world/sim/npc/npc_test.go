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
