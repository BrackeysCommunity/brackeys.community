package item

import (
	"slices"
	"strings"

	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
	"jams.team/mmo-world/sim/tally"
)

// Count and Tally live in sim/tally; an item's record is one.
type (
	Count = tally.Count
	Tally = tally.Tally
)

// Instance is one item a character holds: a kind, plus what this one has
// lived through. Level, picks and record stay with it when it is sold.
type Instance struct {
	ID            string   `json:"id"`
	Kind          string   `json:"kind"`
	Level         int64    `json:"level"`
	XP            int64    `json:"xp"` // toward the next level
	Durability    int64    `json:"durability"`
	MaxDurability int64    `json:"maxDurability"`
	Picks         []string `json:"picks"`
	// Offers are a reached milestone's two offers, fixed when reached.
	Offers []string `json:"offers,omitempty"`
	// Waiting are milestones reached while another's offers stood, in
	// order; each is offered once the one before is picked.
	Waiting []int64 `json:"waiting,omitempty"`
	Dormant bool    `json:"dormant,omitempty"`
	Maker   string  `json:"maker,omitempty"`
	Record  Tally   `json:"record"`
	// Mount names a mounts.kinds row when the instance is a mount.
	Mount string `json:"mount,omitempty"`
	// Exploit is the exploit instance a deck holds.
	Exploit *Instance `json:"exploit,omitempty"`
	// Pattern names the kind a written pattern teaches.
	Pattern string `json:"pattern,omitempty"`
	Staged  bool   `json:"staged,omitempty"`
}

// NewInstance is a freshly made item at level 1, whole.
func NewInstance(id string, k *Kind, maker string) *Instance {
	return &Instance{ID: id, Kind: k.ID, Level: 1, Durability: k.Durability, MaxDurability: k.Durability, Maker: maker, Picks: []string{}}
}

// Traits are the kind's traits and those picked at milestones.
func (in *Instance) Traits(k *Kind, d *Deriver) []string {
	out := slices.Clone(k.Traits)
	for _, p := range in.Picks {
		if d.traits[p] != nil && !slices.Contains(out, p) {
			out = append(out, p)
		}
	}
	return out
}

// Tags are the kind's tags plus picked traits' tags.
func (in *Instance) Tags(k *Kind, d *Deriver) []tags.Tag {
	out := slices.Clone(k.Tags)
	for _, p := range in.Picks {
		if tr := d.traits[p]; tr != nil && !slices.Contains(out, tags.Tag(tr.Tag)) {
			out = append(out, tags.Tag(tr.Tag))
		}
	}
	slices.Sort(out)
	return out
}

// Usable: not dormant and not worn to nothing.
func (in *Instance) Usable() bool { return !in.Dormant && (in.MaxDurability == 0 || in.Durability > 0) }

// Broken: worn to nothing with no pick to keep it, so gone.
func (in *Instance) Broken() bool { return in.MaxDurability > 0 && !in.Dormant && in.Durability == 0 }

// Wear is what using an item does to it.
type Wear int

const (
	Worn        Wear = iota // still usable
	Broke                   // gone; salvage left
	WentDormant             // unusable until repaired, never destroyed
)

// Use spends durability. At 0 an item with no milestone pick yet breaks;
// one that has taken a pick goes dormant (GDD 9.11). Broke is reported
// once, on the use that breaks it.
func (in *Instance) Use(n int64) Wear {
	if in.MaxDurability == 0 || in.Dormant || n <= 0 || in.Durability == 0 {
		return Worn
	}
	in.Durability = max(0, in.Durability-n)
	if in.Durability > 0 {
		return Worn
	}
	if len(in.Picks) > 0 {
		in.Dormant = true
		return WentDormant
	}
	return Broke
}

// Spoil is a quantity of one material.
type Spoil struct {
	Material string `json:"material"`
	Qty      int64  `json:"qty"`
}

// AddSpoil adds n of a material to a list, merging with its line; n of 0
// or less adds nothing.
func AddSpoil(list []Spoil, material string, n int64) []Spoil {
	if n <= 0 {
		return list
	}
	for i := range list {
		if list[i].Material == material {
			list[i].Qty += n
			return list
		}
	}
	return append(list, Spoil{Material: material, Qty: n})
}

// Total is a list's whole quantity.
func Total(ss []Spoil) int64 {
	var n int64
	for _, s := range ss {
		n += s.Qty
	}
	return n
}

// Materials is what a kind is made of, in base materials, per unit made.
func (d *Deriver) Materials(id string) []Spoil {
	var out []Spoil
	var walk func(id string, qty int64)
	walk = func(id string, qty int64) {
		if _, ok := d.materials[id]; ok {
			i := slices.IndexFunc(out, func(s Spoil) bool { return s.Material == id })
			if i < 0 {
				out = append(out, Spoil{Material: id})
				i = len(out) - 1
			}
			out[i].Qty += qty
			return
		}
		k, ok := d.Reg.Kind(id)
		if !ok {
			return
		}
		for _, in := range k.Recipe.Inputs {
			walk(in.Kind, qty*in.Qty)
		}
	}
	walk(id, 1)
	slices.SortFunc(out, func(a, b Spoil) int { return strings.Compare(a.Material, b.Material) })
	return out
}

// Salvage is a share of what a recipe's inputs are made of, in base
// materials, each rounded.
func (d *Deriver) Salvage(inputs []Input, share int64) []Spoil {
	var all []Spoil
	for _, in := range inputs {
		for _, s := range d.Materials(in.Kind) {
			all = AddSpoil(all, s.Material, s.Qty*in.Qty)
		}
	}
	slices.SortFunc(all, func(a, b Spoil) int { return strings.Compare(a.Material, b.Material) })
	var out []Spoil
	for _, s := range all {
		if n := fixed.PercentOf(s.Qty, share); n > 0 {
			out = append(out, Spoil{Material: s.Material, Qty: n})
		}
	}
	return out
}

// TopInput is the highest-tier input of a kind's own recipe, by its
// base tier; ties go to the first in recipe order.
func (d *Deriver) TopInput(k *Kind) string {
	best, bestTier := "", int64(-1)
	for _, in := range k.Recipe.Inputs {
		var t int64
		if mt, ok := d.Material(in.Kind); ok {
			t = mt
		} else if ik, ok := d.Reg.Kind(in.Kind); ok {
			t = ik.Tier
		}
		if t > bestTier {
			best, bestTier = in.Kind, t
		}
	}
	return best
}

// RepairCost is the units of the kind's top input that bring an item back
// to its maximum: one unit per share of the maximum restored, rounded up.
func RepairCost(in *Instance, wear []sheets.Param) int64 {
	missing := in.MaxDurability - in.Durability
	if missing <= 0 {
		return 0
	}
	per := max(1, fixed.PercentOf(in.MaxDurability, sheets.IntParam(wear, "repair-share-per-unit")))
	return (missing + per - 1) / per
}

// Repair restores an item to its maximum; a dormant one wakes.
func (in *Instance) Repair() {
	in.Durability = in.MaxDurability
	in.Dormant = false
}
