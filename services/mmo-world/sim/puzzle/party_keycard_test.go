package puzzle_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/puzzle"
)

// Both readers must read a pass within the window, and they change hands
// on every pass.
func TestDoubleSwipe(t *testing.T) {
	const seats = 2
	_, _, l := seatedRig(t, puzzle.DoubleSwipe, 3, seats, 0)
	width, fastest := l.Par[0], l.Par[2]
	if int64(len(l.Key)) != l.Size || slices.Min(l.Key) < fastest+width || slices.Max(l.Key) > max(fastest+width, l.Range-width) {
		t.Fatalf("the second reader's speeds %v", l.Key)
	}
	if l.Window <= 0 {
		t.Fatal("no window")
	}
	at := 2 * l.Range
	first := puzzle.Move{At: at, A: l.Target[0], B: 0, Seat: 0}
	partner := func(late int64) puzzle.Move { return puzzle.Move{At: at + late, A: l.Key[0], B: 1, Seat: 1} }

	if st, now := lastState(t, l, first, partner(l.Window)); st != puzzle.Going || !slices.Equal(now, []int64{1, 0, -1, -1}) {
		t.Fatalf("two good swipes inside the window: %v", now)
	}
	if _, now := lastState(t, l, first, partner(l.Window+1)); !slices.Equal(now, []int64{0, 0, -1, at + l.Window + 1}) {
		t.Fatalf("two good swipes outside the window: %v", now)
	}
	off := first
	off.Seat = 1
	if _, now := lastState(t, l, off); !slices.Equal(now, []int64{0, 0, -1, -1}) {
		t.Fatalf("a seat swiped a reader it does not hold: %v", now)
	}
	// The pass read, the readers have changed hands.
	held := puzzle.Move{At: 2 * at, A: l.Target[1], B: 0, Seat: 1 % seats}
	if _, now := lastState(t, l, first, partner(0), held); now[2] != 2*at {
		t.Fatalf("the first reader did not pass to seat 1: %v", now)
	}
	bad := first
	bad.A += width + 1
	if _, now := lastState(t, l, bad); !slices.Equal(now, []int64{0, 1, -1, -1}) {
		t.Fatalf("a swipe off the speed: %v", now)
	}
	quick := first
	quick.At = quick.A - 1
	if st, _ := lastState(t, l, quick); st != puzzle.Broke {
		t.Fatal("a swipe longer than the time it had was read")
	}
}
