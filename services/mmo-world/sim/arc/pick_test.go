package arc

import (
	"testing"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/keys"
)

func pickCandidates() []Candidate {
	return []Candidate{
		{Cast: castOf("front", "region", "r-4"), Pressure: 300, Place: -1},
		{Cast: castOf("front", "region", "r-1"), Pressure: 700, Place: -1},
		{Cast: castOf("front", "region", "r-3"), Pressure: 700, Place: -1},
		{Cast: castOf("front", "region", "r-2"), Pressure: 700, Place: -1},
		{Cast: castOf("front", "region", "r-5"), Pressure: 100, Place: -1},
	}
}

func TestOrdered(t *testing.T) {
	o := Ordered(pickCandidates())
	var got []string
	for _, c := range o {
		got = append(got, c.Cast.Key())
	}
	want := []string{"front=region:r-1", "front=region:r-2", "front=region:r-3", "front=region:r-4", "front=region:r-5"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("order %v, want %v", got, want)
		}
	}
}

func TestPickTakesTheHighest(t *testing.T) {
	d := draw.NewDrawer(keys.Throwaway("arc-pick").Generation)
	if _, ok := Pick(nil, d, "the-siege", "world", 3); ok {
		t.Fatal("no candidates should pick none")
	}
	cs := pickCandidates()
	cs[0].Pressure = 900
	c, ok := Pick(cs, nil, "the-siege", "world", 3)
	if !ok || c.Cast.Key() != "front=region:r-4" {
		t.Fatalf("picked %v, want the 900", c.Cast)
	}
}

// A tie is drawn: the same key, row, scope and day always give the same
// cast, whatever order the candidates came in, and over days every tied
// candidate is taken and no lower one is.
func TestPickIsKeyed(t *testing.T) {
	k := keys.Throwaway("arc-pick").Generation
	cs := pickCandidates()
	rev := make([]Candidate, len(cs))
	for i := range cs {
		rev[len(cs)-1-i] = cs[i]
	}
	seen := map[string]int{}
	for day := range int64(60) {
		a, _ := Pick(cs, draw.NewDrawer(k), "the-long-cold", "world", day)
		b, _ := Pick(rev, draw.NewDrawer(k), "the-long-cold", "world", day)
		if a.Cast.Key() != b.Cast.Key() {
			t.Fatalf("day %d: %s and %s from the same draw", day, a.Cast.Key(), b.Cast.Key())
		}
		if a.Pressure != 700 {
			t.Fatalf("day %d: picked a lower pressure %d", day, a.Pressure)
		}
		seen[a.Cast.Key()]++
	}
	if len(seen) != 3 {
		t.Fatalf("over 60 days the tie took %v", seen)
	}
	other := keys.Throwaway("arc-pick-other").Generation
	differs := false
	for day := range int64(60) {
		a, _ := Pick(cs, draw.NewDrawer(k), "the-long-cold", "world", day)
		b, _ := Pick(cs, draw.NewDrawer(other), "the-long-cold", "world", day)
		differs = differs || a.Cast.Key() != b.Cast.Key()
	}
	if !differs {
		t.Fatal("another world's key never picks differently")
	}
}

func TestChanceIsKeyed(t *testing.T) {
	k := keys.Throwaway("arc-chance").Generation
	d := draw.NewDrawer(k)
	hits := 0
	for day := range int64(400) {
		a := Chance(d, "the-siege", "world", day, 30)
		if a != Chance(draw.NewDrawer(k), "the-siege", "world", day, 30) {
			t.Fatalf("day %d: chance is not keyed", day)
		}
		if a {
			hits++
		}
		if !Chance(d, "the-siege", "world", day, 100) || Chance(d, "the-siege", "world", day, 0) {
			t.Fatal("100 always and 0 never")
		}
	}
	if hits < 80 || hits > 160 {
		t.Fatalf("30%% over 400 days hit %d times", hits)
	}
}
