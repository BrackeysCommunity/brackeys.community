package game

import (
	"encoding/json"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/goal"
)

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
	if p := e.Promotion(l.ID); p != nil {
		return p.Shown()
	}
	return ""
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
		if p := e.Promotion(rec.ID); p != nil {
			return p.Shown()
		}
	}
	return ""
}
