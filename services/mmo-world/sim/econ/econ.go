// Package econ prices things in coin: reference values (GDD 10.10), what
// each settlement's buyers want and pay by urgency and standing (GDD 10.4,
// 5.4), and the fees.
package econ

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

// Values prices materials and kinds in coin.
type Values struct {
	ref       map[int64]sheets.RefValue
	materials map[string]*sheets.Material
	sorted    []sheets.Material
	params    []sheets.Param
	archs     map[string]*sheets.Archetype
	standing  []sheets.StandingBand // by From, lowest first
	// Found prices the materials the world made in play by their tier,
	// where the sheet has no row.
	Found *item.Found
}

func New(b *sheets.Book) *Values {
	v := &Values{ref: map[int64]sheets.RefValue{}, materials: sheets.Lookup(b.Materials), params: b.EconomyParams, archs: sheets.Lookup(b.Archetypes)}
	v.sorted = slices.Clone(b.Materials)
	slices.SortFunc(v.sorted, func(a, b sheets.Material) int { return cmp.Compare(a.ID, b.ID) })
	v.standing = slices.Clone(b.Standing)
	slices.SortFunc(v.standing, func(a, b sheets.StandingBand) int { return cmp.Compare(a.From, b.From) })
	for _, r := range b.RefValues {
		v.ref[r.Tier] = r
	}
	return v
}

// Archetype is a faction archetype's row, or nil.
func (v *Values) Archetype(id string) *sheets.Archetype { return v.archs[id] }

// Param is an economy.params cell.
func (v *Values) Param(id string) int64 { return sheets.IntParam(v.params, id) }

// Material is a material's reference value: its tier's base, scaled by its
// vector total against the tier's median, rounded half away. Never under 1.
func (v *Values) Material(id string) int64 {
	m, ok := v.material(id)
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

func (v *Values) material(id string) (sheets.Material, bool) {
	if m, ok := v.materials[id]; ok {
		return *m, true
	}
	return v.Found.Get(id)
}

// Kind is a made kind's value: its inputs' values plus step-markup,
// compounding once per process in its ancestry.
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

// Keepers is the buyer of what no faction at a settlement wants: its own
// keepers, so a new character can always sell a haul.
const Keepers = -1

// Buyer is a faction as its orders see it. Full is the need at which a
// tag is most urgent; a Gone faction buys nothing.
type Buyer struct {
	Archetype string
	Needs     map[string]int64
	Full      int64
	AtWar     bool
	Gone      bool
}

// Want is one material a buyer at a settlement wants, at a price each,
// with the urgency that weighs its share of the budget.
type Want struct {
	Material string
	Buyer    int   // a faction index, or Keepers
	Urgency  int64 // percent, 100 for no special need
	Price    int64
}

// Wants are a settlement's buy orders for the world day (GDD 10.4): each
// material from the faction that wants it most (first on a tie) or else
// the keepers, provisions from the first faction that buys them, each
// priced at reference value times urgency. Found materials follow the
// sheet's.
func (v *Values) Wants(buyers []Buyer) []Want {
	var out []Want
	for _, m := range append(slices.Clip(v.sorted), v.Found.List()...) {
		w := Want{Material: m.ID, Buyer: Keepers, Urgency: fixed.Hundredths}
		for fi, b := range buyers {
			if u, ok := v.urgency(b, m.Tags); ok && (w.Buyer == Keepers || u > w.Urgency) {
				w.Buyer, w.Urgency = fi, u
			}
		}
		w.Price = fixed.PercentOf(v.Material(m.ID), w.Urgency)
		out = append(out, w)
	}
	for fi, b := range buyers {
		if u, ok := v.urgency(b, []string{ledger.Provisions}); ok {
			out = append(out, Want{Material: ledger.Provisions, Buyer: fi, Urgency: u, Price: fixed.PercentOf(v.Asset(ledger.Provisions), u)})
			break
		}
	}
	return out
}

// urgency is how badly a buyer wants something with these tags, in
// percent of reference, or false if it buys none of them.
func (v *Values) urgency(b Buyer, tagList []string) (int64, bool) {
	a, ok := v.archs[b.Archetype]
	if !ok || b.Gone {
		return 0, false
	}
	best, buys := int64(0), false
	for _, t := range tagList {
		if !slices.Contains(a.Buys, t) {
			continue
		}
		buys = true
		u := int64(fixed.Hundredths)
		if b.Full > 0 {
			u += (v.Param("urgency-max") - fixed.Hundredths) * min(b.Needs[t], b.Full) / b.Full
		}
		if b.AtWar && t == tagBlade {
			u += v.Param("war-urgency")
		}
		best = max(best, min(u, v.Param("urgency-max")))
	}
	return best, buys
}

// structural: a faction at war wants blades (GDD 10.4).
const tagBlade = "blade"

// Standing is what a character's standing with a faction does to its
// orders: the per cent added to the price, or false where it will not buy.
func (v *Values) Standing(standing int64) (price int64, buys bool) {
	buys = true
	for _, b := range v.standing {
		if standing >= b.From {
			price, buys = b.Price, !b.Refuses
		}
	}
	return price, buys
}

// Fee is the fee on a fill, from the seller, rounded up so splitting a
// sale never pays less than making it whole.
func (v *Values) Fee(coin int64) int64 { return fixed.PercentCeil(coin, v.FeePercent()) }

// FeePercent is the fee as a percent of the fill.
func (v *Values) FeePercent() int64 { return v.Param("fill-fee") }

// GoalFee is a goal's listing fee (GDD 10.2): a share of its reward,
// rounded up, and never under the least fee.
func (v *Values) GoalFee(reward int64) int64 {
	return max(v.Param("goal-fee-min"), fixed.PercentCeil(reward, v.Param("goal-fee")))
}

// Asset is a tradable asset's reference value each: provisions', or a
// material's.
func (v *Values) Asset(material string) int64 {
	if material == ledger.Provisions {
		return v.Param("provisions-value")
	}
	return v.Material(material)
}
