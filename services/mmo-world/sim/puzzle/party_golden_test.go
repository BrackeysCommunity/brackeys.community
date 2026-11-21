package puzzle_test

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/puzzle"
)

var versionsFlag = flag.String("versions", "", "with -update, the party versions whose vectors to rewrite, comma-separated (default: every version)")

// The party vectors hold every client's model of a party version to this
// package's: one layout every seat shares, each seat's dealt part of it,
// and merged logs played against it. One file a version.
type partyFile struct {
	Version string      `json:"version"`
	Family  string      `json:"family"`
	Cases   []partyCase `json:"cases"`
}

type partyHead struct {
	Name      string          `json:"name"`
	Spec      puzzle.Spec     `json:"spec"`
	Countdown int64           `json:"countdown"`
	Horizon   int64           `json:"horizon"`
	Layout    puzzle.Layout   `json:"layout"`
	Parts     []puzzle.Layout `json:"parts"`
}

type partyCase struct {
	partyHead
	Logs []partyLog `json:"logs"`
}

type partyLog struct {
	Name    string         `json:"name"`
	Log     puzzle.Log     `json:"log"`
	Outcome puzzle.Outcome `json:"outcome"`
	Result  puzzle.Result  `json:"result"`
	Trace   []goldenState  `json:"trace"`
}

var (
	partySeats  = []int64{2, 3, 4}
	partyShapes = []int64{0, 1}
)

// allVersions is every registered party version, in family then id order.
func allVersions(p *puzzle.Puzzles) []string {
	var out []string
	for _, fam := range p.All() {
		out = append(out, puzzle.PartyVersions(fam)...)
	}
	return out
}

func partySpec(version string, level, seats, shape int64) puzzle.Spec {
	return puzzle.Spec{Family: puzzle.PartyFamily(version), Level: level, Tier: 1, Place: "floor:0,0/1", Beat: level,
		Party: version, Seats: seats, Shape: shape}
}

func partyName(s puzzle.Spec) string {
	return fmt.Sprintf("%s level %d seats %d shape %d", s.Party, s.Level, s.Seats, s.Shape)
}

// runTrace plays a merged log and keeps every state it passes through.
func runTrace(l puzzle.Layout, log puzzle.Log, horizon int64) (puzzle.Outcome, [][]int64) {
	var states [][]int64
	out := puzzle.RunParty(l, log, horizon, func(_ int64, s []int64) { states = append(states, s) })
	return out, states
}

// partyEnd plays moves against a party layout and gives the status and
// the last state.
func partyEnd(l puzzle.Layout, moves ...puzzle.Move) (puzzle.Status, []int64) {
	out, states := runTrace(l, puzzle.Log{Moves: moves}, math.MaxInt64)
	return out.Status, states[len(states)-1]
}

func withMoves(log puzzle.Log, moves []puzzle.Move) puzzle.Log {
	return puzzle.Log{Moves: moves, End: log.End}
}

// outOfPart is the solve with one move copied, right before itself, to a
// seat that does not hold its piece: a copy that changes nothing, so every
// other state is the solve's. On a machine played move by move the copy
// leaves the state as the move before left it.
func outOfPart(l puzzle.Layout, solve puzzle.Log, horizon int64) (puzzle.Log, bool) {
	want, states := runTrace(l, solve, horizon)
	_, rest := runTrace(l, puzzle.Log{}, horizon)
	before := append(rest[:1:1], states...)
	n := len(solve.Moves)
	for k := range n {
		i := (n/2 + k) % n
		for d := int64(1); d < l.Seats; d++ {
			c := solve.Moves[i]
			c.Seat = (c.Seat + d) % l.Seats
			log := withMoves(solve, slices.Insert(slices.Clone(solve.Moves), i, c))
			got, seen := runTrace(l, log, horizon)
			if got != want || len(seen) <= i || !reflect.DeepEqual(slices.Delete(slices.Clone(seen), i, i+1), states) {
				continue
			}
			if l.Step == 0 && !slices.Equal(seen[i], before[i]) {
				continue
			}
			return log, true
		}
	}
	return puzzle.Log{}, false
}

// breakLog is the solve with the first move from the middle whose A out
// of range breaks the machine.
func breakLog(l puzzle.Layout, solve puzzle.Log, horizon int64) (puzzle.Log, bool) {
	n := len(solve.Moves)
	for k := range n {
		moves := slices.Clone(solve.Moves)
		moves[(n/2+k)%n].A = -1
		log := withMoves(solve, moves)
		if out, _ := runTrace(l, log, horizon); out.Status == puzzle.Broke {
			return log, true
		}
	}
	return puzzle.Log{}, false
}

