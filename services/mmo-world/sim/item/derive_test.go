package item_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/tags"
)

func deriver(t *testing.T) *item.Deriver {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	return item.NewDeriver(b, keys.Throwaway("items-test").Quirk)
}

// The Copperleaf blade of GDD 9.6, without its quirk.
func TestCopperleaf(t *testing.T) {
	d := deriver(t)
	d.SkipQuirk = true
	alloy, err := d.Derive(item.Recipe{Process: "alloy", Method: "slow-cool", Inputs: []item.Input{
		{Kind: "copper-ore", Qty: 2}, {Kind: "bog-iron", Qty: 1},
	}}, 2)
	if err != nil {
		t.Fatal(err)
	}
	// edge, weight, flex, conduct, heat, ward, reach, bond
	if want := (item.Vec{13, 15, 0, 26, 0, 0, 0, 0}); !slices.Equal(alloy.Vec, want) || alloy.Tier != 2 {
		t.Fatalf("alloy %v tier %d", alloy.Vec, alloy.Tier)
	}
	// Narrow grind: the template gives Edge 34, Weight 20, Conduct 48 pts
	// (GDD 9.6's 102 pts), then Edge +10% and Weight -10%.
	blade, err := d.Derive(item.Recipe{Process: "shape", Method: "narrow-grind", Slot: "blade",
		Inputs: []item.Input{{Kind: alloy.ID, Qty: 1}}}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if want := (item.Vec{37, 18, 0, 48, 0, 0, 0, 0}); !slices.Equal(blade.Vec, want) || blade.Trimmed != 0 {
		t.Fatalf("blade %v (%d pts, %d trimmed)", blade.Vec, blade.Vec.Total(), blade.Trimmed)
	}
	for _, tag := range []tags.Tag{"metal", "conductive", "blade", "item"} {
		if !slices.Contains(blade.Tags, tag) {
			t.Errorf("blade lacks %s: %v", tag, blade.Tags)
		}
	}
}

func TestKindIDIgnoresInputOrder(t *testing.T) {
	a := item.KindID(item.Recipe{Process: "alloy", Method: "fold", Inputs: []item.Input{{"a", 1}, {"b", 2}}})
	b := item.KindID(item.Recipe{Process: "alloy", Method: "fold", Inputs: []item.Input{{"b", 2}, {"a", 1}}})
	c := item.KindID(item.Recipe{Process: "alloy", Method: "fold", Inputs: []item.Input{{"b", 1}, {"a", 2}}})
	if a != b || a == c || len(a) != 32 {
		t.Fatal(a, b, c)
	}
}

func TestQuirkIsKeyed(t *testing.T) {
	r := item.Recipe{Process: "alloy", Method: "quench", Inputs: []item.Input{{Kind: "timber", Qty: 3}, {Kind: "reedflax", Qty: 1}}}
	b, _ := sheetfs.LoadBook(sheetfs.ModuleRoot())
	var shifts []int64
	for i := range 50 {
		label := string(rune('A' + i))
		k, err := item.NewDeriver(b, keys.Throwaway(label).Quirk).Derive(r, 2)
		if err != nil {
			t.Fatal(err)
		}
		shifts = append(shifts, int64(k.QuirkAxis)*100+k.QuirkShift)
	}
	slices.Sort(shifts)
	if len(slices.Compact(shifts)) < 10 {
		t.Fatalf("the quirk barely depends on the key: %v", shifts)
	}
}

func TestAlloyRules(t *testing.T) {
	d := deriver(t)
	d.SkipQuirk = true
	if _, err := d.Derive(item.Recipe{Process: "alloy", Method: "fold", Inputs: []item.Input{{Kind: "saltglass", Qty: 2}}}, 4); err == nil {
		t.Fatal("one material alloyed alone was accepted")
	}
	first, err := d.Derive(item.Recipe{Process: "alloy", Method: "fold", Inputs: []item.Input{
		{Kind: "copper-ore", Qty: 1}, {Kind: "bog-iron", Qty: 1},
	}}, 4)
	if err != nil {
		t.Fatal(err)
	}
	again, err := d.Derive(item.Recipe{Process: "alloy", Method: "fold", Inputs: []item.Input{
		{Kind: first.ID, Qty: 1}, {Kind: "timber", Qty: 1},
	}}, 4)
	if err != nil {
		t.Fatal(err)
	}
	if first.Tier != 2 || again.Tier != 2 {
		t.Fatalf("re-alloying climbed: tier %d then %d", first.Tier, again.Tier)
	}
	if want := []string{"alloy", "alloy"}; !slices.Equal(again.Steps, want) {
		t.Fatalf("steps %v", again.Steps)
	}
}

func TestResonance(t *testing.T) {
	d := deriver(t)
	d.SkipQuirk = true
	// Stormglass (Conduct 40, Reach 26) and chips (Conduct 30, Reach 22)
	// share both axes but neither holds 35 pts on both.
	plain, err := d.Derive(item.Recipe{Process: "bind", Method: "lash", Inputs: []item.Input{
		{Kind: "stormglass", Qty: 1}, {Kind: "chips", Qty: 1},
	}}, 4)
	if err != nil {
		t.Fatal(err)
	}
	if slices.Contains(plain.Traits, "arcing") {
		t.Fatalf("resonated below the threshold: %v", plain.Traits)
	}
}

func TestKindIDKeepsCarrierFirst(t *testing.T) {
	a := item.KindID(item.Recipe{Process: "infuse", Method: "steep", Inputs: []item.Input{{"a", 1}, {"b", 1}}})
	b := item.KindID(item.Recipe{Process: "infuse", Method: "steep", Inputs: []item.Input{{"b", 1}, {"a", 1}}})
	if a == b {
		t.Fatal("an infuse's carrier and minor input swapped to the same kind")
	}
	x := item.KindID(item.Recipe{Process: "alloy", Method: "fold", Inputs: []item.Input{{"a", 1}, {"a", 2}}})
	y := item.KindID(item.Recipe{Process: "alloy", Method: "fold", Inputs: []item.Input{{"a", 2}, {"a", 1}}})
	if x != y {
		t.Fatal("an alloy's repeated input changed its kind by order")
	}
}

func TestAtSetsCapOnlyForAHeldAlloy(t *testing.T) {
	d := deriver(t)
	smelt := item.Recipe{Process: "alloy", Method: "slow-cool", Inputs: []item.Input{{Kind: "copper-ore", Qty: 2}, {Kind: "bog-iron", Qty: 1}}}
	low, high := d.At(smelt, 1), d.At(smelt, 4)
	if low.Cap == 0 || high.Cap != 0 || item.KindID(low) == item.KindID(high) {
		t.Fatalf("low %+v high %+v", low, high)
	}
	if stale := d.At(low, 4); item.KindID(stale) != item.KindID(high) {
		t.Fatalf("a stale cap survived a better station: %+v", stale)
	}
	shape := item.Recipe{Process: "shape", Method: "narrow-grind", Slot: "blade", Inputs: []item.Input{{Kind: "copper-ore", Qty: 1}}}
	capped := shape
	capped.Cap = 1
	if item.KindID(d.At(capped, 2)) != item.KindID(d.At(shape, 2)) {
		t.Fatal("a cap on a shape made a kind of its own")
	}
}

func TestBindTailOrderGivesOneKind(t *testing.T) {
	derive := func(tail ...string) *item.Kind {
		d := deriver(t)
		d.SkipQuirk = true
		part := func(id, trait string) {
			d.Reg.Freeze(&item.Kind{ID: id, KindProps: item.KindProps{Tier: 2, BaseTier: 2, Slot: "blade", Vec: item.Vec{20, 10, 0, 0, 0, 0, 0, 0},
				Durability: 40, Traits: []string{trait}, Tags: []tags.Tag{"item"}}})
		}
		part("carrier", "tempered")
		part("tail-a", "dense")
		part("tail-b", "springy")
		in := []item.Input{{Kind: "carrier", Qty: 1}}
		for _, id := range tail {
			in = append(in, item.Input{Kind: id, Qty: 1})
		}
		k, err := d.Derive(item.Recipe{Process: "bind", Method: "lash", Inputs: in}, 2)
		if err != nil {
			t.Fatal(err)
		}
		return k
	}
	a, b := derive("tail-a", "tail-b"), derive("tail-b", "tail-a")
	if a.ID != b.ID || !slices.Equal(a.Traits, b.Traits) || !slices.Equal(a.Vec, b.Vec) {
		t.Fatalf("%s %v %v / %s %v %v", a.ID, a.Traits, a.Vec, b.ID, b.Traits, b.Vec)
	}
}
