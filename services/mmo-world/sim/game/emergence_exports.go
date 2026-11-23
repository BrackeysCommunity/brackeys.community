package game

import (
	"encoding/json"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

// FirstKinds are the facts that name a promotion's first, which no other
// viewer is shown.
var FirstKinds = []string{factPromotion, factPromotionRenamed, factLootedFirst}

// FactPromotion is the fact a promotion is announced by.
const FactPromotion = factPromotion

// The ref kinds a legend is made of.
const (
	LegendCreature = kindCreature
	LegendItem     = renownItem
)

// PromotionRef is the ref a promotion is a fact's subject by.
func PromotionRef(id string) fact.Ref { return promotionRef(id) }

// RoadState is a tile's recorded road today: its shown name, whether a
// raid has cut it, and the toll a step pays while it is tolled and not
// cut; "" off a recorded road.
func (g *Game) RoadState(h hex.Hex) (name string, cut bool, toll int64) {
	rec, ok := g.roadAt(h)
	if !ok {
		return "", false, 0
	}
	day := g.Tick() / sheets.TicksPerDay
	cut = rec.Cut(day)
	if tollDue(rec, day) {
		toll = g.r.Emerge.P.TollCoin
	}
	return g.Emergence.Shown(rec.ID), cut, toll
}

// GoalLegend is the name of the living legend a Defeat goal's target
// became in the goal's region, or "".
func (g *Game) GoalLegend(x *Goal) string {
	e := g.Emergence
	if e == nil || x.Cond.Verb != goal.Defeat {
		return ""
	}
	arch := x.Cond.Kind
	if arch == "" {
		if l := e.Lines[signature(x)]; l != nil {
			arch = l.Archetype
		}
	}
	if arch == "" {
		return ""
	}
	region, _ := g.goalPlace(x)
	l := g.legendOf(fact.Ref{Kind: kindCreature, ID: arch}, region)
	if l == nil {
		return ""
	}
	return e.Shown(l.ID)
}

// GoalCustom is the name of the custom a settlement's goal renews as, or
// was posted by: one at its board on the same line, or "".
func (g *Game) GoalCustom(x *Goal) string {
	e := g.Emergence
	place := customPlace(x)
	if e == nil || place < 0 {
		return ""
	}
	sig := signature(x)
	for _, rec := range e.Customs {
		if rec.Place != place {
			continue
		}
		var s GoalSpec
		if json.Unmarshal(rec.Spec, &s) != nil {
			continue
		}
		if signature(&Goal{Issuer: x.Issuer, Cond: s.Cond}) != sig {
			continue
		}
		if name := e.Shown(rec.ID); name != "" {
			return name
		}
	}
	return ""
}
