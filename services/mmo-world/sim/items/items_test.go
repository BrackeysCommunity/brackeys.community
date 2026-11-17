package items_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/harness"
	"jams.team/mmo-world/sim/items"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/tags"
)

func deriver(t *testing.T) *items.Deriver {
	t.Helper()
	b, err := harness.LoadBook(harness.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	return items.NewDeriver(b, keys.Throwaway("items-test").Quirk)
}

// The Copperleaf blade of GDD 9.6, without its quirk.
func TestCopperleaf(t *testing.T) {
	d := deriver(t)
	d.SkipQuirk = true
	alloy, err := d.Derive(items.Recipe{Process: "alloy", Method: "slow-cool", Inputs: []items.Input{
		{Kind: "copper-ore", Qty: 2}, {Kind: "bog-iron", Qty: 1},
	}}, 2)
	if err != nil {
		t.Fatal(err)
	}
	// edge, weight, flex, conduct, heat, ward, reach, bond
	if want := (items.Vec{13, 15, 0, 26, 0, 0, 0, 0}); !slices.Equal(alloy.Vec, want) || alloy.Tier != 2 {
		t.Fatalf("alloy %v tier %d", alloy.Vec, alloy.Tier)
	}
	// Narrow grind: the template gives Edge 34, Weight 20, Conduct 48 pts
	// (GDD 9.6's 102 pts), then Edge +10% and Weight -10%.
	blade, err := d.Derive(items.Recipe{Process: "shape", Method: "narrow-grind", Slot: "blade",
		Inputs: []items.Input{{Kind: alloy.ID, Qty: 1}}}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if want := (items.Vec{37, 18, 0, 48, 0, 0, 0, 0}); !slices.Equal(blade.Vec, want) || blade.Trimmed != 0 {
		t.Fatalf("blade %v (%d pts, %d trimmed)", blade.Vec, blade.Vec.Total(), blade.Trimmed)
	}
	for _, tag := range []tags.Tag{"metal", "conductive", "blade", "item"} {
		if !slices.Contains(blade.Tags, tag) {
			t.Errorf("blade lacks %s: %v", tag, blade.Tags)
		}
	}
}

func TestKindIDIgnoresInputOrder(t *testing.T) {
	a := items.KindID(items.Recipe{Process: "alloy", Method: "fold", Inputs: []items.Input{{"a", 1}, {"b", 2}}})
	b := items.KindID(items.Recipe{Process: "alloy", Method: "fold", Inputs: []items.Input{{"b", 2}, {"a", 1}}})
	c := items.KindID(items.Recipe{Process: "alloy", Method: "fold", Inputs: []items.Input{{"b", 1}, {"a", 2}}})
	if a != b || a == c || len(a) != 32 {
		t.Fatal(a, b, c)
	}
}

func TestQuirkIsKeyed(t *testing.T) {
	r := items.Recipe{Process: "alloy", Method: "quench", Inputs: []items.Input{{Kind: "timber", Qty: 3}, {Kind: "reedflax", Qty: 1}}}
	b, _ := harness.LoadBook(harness.ModuleRoot())
	var shifts []int64
	for i := range 50 {
		label := string(rune('A' + i))
		k, err := items.NewDeriver(b, keys.Throwaway(label).Quirk).Derive(r, 2)
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
	if _, err := d.Derive(items.Recipe{Process: "alloy", Method: "fold", Inputs: []items.Input{{Kind: "saltglass", Qty: 2}}}, 4); err == nil {
		t.Fatal("one material alloyed alone was accepted")
	}
	first, err := d.Derive(items.Recipe{Process: "alloy", Method: "fold", Inputs: []items.Input{
		{Kind: "copper-ore", Qty: 1}, {Kind: "bog-iron", Qty: 1},
	}}, 4)
	if err != nil {
		t.Fatal(err)
	}
	again, err := d.Derive(items.Recipe{Process: "alloy", Method: "fold", Inputs: []items.Input{
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
	plain, err := d.Derive(items.Recipe{Process: "bind", Method: "lash", Inputs: []items.Input{
		{Kind: "stormglass", Qty: 1}, {Kind: "chips", Qty: 1},
	}}, 4)
	if err != nil {
		t.Fatal(err)
	}
	if slices.Contains(plain.Traits, "arcing") {
		t.Fatalf("resonated below the threshold: %v", plain.Traits)
	}
}
