package puzzle_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/puzzle"
)

func TestPartyTwoHandLock(t *testing.T) {
	l := puzzle.Layout{Family: puzzle.Dial, Size: 3, Range: 40, Target: []int64{5, 6, 7}, Turn: []int64{1, -1, 1},
		Party: puzzle.TwoHandLock, Seats: 2, Window: 1000}
	set := func(at, dial int64) puzzle.Move {
		return puzzle.Move{At: at, A: dial, B: l.Target[dial], C: l.Turn[dial], Seat: dial % 2}
	}
	for _, c := range []struct {
		name  string
		moves []puzzle.Move
		st    puzzle.Status
		state []int64 // dials clicked, then the open pair's click times
	}{
		{"one dial of a pair waits", []puzzle.Move{set(0, 0)}, puzzle.Going, []int64{0, 0, -1}},
		{"a pair inside the window holds", []puzzle.Move{set(0, 0), set(1000, 1)}, puzzle.Going, []int64{2, -1, -1}},
		{"a pair outside the window slips", []puzzle.Move{set(0, 0), set(1001, 1)}, puzzle.Going, []int64{0, -1, -1}},
		{"the odd last dial is a pair of one", []puzzle.Move{set(0, 1), set(0, 0), set(5000, 2)}, puzzle.Done, []int64{3, -1, -1}},
		{"a dial outside the open pair drops them all", []puzzle.Move{set(0, 0), set(0, 1), set(10, 0)}, puzzle.Going, []int64{0, -1, -1}},
		{"another seat's dial is ignored", []puzzle.Move{set(0, 0), {At: 0, A: 1, B: 6, C: -1, Seat: 0}}, puzzle.Going, []int64{0, 0, -1}},
		{"a wrong number leaves it", []puzzle.Move{set(0, 0), {At: 0, A: 1, B: 7, C: -1, Seat: 1}}, puzzle.Going, []int64{0, 0, -1}},
		{"a wrong way leaves it", []puzzle.Move{set(0, 0), {At: 0, A: 1, B: 6, C: 1, Seat: 1}}, puzzle.Going, []int64{0, 0, -1}},
		{"a dial out of range", []puzzle.Move{{A: 3}}, puzzle.Broke, nil},
		{"a seat it does not have", []puzzle.Move{{A: 0, B: 5, C: 1, Seat: 2}}, puzzle.Broke, nil},
	} {
		st, state := partyEnd(l, c.moves...)
		if st != c.st || (c.state != nil && !slices.Equal(state, c.state)) {
			t.Errorf("%s: %v %v, want %v %v", c.name, st, state, c.st, c.state)
		}
	}
	// Each dial of a laid machine is its seat's, and a pair's two dials
	// are set together.
	p := puzzles(t)
	for seats := int64(2); seats <= 4; seats++ {
		m := p.Make(partySpec(puzzle.TwoHandLock, 9, seats, 0))
		for _, mv := range p.PartySolve(m).Moves {
			if mv.Seat != mv.A%seats || mv.At != mv.A/2*500 {
				t.Fatalf("%d seats: %+v", seats, mv)
			}
		}
	}
}
