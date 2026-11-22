package pattern

import "jams.team/mmo-world/sim/draw"

// Solve draws a board's solution under pattern.solution; never stored.
// The board's id is the whole identity, so a world's key and the id fix
// it, and nothing at rest holds it.
func Solve(d *draw.Drawer, b Board) Solution {
	if b.Points <= 0 {
		return nil
	}
	id := draw.Str(b.ID)
	switch b.Kind {
	case Order:
		return widen(d.Shuffle(b.Points, solutionP, id))
	case State, Alignment:
		st := d.Stream(solutionP, id)
		s := make(Solution, b.Points)
		for i := range s {
			s[i] = int64(st.Below(uint64(b.values())))
		}
		return s
	case Connection:
		s := make(Solution, b.Points)
		for _, pt := range d.Shuffle(b.Points, solutionP, id)[:b.need()] {
			s[pt] = 1
		}
		return s
	case Completion, Constellation:
		return Solution{int64(d.Below(uint64(b.Points), solutionP, id))}
	}
	return nil
}

func widen(xs []int) Solution {
	s := make(Solution, len(xs))
	for i, x := range xs {
		s[i] = int64(x)
	}
	return s
}
