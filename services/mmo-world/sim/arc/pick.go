package arc

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/draw"
)

// CastDraw is the purpose of every casting chance and tie.
const CastDraw draw.Purpose = "arc.cast"

// structural: tells a tie's draw from the chance's under the same identity.
const tiePart = "tie"

// Chance reports whether an eligible template is cast today, its row's
// percent drawn per template, scope ref and day.
func Chance(d *draw.Drawer, row, scope string, day, chance int64) bool {
	return d.Percent(chance, CastDraw, draw.Str(row), draw.Str(scope), draw.Int(day))
}

// Ordered is cs by Pressure, highest first, then by Cast.Key.
func Ordered(cs []Candidate) []Candidate {
	out := slices.Clone(cs)
	slices.SortStableFunc(out, func(a, b Candidate) int {
		return cmp.Or(cmp.Compare(b.Pressure, a.Pressure), cmp.Compare(a.Cast.Key(), b.Cast.Key()))
	})
	return out
}

// Pick orders candidates by Pressure then Cast.Key and takes the highest;
// a tie at the top is drawn per template, scope ref and day.
func Pick(cs []Candidate, d *draw.Drawer, row string, scope string, day int64) (Candidate, bool) {
	if len(cs) == 0 {
		return Candidate{}, false
	}
	o := Ordered(cs)
	n := 1
	for n < len(o) && o[n].Pressure == o[0].Pressure {
		n++
	}
	if n == 1 || d == nil {
		return o[0], true
	}
	k := d.Below(uint64(n), CastDraw, draw.Str(row), draw.Str(scope), draw.Int(day), draw.Str(tiePart))
	return o[k], true
}
