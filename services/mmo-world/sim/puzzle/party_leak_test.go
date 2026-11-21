package puzzle_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/puzzle"
)

// Each run has its own gauge, knocked only by its own seat, and a run left
// to drain breaks the machine.
func TestPipeCrew(t *testing.T) {
	const seats = 3
	_, _, l := seatedRig(t, puzzle.PipeCrew, 4, seats, 0)
	full, miss := l.Par[0], l.Par[2]
	for slot := range l.Size {
		run := slot % seats
		st, now := lastState(t, l, puzzle.Move{A: slot, Seat: run})
		for r, g := range now[:seats] {
			want := full
			if int64(r) == run {
				want -= miss
			}
			if st != puzzle.Going || g != want {
				t.Fatalf("a knock on slot %d left run %d's gauge at %d, want %d", slot, r, g, want)
			}
		}
		if _, now := lastState(t, l, puzzle.Move{A: slot, Seat: (run + 1) % seats}); slices.ContainsFunc(now[:seats], func(g int64) bool { return g != full }) {
			t.Fatalf("slot %d was tapped by a seat off its run: %v", slot, now)
		}
	}
	out, seen := seatedStates(l, puzzle.Log{End: far})
	last := seen[len(seen)-1]
	if out.Status != puzzle.Broke || !slices.ContainsFunc(last[:seats], func(g int64) bool { return g <= 0 }) {
		t.Fatalf("left alone, the pipe held: %+v %v", out, last)
	}
}
