package gen

import "slices"

// Instance is one placement of a pattern rule: its centre and every point
// it lays, in part order, whether or not a chunk keeps each one.
type Instance struct {
	Rule   string
	ID     string
	Centre Hex
	Points []PatternPoint
}

func (g *Gen) public(in *instance) Instance {
	return Instance{Rule: g.b.Patterns[in.rule].ID, ID: in.id, Centre: in.centre, Points: slices.Clone(in.points)}
}

// Instances lists a rule's instances whose centre lies within reach of h,
// in a fixed order; none for a rule the sheets lack.
func (g *Gen) Instances(rule string, h Hex, reach int64) []Instance {
	ri, ok := g.rules[rule]
	if !ok {
		return nil
	}
	var out []Instance
	for _, in := range g.instancesNear(ri, h, reach) {
		out = append(out, g.public(in))
	}
	return out
}

// OriginInstance is the one instance of a rule anchored on the origin,
// such as the ring of eight round the core or the triangle off it.
func (g *Gen) OriginInstance(rule string) (Instance, bool) {
	ri, ok := g.rules[rule]
	if !ok || g.b.Patterns[ri].Anchor != anchorOrigin {
		return Instance{}, false
	}
	return g.public(g.instance(ri, anchorOrigin, Hex{})), true
}

// InstanceOf is the instance a pattern point was laid by.
func (g *Gen) InstanceOf(p PatternPoint) (Instance, bool) {
	for _, in := range g.Instances(p.Rule, p.Centre, 0) {
		if in.ID == p.Instance {
			return in, true
		}
	}
	return Instance{}, false
}

// Standing reports whether a point is on the scaffold: no settlement or
// earlier rule took its tile.
func (g *Gen) Standing(p PatternPoint) bool {
	return slices.ContainsFunc(g.Patterns(g.ch.Of(p.Hex)), func(o PatternPoint) bool {
		return o.Rule == p.Rule && o.Instance == p.Instance && o.Index == p.Index && o.Hex == p.Hex
	})
}
