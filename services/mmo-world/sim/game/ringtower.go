package game

import (
	"slices"

	"jams.team/mmo-world/sim/hex"
)

// Towers is the ring's standing towers whose guardians have not fallen this
// season, for the waking tower (arc.Ringed).
func (v *storyView) Towers() []hex.Hex {
	ring := v.g.ringOf()
	if ring == nil {
		return nil
	}
	var fell []hex.Hex
	if c, ok := v.g.clock(); ok && ring.Season == c.N {
		fell = ring.Fell
	}
	return slices.DeleteFunc(slices.Clone(ring.Towers), func(h hex.Hex) bool { return slices.Contains(fell, h) })
}
