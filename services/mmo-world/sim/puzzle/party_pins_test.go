package puzzle_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/puzzle"
)

func TestPartyTensionAndPick(t *testing.T) {
	// Pin 1 first at height 4, then pin 0 at 3; pin 2 is false. Seat 1
	// holds the tension for the first pin and seat 0 the pick; they swap
	// for the second.
	l := puzzle.Layout{Family: puzzle.Pins, Size: 2, Order: []int64{1, 0}, Target: []int64{3, 4}, False: []int64{2},
		Party: puzzle.TensionAndPick, Seats: 2, Window: 3000, Pass: 1}
	on := func(at, seat int64) puzzle.Move { return puzzle.Move{At: at, C: 1, Seat: seat} }
	off := func(at, seat int64) puzzle.Move { return puzzle.Move{At: at, C: 2, Seat: seat} }
	pin := func(at, seat, a, b int64) puzzle.Move { return puzzle.Move{At: at, A: a, B: b, Seat: seat} }
	first := []puzzle.Move{on(100, 1), pin(3100, 0, 1, 4)}
	for _, c := range []struct {
		name  string
		moves []puzzle.Move
		st    puzzle.Status
		state []int64 // pins set, then when the tension went on
	}{
		{"a pin with no tension slips", []puzzle.Move{pin(0, 0, 1, 4)}, puzzle.Going, []int64{0, -1}},
		{"only the tension seat applies it", []puzzle.Move{on(0, 0)}, puzzle.Going, []int64{0, -1}},
		{"only the pick seat lifts", []puzzle.Move{on(0, 1), pin(10, 1, 1, 4)}, puzzle.Going, []int64{0, 0}},
		{"a pin inside the window sets and passes the roles", first, puzzle.Going, []int64{1, -1}},
		{"the old tension seat no longer holds it", append(slices.Clone(first), on(3200, 1)), puzzle.Going, []int64{1, -1}},
		{"a pin past the window slips", append(slices.Clone(first), on(3200, 0), pin(6201, 1, 0, 3)), puzzle.Going, []int64{0, -1}},
		{"tension off drops the pins", append(slices.Clone(first), off(3200, 0)), puzzle.Going, []int64{0, -1}},
		{"a wrong height drops the pins", append(slices.Clone(first), on(3200, 0), pin(3300, 1, 0, 2)), puzzle.Going, []int64{0, -1}},
		{"a false pin drops the pins", append(slices.Clone(first), on(3200, 0), pin(3300, 1, 2, 1)), puzzle.Going, []int64{0, -1}},
		{"both pins set", append(slices.Clone(first), on(3200, 0), pin(6200, 1, 0, 3)), puzzle.Done, []int64{2, -1}},
		{"a pin out of range", []puzzle.Move{on(0, 1), pin(1, 0, 3, 1)}, puzzle.Broke, nil},
		{"a move of no kind", []puzzle.Move{{C: 3, Seat: 1}}, puzzle.Broke, nil},
		{"a seat it does not have", []puzzle.Move{on(0, 2)}, puzzle.Broke, nil},
	} {
		st, state := partyEnd(l, c.moves...)
		if st != c.st || (c.state != nil && !slices.Equal(state, c.state)) {
			t.Errorf("%s: %v %v, want %v %v", c.name, st, state, c.st, c.state)
		}
	}
	// With three or four seats the roles still pass one seat a pin.
	p := puzzles(t)
	for seats := int64(2); seats <= 4; seats++ {
		m := p.Make(partySpec(puzzle.TensionAndPick, 9, seats, 0))
		for i, mv := range p.PartySolve(m).Moves {
			k := int64(i / 2)
			want := (k + 1) % seats
			if mv.C == 0 {
				want = k % seats
			}
			if mv.Seat != want {
				t.Fatalf("%d seats, move %d: %+v", seats, i, mv)
			}
		}
	}
}