// badSeat is the solve with its middle move made by a seat the machine
// does not have.
func badSeat(l puzzle.Layout, solve puzzle.Log) puzzle.Log {
	moves := slices.Clone(solve.Moves)
	moves[len(moves)/2].Seat = l.Seats
	return withMoves(solve, moves)
}

// slowLog is the solve with the last move that, delayed past the window
// along with every move after it, leaves the machine going.
func slowLog(l puzzle.Layout, solve puzzle.Log, horizon int64) (puzzle.Log, bool) {
	for i := len(solve.Moves) - 1; i > 0; i-- {
		moves := slices.Clone(solve.Moves)
		for j := i; j < len(moves); j++ {
			moves[j].At += l.Window + 1
		}
		log := withMoves(solve, moves)
		if log.End > 0 {
			log.End += l.Window + 1
		}
		if out, _ := runTrace(l, log, horizon); out.Status == puzzle.Going {
			return log, true
		}
	}
	return puzzle.Log{}, false
}

// isUnseen reports whether one element of a dealt field is hidden.
func isUnseen(v reflect.Value) bool {
	switch x := v.Interface().(type) {
	case int64:
		return x == puzzle.Unseen
	case puzzle.Clue:
		return x == puzzle.Clue{Before: puzzle.Unseen, After: puzzle.Unseen}
	}
	return false
}

// reassembles checks the dealt parts against the layout: every part shows
// the layout or hides it, every element of a field any seat is shown is
// shown to some seat, and a field hidden from every seat is the answer
// nobody holds.
func reassembles(l puzzle.Layout, parts []puzzle.Layout) error {
	if int64(len(parts)) != l.Seats {
		return fmt.Errorf("%d parts for %d seats", len(parts), l.Seats)
	}
	whole := reflect.ValueOf(l)
	for i := range whole.NumField() {
		field, want := whole.Type().Field(i).Name, whole.Field(i)
		if want.Kind() != reflect.Slice {
			for s, part := range parts {
				if got := reflect.ValueOf(part).Field(i); !reflect.DeepEqual(got.Interface(), want.Interface()) {
					return fmt.Errorf("seat %d's %s is %v, the layout's %v", s, field, got, want)
				}
			}
			continue
		}
		shown, dealt := make([]bool, want.Len()), false
		for s, part := range parts {
			got := reflect.ValueOf(part).Field(i)
			if got.IsNil() {
				continue
			}
			dealt = true
			if got.Len() != want.Len() {
				return fmt.Errorf("seat %d's %s has %d elements, the layout's %d", s, field, got.Len(), want.Len())
			}
			for j := range want.Len() {
				if isUnseen(got.Index(j)) {
					continue
				}
				if !reflect.DeepEqual(got.Index(j).Interface(), want.Index(j).Interface()) {
					return fmt.Errorf("seat %d's %s[%d] is %v, the layout's %v", s, field, j, got.Index(j), want.Index(j))
				}
				shown[j] = true
			}
		}
		if j := slices.Index(shown, false); dealt && j >= 0 {
			return fmt.Errorf("%s[%d] is shown to no seat", field, j)
		}
	}
	return nil
}

func partyVectors(t *testing.T, p *puzzle.Puzzles, version string) partyFile {
	t.Helper()
	file := partyFile{Version: version, Family: puzzle.PartyFamily(version)}
	for _, seats := range partySeats {
		for _, shape := range partyShapes {
			for _, level := range []int64{3, 9} {
				s := partySpec(version, level, seats, shape)
				head := partyHead{Name: fmt.Sprintf("level-%d-seats-%d-shape-%d", level, seats, shape), Spec: s}
				head.Countdown = p.PartyCountdown(s, 0)
				head.Horizon = head.Countdown + p.Grace()
				head.Layout, head.Parts = p.Make(s), p.Deal(s)
				l := head.Layout
				solve := p.PartySolve(l)
				logs := []partyLog{{Name: "solve", Log: solve}, {Name: "cut-short", Log: cutShort(solve)}}
				out, ok := outOfPart(l, solve, head.Horizon)
				if !ok {
					t.Fatalf("%s: no move can be copied out of its part", partyName(s))
				}
				logs = append(logs, partyLog{Name: "out-of-part", Log: out})
				bad, ok := breakLog(l, solve, head.Horizon)
				if !ok {
					t.Fatalf("%s: no move out of range breaks it", partyName(s))
				}
				logs = append(logs, partyLog{Name: "break", Log: bad}, partyLog{Name: "bad-seat", Log: badSeat(l, solve)})
				if l.Window > 0 {
					if slow, ok := slowLog(l, solve, head.Horizon); ok {
						logs = append(logs, partyLog{Name: "slow", Log: slow})
					}
				}
				c := partyCase{partyHead: head}
				for _, g := range logs {
					var trace []goldenState
					g.Outcome = puzzle.RunParty(l, g.Log, head.Horizon, func(at int64, state []int64) {
						trace = append(trace, goldenState{len(trace), at, state})
					})
					g.Trace = thin(trace)
					g.Result = p.Play(s, g.Log, puzzle.Limits{Countdown: head.Countdown, Elapsed: -1})
					c.Logs = append(c.Logs, g)
				}
				file.Cases = append(file.Cases, c)
			}
		}
	}
	return file
}

