package game

import (
	"strings"
	"testing"

	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/sheets"
)

func TestMaterialName(t *testing.T) {
	g := feedGame(t)
	hide := g.MaterialName("stalker-hide")
	if hide == "" || hide != g.r.Name("items.materials:stalker-hide") {
		t.Fatalf("a sheet material reads %q", hide)
	}
	id := emerge.MaterialID("plated", "stalker-hide")
	if !g.foundMaterial(sheets.Material{ID: id, Tier: 2}) {
		t.Fatal("the found material was not registered")
	}
	if got, want := g.MaterialName(id), "a new material made of "+strings.ToLower(hide); got != want {
		t.Fatalf("an unpromoted found material reads %q, want %q", got, want)
	}
	g.Emergence.Promotions = append(g.Emergence.Promotions, emerge.Promotion{ID: "p-test", Type: emerge.Material, Name: "Plated Hide", Of: id, Region: -1})
	if got := g.MaterialName(id); got != "Plated Hide" {
		t.Fatalf("a promoted found material reads %q", got)
	}
	g.Emergence.Promotions[len(g.Emergence.Promotions)-1].Named = "Mira's Hide"
	if got := g.MaterialName(id); got != "Mira's Hide" {
		t.Fatalf("a renamed found material reads %q", got)
	}
	if got := g.MaterialName("no-such"); got != "" {
		t.Fatalf("an unknown material reads %q", got)
	}
}

func TestPlainNameKeepsSheetName(t *testing.T) {
	g := feedGame(t)
	id := emerge.MaterialID("plated", "stalker-hide")
	if !g.foundMaterial(sheets.Material{ID: id, Tier: 2}) {
		t.Fatal("the found material was not registered")
	}
	rc := item.Recipe{Process: "shape", Slot: "blade", Inputs: []item.Input{{Kind: id, Qty: 1}}}
	before := g.plainName(rc)
	if strings.Contains(before, "a new material") {
		t.Fatalf("an unpromoted found material names a kind %q", before)
	}
	g.Emergence.Promotions = append(g.Emergence.Promotions, emerge.Promotion{ID: "p-test", Type: emerge.Material, Name: "Plated Hide", Of: id, Region: -1})
	if after := g.plainName(rc); after != before || strings.Contains(after, "Plated Hide") {
		t.Fatalf("a promotion moved a frozen kind name from %q to %q", before, after)
	}
}
