// Package craft is making things at a station: appraisal before a craft,
// the craft itself, first makers, failures, salvage and patterns
// (GDD 9.10, 9.14).
package craft

import (
	"fmt"
	"slices"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/sheets"
)

// structural: a percentage is hundredths.
const (
	percent = 100
	half    = 2
)

// Crafter makes things. The roll key draws appraisal offsets and
// maturity savings; nothing it draws can be computed without it.
type Crafter struct {
	d        *item.Deriver
	g        *item.Growth
	params   []sheets.Param
	weights  map[string]int64
	stations map[string][]string
	roll     *draw.Drawer
}

func New(b *sheets.Book, d *item.Deriver, g *item.Growth, rollKey draw.Key) *Crafter {
	c := &Crafter{d: d, g: g, params: b.ItemParams, weights: map[string]int64{}, stations: map[string][]string{}, roll: draw.NewDrawer(rollKey)}
	for _, w := range b.FactWeights {
		c.weights[w.Kind] = w.Weight
	}
	for _, p := range b.Processes {
		c.stations[p.ID] = p.Stations
	}
	return c
}

func (c *Crafter) param(id string) int64 { return sheets.IntParam(c.params, id) }

// Station is where a craft happens: its kind and tier.
type Station struct {
	Kind string `json:"kind"`
	Tier int64  `json:"tier"`
}

// Ranges is what appraisal shows: a low and high for each axis. The true
// value lies inside, not at the middle. The quirk is never previewed.
type Ranges struct {
	Kind   string   `json:"kind"`
	Tier   int64    `json:"tier"`
	Slot   string   `json:"slot,omitempty"`
	Lo     item.Vec `json:"lo"`
	Hi     item.Vec `json:"hi"`
	Spread fixed.F  `json:"spread"`
	Known  bool     `json:"known"` // already in the registry: shown exact
}

// Spread is the appraisal spread at a practice: the sheet's spread,
// narrowed by a share of itself per practice point, never below none.
func (c *Crafter) Spread(practice int64) fixed.F {
	keep := max(0, percent-practice*c.param("appraisal-narrow"))
	return fixed.Ratio(c.param("appraisal-spread")*keep, percent*percent)
}

// Appraise shows a recipe's ranges to one crafter at one practice. The
// offset inside each range is keyed by crafter and kind, so asking again
// shows the same ranges.
func (c *Crafter) Appraise(r item.Recipe, st Station, practice int64, who string) (Ranges, error) {
	if err := c.at(r, st); err != nil {
		return Ranges{}, err
	}
	id := item.KindID(r)
	if k, ok := c.d.Reg.Kind(id); ok {
		return Ranges{Kind: id, Tier: k.Tier, Slot: k.Slot, Lo: k.Vec, Hi: k.Vec, Known: true}, nil
	}
	skip := c.d.SkipQuirk
	c.d.SkipQuirk = true
	p, err := c.d.Props(r, st.Tier)
	c.d.SkipQuirk = skip
	if err != nil {
		return Ranges{}, err
	}
	spread := c.Spread(practice)
	out := Ranges{Kind: id, Tier: p.Tier, Slot: p.Slot, Lo: make(item.Vec, len(p.Vec)), Hi: make(item.Vec, len(p.Vec)), Spread: spread}
	for a, v := range p.Vec {
		w := spread.Of(v)
		// The true value sits anywhere from the low quarter to the high
		// quarter of its range.
		off := int64(0)
		if w > 0 {
			off = int64(c.roll.Below(uint64(w+1), "appraise.offset", draw.Str(who), draw.Str(id), draw.Int(int64(a)))) - w/half
		}
		out.Lo[a] = max(0, v-w+off)
		out.Hi[a] = v + w + off
	}
	return out, nil
}

func (c *Crafter) at(r item.Recipe, st Station) error {
	if !slices.Contains(c.stations[r.Process], st.Kind) {
		return fmt.Errorf("craft: %s is not done at a %s", r.Process, st.Kind)
	}
	return nil
}

// Result is what a craft did.
type Result struct {
	Kind       *item.Kind     `json:"kind"`
	Instance   *item.Instance `json:"instance,omitempty"`
	Discovered bool           `json:"discovered"`
	Failed     bool           `json:"failed"`
	Consumed   []item.Spoil   `json:"consumed"`
	Saved      []item.Spoil   `json:"saved,omitempty"` // units maturity kept back
	Salvage    []item.Spoil   `json:"salvage,omitempty"`
	ToolXP     int64          `json:"toolXP"`
}

