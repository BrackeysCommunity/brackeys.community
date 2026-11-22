package harness

import (
	"fmt"
	"io"
	"strings"

	"jams.team/mmo-world/sim/sheets"
)

// Measured is one target's reading from a run.
type Measured struct {
	Target string
	Value  string
	Holds  bool
}

// unmeasured opens the reading of a target a run could not measure at its
// size; the report shows its reason and no mark.
const unmeasured = "– "

// notMeasured is a target's reading with the reason it was not measured.
func notMeasured(target, why string) Measured {
	return Measured{Target: target, Value: unmeasured + why}
}

// spikeETargets are the scaffold targets spike E checks seed by seed in
// its own report; pins and content draws leave them untouched.
var spikeETargets = map[string]bool{
	"structures-reachable": true,
	"chunk-order":          true,
	"novelty-share":        true,
	"biome-patches":        true,
	"ecotone-share":        true,
}

// Report prints every target with its reading from readings, or "not
// measured" ("spike E's" for the scaffold targets spike E reads).
func Report(w io.Writer, b *sheets.Book, readings []Measured) {
	got := map[string]Measured{}
	for _, m := range readings {
		got[m.Target] = m
	}
	fmt.Fprintln(w, "# Report run")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "| Target | Holds from | Runs | Reading | Holds |")
	fmt.Fprintln(w, "| --- | --- | --- | --- | --- |")
	for _, t := range b.Targets {
		reading, mark := "not measured", "–"
		if spikeETargets[t.ID] {
			reading = "spike E's (`harness spike-e`)"
		}
		if m, ok := got[t.ID]; ok {
			reading = m.Value
			mark = holds(m.Holds)
			if strings.HasPrefix(m.Value, unmeasured) {
				mark = "–"
			}
		}
		fmt.Fprintf(w, "| %s | %s | %s | %s | %s |\n", t.Text, t.HoldsFrom, t.Runs, reading, mark)
	}
	fmt.Fprintf(w, "\n%d targets, %d measured.\n", len(b.Targets), len(readings))
}

// PrintCheck writes the Check run's results and reports whether all passed.
func PrintCheck(w io.Writer, results []Result) bool {
	ok := true
	for _, r := range results {
		mark := "ok  "
		if !r.OK() {
			mark, ok = "FAIL", false
		}
		fmt.Fprintf(w, "%s %s\n", mark, r.Name)
		for _, p := range r.Problems {
			fmt.Fprintf(w, "       %s\n", strings.TrimSpace(p))
		}
	}
	return ok
}
