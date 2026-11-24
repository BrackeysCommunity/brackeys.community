package align_test

import (
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/align"
)

func params(t *testing.T) (align.Params, []align.Band) {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	return align.ParamsOf(b.AlignParams), align.BandsOf(b.AlignBands)
}

// TestDepthTable: away from zero a move is whole; toward zero it shrinks
// by the share of depth already covered, rounded half up, never under 1.
func TestDepthTable(t *testing.T) {
	p, _ := params(t)
	for _, c := range []struct{ value, move, want int64 }{
		{0, 2, 2}, {0, -25, -25}, {40, 6, 6}, {-40, -3, -3}, {-100, -25, -25},
		{-15, 2, 2}, {-13, 2, 2}, {-11, 2, 2}, {-9, 2, 2},
		{-31, 2, 2}, {-32, 2, 1}, {-80, 2, 1}, {-100, 2, 1}, {-80, 6, 2}, {-80, 3, 1},
		{80, -3, -1}, {80, -25, -9}, {50, -25, -15}, {10, -10, -9}, {-1, 2, 2}, {5, -2, -2},
		{100, -2, -1}, {-100, 6, 1}, {7, 0, 0}, {0, 0, 0},
	} {
		if got := align.Deepen(p, c.value, c.move); got != c.want {
			t.Errorf("Deepen(%d, %d) = %d, want %d", c.value, c.move, got, c.want)
		}
	}
}

// TestAlignmentDepth: −15 is back to unremarked within three +2 acts, and
// −80 needs 31 of them to leave notorious.
func TestAlignmentDepth(t *testing.T) {
	p, bands := params(t)
	v := int64(-15)
	var steps []int64
	for range 3 {
		v += align.Deepen(p, v, 2)
		steps = append(steps, v)
	}
	if steps[0] != -13 || steps[1] != -11 || steps[2] != -9 || align.BandOf(bands, v) != "unremarked" {
		t.Fatalf("from −15: %v, %s", steps, align.BandOf(bands, v))
	}
	v, acts := int64(-80), 0
	for align.BandOf(bands, v) == "notorious" {
		v += align.Deepen(p, v, 2)
		acts++
	}
	if acts != 31 || v != -49 {
		t.Fatalf("from −80: %d acts to %d", acts, v)
	}
}

func TestBandOf(t *testing.T) {
	_, bands := params(t)
	for v, want := range map[int64]string{-100: "notorious", -50: "notorious", -49: "crooked", -10: "crooked", -9: "unremarked",
		0: "unremarked", 9: "unremarked", 10: "decent", 49: "decent", 50: "upright", 100: "upright", -120: "notorious", 130: "upright"} {
		if got := align.BandOf(bands, v); got != want {
			t.Errorf("BandOf(%d) = %s, want %s", v, got, want)
		}
	}
	if align.BandOf(nil, 0) != "" {
		t.Error("no bands, no band")
	}
}

// TestCapped: +6 a day, +2 a day per partner for a paired act only, the
// excess dropped; a bad move passes whole.
func TestCapped(t *testing.T) {
	p, _ := params(t)
	for _, c := range []struct {
		move, good, pair int64
		paired           bool
		want             int64
	}{
		{2, 0, 0, false, 2}, {6, 0, 0, false, 6}, {3, 5, 0, false, 1}, {5, 4, 0, false, 2}, {2, 6, 0, false, 0}, {2, 9, 0, false, 0},
		{2, 0, 0, true, 2}, {2, 0, 1, true, 1}, {2, 0, 2, true, 0}, {3, 0, 0, true, 2}, {2, 5, 0, true, 1},
		{3, 0, 2, false, 3}, {-25, 6, 2, true, -25}, {-3, 6, 0, false, -3}, {0, 0, 0, false, 0},
	} {
		if got := align.Capped(p, c.move, c.good, c.pair, c.paired); got != c.want {
			t.Errorf("Capped(%d, good %d, pair %d, paired %v) = %d, want %d", c.move, c.good, c.pair, c.paired, got, c.want)
		}
	}
}

func TestTheftMove(t *testing.T) {
	for _, c := range []struct{ worth, want int64 }{{0, -2}, {19, -2}, {29, -2}, {30, -3}, {99, -9}, {400, -40}} {
		if got := align.TheftMove(10, 2, c.worth); got != c.want {
			t.Errorf("TheftMove(%d) = %d, want %d", c.worth, got, c.want)
		}
	}
	if align.TheftMove(0, 2, 500) != -2 {
		t.Error("no per-coin rate moves by the least")
	}
}

func TestClamp(t *testing.T) {
	p, _ := params(t)
	if align.Clamp(p, -130) != p.Min || align.Clamp(p, 101) != p.Max || align.Clamp(p, 7) != 7 {
		t.Fatal("clamp")
	}
}
