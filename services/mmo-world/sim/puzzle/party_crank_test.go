package puzzle_test

import (
	"testing"

	"jams.team/mmo-world/sim/puzzle"
)

// The cranks change hands on the clock, and only the two together charge.
func TestTandemWinch(t *testing.T) {
	const seats, turn = 2, 1
	p, _, l := seatedRig(t, puzzle.TandemWinch, 3, seats, 0)
	kick := l.Par[3]
	if l.Pass <= 0 {
		t.Fatal("the cranks never change hands")
	}
	for _, c := range []struct {
		at, crank, seat, speed int64
	}{
		{0, 0, 0, kick}, {0, 0, 1, 0}, {0, 1, 1, kick}, {0, 1, 0, 0},
		{l.Pass, 0, 0, 0}, {l.Pass, 0, 1, kick}, {l.Pass, 1, 0, kick},
	} {
		st, now := lastState(t, l, puzzle.Move{At: c.at, A: turn, B: c.crank, Seat: c.seat})
		if st != puzzle.Going || now[c.crank] != c.speed {
			t.Fatalf("crank %d turned by seat %d at %d ms: %v", c.crank, c.seat, c.at, now)
		}
	}
	for _, m := range []puzzle.Move{{A: turn, B: 2}, {A: 2}, {A: 0}} {
		if st, _ := lastState(t, l, m); st != puzzle.Broke {
			t.Fatalf("%+v was played", m)
		}
	}

	solve := p.PartySolve(l)
	var one puzzle.Log
	for _, m := range solve.Moves {
		if m.B == 0 {
			one.Moves = append(one.Moves, m)
		}
	}
	one.End = solve.Stop()
	if out, seen := seatedStates(l, one); out.Status == puzzle.Done || seen[len(seen)-1][2] != 0 {
		t.Fatalf("one crank alone charged the winch: %+v %v", out, seen[len(seen)-1])
	}
}
