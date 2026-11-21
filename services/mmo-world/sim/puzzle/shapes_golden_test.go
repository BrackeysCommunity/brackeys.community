package puzzle_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/puzzle"
)

// structural: the shape the shape vectors hold, and the level the
// family's largest machine, with every twist at its height, is checked at.
const (
	vectorShape = 1
	topLevel    = 12
)

// shapeSpecs are the machines a family's shape vectors hold: levels 3, 7
// and the top at tier 1, level 7 at tier 3, and level 7 on a phone where
// the shape is capped there.
func shapeSpecs(fam string, phoneMax int64) []goldenHead {
	spec := func(level, tier int64, compact bool) goldenHead {
		name := fmt.Sprintf("level-%d-full", level)
		switch {
		case compact:
			name = fmt.Sprintf("level-%d-compact", level)
		case tier > 1:
			name = fmt.Sprintf("level-%d-tier-%d", level, tier)
		}
		return goldenHead{Name: name, Spec: puzzle.Spec{Family: fam, Level: level, Tier: tier, Place: "golden:" + fam, Beat: level,
			Compact: compact, Shape: vectorShape}}
	}
	out := []goldenHead{spec(3, 1, false), spec(7, 1, false), spec(topLevel, 1, false), spec(7, 3, false)}
	if phoneMax > 0 {
		out = append(out, spec(7, 1, true))
	}
	return out
}

func shapeGolden(p *puzzle.Puzzles, fam string, phoneMax int64) goldenFile {
	file := goldenFile{Family: fam}
	for _, head := range shapeSpecs(fam, phoneMax) {
		s := head.Spec
		head.Countdown = p.Countdown(fam, s.Level, s.Tier, 0)
		head.Horizon = head.Countdown + p.Grace()
		head.Layout, head.Inner = p.Make(s), p.Inner(s)
		solve := p.Solve(head.Layout)
		bad := puzzle.Log{Moves: slices.Clone(solve.Moves), End: solve.End}
		bad.Moves[len(bad.Moves)/2].A = -1
		c := goldenCase{goldenHead: head}
		for _, l := range []goldenLog{
			{Name: "solve", Log: solve},
			{Name: "master", Master: true, Log: masterLog(p, head.Layout, head.Inner)},
			{Name: "cut-short", Log: cutShort(solve)},
			{Name: "break", Log: bad},
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

// TestShapesGolden holds the vectors every client's shape 1 model is
// tested against, on the live sheets. Run it with -run TestShapesGolden
// -update to rewrite them after a rule changes.
func TestShapesGolden(t *testing.T) {
	p := puzzles(t)
	dir := filepath.Join("testdata", "shapes")
	caps := map[string]int64{}
	for _, l := range book(t).PuzzleLayouts {
		caps[l.Family] = l.PhoneMax
	}
	for _, r := range book(t).PuzzleShapes {
		if r.Shape == vectorShape && r.PhoneMax > 0 {
			caps[r.Family] = r.PhoneMax
		}
	}
	shaped := 0
	for _, fam := range p.All() {
		if !slices.Contains(p.Shapes(fam), vectorShape) {
			continue
		}
		shaped++
		file := shapeGolden(p, fam, caps[fam])
		got := goldenBytes(t, file)
		var back goldenFile
		if err := json.Unmarshal(got, &back); err != nil || len(back.Cases) != len(file.Cases) {
			t.Fatalf("%s: the vectors do not read back: %v", fam, err)
		}
		for _, c := range file.Cases {
			if c.Layout.Shape != vectorShape || c.Inner.Shape != vectorShape || c.Spec.Shape != vectorShape {
				t.Fatalf("%s %s: shapes %d, %d and %d", fam, c.Name, c.Spec.Shape, c.Layout.Shape, c.Inner.Shape)
			}
			for _, l := range c.Logs {
				if (l.Outcome.Status == puzzle.Done) != l.Result.Solved || l.Outcome.Master != l.Result.Master ||
					(l.Result.Solved && l.Outcome.At != l.Result.At) {
					t.Fatalf("%s %s %s: the model says %+v, the server %+v", fam, c.Name, l.Name, l.Outcome, l.Result)
				}
				if solved := l.Name == "solve" || l.Name == "master"; solved != l.Result.Solved || len(l.Trace) == 0 || len(l.Trace) > traceMax {
					t.Fatalf("%s %s %s: %+v with %d states", fam, c.Name, l.Name, l.Result, len(l.Trace))
				}
				if l.Name == "solve" && l.Result.At > c.Countdown {
					t.Fatalf("%s %s: solved at %d ms of %d", fam, c.Name, l.Result.At, c.Countdown)
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
	if len(files) != shaped {
		t.Fatalf("%d vector files for %d families with a shape %d", len(files), shaped, vectorShape)
	}
}
