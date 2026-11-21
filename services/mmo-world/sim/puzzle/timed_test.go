package puzzle_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/puzzle"
)

// far is a horizon no test log reaches: ten minutes.
const far = int64(600_000)

// machine lays out one machine of a family for a rule's test.
func machine(t *testing.T, fam string, level int64) (*puzzle.Puzzles, puzzle.Layout) {
	t.Helper()
	p := puzzles(t)
	return p, p.Make(puzzle.Spec{Family: fam, Level: level, Tier: 1, Place: "tile:2,5", Beat: 3})
}

// states plays a log and keeps every state it passed through.
func states(l puzzle.Layout, log puzzle.Log) (puzzle.Outcome, [][]int64) {
	var seen [][]int64
	out := puzzle.RunLog(l, nil, log, far, func(_ int64, st []int64) { seen = append(seen, st) })
	return out, seen
}

func status(l puzzle.Layout, end int64, moves ...puzzle.Move) puzzle.Status {
	return puzzle.RunLog(l, nil, puzzle.Log{Moves: moves, End: end}, far, nil).Status
}

func TestPressure(t *testing.T) {
	_, l := machine(t, puzzle.Pressure, 8)
	lo, hi, hold := l.Par[0], l.Par[1], l.Par[4]
	if slices.Min(l.Init) < 1 || slices.Max(l.Init) >= l.Range {
		t.Fatalf("a needle starts off the gauge: %v", l.Init)
	}
	if !slices.ContainsFunc(l.Init, func(v int64) bool { return v < lo || v > hi }) {
		t.Fatalf("every needle starts in the band: %v", l.Init)
	}
	if status(l, 0, puzzle.Move{A: 0, B: 2}) != puzzle.Broke || status(l, 0, puzzle.Move{A: l.Size, B: 1}) != puzzle.Broke {
		t.Fatal("a turn the valve does not have was played")
	}
	// Opened far enough, a valve bursts its needle.
	var open []puzzle.Move
	for range l.Range {
		open = append(open, puzzle.Move{A: 0, B: 1})
	}
	if status(l, 0, open...) != puzzle.Broke {
		t.Fatal("a needle past the top of the gauge did not burst")
	}
	// The band must be held: the solve stopped one step short is not one.
	p := puzzles(t)
	log := p.Solve(l)
	if out := puzzle.RunLog(l, nil, puzzle.Log{Moves: log.Moves, End: log.End - l.Step}, far, nil); out.Status != puzzle.Going {
		t.Fatalf("solved a step before the hold was up: %+v", out)
	}
	out, seen := states(l, log)
	if out.Status != puzzle.Done || seen[len(seen)-1][l.Size+1] != hold {
		t.Fatalf("solved with the band held %d of %d steps: %+v", seen[len(seen)-1][l.Size+1], hold, out)
	}
}

func TestCrank(t *testing.T) {
	p, l := machine(t, puzzle.Crank, 5)
	var wind []puzzle.Move
	for range l.Range {
		wind = append(wind, puzzle.Move{A: 1})
	}
	if status(l, 0, wind...) != puzzle.Broke {
		t.Fatal("wound without limit, the dynamo did not blow")
	}
	if status(l, 0, puzzle.Move{A: 2}) != puzzle.Broke || status(l, 0, puzzle.Move{A: 0}) != puzzle.Broke {
		t.Fatal("a move that is not a quarter turn was played")
	}
	if len(l.Track) != int(2*l.Size) {
		t.Fatalf("%d spikes drawn for size %d", len(l.Track)/2, l.Size)
	}
	for i := 2; i < len(l.Track); i += 2 {
		if l.Track[i] < l.Track[i-2]+l.Track[i-1] {
			t.Fatalf("spikes overlap: %v", l.Track)
		}
	}
	// Let go of half way, the charge stalls where it was; it is not lost.
	log := p.Solve(l)
	half := cutShort(log)
	_, seen := states(l, half)
	had := seen[len(seen)-1][1]
	half.End = log.End * 2
	out, seen := states(l, half)
	if got := seen[len(seen)-1]; out.Status != puzzle.Going || got[0] != 0 || got[1] < had || had == 0 {
		t.Fatalf("after letting go: speed %d, charge %d (had %d), %+v", got[0], got[1], had, out)
	}
}