// partyBytes writes a file one log a line, as goldenBytes does.
func partyBytes(t *testing.T, f partyFile) []byte {
	t.Helper()
	js := func(v any) []byte {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	sep := func(i, n int) string {
		if i < n-1 {
			return ",\n"
		}
		return "\n"
	}
	var b bytes.Buffer
	fmt.Fprintf(&b, "{\"version\":%s,\"family\":%s,\"cases\":[\n", js(f.Version), js(f.Family))
	for i, c := range f.Cases {
		head := js(c.partyHead)
		b.Write(head[:len(head)-1])
		b.WriteString(",\"logs\":[\n")
		for j, l := range c.Logs {
			b.Write(js(l))
			b.WriteString(sep(j, len(c.Logs)))
		}
		b.WriteString("]}" + sep(i, len(f.Cases)))
	}
	b.WriteString("]}\n")
	return b.Bytes()
}

// checkVectors holds a version's vectors to what each log is meant to
// show.
func checkVectors(t *testing.T, p *puzzle.Puzzles, f partyFile) {
	t.Helper()
	want := map[string]puzzle.Status{"solve": puzzle.Done, "out-of-part": puzzle.Done, "cut-short": puzzle.Going,
		"break": puzzle.Broke, "bad-seat": puzzle.Broke, "slow": puzzle.Going}
	slow := false
	for _, c := range f.Cases {
		if err := reassembles(c.Layout, c.Parts); err != nil {
			t.Fatalf("%s %s: the dealt parts do not make the layout: %v", f.Version, c.Name, err)
		}
		var solved puzzle.Result
		for _, l := range c.Logs {
			name := f.Version + " " + c.Name + " " + l.Name
			if l.Outcome.Status != want[l.Name] || (l.Outcome.Status == puzzle.Done) != l.Result.Solved ||
				(l.Result.Solved && (l.Outcome.At != l.Result.At || l.Result.At > c.Countdown)) {
				t.Fatalf("%s: the model says %+v, the server %+v", name, l.Outcome, l.Result)
			}
			if len(l.Trace) == 0 || len(l.Trace) > traceMax {
				t.Fatalf("%s: %d states", name, len(l.Trace))
			}
			switch l.Name {
			case "solve":
				solved = l.Result
			case "out-of-part":
				if l.Result != solved {
					t.Fatalf("%s: %+v, the solve %+v", name, l.Result, solved)
				}
			case "slow":
				slow = true
			}
			lim := puzzle.Limits{Countdown: c.Countdown, Elapsed: -1}
			if again := p.Play(c.Spec, l.Log, lim); again != l.Result {
				t.Fatalf("%s: played again %+v, first %+v", name, again, l.Result)
			}
		}
	}
	if f.Cases[0].Layout.Window > 0 && !slow {
		t.Fatalf("%s: a version with a window has no slow log", f.Version)
	}
}

// TestPartyGolden holds this package to the party vectors the clients are
// tested against. Run it with -update (and -versions to name some) to
// rewrite them after a rule changes.
func TestPartyGolden(t *testing.T) {
	p := puzzles(t)
	dir := filepath.Join("testdata", "party")
	only := map[string]bool{}
	for _, v := range strings.Split(*versionsFlag, ",") {
		if v != "" {
			only[v] = true
		}
	}
	versions := allVersions(p)
	for _, v := range versions {
		file := partyVectors(t, p, v)
		checkVectors(t, p, file)
		got := partyBytes(t, file)
		var back partyFile
		if err := json.Unmarshal(got, &back); err != nil || !reflect.DeepEqual(back, file) {
			t.Fatalf("%s: the vectors do not read back: %v", v, err)
		}
		path := filepath.Join(dir, v+".json")
		if *update {
			if len(only) > 0 && !only[v] {
				continue
			}
			if err := os.MkdirAll(dir, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, got, 0o644); err != nil {
				t.Fatal(err)
			}
			continue
		}
		want, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("%s: %v (run with -update to write the vectors)", v, err)
		}
		if !bytes.Equal(got, want) {
			gl, wl := bytes.Split(got, []byte("\n")), bytes.Split(want, []byte("\n"))
			for i := range gl {
				if i >= len(wl) || !bytes.Equal(gl[i], wl[i]) {
					t.Fatalf("%s: line %d differs from %s; run with -update if the rule was meant to change\n got %.300s", v, i+1, path, gl[i])
				}
			}
			t.Fatalf("%s: %s holds more than the code gives", v, path)
		}
	}
	if *update {
		return
	}
	files, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != len(versions) {
		t.Fatalf("%d vector files for %d party versions", len(files), len(versions))
	}
}

