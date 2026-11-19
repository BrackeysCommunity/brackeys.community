package econ

import (
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/sheets"
)

func values(t *testing.T) (*Values, *sheets.Book) {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	return New(b), b
}

// TestFeeNotSplit: two half fills never pay less than one whole fill.
func TestFeeNotSplit(t *testing.T) {
	v, _ := values(t)
	for _, coin := range []int64{1, 2, 10, 33, 34, 100, 101, 999} {
		half := coin / 2
		if v.Fee(half)+v.Fee(coin-half) < v.Fee(coin) {
			t.Fatalf("splitting %d coin pays %d+%d, under %d", coin, v.Fee(half), v.Fee(coin-half), v.Fee(coin))
		}
	}
	if v.FeePercent() > 0 && v.Fee(1) == 0 {
		t.Fatal("a one-coin fill pays no fee")
	}
}

// TestMaterialValue is the tier's base scaled by the vector total against
// the tier's median, never under 1.
func TestMaterialValue(t *testing.T) {
	v, b := values(t)
	for _, m := range b.Materials {
		var ref *sheets.RefValue
		for i := range b.RefValues {
			if b.RefValues[i].Tier == m.Tier {
				ref = &b.RefValues[i]
			}
		}
		if ref == nil {
			if v.Material(m.ID) != 0 {
				t.Fatalf("%s has no tier but a value", m.ID)
			}
			continue
		}
		var total int64
		for _, x := range m.Vector.Slice() {
			total += x
		}
		want := max(1, fixed.Ratio(ref.Base*total, ref.Median).Int())
		if got := v.Material(m.ID); got != want || got < 1 {
			t.Fatalf("%s: %d, want %d", m.ID, got, want)
		}
	}
	if v.Material("no-such-material") != 0 {
		t.Fatal("an unknown material has a value")
	}
}

// TestKindValueCompounds: a kind made of a made kind pays step-markup at
// each level.
func TestKindValueCompounds(t *testing.T) {
	v, b := values(t)
	m := b.Materials[0].ID
	reg := item.NewMemRegistry()
	inner := reg.Freeze(&item.Kind{ID: "inner", Recipe: item.Recipe{Inputs: []item.Input{{Kind: m, Qty: 2}}}})
	outer := &item.Kind{ID: "outer", Recipe: item.Recipe{Inputs: []item.Input{{Kind: "inner", Qty: 1}, {Kind: m, Qty: 1}}}}
	markup := v.Param("step-markup")
	wantInner := fixed.PercentPlus(2*v.Material(m), markup)
	if got := v.Kind(reg, inner); got != wantInner {
		t.Fatalf("inner: %d, want %d", got, wantInner)
	}
	if got, want := v.Kind(reg, outer), fixed.PercentPlus(wantInner+v.Material(m), markup); got != want {
		t.Fatalf("outer: %d, want %d", got, want)
	}
}
