package draw

import (
	"math/rand/v2"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/fixed"
)

var testKey = Key{1, 2, 3}

func TestDeterministicAndKeyed(t *testing.T) {
	a := Draw(testKey, "x", Int(3), Int(-4))
	if a != Draw(testKey, "x", Int(3), Int(-4)) {
		t.Fatal("same identity, different draw")
	}
	if a == Draw(Key{9}, "x", Int(3), Int(-4)) {
		t.Fatal("key does not matter")
	}
	if a == Draw(testKey, "y", Int(3), Int(-4)) {
		t.Fatal("purpose does not matter")
	}
	if a != NewDrawer(testKey).Draw("x", Int(3), Int(-4)) {
		t.Fatal("Drawer differs from Draw")
	}
}

func TestEncodingIsUnambiguous(t *testing.T) {
	d := NewDrawer(testKey)
	pairs := [][2][]Part{
		{{Str("ab"), Str("c")}, {Str("a"), Str("bc")}},
		{{Int(1)}, {Str("\x00\x00\x00\x00\x00\x00\x00\x01")}},
		{{Int(1), Int(2)}, {Int(2), Int(1)}},
		{{}, {Str("")}},
	}
	for _, p := range pairs {
		if d.Draw("p", p[0]...) == d.Draw("p", p[1]...) {
			t.Errorf("collision between %v and %v", p[0], p[1])
		}
	}
	if d.Draw("ab", Str("c")) == d.Draw("a", Str("bc")) {
		t.Error("purpose and parts run together")
	}
}

func TestBelowIsUniform(t *testing.T) {
	d := NewDrawer(testKey)
	const n, draws = 10, 200000
	var counts [n]int
	for i := range draws {
		counts[d.Below(n, "u", Int(int64(i)))]++
	}
	// Chi-square with 9 degrees of freedom; 27.9 is the 0.1% critical value.
	exp := float64(draws) / n
	chi := 0.0
	for _, c := range counts {
		chi += (float64(c) - exp) * (float64(c) - exp) / exp
	}
	if chi > 27.9 {
		t.Fatalf("chi-square %.1f: %v", chi, counts)
	}
}

func TestRollMatchesChance(t *testing.T) {
	d := NewDrawer(testKey)
	for _, pct := range []int64{0, 10, 25, 50, 75, 90, 100} {
		hits := 0
		const draws = 100000
		for i := range draws {
			if d.Roll(fixed.FromInt(pct).AsFraction(), "roll", Int(pct), Int(int64(i))) {
				hits++
			}
		}
		got := hits * 100 / draws
		if (pct == 0 && hits != 0) || (pct == 100 && hits != draws) || got < int(pct)-1 || got > int(pct)+1 {
			t.Errorf("chance %d%%: hit %d of %d", pct, hits, draws)
		}
	}
}

func TestPickProportional(t *testing.T) {
	d := NewDrawer(testKey)
	w := []int64{1, 0, 3, 6}
	var counts [4]int
	for i := range 100000 {
		counts[d.Pick(w, "pick", Int(int64(i)))]++
	}
	if counts[1] != 0 {
		t.Fatal("zero weight picked")
	}
	for i, want := range []int{10000, 0, 30000, 60000} {
		if diff := counts[i] - want; diff > 1000 || diff < -1000 {
			t.Errorf("index %d: %d, want about %d", i, counts[i], want)
		}
	}
}

func TestShuffle(t *testing.T) {
	d := NewDrawer(testKey)
	p := d.Shuffle(50, "s", Int(1))
	q := slices.Clone(p)
	slices.Sort(q)
	for i := range q {
		if q[i] != i {
			t.Fatal("not a permutation")
		}
	}
	if !slices.Equal(p, d.Shuffle(50, "s", Int(1))) {
		t.Fatal("not deterministic")
	}
	// Every position takes every value about equally often.
	var first [5]int
	for i := range 50000 {
		first[d.Shuffle(5, "s5", Int(int64(i)))[0]]++
	}
	for v, c := range first {
		if c < 9500 || c > 10500 {
			t.Errorf("value %d first %d times", v, c)
		}
	}
}

func TestStreamWordsFixedByIndex(t *testing.T) {
	d := NewDrawer(testKey)
	s := d.Stream("st", Int(7))
	var a []uint64
	for range 9 {
		a = append(a, s.Next())
	}
	d.Draw("interleaved", Int(1))
	s2 := d.Stream("st", Int(7))
	for i := range 9 {
		if s2.Next() != a[i] {
			t.Fatalf("word %d differs", i)
		}
	}
}

// BenchmarkDrawFresh is the cost of one fresh keyed draw, which the
// harness budgets against.
func BenchmarkDrawFresh(b *testing.B) {
	for i := range b.N {
		Draw(testKey, "beat.option", Int(int64(i)), Int(3), Int(5))
	}
}

func BenchmarkDrawerReuse(b *testing.B) {
	d := NewDrawer(testKey)
	b.ReportAllocs()
	for i := range b.N {
		d.Draw("beat.option", Int(int64(i)), Int(3), Int(5))
	}
}

func BenchmarkStreamWord(b *testing.B) {
	d := NewDrawer(testKey)
	s := d.Stream("bench")
	b.ReportAllocs()
	for range b.N {
		s.Next()
	}
}

func BenchmarkPCGBaseline(b *testing.B) {
	r := rand.New(rand.NewPCG(1, 2))
	for range b.N {
		r.Uint64()
	}
}

// Between and Percent spend the same draw as the Below they stand for.
func TestBetweenAndPercentMatchBelow(t *testing.T) {
	d := NewDrawer(testKey)
	for i := range int64(200) {
		if got, want := d.Between(-3, 9, "x", Int(i)), -3+int64(d.Below(13, "x", Int(i))); got != want {
			t.Fatalf("between %d, want %d", got, want)
		}
		if got, want := d.Percent(37, "y", Int(i)), int64(d.Below(fixed.Hundredths, "y", Int(i))) < 37; got != want {
			t.Fatalf("percent %v, want %v", got, want)
		}
	}
	s, u := d.Stream("z"), d.Stream("z")
	for range 50 {
		if got, want := s.Between(2, 5), 2+int64(u.Below(4)); got != want {
			t.Fatalf("stream between %d, want %d", got, want)
		}
	}
}