// checkParty is what every party version is held to at one spec: the
// same spec gives the same layout, its own Solve solves it inside the
// party countdown with every move seated, half of it does not, a copy out
// of its part changes nothing, a bad seat breaks it, the parts reassemble
// and Probe agrees with Play.
func checkParty(t *testing.T, p, q *puzzle.Puzzles, s puzzle.Spec) {
	t.Helper()
	l := p.Make(s)
	if again := p.Make(s); !reflect.DeepEqual(l, again) {
		t.Fatalf("%s: the same spec gave two layouts", partyName(s))
	}
	if l.Party != s.Party || l.Seats != s.Seats || l.Shape != s.Shape {
		t.Fatalf("%s: laid out as %q, %d seats, shape %d", partyName(s), l.Party, l.Seats, l.Shape)
	}
	cd := p.PartyCountdown(s, 0)
	lim := puzzle.Limits{Countdown: cd, Elapsed: -1}
	solve := p.PartySolve(l)
	for _, m := range solve.Moves {
		if m.Seat < 0 || m.Seat >= s.Seats {
			t.Fatalf("%s: Solve moves seat %d", partyName(s), m.Seat)
		}
	}
	r := p.Play(s, solve, lim)
	if !r.Solved || r.Haywire != "" || r.At > cd {
		t.Fatalf("%s: Solve's log did not solve inside %d ms: %+v (%d moves)", partyName(s), cd, r, len(solve.Moves))
	}
	if again, other := p.Play(s, solve, lim), q.Play(s, solve, lim); again != r || other != r {
		t.Fatalf("%s: played again %+v, on a second world %+v, first %+v", partyName(s), again, other, r)
	}
	if st := p.Probe(s, solve); st != puzzle.Done {
		t.Fatalf("%s: Probe says %v of the solve", partyName(s), st)
	}
	half := cutShort(solve)
	if r := p.Play(s, half, lim); r.Solved || r.Haywire == "" {
		t.Fatalf("%s: half a log solved: %+v", partyName(s), r)
	}
	if st := p.Probe(s, half); st != puzzle.Going {
		t.Fatalf("%s: Probe says %v of half the solve", partyName(s), st)
	}
	horizon := cd + p.Grace()
	if out, ok := outOfPart(l, solve, horizon); !ok {
		t.Fatalf("%s: no move can be copied out of its part", partyName(s))
	} else if got := p.Play(s, out, lim); got != r {
		t.Fatalf("%s: a move out of its part gave %+v, the solve %+v", partyName(s), got, r)
	}
	if st := p.Probe(s, badSeat(l, solve)); st != puzzle.Broke {
		t.Fatalf("%s: a move by seat %d gave %v", partyName(s), s.Seats, st)
	}
	if err := reassembles(l, p.Deal(s)); err != nil {
		t.Fatalf("%s: the dealt parts do not make the layout: %v", partyName(s), err)
	}
}

// TestPartySolves holds every registered party version at 2, 3 and 4
// seats, levels 1 to 12 and both shapes.
func TestPartySolves(t *testing.T) {
	p, q := puzzles(t), puzzles(t)
	for _, v := range allVersions(p) {
		for _, seats := range partySeats {
			for _, shape := range partyShapes {
				for level := int64(1); level <= 12; level++ {
					checkParty(t, p, q, partySpec(v, level, seats, shape))
				}
			}
		}
	}
}

