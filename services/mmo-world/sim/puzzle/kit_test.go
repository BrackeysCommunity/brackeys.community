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

// machines is every level, tier and screen a family is checked at.
func machines(fam string) []puzzle.Spec {
	var out []puzzle.Spec
	for level := int64(1); level <= 12; level++ {
		for tier := int64(1); tier <= 4; tier++ {
			for _, compact := range []bool{false, true} {
				out = append(out, puzzle.Spec{Family: fam, Level: level, Tier: tier,
					Place: "tile:3,-2", Beat: level*10 + tier, Compact: compact})
			}
		}
	}
	return out
}

func name(s puzzle.Spec) string {
	return fmt.Sprintf("%s level %d tier %d compact %v attempt %d", s.Family, s.Level, s.Tier, s.Compact, s.Attempt)
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

// Solve's log solves every family's machine at every level, tier and
// screen inside the countdown at no practice; half of it does not; and an
// empty or late log haywires.
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

// The eight families that were played before the kit give through Play
// what Replay gives.
func TestPlayMatchesReplay(t *testing.T) {
	p := puzzles(t)
	for _, fam := range firstEight {
		for _, s := range machines(fam) {
			if s.Compact {
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
		s := puzzle.Spec{Family: fam, Level: 2, Tier: 1, Place: "floor:barrow/1", Beat: 4}
		cd := p.Countdown(fam, s.Level, s.Tier, 0)
		l, inner := p.Make(s), p.Inner(s)
		if inner.Level != s.Level+1 || inner.Family != fam {
			t.Fatalf("%s: inner panel is %s level %d", fam, inner.Family, inner.Level)
		}
		if reflect.DeepEqual(inner, p.Make(puzzle.Spec{Family: fam, Level: s.Level + 1, Tier: 1, Place: s.Place, Beat: s.Beat})) {
			t.Fatalf("%s: the inner panel is the machine one level up", fam)
		}
		log := masterLog(p, l, inner)
		r := p.Play(s, log, puzzle.Limits{Countdown: cd, Elapsed: -1, Master: true})
		if !r.Solved || !r.Master {
			t.Fatalf("%s: both panels solved, but %+v", fam, r)
		}
		if p.HaulPercent(r) != p.HaulPercent(puzzle.Result{Solved: true, Clean: true}) {
			t.Fatalf("%s: a master's solve is not paid as clean", fam)
		}
		plain := p.Play(s, log, puzzle.Limits{Countdown: cd, Elapsed: -1})
		if !plain.Solved || plain.Master || plain.At != r.At {
			t.Fatalf("%s: without mastery the same log gave %+v", fam, plain)
		}
		// A failed inner panel costs nothing.
		bad := puzzle.Log{Moves: append(slices.Clone(p.Solve(l).Moves), puzzle.Move{At: r.At + 1, A: -1})}
		if got := p.Play(s, bad, puzzle.Limits{Countdown: cd, Elapsed: -1, Master: true}); !got.Solved || got.Master || got.Clean != plain.Clean {
			t.Fatalf("%s: a broken inner panel gave %+v", fam, got)
		}
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
	// A bench has no countdown: never clean, and bounded only by the
	// longest play.
	slow := shifted(log, cd*3)
	if r := p.Play(s, slow, puzzle.Limits{Elapsed: -1}); !r.Solved || r.Clean {
		t.Fatalf("a slow bench solve: %+v", r)
	}
	if r := p.Play(s, shifted(log, p.Param("max-play-seconds")*1000+1), puzzle.Limits{Elapsed: -1}); r.Solved {
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

// Any log at all ends in a result: wild moves break the machine, never
// the process.
func TestWildLogs(t *testing.T) {
	p := puzzles(t)
	rng := rand.New(rand.NewPCG(7, 11))
	wild := []int64{-1 << 40, -2, -1, 0, 1, 2, 3, 5, 9, 60, 300, 1 << 40}
	for _, fam := range p.All() {
		for _, level := range []int64{1, 4, 9} {
			s := puzzle.Spec{Family: fam, Level: level, Tier: 2, Place: "tile:0,0", Beat: 1}
			cd := p.Countdown(fam, level, 2, 0)
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
