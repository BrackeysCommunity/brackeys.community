package puzzle_test

import (
	"fmt"
	"math/rand/v2"
	"reflect"
	"slices"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/sheets"
)

var timed = []string{puzzle.Pressure, puzzle.Crank, puzzle.Leak, puzzle.Keycard, puzzle.Scrub, puzzle.Splice}

func book(t *testing.T) *sheets.Book {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// shapes are the looks every family has a puzzles.shapes row for.
var shapes = []int64{0, 1}

// machines is every level, tier, shape and screen a family is checked at.
func machines(fam string) []puzzle.Spec {
	var out []puzzle.Spec
	for level := int64(1); level <= 12; level++ {
		for tier := int64(1); tier <= 4; tier++ {
			for _, shape := range shapes {
				for _, compact := range []bool{false, true} {
					out = append(out, puzzle.Spec{Family: fam, Level: level, Tier: tier,
						Place: "tile:3,-2", Beat: level*10 + tier, Compact: compact, Shape: shape})
				}
			}
		}
	}
	return out
}

func name(s puzzle.Spec) string {
	return fmt.Sprintf("%s level %d tier %d shape %d compact %v attempt %d", s.Family, s.Level, s.Tier, s.Shape, s.Compact, s.Attempt)
}

// cutShort is the first half of a log, stopped at its last move.
func cutShort(log puzzle.Log) puzzle.Log {
	half := puzzle.Log{Moves: log.Moves[:len(log.Moves)/2]}
	if n := len(half.Moves); n > 0 {
		half.End = half.Moves[n-1].At
	}
	return half
}

// shifted is a log with every stamp moved later.
func shifted(log puzzle.Log, by int64) puzzle.Log {
	out := puzzle.Log{Moves: slices.Clone(log.Moves)}
	for i := range out.Moves {
		out.Moves[i].At += by
	}
	if log.End > 0 {
		out.End = log.End + by
	}
	return out
}

func TestFourteenFamilies(t *testing.T) {
	p := puzzles(t)
	if got := p.All(); len(got) != 14 {
		t.Fatalf("%d families: %v", len(got), got)
	}
	for _, fam := range p.All() {
		if !p.Known(fam) {
			t.Fatalf("%s has no layout row or no rule", fam)
		}
		if got, want := len(puzzle.Keys(fam)) > 0, slices.Contains(timed, fam); got != want {
			t.Fatalf("%s: on the clock %v, want %v", fam, got, want)
		}
	}
	if p.Known("no-such-family") {
		t.Fatal("an unknown family is known")
	}
}

// Solve's log solves every family's machine at every level, tier, shape
// and screen inside the countdown at no practice; half of it does not;
// and an empty or late log haywires.
func TestSolveSolves(t *testing.T) {
	p := puzzles(t)
	grace := p.Param("network-grace") * 1000
	for _, fam := range p.All() {
		for _, s := range machines(fam) {
			l := p.Make(s)
			if again := p.Make(s); !reflect.DeepEqual(l, again) {
				t.Fatalf("%s: the same spec gave two layouts", name(s))
			}
			if (l.Step > 0) != slices.Contains(timed, fam) {
				t.Fatalf("%s: step %d", name(s), l.Step)
			}
			cd := p.Countdown(fam, s.Level, s.Tier, 0)
			lim := puzzle.Limits{Countdown: cd, Elapsed: -1}
			log := p.Solve(l)
			r := p.Play(s, log, lim)
			if !r.Solved || r.Haywire != "" || r.At > cd {
				t.Fatalf("%s: Solve's log did not solve inside %d ms: %+v (%d moves, end %d)", name(s), cd, r, len(log.Moves), log.End)
			}
			// The server's clock agreeing with the log changes nothing.
			if seen := p.Play(s, log, puzzle.Limits{Countdown: cd, Elapsed: r.At}); seen != r {
				t.Fatalf("%s: with the server's clock at the solve: %+v, want %+v", name(s), seen, r)
			}
			if r := p.Play(s, cutShort(log), lim); r.Solved || r.Haywire == "" {
				t.Fatalf("%s: half a log solved: %+v", name(s), r)
			}
			if r := p.Play(s, puzzle.Log{}, lim); r.Solved || r.Haywire == "" {
				t.Fatalf("%s: an empty log solved: %+v", name(s), r)
			}
			if r := p.Play(s, puzzle.Log{End: cd}, lim); r.Solved || r.Haywire == "" {
				t.Fatalf("%s: waiting solved: %+v", name(s), r)
			}
			if r := p.Play(s, shifted(log, cd+grace+1), lim); r.Solved || r.Haywire == "" {
				t.Fatalf("%s: a late log solved: %+v", name(s), r)
			}
			if r := p.Play(s, log, puzzle.Limits{Countdown: cd, Elapsed: cd + grace + 1}); r.Solved || !r.Late || r.Haywire == "" {
				t.Fatalf("%s: a log sent after the countdown: %+v", name(s), r)
			}
		}
	}
}

// The same log gives the same fact twice, on two worlds built from the
// same sheets and key.
func TestReplayTwice(t *testing.T) {
	p, q := puzzles(t), puzzles(t)
	for _, fam := range p.All() {
		for _, s := range machines(fam) {
			cd := p.Countdown(fam, s.Level, s.Tier, 0)
			lim := puzzle.Limits{Countdown: cd, Elapsed: -1, Master: true}
			solve := p.Solve(p.Make(s))
			for what, log := range map[string]puzzle.Log{"solve": solve, "cut-short": cutShort(solve), "empty": {}} {
				first, second, other := p.Play(s, log, lim), p.Play(s, log, lim), q.Play(s, log, lim)
				if first != second || first != other {
					t.Fatalf("%s, %s: %+v, then %+v, and on a second world %+v", name(s), what, first, second, other)
				}
			}
		}
	}
}

// A second try at a machine is not the first one over again, and a phone
// is held to the family's cap.
func TestAttemptsAndCaps(t *testing.T) {
	p := puzzles(t)
	caps := map[string]int64{}
	for _, l := range book(t).PuzzleLayouts {
		caps[l.Family] = l.PhoneMax
	}
	for _, fam := range p.All() {
		differs := false
		for _, s := range machines(fam) {
			l := p.Make(s)
			if c := caps[fam]; s.Compact && c > 0 && l.Size > c {
				t.Fatalf("%s: size %d over the phone's %d", name(s), l.Size, c)
			}
			if s.Compact && caps[fam] == 0 {
				full := s
				full.Compact = false
				if !reflect.DeepEqual(l, p.Make(full)) {
					t.Fatalf("%s: a family with no cap changed on a phone", name(s))
				}
			}
			s.Attempt = 1
			again := p.Make(s)
			differs = differs || !reflect.DeepEqual(l, again)
			if r := p.Play(s, p.Solve(again), puzzle.Limits{Countdown: p.Countdown(fam, s.Level, s.Tier, 0), Elapsed: -1}); !r.Solved {
				t.Fatalf("%s: Solve's log did not solve a second try: %+v", name(s), r)
			}
		}
		if !differs {
			t.Fatalf("%s: every second try was the first machine again", fam)
		}
	}
}

// For the families played move by move, Play gives what Replay gives.
func TestPlayMatchesReplay(t *testing.T) {
	p := puzzles(t)
	for _, fam := range firstEight {
		for _, s := range machines(fam) {
			if s.Compact || s.Shape > 0 {
				continue
			}
			l := p.Generate(fam, s.Level, s.Tier, s.Where())
			if !reflect.DeepEqual(l, p.Make(s)) {
				t.Fatalf("%s: Make and Generate differ", name(s))
			}
			cd := p.Countdown(fam, s.Level, s.Tier, 0)
			moves := puzzle.Solve(l)
			for i := range moves {
				moves[i].At = int64(i) * 700
			}
			want := p.Replay(l, moves, cd, s.Where())
			if got := p.Play(s, puzzle.Log{Moves: moves}, puzzle.Limits{Countdown: cd, Elapsed: -1}); got != want {
				t.Fatalf("%s: Play %+v, Replay %+v", name(s), got, want)
			}
		}
	}
}

// A master who solves the machine and then its inner panel inside the
// same countdown has the third outcome; nobody else is shown or paid it.
func TestMaster(t *testing.T) {
	p := puzzles(t)
	for _, fam := range p.All() {
		for _, shape := range shapes {
			master(t, p, puzzle.Spec{Family: fam, Level: 2, Tier: 1, Place: "floor:barrow/1", Beat: 4, Shape: shape})
		}
	}
}

func master(t *testing.T, p *puzzle.Puzzles, s puzzle.Spec) {
	t.Helper()
	fam := s.Family
	cd := p.Countdown(fam, s.Level, s.Tier, 0)
	l, inner := p.Make(s), p.Inner(s)
	up := puzzle.Spec{Family: fam, Level: s.Level + p.Param("inner-levels"), Tier: 1, Place: s.Place, Beat: s.Beat, Shape: s.Shape}
	if inner.Level != up.Level || inner.Family != fam || inner.Shape != s.Shape || inner.Decoys != p.Make(up).Decoys+p.Param("inner-decoys") {
		t.Fatalf("%s: inner panel is %s level %d shape %d with %d decoys", name(s), inner.Family, inner.Level, inner.Shape, inner.Decoys)
	}
	if reflect.DeepEqual(inner, p.Make(up)) {
		t.Fatalf("%s: the inner panel is the machine at its level", name(s))
	}
	log := masterLog(p, l, inner)
	r := p.Play(s, log, puzzle.Limits{Countdown: cd, Elapsed: -1, Master: true})
	if !r.Solved || !r.Master {
		t.Fatalf("%s: both panels solved, but %+v", name(s), r)
	}
	if p.HaulPercent(r) != p.HaulPercent(puzzle.Result{Solved: true, Clean: true}) {
		t.Fatalf("%s: a master's solve is not paid as clean", name(s))
	}
	plain := p.Play(s, log, puzzle.Limits{Countdown: cd, Elapsed: -1})
	if !plain.Solved || plain.Master || plain.At != r.At {
		t.Fatalf("%s: without mastery the same log gave %+v", name(s), plain)
	}
	// A failed inner panel costs nothing.
	bad := puzzle.Log{Moves: append(slices.Clone(p.Solve(l).Moves), puzzle.Move{At: r.At + 1, A: -1})}
	if got := p.Play(s, bad, puzzle.Limits{Countdown: cd, Elapsed: -1, Master: true}); !got.Solved || got.Master || got.Clean != plain.Clean {
		t.Fatalf("%s: a broken inner panel gave %+v", name(s), got)
	}
}

// masterLog solves a machine and then its inner panel.
func masterLog(p *puzzle.Puzzles, l, inner puzzle.Layout) puzzle.Log {
	first := p.Solve(l)
	at := puzzle.RunLog(l, nil, first, first.End+1<<40, nil).At
	second := shifted(p.Solve(inner), at)
	return puzzle.Log{Moves: append(slices.Clone(first.Moves), second.Moves...), End: second.End}
}

func TestLimits(t *testing.T) {
	p := puzzles(t)
	grace := p.Param("network-grace") * 1000
	s := puzzle.Spec{Family: puzzle.Fuse, Level: 2, Tier: 1, Place: "floor:d/1", Beat: 2}
	cd := p.Countdown(s.Family, s.Level, s.Tier, 0)
	log := p.Solve(p.Make(s))
	at := log.Moves[len(log.Moves)-1].At

	// A clean solve needs half the countdown left on the server's clock,
	// whatever the log says of itself.
	if r := p.Play(s, log, puzzle.Limits{Countdown: cd, Elapsed: at}); !r.Clean {
		t.Fatalf("a quick solve is clean: %+v", r)
	}
	if r := p.Play(s, log, puzzle.Limits{Countdown: cd, Elapsed: cd/2 + grace + 1}); !r.Solved || r.Clean {
		t.Fatalf("a solve the server saw late is solved, not clean: %+v", r)
	}
	// A move stamped later than the server has seen is not played.
	ahead := shifted(log, cd/2)
	if r := p.Play(s, ahead, puzzle.Limits{Countdown: cd, Elapsed: at}); r.Solved {
		t.Fatalf("moves from the future solved: %+v", r)
	}
	// A bench has no countdown and no haywire: never clean, and bounded
	// only by the longest play.
	slow := shifted(log, cd*3)
	if r := p.Play(s, slow, puzzle.Limits{Elapsed: -1, Bench: true}); !r.Solved || r.Clean {
		t.Fatalf("a slow bench solve: %+v", r)
	}
	if r := p.Play(s, shifted(log, p.MaxPlay()+1), puzzle.Limits{Elapsed: -1, Bench: true}); r.Solved || r.Haywire != "" {
		t.Fatalf("a bench solve past the longest play: %+v", r)
	}
	// A log too long to replay is a haywire, however it ends.
	knobs := puzzle.Spec{Family: puzzle.Signal, Level: 1, Tier: 1, Place: "x"}
	set := p.Solve(p.Make(knobs)).Moves
	long := puzzle.Log{Moves: append(make([]puzzle.Move, p.Param("max-moves")-int64(len(set))), set...)}
	if r := p.Play(knobs, long, puzzle.Limits{Countdown: cd, Elapsed: -1}); !r.Solved {
		t.Fatalf("a log at the move cap: %+v", r)
	}
	long.Moves = append([]puzzle.Move{{}}, long.Moves...)
	if r := p.Play(knobs, long, puzzle.Limits{Countdown: cd, Elapsed: -1}); r.Solved || r.Haywire == "" {
		t.Fatalf("a log over the move cap: %+v", r)
	}
	// Moves out of order stop the replay.
	back := slices.Clone(log.Moves)
	back[0].At, back[1].At = back[1].At, back[0].At
	if r := p.Play(s, puzzle.Log{Moves: back}, puzzle.Limits{Countdown: cd, Elapsed: -1}); r.Solved {
		t.Fatalf("moves out of order solved: %+v", r)
	}
}

func wildSpecs(fam string) []puzzle.Spec {
	var out []puzzle.Spec
	for _, level := range []int64{1, 4, 9} {
		for _, shape := range shapes {
			out = append(out, puzzle.Spec{Family: fam, Level: level, Tier: 2, Place: "tile:0,0", Beat: 1, Shape: shape})
		}
	}
	return out
}

// Any log at all ends in a result: wild moves break the machine, never
// the process.
func TestWildLogs(t *testing.T) {
	p := puzzles(t)
	rng := rand.New(rand.NewPCG(7, 11))
	wild := []int64{-1 << 40, -2, -1, 0, 1, 2, 3, 5, 9, 60, 300, 1 << 40}
	for _, fam := range p.All() {
		for _, s := range wildSpecs(fam) {
			cd := p.Countdown(fam, s.Level, 2, 0)
			solve := p.Solve(p.Make(s)).Moves
			for range 400 {
				var log puzzle.Log
				var at int64
				for range 1 + rng.IntN(40) {
					at += rng.Int64N(400)
					m := puzzle.Move{At: at, A: wild[rng.IntN(len(wild))], B: wild[rng.IntN(len(wild))], C: wild[rng.IntN(len(wild))]}
					// Mostly real moves, so the replay gets somewhere before it is knocked.
					if rng.IntN(3) > 0 {
						known := solve[rng.IntN(len(solve))]
						m.A, m.B, m.C = known.A, known.B, known.C
					}
					if rng.IntN(50) == 0 {
						m.At = wild[rng.IntN(len(wild))]
					}
					log.Moves = append(log.Moves, m)
				}
				log.End = at + rng.Int64N(cd)
				for _, master := range []bool{false, true} {
					lim := puzzle.Limits{Countdown: cd, Elapsed: -1, Master: master}
					if a, b := p.Play(s, log, lim), p.Play(s, log, lim); a != b {
						t.Fatalf("%s: %+v then %+v", name(s), a, b)
					}
				}
			}
		}
	}
}

// Every cell a family on the clock reads is in the sheet.
func TestTuningRows(t *testing.T) {
	rows := map[string]bool{}
	for _, r := range book(t).PuzzleTuning {
		if r.ID != r.Family+"-"+r.Key {
			t.Errorf("puzzles.tuning %s: the id is the family, a dash, the key", r.ID)
		}
		rows[r.ID] = true
	}
	read := map[string]bool{}
	for _, fam := range timed {
		for _, k := range puzzle.Keys(fam) {
			read[fam+"-"+k] = true
			if !rows[fam+"-"+k] {
				t.Errorf("%s reads %q, which has no puzzles.tuning row", fam, k)
			}
		}
	}
	for id := range rows {
		if !read[id] {
			t.Errorf("puzzles.tuning %s is read by no family", id)
		}
	}
}

// Hints never give more than the layout already holds, and every family
// has a guide line.
func TestHints(t *testing.T) {
	p := puzzles(t)
	for _, fam := range p.All() {
		for _, s := range machines(fam) {
			l := p.Make(s)
			if len(p.Solve(l).Moves) == 0 {
				t.Fatalf("%s: no first move for a guide line", name(s))
			}
			hints := p.Hints(l)
			if !reflect.DeepEqual(hints, p.Hints(l)) {
				t.Fatalf("%s: hints differ from one call to the next", name(s))
			}
			if len(hints) == 0 && fam != puzzle.Splice {
				t.Fatalf("%s: no hints", name(s))
			}
		}
	}
}

// A shape is drawn by weight among those open at the level, the same way
// every time; below a later shape's level, and on the frozen sheets,
// there is only the first.
func TestShapeDraw(t *testing.T) {
	p, q, frozen := puzzles(t), puzzles(t), frozenPuzzles(t)
	rows := map[string]int64{}
	for _, r := range book(t).PuzzleShapes {
		if r.Shape > 0 {
			rows[r.Family] = r.MinLevel
		}
	}
	for _, fam := range p.All() {
		if got := p.Shapes(fam); !slices.Equal(got, shapes) {
			t.Fatalf("%s has shapes %v, want %v", fam, got, shapes)
		}
		count := map[int64]int{}
		for level := int64(1); level <= 12; level++ {
			for beat := range int64(40) {
				w := puzzle.Where{Place: fmt.Sprintf("tile:%d,%d", beat, -level), Beat: beat}
				got := p.Shape(fam, level, w)
				if got != q.Shape(fam, level, w) || got != p.Shape(fam, level, w) {
					t.Fatalf("%s level %d: the shape draw moved", fam, level)
				}
				if frozen.Shape(fam, level, w) != 0 {
					t.Fatalf("%s level %d: a shape past the first on the frozen sheets", fam, level)
				}
				if level < rows[fam] && got != 0 {
					t.Fatalf("%s level %d: shape %d below its level %d", fam, level, got, rows[fam])
				}
				if level >= rows[fam] {
					count[got]++
				}
			}
		}
		// Even weights: each shape within a third of half the draws.
		n := count[0] + count[1]
		if lo := n / 3; count[0] < lo || count[1] < lo {
			t.Fatalf("%s: shapes drawn %v", fam, count)
		}
	}
}

// A shape past the first is its own machine: it says its shape, is drawn
// afresh, and a second try at it is another machine again.
func TestShapedLayouts(t *testing.T) {
	p := puzzles(t)
	for _, fam := range p.All() {
		s := puzzle.Spec{Family: fam, Level: 7, Tier: 1, Place: "tile:4,4", Beat: 2}
		first := p.Make(s)
		s.Shape = 1
		shaped := p.Make(s)
		if first.Shape != 0 || shaped.Shape != 1 {
			t.Fatalf("%s: shapes %d and %d", fam, first.Shape, shaped.Shape)
		}
		if shaped.Size != first.Size || shaped.Decoys != first.Decoys {
			t.Fatalf("%s: shape 1 is size %d with %d decoys, shape 0 %d with %d", fam, shaped.Size, shaped.Decoys, first.Size, first.Decoys)
		}
		unshaped := shaped
		unshaped.Shape, unshaped.Range = 0, first.Range
		if reflect.DeepEqual(unshaped, first) {
			t.Fatalf("%s: shape 1 was laid on shape 0's stream", fam)
		}
		s.Attempt = 1
		if reflect.DeepEqual(p.Make(s), shaped) {
			t.Fatalf("%s: a second try at shape 1 was the first again", fam)
		}
	}
}

// structural: a hex cell's sides, and the hex tile kinds a circuit draws.
const (
	hexSides = 6
	hexKinds = 6
)

// A hex maze has six sides a cell, walls that agree from both sides, a
// closed rim, and every cell reachable.
func TestHexMaze(t *testing.T) {
	p := puzzles(t)
	diagonal := false
	for level := int64(1); level <= 12; level++ {
		l := p.Make(puzzle.Spec{Family: puzzle.Maze, Level: level, Tier: 1, Place: "tile:1,1", Beat: level, Shape: 1})
		n := l.Size
		at := func(q, r int64) int64 { return r*n + q }
		// E, SE, SW, W, NW, NE in axial steps.
		dq := []int64{1, 0, -1, -1, 0, 1}
		dr := []int64{0, 1, 1, 0, -1, -1}
		seen := map[int64]bool{0: true}
		queue := []int64{0}
		for len(queue) > 0 {
			c := queue[0]
			queue = queue[1:]
			if l.Walls[c] < 0 || l.Walls[c] >= 1<<hexSides {
				t.Fatalf("level %d: cell %d walls %b", level, c, l.Walls[c])
			}
			q, r := c%n, c/n
			for d := range int64(hexSides) {
				nq, nr := q+dq[d], r+dr[d]
				open := l.Walls[c]&(1<<d) == 0
				if nq < 0 || nr < 0 || nq >= n || nr >= n {
					if open {
						t.Fatalf("level %d: cell %d is open off the board to side %d", level, c, d)
					}
					continue
				}
				nb := at(nq, nr)
				if back := l.Walls[nb]&(1<<((d+hexSides/2)%hexSides)) == 0; back != open {
					t.Fatalf("level %d: the wall between %d and %d differs from its two sides", level, c, nb)
				}
				if open && !seen[nb] {
					seen[nb] = true
					queue = append(queue, nb)
				}
			}
		}
		if int64(len(seen)) != n*n {
			t.Fatalf("level %d: %d of %d cells reachable", level, len(seen), n*n)
		}
		for _, m := range p.Solve(l).Moves {
			diagonal = diagonal || m.A == 1 || m.A == 4 || m.A == 2 || m.A == 5
		}
		if status(l, 0, puzzle.Move{A: hexSides}) != puzzle.Broke || status(l, 0, puzzle.Move{A: hexSides - 1}) == puzzle.Broke {
			t.Fatalf("level %d: a hex tilt is A in [0, 6)", level)
		}
	}
	if !diagonal {
		t.Fatal("no hex maze's solve leaves the east-west line along a hex side")
	}
	square := p.Make(puzzle.Spec{Family: puzzle.Maze, Level: 5, Tier: 1, Place: "tile:1,1", Beat: 5})
	if status(square, 0, puzzle.Move{A: 4}) != puzzle.Broke {
		t.Fatal("a square maze took a fifth side")
	}
}

// A hex circuit is laid from hex tiles turned in sixths: power leaves the
// source and reaches the load through ends, and six turns of a tile bring
// it back.
func TestHexCircuit(t *testing.T) {
	p := puzzles(t)
	kinds := map[int64]bool{}
	for level := int64(1); level <= 12; level++ {
		l := p.Make(puzzle.Spec{Family: puzzle.Circuit, Level: level, Tier: 1, Place: "tile:1,1", Beat: level, Shape: 1})
		last := l.Size*l.Size - 1
		for c, k := range l.Tiles {
			if k < 0 || k >= hexKinds || l.Turn[c] < 0 || l.Turn[c] >= hexSides {
				t.Fatalf("level %d: tile %d is kind %d at turn %d", level, c, k, l.Turn[c])
			}
			kinds[k] = true
		}
		if end := int64(hexKinds - 1); l.Tiles[0] != end || l.Tiles[last] != end {
			t.Fatalf("level %d: the source and load are kinds %d and %d, not ends", level, l.Tiles[0], l.Tiles[last])
		}
		var six []puzzle.Move
		for range hexSides {
			six = append(six, puzzle.Move{A: 0})
		}
		_, seen := states(l, puzzle.Log{Moves: six})
		if seen[0][0] != (l.Turn[0]+1)%hexSides || seen[hexSides-1][0] != l.Turn[0] {
			t.Fatalf("level %d: six turns of the source went %d, then %d from %d", level, seen[0][0], seen[hexSides-1][0], l.Turn[0])
		}
	}
	for k := range int64(hexKinds) {
		if !kinds[k] {
			t.Fatalf("no hex circuit holds tile kind %d: %v", k, kinds)
		}
	}
}

// Override's ring pad has the shape row's six symbols.
func TestOverrideRing(t *testing.T) {
	p := puzzles(t)
	s := puzzle.Spec{Family: puzzle.Override, Level: 12, Tier: 1, Place: "tile:1,1", Beat: 1}
	pad := p.Make(s)
	s.Shape = 1
	ring := p.Make(s)
	if pad.Range != 4 || ring.Range != 6 || slices.Max(ring.Order) < pad.Range || slices.Max(ring.Order) >= ring.Range {
		t.Fatalf("pad of %d, ring of %d holding %v", pad.Range, ring.Range, ring.Order)
	}
}

// The opening Rewire's band under the Battle model, the odds band its
// solve rate reaches, is at most one band worse than on MM7's puzzle
// sheets, for all its look-alike port.
func TestIntroBand(t *testing.T) {
	bands := book(t).OddsBands
	bandOf := func(p *puzzle.Puzzles) (int64, string) {
		fam, level := p.IntroMachine()
		rate := p.SolveRate(fam, 0, level, 1, 1)
		rank := bands[0].Rank
		for _, b := range bands {
			if b.Chance <= rate && b.Rank > rank {
				rank = b.Rank
			}
		}
		return rank, rate.String()
	}
	p, mm7 := puzzles(t), frozenPuzzles(t)
	fam, level := p.IntroMachine()
	if l := p.Make(puzzle.Spec{Family: fam, Level: level, Tier: 1, Place: "tile:0,0"}); l.Size != p.Param("intro-wires") || l.Decoys != 1 {
		t.Fatalf("the opening Rewire has %d wires and %d look-alike ports", l.Size, l.Decoys)
	}
	now, rate := bandOf(p)
	was, old := bandOf(mm7)
	if now < was-1 {
		t.Fatalf("the opening machine's band fell from %d (%s) to %d (%s)", was, old, now, rate)
	}
}