// TestPartyMake checks the dispatch: a party spec is laid at its row's
// size, its countdown is the row's share of the solo one, a family's
// version is drawn among its rows, and a solo spec deals one whole seat.
func TestPartyMake(t *testing.T) {
	p, b := puzzles(t), book(t)
	rows := map[string]int64{}
	for _, r := range b.PartyVersions {
		rows[r.ID] = r.Countdown
	}
	for _, v := range allVersions(p) {
		s := partySpec(v, 5, 3, 0)
		if got, want := p.PartyCountdown(s, 14), fixed.PercentOf(p.Countdown(s.Family, 5, 1, 14), rows[v]); got != want {
			t.Errorf("%s: countdown %d, want %d", v, got, want)
		}
	}
	if n := p.Make(partySpec(puzzle.BigRewire, 1, 4, 0)).Size; n != 12 {
		t.Errorf("big rewire has %d wires", n)
	}
	solo := p.Make(puzzle.Spec{Family: puzzle.Signal, Level: 7, Tier: 1, Place: "floor:0,0/1", Beat: 7})
	for seats := int64(2); seats <= 4; seats++ {
		if n := p.Make(partySpec(puzzle.RelayChain, 7, seats, 0)).Size; n != solo.Size*seats {
			t.Errorf("relay chain at %d seats has %d knobs, solo %d", seats, n, solo.Size)
		}
	}
	if a, b := p.Make(partySpec(puzzle.SplitGrid, 6, 2, 0)), p.Make(partySpec(puzzle.SplitGrid, 6, 4, 0)); b.Size != a.Size+2 {
		t.Errorf("split grid: %d at two seats, %d at four", a.Size, b.Size)
	}
	if a, b := p.Make(partySpec(puzzle.BombSquad, 6, 2, 0)), p.Make(partySpec(puzzle.BombSquad, 6, 4, 0)); b.Decoys != a.Decoys+2 || b.Size != a.Size {
		t.Errorf("bomb squad: %d/%d at two seats, %d/%d at four", a.Size, a.Decoys, b.Size, b.Decoys)
	}
	a, again := partySpec(puzzle.TwoAxisTilt, 6, 2, 0), partySpec(puzzle.TwoAxisTilt, 6, 2, 0)
	again.Attempt = 1
	if reflect.DeepEqual(p.Make(a).Walls, p.Make(again).Walls) {
		t.Error("a second try at a party machine is the first over again")
	}
	if p.PartyVersion("no-such-family", puzzle.Where{}) != "" {
		t.Error("a family with no party version drew one")
	}
	seen := map[string]bool{}
	for beat := range int64(40) {
		w := puzzle.Where{Place: "floor:0,0/1", Beat: beat}
		v := p.PartyVersion(puzzle.Rewire, w)
		if v != p.PartyVersion(puzzle.Rewire, w) || puzzle.PartyFamily(v) != puzzle.Rewire {
			t.Fatalf("rewire drew %q", v)
		}
		seen[v] = true
		if got := p.PartyVersion(puzzle.Dial, w); got != puzzle.TwoHandLock {
			t.Fatalf("lock-dial drew %q", got)
		}
	}
	if !seen[puzzle.BigRewire] || !seen[puzzle.SplitPanel] {
		t.Errorf("rewire's draws over 40 beats: %v", seen)
	}
	if f := frozenPuzzles(t); f.PartyVersion(puzzle.Rewire, puzzle.Where{}) != "" {
		t.Error("the frozen sheets, which have no party rows, drew a version")
	}
	s := puzzle.Spec{Family: puzzle.Fuse, Level: 4, Tier: 1, Place: "tile:0,0", Beat: 1}
	if d := p.Deal(s); len(d) != 1 || !reflect.DeepEqual(d[0], p.Make(s)) {
		t.Error("a solo machine's deal is not the one whole layout")
	}
	if st := p.Probe(s, p.Solve(p.Make(s))); st != puzzle.Done {
		t.Errorf("Probe of a solo solve: %v", st)
	}
	if st := p.Probe(s, puzzle.Log{Moves: make([]puzzle.Move, p.Param("max-moves")+1)}); st != puzzle.Broke {
		t.Errorf("Probe of a log past the most moves: %v", st)
	}
}
