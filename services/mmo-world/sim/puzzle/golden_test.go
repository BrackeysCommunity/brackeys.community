package puzzle_test

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/puzzle"
)

var update = flag.Bool("update", false, "rewrite the golden vectors under testdata/golden")

// The golden vectors hold every client's model of a family to this
// package's: a layout, logs played against it, and the states each log
// passes through. One file a family.
type goldenFile struct {
	Family string       `json:"family"`
	Cases  []goldenCase `json:"cases"`
}

type goldenHead struct {
	Name      string        `json:"name"`
	Spec      puzzle.Spec   `json:"spec"`
	Countdown int64         `json:"countdown"`
	Horizon   int64         `json:"horizon"` // the last ms a move may be stamped
	Layout    puzzle.Layout `json:"layout"`
	Inner     puzzle.Layout `json:"inner"`
}

type goldenCase struct {
	goldenHead
	Logs []goldenLog `json:"logs"`
}

type goldenLog struct {
	Name    string         `json:"name"`
	Master  bool           `json:"master"` // played with the inner panel behind
	Log     puzzle.Log     `json:"log"`
	Outcome puzzle.Outcome `json:"outcome"` // the family model's own
	Result  puzzle.Result  `json:"result"`  // what the server makes of it
	Trace   []goldenState  `json:"trace"`
}

// goldenState is the model's state after one move, or where a panel's
// replay stopped. I counts every state the log passed through, kept or
// not.
type goldenState struct {
	I     int     `json:"i"`
	At    int64   `json:"at"`
	State []int64 `json:"state"`
}

const traceMax = 64

// thin keeps every stride-th state and the last, so a long play's trace
// stays small.
func thin(all []goldenState) []goldenState {
	stride := max(1, (len(all)+traceMax-3)/(traceMax-1))
	var out []goldenState
	for i, s := range all {
		if i%stride == 0 || i == len(all)-1 {
			out = append(out, s)
		}
	}
	return out
}

func goldenSpecs(fam string, phoneMax int64) []goldenHead {
	spec := func(level, tier int64, compact bool) goldenHead {
		name := fmt.Sprintf("level-%d-full", level)
		switch {
		case compact:
			name = fmt.Sprintf("level-%d-compact", level)
		case tier > 1:
			name = fmt.Sprintf("level-%d-tier-%d", level, tier)
		}
		return goldenHead{Name: name, Spec: puzzle.Spec{Family: fam, Level: level, Tier: tier, Place: "golden:" + fam, Beat: level, Compact: compact}}
	}
	out := []goldenHead{spec(1, 1, false), spec(3, 1, false), spec(6, 1, false), spec(9, 1, false)}
	if phoneMax > 0 {
		out = append(out, spec(3, 1, true), spec(9, 1, true))
	}
	return append(out, spec(6, 3, false))
}

func golden(p *puzzle.Puzzles, fam string, phoneMax int64) goldenFile {
	file := goldenFile{Family: fam}
	for _, head := range goldenSpecs(fam, phoneMax) {
		s := head.Spec
		head.Countdown = p.Countdown(fam, s.Level, s.Tier, 0)
		head.Horizon = head.Countdown + p.Param("network-grace")*1000
		head.Layout, head.Inner = p.Make(s), p.Inner(s)
		solve := p.Solve(head.Layout)
		bad := puzzle.Log{Moves: slices.Clone(solve.Moves), End: solve.End}
		bad.Moves[len(bad.Moves)/2].A = -1
		c := goldenCase{goldenHead: head}
		for _, l := range []goldenLog{
			{Name: "solve", Log: solve},
			{Name: "master", Master: true, Log: masterLog(p, head.Layout, head.Inner)},
			{Name: "cut-short", Log: cutShort(solve)},
			{Name: "bad-move", Log: bad},
			{Name: "late", Log: shifted(solve, head.Horizon+1)},
			{Name: "empty", Log: puzzle.Log{Moves: []puzzle.Move{}}},
		} {
			var inner *puzzle.Layout
			if l.Master {
				inner = &head.Inner
			}
			var trace []goldenState
			l.Outcome = puzzle.RunLog(head.Layout, inner, l.Log, head.Horizon, func(at int64, state []int64) {
				trace = append(trace, goldenState{len(trace), at, state})
			})
			l.Trace = thin(trace)
			l.Result = p.Play(s, l.Log, puzzle.Limits{Countdown: head.Countdown, Elapsed: -1, Master: l.Master})
			c.Logs = append(c.Logs, l)
		}
		file.Cases = append(file.Cases, c)
	}
	return file
}

// goldenBytes writes a file one log a line, so a change reads as the logs
// it changed.
func goldenBytes(t *testing.T, f goldenFile) []byte {
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
	fmt.Fprintf(&b, "{\"family\":%s,\"cases\":[\n", js(f.Family))
	for i, c := range f.Cases {
		head := js(c.goldenHead)
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

// TestGolden holds this package to the vectors the clients are tested
// against, on the puzzle sheets they were made from. Run it with -update
// to rewrite them after a rule changes.
func TestGolden(t *testing.T) {
	b := frozenBook(t)
	p := puzzle.New(b, keys.Throwaway("puzzle-test").Generation)
	dir := filepath.Join("testdata", "golden")
	caps := map[string]int64{}
	for _, l := range b.PuzzleLayouts {
		caps[l.Family] = l.PhoneMax
	}
	for _, fam := range p.All() {
		file := golden(p, fam, caps[fam])
		got := goldenBytes(t, file)
		var back goldenFile
		if err := json.Unmarshal(got, &back); err != nil || len(back.Cases) != len(file.Cases) {
			t.Fatalf("%s: the vectors do not read back: %v", fam, err)
		}
		for _, c := range file.Cases {
			for _, l := range c.Logs {
				if (l.Outcome.Status == puzzle.Done) != l.Result.Solved || l.Outcome.Master != l.Result.Master ||
					(l.Result.Solved && l.Outcome.At != l.Result.At) {
					t.Fatalf("%s %s %s: the model says %+v, the server %+v", fam, c.Name, l.Name, l.Outcome, l.Result)
				}
				if solved := l.Name == "solve" || l.Name == "master"; solved != l.Result.Solved || len(l.Trace) == 0 || len(l.Trace) > traceMax {
					t.Fatalf("%s %s %s: %+v with %d states", fam, c.Name, l.Name, l.Result, len(l.Trace))
				}
			}
		}
		path := filepath.Join(dir, fam+".json")
		if *update {
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
			t.Fatalf("%s: %v (run with -update to write the vectors)", fam, err)
		}
		if !bytes.Equal(got, want) {
			gl, wl := bytes.Split(got, []byte("\n")), bytes.Split(want, []byte("\n"))
			for i := range gl {
				if i >= len(wl) || !bytes.Equal(gl[i], wl[i]) {
					t.Fatalf("%s: line %d differs from %s; run with -update if the rule was meant to change\n got %.300s", fam, i+1, path, gl[i])
				}
			}
			t.Fatalf("%s: %s holds more than the code gives", fam, path)
		}
	}
	files, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != len(p.All()) {
		t.Fatalf("%d vector files for %d families", len(files), len(p.All()))
	}
}
