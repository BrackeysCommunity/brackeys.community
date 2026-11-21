package puzzle_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/puzzle"
)

// seatedRig lays out one party machine for a rule's test.
func seatedRig(t *testing.T, version string, level, seats, shape int64) (*puzzle.Puzzles, puzzle.Spec, puzzle.Layout) {
	t.Helper()
	p := puzzles(t)
	s := puzzle.Spec{Family: puzzle.PartyFamily(version), Level: level, Tier: 1, Place: "floor:2,5/1", Beat: 3,
		Party: version, Seats: seats, Shape: shape}
	return p, s, p.Make(s)
}

// seatedStates plays a merged log and keeps every state it passed through.
func seatedStates(l puzzle.Layout, log puzzle.Log) (puzzle.Outcome, [][]int64) {
	var seen [][]int64
	out := puzzle.RunParty(l, log, far, func(_ int64, st []int64) { seen = append(seen, st) })
	return out, seen
}

// lastState is the state a merged log leaves the machine in.
func lastState(t *testing.T, l puzzle.Layout, moves ...puzzle.Move) (puzzle.Status, []int64) {
	t.Helper()
	out, seen := seatedStates(l, puzzle.Log{Moves: moves})
	return out.Status, seen[len(seen)-1]
}

func TestCallAndAnswer(t *testing.T) {
	const seats = 3
	p, s, l := seatedRig(t, puzzle.CallAndAnswer, 5, seats, 0)
	for seat, part := range p.Deal(s) {
		for i, x := range part.Order {
			if mine := int64(i)%seats == int64(seat); mine != (x != puzzle.Unseen) || mine && x != l.Order[i] {
				t.Fatalf("seat %d is dealt %v of %v", seat, part.Order, l.Order)
			}
		}
	}

	const press, call = 0, 1
	var calls []puzzle.Move
	for i, x := range l.Order {
		calls = append(calls, puzzle.Move{At: int64(i) * 250, A: x, C: call, Seat: int64(i) % seats})
	}
	if out, seen := seatedStates(l, puzzle.Log{Moves: calls}); out.Status != puzzle.Going ||
		slices.ContainsFunc(seen, func(st []int64) bool { return st[0] != 0 }) {
		t.Fatalf("calls alone moved the machine: %+v %v", out, seen)
	}

	keypad := func(round int64) int64 { return round / max(1, l.Pass) % seats }
	first := puzzle.Move{A: l.Order[0], C: press, Seat: keypad(0)}
	again := puzzle.Move{A: l.Order[0], C: press, Seat: keypad(0)}
	next := puzzle.Move{A: l.Order[0], C: press, Seat: keypad(1)}
	if st, now := lastState(t, l, first); st != puzzle.Going || now[0] != 1 {
		t.Fatalf("the keypad's first press: %v %v", st, now)
	}
	if keypad(1) != keypad(0) {
		if _, now := lastState(t, l, first, again); now[0] != 1 {
			t.Fatalf("the round before's keypad pressed after the keypad passed: %v", now)
		}
	}
	if _, now := lastState(t, l, first, next); now[0] != 2 {
		t.Fatalf("the new keypad's press: %v", now)
	}
	other := puzzle.Move{A: l.Order[0], C: press, Seat: (keypad(0) + 1) % seats}
	if _, now := lastState(t, l, other); now[0] != 0 {
		t.Fatalf("a seat off the keypad pressed: %v", now)
	}
	wrong := first
	wrong.A = (l.Order[0] + 1) % l.Range
	if st, _ := lastState(t, l, wrong); st != puzzle.Broke {
		t.Fatal("a wrong press by the keypad did not break the machine")
	}
	if st, _ := lastState(t, l, puzzle.Move{A: l.Order[0], C: 2}); st != puzzle.Broke {
		t.Fatal("a move that is neither a press nor a call was played")
	}
}
