package puzzle_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/puzzle"
)

// region is the seat whose region a cell is in: columns for two and three
// seats, quarters for four.
func region(n, seats, c int64) int64 {
	x, y := c%n, c/n
	if seats == 4 {
		return x*2/n + 2*(y*2/n)
	}
	return x * seats / n
}

func TestPartySplitGrid(t *testing.T) {
	p := puzzles(t)
	for _, shape := range []int64{0, 1} {
		for seats := int64(2); seats <= 4; seats++ {
			l := p.Make(partySpec(puzzle.SplitGrid, 7, seats, shape))
			_, rest := runTrace(l, puzzle.Log{}, 0)
			for c := range l.Size * l.Size {
				for s := range seats {
					st, state := partyEnd(l, puzzle.Move{A: c, Seat: s})
					turned := !slices.Equal(state, rest[0])
					if st == puzzle.Broke || turned != (s == region(l.Size, seats, c)) {
						t.Fatalf("shape %d, %d seats: seat %d's turn of tile %d: %v, turned %v", shape, seats, s, c, st, turned)
					}
				}
			}
			for _, mv := range p.PartySolve(l).Moves {
				if mv.Seat != region(l.Size, seats, mv.A) {
					t.Fatalf("shape %d, %d seats: %+v", shape, seats, mv)
				}
			}
			if st, _ := partyEnd(l, puzzle.Move{A: l.Size * l.Size}); st != puzzle.Broke {
				t.Fatalf("a tile out of range: %v", st)
			}
			if st, _ := partyEnd(l, puzzle.Move{A: 0, Seat: seats}); st != puzzle.Broke {
				t.Fatalf("a seat it does not have: %v", st)
			}
		}
	}
	// Four seats on a four by four board hold its quarters.
	quarters := []int64{0, 0, 1, 1, 0, 0, 1, 1, 2, 2, 3, 3, 2, 2, 3, 3}
	for c, want := range quarters {
		if got := region(4, 4, int64(c)); got != want {
			t.Fatalf("cell %d in quarter %d", c, got)
		}
	}
}
