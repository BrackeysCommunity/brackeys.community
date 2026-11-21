package puzzle_test

import (
	"testing"

	"jams.team/mmo-world/sim/puzzle"
)

// At the end of a segment the iron lifts and passes; only the next seat
// can set it down at the joint.
func TestRelaySolder(t *testing.T) {
	const seats, down = 2, 2
	p, _, l := seatedRig(t, puzzle.RelaySolder, 3, seats, 0)
	if l.Pass <= 0 {
		t.Fatal("no pass")
	}
	solve := p.PartySolve(l)
	_, seen := seatedStates(l, solve)
	j := -1
	for i, st := range seen {
		if st[0] == l.Pass {
			j = i
			break
		}
	}
	if j < 0 || j+1 >= len(solve.Moves) {
		t.Fatalf("the solve never reached the first joint: %v", seen)
	}
	if st := seen[j]; st[3] != 0 || st[4] != 1 {
		t.Fatalf("at the joint the iron is still down, or held by seat %d: %v", st[4], st)
	}
	next := solve.Moves[j+1]
	if next.C != down || next.Seat != 1 {
		t.Fatalf("the move after the joint %+v", next)
	}
	stale := next
	stale.Seat = 0
	_, now := lastState(t, l, append(solve.Moves[:j+1:j+1], stale)...)
	if now[0] != l.Pass {
		t.Fatalf("the seat before set the iron down past the joint: %v", now)
	}
	_, now = lastState(t, l, solve.Moves[:j+2]...)
	if now[0] != l.Pass+1 || now[3] != 1 {
		t.Fatalf("the next seat's set-down did not solder: %v", now)
	}
}
