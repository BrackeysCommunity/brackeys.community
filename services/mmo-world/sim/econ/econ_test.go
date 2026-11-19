package econ

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
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

// TestGoalFee is a share of the reward rounded up, never under the least.
func TestGoalFee(t *testing.T) {
	v, _ := values(t)
	least := v.Param("goal-fee-min")
	if got := v.GoalFee(0); got != least {
		t.Fatalf("a goal of nothing pays %d, want %d", got, least)
	}
	if got, want := v.GoalFee(1000), fixed.PercentOf(1000, v.Param("goal-fee")); got != max(least, want) {
		t.Fatalf("a 1000-coin goal pays %d, want %d", got, want)
	}
}

// TestWantsByUrgency: a faction short of what a material is tagged with
// buys it above reference; with no need it pays reference; what no
// faction buys, the keepers do.
func TestWantsByUrgency(t *testing.T) {
	v, b := values(t)
	calm := v.Wants(nil)
	for _, w := range calm {
		if w.Material != ledger.Provisions && (w.Buyer != Keepers || w.Price != v.Material(w.Material)) {
			t.Fatalf("with no factions: %+v", w)
		}
	}
	mats := sheets.Lookup(b.Materials)
	for i, w := range calm {
		for _, a := range b.Archetypes {
			for _, tag := range mats[w.Material].Tags {
				if !slices.Contains(a.Buys, tag) {
					continue
				}
				needy := v.Wants([]Buyer{{Archetype: a.ID, Needs: map[string]int64{tag: 10}, Full: 10}})[i]
				if needy.Buyer != 0 || needy.Urgency != v.Param("urgency-max") || needy.Price <= v.Material(w.Material) {
					t.Fatalf("%s at full need for %s: %+v", a.ID, tag, needy)
				}
				return
			}
		}
	}
	t.Fatal("no archetype buys any material")
}

// TestStanding follows GDD 5.4's bands.
func TestStanding(t *testing.T) {
	v, _ := values(t)
	for _, c := range []struct {
		standing, price int64
		buys            bool
	}{{-100, 0, false}, {-50, 0, false}, {-49, -3, true}, {0, 0, true}, {10, 6, true}, {49, 6, true}, {50, 10, true}, {100, 10, true}} {
		if p, ok := v.Standing(c.standing); p != c.price || ok != c.buys {
			t.Fatalf("at %d standing: %d%%, buys %v", c.standing, p, ok)
		}
	}
}
