package item_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

// GDD 9.3's plated hide: the stalker's hide with ward doubled and flex
// two lower, one tier up.
func platedHide() sheets.Material {
	return sheets.Material{ID: "found.plated.stalker-hide", Tier: 2, Tags: []string{"hide", "plated"},
		Vector: sheets.Vector{Flex: 16, Ward: 52}}
}

func TestFoundRegistry(t *testing.T) {
	var none *item.Found
	if _, ok := none.Get("x"); ok || none.List() != nil {
		t.Fatal("a nil registry holds something")
	}
	f := &item.Found{}
	b := sheets.Material{ID: "found.b", Tier: 1}
	if !f.Add(b) || !f.Add(platedHide()) {
		t.Fatal("a new material was refused")
	}
	if f.Add(sheets.Material{ID: "found.b", Tier: 3}) {
		t.Fatal("a material was added twice")
	}
	if m, _ := f.Get("found.b"); m.Tier != 1 {
		t.Fatal("a second add changed the first")
	}
	ids := []string{}
	for _, m := range f.List() {
		ids = append(ids, m.ID)
	}
	if !slices.Equal(ids, []string{"found.b", "found.plated.stalker-hide"}) {
		t.Fatalf("listed %v", ids)
	}
}

// A found material is a base material once registered: it resolves in a
// recipe, carries its tags through, and comes back on salvage.
func TestFoundMaterialResolvesAndSalvages(t *testing.T) {
	d := deriver(t)
	d.SkipQuirk = true
	m := platedHide()
	r := item.Recipe{Process: "shape", Method: "broad-grind", Slot: "plate", Inputs: []item.Input{{Kind: m.ID, Qty: 2}}}
	if _, err := d.Derive(r, 2); err == nil {
		t.Fatal("an unregistered material resolved")
	}
	if _, ok := d.Material(m.ID); ok {
		t.Fatal("an unregistered material is a material")
	}
	d.Found = &item.Found{}
	d.Found.Add(m)
	if tier, ok := d.Material(m.ID); !ok || tier != 2 {
		t.Fatalf("found material tier %d, %v", tier, ok)
	}
	k, err := d.Derive(r, 2)
	if err != nil {
		t.Fatal(err)
	}
	if k.Tier != 2 || k.BaseTier != 2 || !slices.Contains(k.Tags, tags.Tag("plated")) || !slices.Contains(k.Tags, tags.Tag("hide")) {
		t.Fatalf("plate tier %d base %d tags %v", k.Tier, k.BaseTier, k.Tags)
	}
	if got := d.Materials(k.ID); !slices.Equal(got, []item.Spoil{{Material: m.ID, Qty: 2}}) {
		t.Fatalf("made of %v", got)
	}
	if got := d.Salvage([]item.Input{{Kind: k.ID, Qty: 1}}, 50); !slices.Equal(got, []item.Spoil{{Material: m.ID, Qty: 1}}) {
		t.Fatalf("salvaged %v", got)
	}
	if d.TopInput(k) != m.ID {
		t.Fatal("repair does not take the found material")
	}
}

// The sheet's row always wins over a found one of the same id.
func TestSheetMaterialBeforeFound(t *testing.T) {
	d := deriver(t)
	d.Found = &item.Found{}
	d.Found.Add(sheets.Material{ID: "stalker-hide", Tier: 4})
	if tier, _ := d.Material("stalker-hide"); tier != 1 {
		t.Fatalf("stalker-hide tier %d", tier)
	}
}