func TestLeak(t *testing.T) {
	_, l := machine(t, puzzle.Leak, 5)
	gauge, miss := l.Par[0], l.Par[2]
	first, slot := l.Track[0]*l.Step, l.Track[1]
	// A tap on a dry slot knocks the gauge; one on the leak does not.
	_, seen := states(l, puzzle.Log{Moves: []puzzle.Move{{At: 0, A: slot}}})
	if seen[0][0] != gauge-miss {
		t.Fatalf("a tap on a dry slot left the gauge at %d of %d", seen[0][0], gauge)
	}
	_, seen = states(l, puzzle.Log{Moves: []puzzle.Move{{At: first, A: slot}}})
	if left := seen[0][2+slot]; seen[0][0] != gauge-l.Par[1] || left != l.Track[2]-1 {
		t.Fatalf("a tap on the leak: gauge %d, taps left %d", seen[0][0], left)
	}
	if status(l, 0, puzzle.Move{A: l.Size}) != puzzle.Broke {
		t.Fatal("a slot the pipe does not have was tapped")
	}
	// Left alone, the pipe runs dry.
	if out := puzzle.RunLog(l, nil, puzzle.Log{End: far}, far, nil); out.Status != puzzle.Broke {
		t.Fatalf("an untended pipe: %+v", out)
	}
	for i := 4; i < len(l.Track); i += 4 {
		if l.Track[i] <= l.Track[i-4] || l.Track[i+1] < 0 || l.Track[i+1] >= l.Size {
			t.Fatalf("leaks out of order or off the pipe: %v", l.Track)
		}
	}
}

func TestKeycard(t *testing.T) {
	_, l := machine(t, puzzle.Keycard, 6)
	width, strikes := l.Par[0], l.Par[1]
	want := l.Target[0]
	// A swipe that took longer than the time there was could not have been made.
	if status(l, 0, puzzle.Move{At: want - 1, A: want}) != puzzle.Broke {
		t.Fatal("a swipe longer than the play so far was read")
	}
	if status(l, 0, puzzle.Move{At: 5000, A: 0}) != puzzle.Broke {
		t.Fatal("a swipe of no time was read")
	}
	// Off by more than the width is a strike; the reader forgives so many.
	var bad []puzzle.Move
	for i := range strikes + 1 {
		bad = append(bad, puzzle.Move{At: (i + 1) * 3000, A: want + width + 1})
		if got, wantSt := status(l, 0, bad...), puzzle.Going; i < strikes && got != wantSt {
			t.Fatalf("%d bad swipes: status %d", i+1, got)
		}
	}
	if status(l, 0, bad...) != puzzle.Broke {
		t.Fatalf("%d bad swipes did not lock the reader", len(bad))
	}
	// At the edge of the width a swipe still reads.
	_, seen := states(l, puzzle.Log{Moves: []puzzle.Move{{At: 3000, A: want + width}, {At: 6000, A: l.Target[1] - width}}})
	if seen[1][0] != 2 || seen[1][1] != 0 {
		t.Fatalf("two swipes at the edge of the width: %v", seen[1])
	}
	for _, v := range l.Target {
		if v < l.Par[2]+width || v > l.Range-width {
			t.Fatalf("a pass wants %d ms, outside what the reader times", v)
		}
	}
}

