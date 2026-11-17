package world_test

import (
	"testing"

	"jams.team/mmo-world/harness"
	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/world"
)

func run(t *testing.T, days int) (*world.State, *fact.Mem) {
	t.Helper()
	b, err := harness.LoadBook(harness.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	k := keys.Throwaway("world-test")
	g, err := gen.New(b, k.Generation)
	if err != nil {
		t.Fatal(err)
	}
	w := g.Discovered(g.Settlement(0).Hex, 30)
	s, err := world.New(b, w, k.Roll)
	if err != nil {
		t.Fatal(err)
	}
	log := &fact.Mem{}
	for range days {
		if err := s.Advance(log); err != nil {
			t.Fatal(err)
		}
	}
	return s, log
}

// A replay of the same days reaches the same digest.
func TestReplayDigest(t *testing.T) {
	s1, l1 := run(t, 30)
	s2, l2 := run(t, 30)
	d1, err := canon.Digest([]any{s1, l1.Since(0)})
	if err != nil {
		t.Fatal(err)
	}
	d2, _ := canon.Digest([]any{s2, l2.Since(0)})
	if d1 != d2 || l1.Len() == 0 {
		t.Fatalf("digests %s and %s over %d facts", d1, d2, l1.Len())
	}
}

func TestGaugesStayInRange(t *testing.T) {
	s, log := run(t, 90)
	for _, r := range s.Regions {
		for _, v := range r.Gauge {
			if v < 0 || v > 1000 {
				t.Fatalf("region %d gauge %d", r.ID, v)
			}
		}
	}
	for _, f := range log.Since(0) {
		for _, c := range f.Causes {
			if c >= f.ID {
				t.Fatalf("fact %d caused by a later fact %d", f.ID, c)
			}
		}
	}
}

// Opening a settlement lowers the tier of the land round it at the next
// day, and a fact says so.
func TestOpenSettlement(t *testing.T) {
	b, err := harness.LoadBook(harness.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	k := keys.Throwaway("world-open")
	g, err := gen.New(b, k.Generation)
	if err != nil {
		t.Fatal(err)
	}
	s, err := world.New(b, g.Discovered(g.Settlement(0).Hex, 60), k.Roll)
	if err != nil {
		t.Fatal(err)
	}
	before := make([]int64, len(s.Regions))
	for i, r := range s.Regions {
		before[i] = r.Tier
	}
	s.OpenSettlement()
	if s.Opened != 1 {
		t.Fatal("a settlement opened before the day turned")
	}
	log := &fact.Mem{}
	if err := s.Advance(log); err != nil {
		t.Fatal(err)
	}
	lowered := 0
	for i, r := range s.Regions {
		if r.Tier > before[i] {
			t.Fatalf("region %d rose from tier %d to %d", i, before[i], r.Tier)
		}
		if r.Tier < before[i] {
			lowered++
		}
	}
	calm := 0
	for _, f := range log.Since(0) {
		if f.Kind == "land.calmer" {
			calm++
		}
	}
	if s.Opened != 2 || lowered == 0 || calm != 1 {
		t.Fatalf("opened %d, %d regions lowered, %d calmer facts", s.Opened, lowered, calm)
	}
}
