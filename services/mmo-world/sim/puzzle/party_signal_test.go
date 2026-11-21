package puzzle_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/puzzle"
)

func TestPartyRelayChain(t *testing.T) {
	// Seat 0's panel is knobs 0 and 1, seat 1's knobs 2 and 3.
	l := puzzle.Layout{Family: puzzle.Signal, Size: 4, Range: 10, Target: []int64{1, 2, 3, 4},
		Party: puzzle.RelayChain, Seats: 2, Window: 1000}
	set := func(at, knob, v int64) puzzle.Move { return puzzle.Move{At: at, A: knob, B: v, Seat: knob / 2} }
	tune0 := []puzzle.Move{set(0, 0, 1), set(100, 1, 2)}
	for _, c := range []struct {
		name  string
		moves []puzzle.Move
		st    puzzle.Status
		state []int64 // knobs, then each panel's lock
	}{
		{"another seat's knob is ignored", []puzzle.Move{{A: 0, B: 1, Seat: 1}}, puzzle.Going, []int64{0, 0, 0, 0, -1, -1}},
		{"a panel locks when it is tuned", tune0, puzzle.Going, []int64{1, 2, 0, 0, 100, -1}},
		{"a knob taken off unlocks it", append(slices.Clone(tune0), set(200, 0, 9)), puzzle.Going, []int64{9, 2, 0, 0, -1, -1}},
		{"retuning a locked panel keeps its lock", append(slices.Clone(tune0), set(200, 1, 2)), puzzle.Going, []int64{1, 2, 0, 0, 100, -1}},
		{"locks inside the window pass", append(slices.Clone(tune0), set(200, 2, 3), set(1100, 3, 4)), puzzle.Done, []int64{1, 2, 3, 4, 100, 1100}},
		{"a panel locked too early drops back", append(slices.Clone(tune0), set(200, 2, 3), set(1101, 3, 4)), puzzle.Going, []int64{0, 0, 3, 4, -1, 1101}},
		{"and is tuned again", append(slices.Clone(tune0), set(200, 2, 3), set(1101, 3, 4), set(1200, 0, 1), set(1300, 1, 2)), puzzle.Done, []int64{1, 2, 3, 4, 1300, 1101}},
		{"a value out of range", []puzzle.Move{set(0, 0, 10)}, puzzle.Broke, nil},
		{"a knob out of range", []puzzle.Move{{A: 4, B: 1, Seat: 1}}, puzzle.Broke, nil},
		{"a seat it does not have", []puzzle.Move{{A: 0, B: 1, Seat: 2}}, puzzle.Broke, nil},
	} {
		st, state := partyEnd(l, c.moves...)
		if st != c.st || (c.state != nil && !slices.Equal(state, c.state)) {
			t.Errorf("%s: %v %v, want %v %v", c.name, st, state, c.st, c.state)
		}
	}
	// The solve tunes every panel in step, and each seat only its own.
	p := puzzles(t)
	for seats := int64(2); seats <= 4; seats++ {
		m := p.Make(partySpec(puzzle.RelayChain, 9, seats, 1))
		per := m.Size / seats
		for _, mv := range p.PartySolve(m).Moves {
			if mv.Seat != mv.A/per || mv.At != 250*(mv.A%per+1) {
				t.Fatalf("%d seats: %+v", seats, mv)
			}
		}
	}
}