// Order is one craft: who, where, when, and the press that asked.
type Order struct {
	Recipe  item.Recipe
	Station Station
	By      string // character id
	Tick    int64
	Press   string // the interaction id; the craft's identity
}

// Craft makes a recipe. The first time a kind is made it is frozen in
// the registry and its maker recorded. A combination that makes nothing
// useful gives back salvage and is recorded. Maturity keeps some input
// units back, by a keyed draw a unit.
func (c *Crafter) Craft(o Order) (Result, []fact.Fact, error) {
	if err := c.at(o.Recipe, o.Station); err != nil {
		return Result{}, nil, err
	}
	id := item.KindID(o.Recipe)
	_, known := c.d.Reg.Kind(id)
	k, err := c.d.Derive(o.Recipe, o.Station.Tier)
	if err != nil {
		return Result{}, nil, err
	}
	who := fact.Ref{Kind: "character", ID: o.By}
	kindRef := fact.Ref{Kind: "kind", ID: k.ID}
	res := Result{Kind: k, Discovered: !known}
	var facts []fact.Fact
	if !known {
		k.FirstMaker, k.Discovered = o.By, o.Tick
		facts = append(facts, c.fact(o.Tick, "kind.discovered", []fact.Ref{who, kindRef}, fact.N("tier", k.Tier), fact.S("process", o.Recipe.Process)))
	}
	if k.Failed {
		res.Failed = true
		res.Consumed = c.inputs(o.Recipe)
		res.Salvage = c.d.Salvage(o.Recipe.Inputs, c.param("failed-salvage"))
		facts = append(facts, c.fact(o.Tick, "craft.failed", []fact.Ref{who, kindRef}, fact.N("salvage", total(res.Salvage))))
		return res, facts, nil
	}
	discount := c.g.Maturity(c.d.Reg.Crafts(k.ID))
	for _, in := range o.Recipe.Inputs {
		var used, kept int64
		for u := range in.Qty {
			if c.roll.Roll(discount, "craft.maturity", draw.Str(o.Press), draw.Str(in.Kind), draw.Int(u)) {
				kept++
			} else {
				used++
			}
		}
		res.Consumed = addSpoil(res.Consumed, item.Spoil{Material: in.Kind, Qty: used})
		if kept > 0 {
			res.Saved = addSpoil(res.Saved, item.Spoil{Material: in.Kind, Qty: kept})
		}
	}
	c.d.Reg.AddCraft(k.ID)
	if k.Slot != "" || k.Exploit != nil {
		res.Instance = item.NewInstance(o.Press, k, o.By)
	}
	if o.Station.Tier >= k.Tier {
		res.ToolXP = c.g.Deed("craft-at-tier")
	}
	facts = append(facts, c.fact(o.Tick, "craft.made", []fact.Ref{who, kindRef}, fact.N("tier", k.Tier), fact.S("process", o.Recipe.Process)))
	return res, facts, nil
}

// WritePattern writes a known recipe out as a pattern: an item that
// teaches the kind and trades like any other.
func (c *Crafter) WritePattern(kindID, by, press string, tick int64) (*item.Instance, fact.Fact, error) {
	if _, ok := c.d.Reg.Kind(kindID); !ok {
		return nil, fact.Fact{}, fmt.Errorf("craft: no kind %s", kindID)
	}
	in := &item.Instance{ID: press, Pattern: kindID, Level: 1, Maker: by, Picks: []string{}}
	return in, c.fact(tick, "craft.pattern", []fact.Ref{{Kind: "character", ID: by}, {Kind: "kind", ID: kindID}}), nil
}

func (c *Crafter) inputs(r item.Recipe) []item.Spoil {
	var out []item.Spoil
	for _, in := range r.Inputs {
		out = addSpoil(out, item.Spoil{Material: in.Kind, Qty: in.Qty})
	}
	return out
}

func (c *Crafter) fact(tick int64, kind string, subjects []fact.Ref, data ...fact.Datum) fact.Fact {
	return fact.Fact{Tick: tick, Kind: kind, Subjects: subjects, Data: data, Weight: c.weights[kind]}
}

func addSpoil(list []item.Spoil, s item.Spoil) []item.Spoil {
	if s.Qty <= 0 {
		return list
	}
	for i := range list {
		if list[i].Material == s.Material {
			list[i].Qty += s.Qty
			return list
		}
	}
	return append(list, s)
}

func total(ss []item.Spoil) int64 {
	var n int64
	for _, s := range ss {
		n += s.Qty
	}
	return n
}