func TestScrub(t *testing.T) {
	_, l := machine(t, puzzle.Scrub, 7)
	if slices.Min(l.Init) < 2 {
		t.Fatalf("a cell starts where it can be read: %v", l.Init)
	}
	for _, c := range l.False {
		if slices.Contains(l.Target, c) {
			t.Fatalf("cell %d is cracked and holds the reading", c)
		}
	}
	crack := l.False[0]
	var rubs []puzzle.Move
	for i := range l.Init[crack] {
		rubs = append(rubs, puzzle.Move{At: i * 100, A: crack})
	}
	if status(l, 0, rubs[:len(rubs)-1]...) != puzzle.Going || status(l, 0, rubs...) != puzzle.Broke {
		t.Fatal("a cracked cell breaks when its last layer is rubbed, and not before")
	}
	blank := slices.IndexFunc(l.Init, func(int64) bool { return true })
	for c := range l.Init {
		if !slices.Contains(l.False, int64(c)) && !slices.Contains(l.Target, int64(c)) {
			blank = c
		}
	}
	var idle []puzzle.Move
	for range 9 {
		idle = append(idle, puzzle.Move{A: int64(blank)})
	}
	if status(l, 0, idle...) != puzzle.Going || status(l, 0, puzzle.Move{A: l.Size * l.Size}) != puzzle.Broke {
		t.Fatal("a blank cell rubbed bare is nothing; a cell off the plate is a break")
	}
	// Grit creeps back onto the reading, never past what the cell began with.
	if len(l.Track) == 0 {
		t.Fatal("no grit creeps back at level 7")
	}
	c := l.Track[1]
	out, seen := states(l, puzzle.Log{Moves: []puzzle.Move{{At: 0, A: c}}, End: far})
	if got := seen[len(seen)-1][c]; out.Status != puzzle.Going || seen[0][c] != l.Init[c]-1 || got != l.Init[c] {
		t.Fatalf("cell %d rubbed once and left: %d layers, began with %d", c, got, l.Init[c])
	}
}

func TestSplice(t *testing.T) {
	p, l := machine(t, puzzle.Splice, 9)
	cells := l.Size * l.Range
	if len(l.False) == 0 || len(l.Track) == 0 {
		t.Fatalf("level 9 has gaps and twitches: %v %v", l.False, l.Track)
	}
	if l.False[0] == 0 || l.False[len(l.False)-1] == int64(len(l.Order))-1 {
		t.Fatalf("a gap at an end of the trace: %v", l.False)
	}
	for i := 1; i < len(l.Order); i++ {
		a, b := l.Order[i-1], l.Order[i]
		if d := b - a; d != 1 && d != l.Size && d != -l.Size {
			t.Fatalf("the trace jumps from cell %d to %d", a, b)
		}
	}
	if l.Order[0]%l.Size != 0 || l.Order[len(l.Order)-1]%l.Size != l.Size-1 {
		t.Fatal("the trace does not run edge to edge")
	}
	down := func(c int64) puzzle.Move { return puzzle.Move{A: c, C: 2} }
	drag := func(c int64) puzzle.Move { return puzzle.Move{A: c, C: 1} }
	off := (l.Order[0] + l.Size*2) % cells
	if status(l, 0, down(off), drag(off)) != puzzle.Going {
		t.Fatal("an iron set down off the trace did something")
	}
	if status(l, 0, down(l.Order[0]), drag(off)) != puzzle.Broke {
		t.Fatal("dragging off the trace did not bridge the board")
	}
	if status(l, 0, down(cells)) != puzzle.Broke || status(l, 0, puzzle.Move{A: 0, C: 3}) != puzzle.Broke {
		t.Fatal("a move the iron cannot make was played")
	}
	// Up to the first gap by dragging; across it only by lifting.
	gap := l.False[0]
	run := []puzzle.Move{down(l.Order[0])}
	for i := int64(1); i < gap; i++ {
		run = append(run, drag(l.Order[i]))
	}
	far := gap
	for slices.Contains(l.False, far) {
		far++
	}
	if status(l, 0, append(slices.Clone(run), drag(l.Order[gap]))...) != puzzle.Broke ||
		status(l, 0, append(slices.Clone(run), drag(l.Order[far]))...) != puzzle.Broke {
		t.Fatal("the iron was dragged across a gap")
	}
	_, seen := states(l, puzzle.Log{Moves: append(slices.Clone(run), puzzle.Move{A: l.Order[gap-1]}, down(l.Order[far]))})
	if got := seen[len(seen)-1]; got[0] != far+1 {
		t.Fatalf("lifted over the gap, %d positions soldered, want %d", got[0], far+1)
	}
	// A twitch moves the loose end: Solve follows it and still finishes.
	out, seen := states(l, p.Solve(l))
	if out.Status != puzzle.Done || !slices.ContainsFunc(seen, func(s []int64) bool { return s[1] != 0 }) {
		t.Fatalf("Solve finished without the trace ever twitching: %+v", out)
	}
	if hints := p.Hints(l); hints[0].A != l.Order[far] || hints[0].B != far {
		t.Fatalf("the first hint is %+v, want the far side of the first gap, position %d", hints[0], far)
	}
}
