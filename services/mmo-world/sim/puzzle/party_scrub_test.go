package puzzle_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/puzzle"
)

// Each seat rubs a band of rows, and every Pass rubs on a panel dirty the
// next panel's reading.
func TestPanelArray(t *testing.T) {
	const seats = 2
	_, _, l := seatedRig(t, puzzle.PanelArray, 5, seats, 0)
	n, cells := l.Size, l.Size*l.Size
	panel := func(c int64) int64 { return c / n * seats / n }
	first := func(p int64) int64 {
		i := slices.IndexFunc(l.Target, func(c int64) bool { return panel(c) == p })
		if i < 0 {
			t.Fatalf("panel %d holds none of the reading %v", p, l.Target)
		}
		return l.Target[i]
	}
	c0, c1 := first(0), first(1)
	if l.Pass <= 0 {
		t.Fatal("no pass")
	}

	if _, now := lastState(t, l, puzzle.Move{A: c0, Seat: 1}); !slices.Equal(now[:cells], l.Init) {
		t.Fatal("a seat rubbed another's panel")
	}
	// Panel 1's first cell rubbed clean, panel 0's Pass-th rub blows a
	// layer back onto it.
	var moves []puzzle.Move
	for range l.Init[c1] {
		moves = append(moves, puzzle.Move{A: c1, Seat: 1})
	}
	for range l.Pass {
		moves = append(moves, puzzle.Move{A: c0, Seat: 0})
	}
	st, now := lastState(t, l, moves...)
	if st != puzzle.Going || now[c1] != 1 || now[cells] != l.Pass || now[cells+1] != l.Init[c1] {
		t.Fatalf("panel 0's rubs did not blow onto cell %d: %v", c1, now)
	}
	_, before := lastState(t, l, moves[:len(moves)-1]...)
	if before[c1] != 0 {
		t.Fatalf("grit blew before the Pass-th rub: %v", before)
	}
}
