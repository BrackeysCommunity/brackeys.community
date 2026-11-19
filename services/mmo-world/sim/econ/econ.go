// Package econ is coin for the solo loop: reference values (GDD 10.10),
// the faction buy orders each starting settlement posts at them, and the
// fees the loop pays. MM5's books and stabiliser build on these values.
package econ

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/sheets"
)

// Values prices materials and kinds in coin.
type Values struct {
	ref       map[int64]sheets.RefValue
	materials map[string]*sheets.Material
	sorted    []sheets.Material
	params    []sheets.Param
	archs     []sheets.Archetype
}

func New(b *sheets.Book) *Values {
	v := &Values{ref: map[int64]sheets.RefValue{}, materials: sheets.Lookup(b.Materials), params: b.EconomyParams, archs: b.Archetypes}
	v.sorted = slices.Clone(b.Materials)
	slices.SortFunc(v.sorted, func(a, b sheets.Material) int { return cmp.Compare(a.ID, b.ID) })
	for _, r := range b.RefValues {
		v.ref[r.Tier] = r
	}
	return v
}

// Param is an economy.params cell.
func (v *Values) Param(id string) int64 { return sheets.IntParam(v.params, id) }

// Material is a material's reference value: its tier's base, scaled by its
// vector total against the tier's median, rounded half away. Never under 1.
func (v *Values) Material(id string) int64 {
	m, ok := v.materials[id]
	if !ok {
		return 0
	}
	r, ok := v.ref[m.Tier]
	if !ok {
		return 0
	}
	var total int64
	for _, x := range m.Vector.Slice() {
		total += x
	}
	return max(1, fixed.Ratio(r.Base*total, r.Median).Int())
}

// Kind is a made kind's value: its inputs, plus the step markup a
// process in its ancestry.
func (v *Values) Kind(reg item.Registry, k *item.Kind) int64 {
	var sum int64
	for _, in := range k.Recipe.Inputs {
		if x, ok := reg.Kind(in.Kind); ok {
			sum += in.Qty * v.Kind(reg, x)
		} else {
			sum += in.Qty * v.Material(in.Kind)
		}
	}
	return fixed.PercentPlus(sum, v.Param("step-markup"))
}

// Order is a standing faction buy order at a settlement.
type Order struct {
	Faction  int    `json:"faction"` // index in the world's factions
	Material string `json:"material"`
	Price    int64  `json:"price"` // coin each
}

// Provisions is the asset id an order for provisions names.
const Provisions = "provisions"

// Keepers is the Faction of an order the settlement's own keepers post.
const Keepers = -1

// Orders are the buy orders a starting settlement holds: for each
// material, the first faction (in world order) whose archetype buys one of
// its tags, at its reference value, else the settlement's keepers, so a
// new character can always sell a haul; provisions from the first faction
// that buys them. factions are the world's factions' archetype ids.
func (v *Values) Orders(factions []string) []Order {
	var out []Order
	buys := func(arch, tag string) bool {
		for _, a := range v.archs {
			if a.ID == arch {
				return slices.Contains(a.Buys, tag)
			}
		}
		return false
	}
	for _, m := range v.sorted {
		o := Order{Faction: Keepers, Material: m.ID, Price: v.Material(m.ID)}
		for fi, arch := range factions {
			if slices.ContainsFunc(m.Tags, func(t string) bool { return buys(arch, t) }) {
				o.Faction = fi
				break
			}
		}
		out = append(out, o)
	}
	for fi, arch := range factions {
		if buys(arch, Provisions) {
			out = append(out, Order{Faction: fi, Material: Provisions, Price: v.Param("provisions-value")})
			break
		}
	}
	return out
}

// Fee is a faction order's fee on a fill, rounded down.
func (v *Values) Fee(coin int64) int64 { return fixed.PercentFloor(coin, v.Param("fill-fee")) }
