package puzzle_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/puzzle"
)

// Every valve pushes every other needle, on either shape, and only the
// valve's seat can turn it.
func TestBoilerRoom(t *testing.T) {
	const seats = 3
	for shape := range int64(2) {
		_, _, l := seatedRig(t, puzzle.BoilerRoom, 6, seats, shape)
		lo, hi, nudge, couple := l.Par[0], l.Par[1], l.Par[2], l.Par[3]
		if slices.Min(l.Init) < 1 || slices.Max(l.Init) >= l.Range {
			t.Fatalf("shape %d: a needle starts off the gauge: %v", shape, l.Init)
		}
		if !slices.ContainsFunc(l.Init, func(v int64) bool { return v < lo || v > hi }) {
			t.Fatalf("shape %d: every needle starts in the band: %v", shape, l.Init)
		}
		for a := range l.Size {
			dir := int64(1)
			if l.Init[a]+nudge >= l.Range {
				dir = -1
			}
			want, burst := make([]int64, l.Size), false
			for b, v := range l.Init {
				v -= dir * couple
				if int64(b) == a {
					v = l.Init[b] + dir*nudge
				}
				want[b], burst = max(0, v), burst || v >= l.Range
			}
			turn := puzzle.Move{A: a, B: dir, Seat: a % seats}
			st, now := lastState(t, l, turn)
			if burst {
				if st != puzzle.Broke {
					t.Fatalf("shape %d: valve %d drove a needle off the gauge: %v", shape, a, now)
				}
			} else if st != puzzle.Going || !slices.Equal(now[:l.Size], want) {
				t.Fatalf("shape %d: valve %d left the needles at %v, want %v", shape, a, now[:l.Size], want)
			}
			turn.Seat = (turn.Seat + 1) % seats
			if _, now := lastState(t, l, turn); !slices.Equal(now[:l.Size], l.Init) {
				t.Fatalf("shape %d: valve %d turned by a seat that does not hold it", shape, a)
			}
		}
		if st, _ := lastState(t, l, puzzle.Move{A: 0, B: 2}); st != puzzle.Broke {
			t.Fatalf("shape %d: a turn the valve does not have was played", shape)
		}
	}
}
