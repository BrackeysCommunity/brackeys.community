// Package econ prices things in coin: reference values (GDD 10.10), what
// each settlement's buyers want and pay by urgency and standing (GDD 10.4,
// 5.4), and the fees.
package econ

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/faucet"
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

// Buyer is a faction as its orders see it: its archetype, what it needs by
// tag, the need at which a tag is most urgent, and whether it is at war.
type Buyer struct {
	Archetype string
	Needs     map[string]int64
	Full      int64
	AtWar     bool
	Gone      bool
}

// Wants are what a settlement's buyers order each world day (GDD 10.4):
// every material, from the faction that wants it most urgently (the first
// in world order on a tie), else the keepers, and provisions from the
// first faction that buys them; each at its reference value times its
// urgency.
func (v *Values) Wants(buyers []Buyer) []faucet.Want {
	var out []faucet.Want
	for _, m := range v.sorted {
		w := faucet.Want{Material: m.ID, Buyer: Keepers, Urgency: hundred}
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
			out = append(out, faucet.Want{Material: ledger.Provisions, Buyer: fi, Urgency: u, Price: fixed.PercentOf(v.Param("provisions-value"), u)})
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
		u := int64(hundred)
		if b.Full > 0 {
			u += (v.Param("urgency-max") - hundred) * min(b.Needs[t], b.Full) / b.Full
		}
		if b.AtWar && t == tagBlade {
			u += v.Param("war-urgency")
		}
		best = max(best, min(u, v.Param("urgency-max")))
	}
	return best, buys
}

// structural: urgency is in percent of reference; a faction at war wants
// blades (GDD 10.4).
const (
	hundred  = 100
	tagBlade = "blade"
)

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

// Fee is a faction order's fee on a fill, rounded up so splitting a sale
// never pays less than making it whole.
func (v *Values) Fee(coin int64) int64 { return -fixed.PercentFloor(-coin, v.FeePercent()) }

// FeePercent is a faction order's fee, as a percent of the fill.
func (v *Values) FeePercent() int64 { return v.Param("fill-fee") }

// GoalFee is a goal's listing fee (GDD 10.2): a share of its reward,
// rounded up, and never under the least fee. Goals post it from MM6.
func (v *Values) GoalFee(reward int64) int64 {
	return max(v.Param("goal-fee-min"), -fixed.PercentFloor(-reward, v.Param("goal-fee")))
}
