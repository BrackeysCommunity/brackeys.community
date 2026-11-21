package puzzle_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/puzzle"
)

func TestPartyBigRewire(t *testing.T) {
	l := puzzle.Layout{Family: puzzle.Rewire, Size: 4, Target: []int64{1, 0, 3, 2}, Glyph: []int64{0, 1, 2, 3},
		Party: puzzle.BigRewire, Seats: 2}
	grab := func(at, seat, w int64) puzzle.Move { return puzzle.Move{At: at, A: w, C: 1, Seat: seat} }
	plug := func(at, seat, w, port int64) puzzle.Move { return puzzle.Move{At: at, A: w, B: port, Seat: seat} }
	for _, c := range []struct {
		name  string
		moves []puzzle.Move
		st    puzzle.Status
		state []int64 // ports, then holds
	}{
		{"a held wire cannot be grabbed", []puzzle.Move{grab(0, 0, 0), grab(1, 1, 0)}, puzzle.Going, []int64{0, 1, 2, 3, 0, -1}},
		{"one wire a hand", []puzzle.Move{grab(0, 0, 0), grab(1, 0, 1)}, puzzle.Going, []int64{0, 1, 2, 3, 0, -1}},
		{"only the holder plugs", []puzzle.Move{grab(0, 0, 0), plug(1, 1, 0, 1)}, puzzle.Going, []int64{0, 1, 2, 3, 0, -1}},
		{"crossing wires drop every hand", []puzzle.Move{grab(0, 0, 0), grab(1, 1, 2), plug(2, 0, 0, 3)}, puzzle.Going, []int64{0, 1, 2, 3, -1, -1}},
		{"wires that do not cross plug", []puzzle.Move{grab(0, 0, 0), grab(1, 1, 3), plug(2, 0, 0, 1)}, puzzle.Going, []int64{1, 0, 2, 3, -1, 3}},
		{"the last plug solves", []puzzle.Move{grab(0, 0, 0), grab(1, 1, 3), plug(2, 0, 0, 1), plug(3, 1, 3, 2)}, puzzle.Done, []int64{1, 0, 3, 2, -1, -1}},
		{"a wire out of range", []puzzle.Move{grab(0, 0, 4)}, puzzle.Broke, nil},
		{"a port out of range", []puzzle.Move{grab(0, 0, 0), plug(1, 0, 0, -1)}, puzzle.Broke, nil},
		{"a move of no kind", []puzzle.Move{{A: 0, C: 3}}, puzzle.Broke, nil},
		{"a seat it does not have", []puzzle.Move{grab(0, 2, 0)}, puzzle.Broke, nil},
	} {
		st, state := partyEnd(l, c.moves...)
		if st != c.st || (c.state != nil && !slices.Equal(state, c.state)) {
			t.Errorf("%s: %v %v, want %v %v", c.name, st, state, c.st, c.state)
		}
	}
}

func TestPartySplitPanel(t *testing.T) {
	p := puzzles(t)
	s := partySpec(puzzle.SplitPanel, 7, 4, 0)
	l := p.Make(s)
	for w, c := range l.Key {
		if l.Code[c] != l.Glyph[l.Target[w]] {
			t.Fatalf("colour %d's code %d, its wire's port glyph %d", c, l.Code[c], l.Glyph[l.Target[w]])
		}
	}
	parts := p.Deal(s)
	for seat, v := range parts {
		if v.Target != nil {
			t.Fatalf("seat %d is dealt the answer", seat)
		}
		wires := seat%2 == 0
		if wires != (v.Key != nil) || wires == (v.Glyph != nil) || wires == (v.Code != nil) {
			t.Fatalf("seat %d: key %v glyph %v code %v", seat, v.Key, v.Glyph, v.Code)
		}
		for i := range l.Size {
			if wires && (v.Key[i] != puzzle.Unseen) != (i%2 == int64(seat/2)) {
				t.Fatalf("wires seat %d's key %v", seat, v.Key)
			}
			if !wires && (v.Code[i] != puzzle.Unseen) != (i%2 == int64(seat/2)) {
				t.Fatalf("ports seat %d's code %v", seat, v.Code)
			}
		}
	}

	h := puzzle.Layout{Family: puzzle.Rewire, Size: 4, Target: []int64{1, 0, 3, 2}, Glyph: []int64{0, 1, 2, 3},
		Key: []int64{0, 1, 2, 3}, Code: []int64{1, 0, 3, 2}, Party: puzzle.SplitPanel, Seats: 4}
	plug := func(at, seat, w, port int64) puzzle.Move { return puzzle.Move{At: at, A: w, B: port, Seat: seat} }
	mark := func(at, seat, port int64) puzzle.Move { return puzzle.Move{At: at, B: port, C: 2, Seat: seat} }
	for _, c := range []struct {
		name  string
		moves []puzzle.Move
		st    puzzle.Status
		state []int64 // ports, then marks
	}{
		{"a ports seat cannot plug", []puzzle.Move{plug(0, 1, 0, 1)}, puzzle.Going, []int64{0, 1, 2, 3, -1, -1, -1, -1}},
		{"a wires seat plugs only its own wires", []puzzle.Move{plug(0, 0, 1, 0)}, puzzle.Going, []int64{0, 1, 2, 3, -1, -1, -1, -1}},
		{"the wire's own seat plugs it", []puzzle.Move{plug(0, 2, 1, 0)}, puzzle.Going, []int64{1, 0, 2, 3, -1, -1, -1, -1}},
		{"a ports seat lights a port", []puzzle.Move{mark(0, 3, 2), mark(1, 0, 1)}, puzzle.Going, []int64{0, 1, 2, 3, -1, -1, -1, 2}},
		{"plugged home", []puzzle.Move{plug(0, 0, 0, 1), plug(1, 0, 2, 3)}, puzzle.Done, []int64{1, 0, 3, 2, -1, -1, -1, -1}},
		{"a port out of range", []puzzle.Move{mark(0, 1, 4)}, puzzle.Broke, nil},
		{"a wire out of range", []puzzle.Move{plug(0, 0, -1, 0)}, puzzle.Broke, nil},
		{"a seat it does not have", []puzzle.Move{mark(0, 4, 0)}, puzzle.Broke, nil},
	} {
		st, state := partyEnd(h, c.moves...)
		if st != c.st || (c.state != nil && !slices.Equal(state, c.state)) {
			t.Errorf("%s: %v %v, want %v %v", c.name, st, state, c.st, c.state)
		}
	}
	// Every plug of the solve is lit first by the ports seat reading the
	// wire's colour.
	solve := p.PartySolve(l)
	for i := 0; i+1 < len(solve.Moves); i += 2 {
		m, pl := solve.Moves[i], solve.Moves[i+1]
		if m.C != 2 || m.B != pl.B || pl.C != 0 || m.Seat != 2*(l.Key[pl.A]%2)+1 || pl.Seat != 2*(pl.A%2) {
			t.Fatalf("solve moves %d and %d: %+v %+v", i, i+1, m, pl)
		}
	}
}
