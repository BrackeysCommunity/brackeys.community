package world_test

import (
	"encoding/json"
	"fmt"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// A seatless archetype and the leaning traits move no draw: on 40 seeds the
// factions seated, their archetypes and their notables come out as they do
// from a book without those rows.
func TestSeatlessMovesNoDraw(t *testing.T) {
	b := book(t)
	if !slices.ContainsFunc(b.Archetypes, func(a sheets.Archetype) bool { return a.Seatless }) ||
		!slices.ContainsFunc(b.NPCTraits, func(r sheets.NPCTrait) bool { return r.Leaning }) {
		t.Fatal("the book holds no seatless archetype or leaning trait to test")
	}
	before := *b
	before.Archetypes = slices.DeleteFunc(slices.Clone(b.Archetypes), func(a sheets.Archetype) bool { return a.Seatless })
	before.NPCTraits = sheets.TraitPool(b.NPCTraits)
	seatless := map[string]bool{}
	for _, a := range b.Archetypes {
		seatless[a.ID] = a.Seatless
	}
	for i := range 40 {
		label := fmt.Sprintf("seatless-%d", i)
		got, want := factionsOf(t, b, label), factionsOf(t, &before, label)
		if got != want {
			t.Fatalf("%s: factions differ\n got %s\nwant %s", label, got, want)
		}
	}
	s, log := start(t, "seatless-days")
	for range 20 {
		if err := s.AdvanceDay(log); err != nil {
			t.Fatal(err)
		}
	}
	for _, f := range s.Factions {
		if seatless[f.Archetype] {
			t.Fatalf("faction %d seated as %s", f.ID, f.Archetype)
		}
	}
}

// factionsOf is a new world's factions after a few days, as JSON.
func factionsOf(t *testing.T, b *sheets.Book, label string) string {
	t.Helper()
	k := keys.Throwaway(label)
	g, err := gen.New(b, k.Generation)
	if err != nil {
		t.Fatal(err)
	}
	s, err := world.New(b, g, k.Roll)
	if err != nil {
		t.Fatal(err)
	}
	log := &fact.Mem{}
	for range 3 {
		if err := s.AdvanceDay(log); err != nil {
			t.Fatal(err)
		}
	}
	out, err := json.Marshal(s.Factions)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}
