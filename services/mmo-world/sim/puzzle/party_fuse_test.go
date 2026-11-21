package puzzle_test

import (
	"testing"

	"jams.team/mmo-world/sim/puzzle"
)

func TestPartyBombSquad(t *testing.T) {
	p := puzzles(t)
	s := partySpec(puzzle.BombSquad, 9, 3, 0)
	l := p.Make(s)
	for seat, v := range p.Deal(s) {
		if v.Order != nil {
			t.Fatalf("seat %d is dealt the order", seat)
		}
		for i, c := range v.Clues {
			if hidden := c == (puzzle.Clue{Before: puzzle.Unseen, After: puzzle.Unseen}); hidden == (i%3 == seat) {
				t.Fatalf("seat %d's clue %d: %+v", seat, i, c)
			}
		}
	}
	// The cutters pass every two fuses: seat 0, 0, 1, 1, 2, 2, 0, ...
	solve := p.PartySolve(l)
	for k, mv := range solve.Moves {
		if mv.Seat != int64(k)/2%3 || mv.A != l.Order[k] {
			t.Fatalf("pull %d: %+v", k, mv)
		}
	}
	pull := func(at, seat, fuse int64) puzzle.Move { return puzzle.Move{At: at, A: fuse, Seat: seat} }
	o := l.Order
	for _, c := range []struct {
		name  string
		moves []puzzle.Move
		st    puzzle.Status
		k     int64
	}{
		{"the cutter pulls", []puzzle.Move{pull(0, 0, o[0])}, puzzle.Going, 1},
		{"nobody else may", []puzzle.Move{pull(0, 1, o[0])}, puzzle.Going, 0},
		{"the cutters pass on", []puzzle.Move{pull(0, 0, o[0]), pull(1, 0, o[1]), pull(2, 0, o[2])}, puzzle.Going, 2},
		{"to the next seat", []puzzle.Move{pull(0, 0, o[0]), pull(1, 0, o[1]), pull(2, 1, o[2])}, puzzle.Going, 3},
		{"the wrong fuse blows", []puzzle.Move{pull(0, 0, o[1])}, puzzle.Broke, 0},
		{"another's wrong fuse is only a press", []puzzle.Move{pull(0, 2, o[1])}, puzzle.Going, 0},
		{"a fuse out of range", []puzzle.Move{pull(0, 1, l.Size)}, puzzle.Broke, 0},
		{"a seat it does not have", []puzzle.Move{pull(0, 3, o[0])}, puzzle.Broke, 0},
	} {
		st, state := partyEnd(l, c.moves...)
		if st != c.st || (st != puzzle.Broke && state[0] != c.k) {
			t.Errorf("%s: %v %v, want %v with %d pulled", c.name, st, state, c.st, c.k)
		}
	}
}
