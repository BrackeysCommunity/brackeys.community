package puzzle_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/puzzle"
)

func TestPartyTwoAxisTilt(t *testing.T) {
	// A two by two square maze with every inner wall open; the axes pass
	// on every roll.
	l := puzzle.Layout{Family: puzzle.Maze, Size: 2, Walls: []int64{12, 9, 6, 3}, Start: 0, Goal: 3,
		Party: puzzle.TwoAxisTilt, Seats: 2, Pass: 1}
	tilt := func(at, seat, side int64) puzzle.Move { return puzzle.Move{At: at, A: side, Seat: seat} }
	east := tilt(0, 0, 0)
	for _, c := range []struct {
		name  string
		moves []puzzle.Move
		st    puzzle.Status
		state []int64 // the bit's cell, then the rolls
	}{
		{"the axis holder tilts", []puzzle.Move{east}, puzzle.Going, []int64{1, 1}},
		{"another axis's tilt is ignored", []puzzle.Move{tilt(0, 0, 1)}, puzzle.Going, []int64{0, 0}},
		{"the axes pass after a roll", []puzzle.Move{east, tilt(1, 0, 2)}, puzzle.Going, []int64{1, 1}},
		{"a tilt into a wall rolls nothing", []puzzle.Move{east, tilt(1, 0, 3)}, puzzle.Going, []int64{1, 1}},
		{"and keeps the axes", []puzzle.Move{east, tilt(1, 0, 3), tilt(2, 1, 1)}, puzzle.Going, []int64{1, 1}},
		{"to the goal", []puzzle.Move{east, tilt(1, 0, 3), tilt(2, 0, 1)}, puzzle.Done, []int64{3, 2}},
		{"a square maze has four sides", []puzzle.Move{tilt(0, 0, 4)}, puzzle.Broke, nil},
		{"a seat it does not have", []puzzle.Move{tilt(0, 2, 0)}, puzzle.Broke, nil},
	} {
		st, state := partyEnd(l, c.moves...)
		if st != c.st || (c.state != nil && !slices.Equal(state, c.state)) {
			t.Errorf("%s: %v %v, want %v %v", c.name, st, state, c.st, c.state)
		}
	}

	// A hex maze has three axes: side 5 is the third axis's, held by
	// seat 2 at the start.
	h := puzzle.Layout{Family: puzzle.Maze, Size: 2, Walls: []int64{63, 63, 63, 63}, Start: 0, Goal: 3, Shape: 1,
		Party: puzzle.TwoAxisTilt, Seats: 3, Pass: 4}
	if st, state := partyEnd(h, tilt(0, 2, 5)); st != puzzle.Going || !slices.Equal(state, []int64{0, 0}) {
		t.Errorf("a hex tilt by its axis holder: %v %v", st, state)
	}
	if st, _ := partyEnd(h, tilt(0, 2, 6)); st != puzzle.Broke {
		t.Errorf("a hex maze's seventh side: %v", st)
	}

	// The solve's every tilt is its axis holder's at that roll.
	p := puzzles(t)
	for _, shape := range []int64{0, 1} {
		axes := 2 + shape
		for seats := int64(2); seats <= 4; seats++ {
			m := p.Make(partySpec(puzzle.TwoAxisTilt, 12, seats, shape))
			for i, mv := range p.PartySolve(m).Moves {
				if want := (mv.A%axes + int64(i)/m.Pass) % seats; mv.Seat != want {
					t.Fatalf("shape %d, %d seats, tilt %d: %+v, want seat %d", shape, seats, i, mv, want)
				}
			}
		}
	}
}
