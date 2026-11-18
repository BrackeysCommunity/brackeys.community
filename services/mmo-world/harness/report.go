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

// Report prints every target with its reading from readings, or "not
// measured".
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
		reading, holds := "not measured", "–"
		if m, ok := got[t.ID]; ok {
			reading = m.Value
			holds = map[bool]string{true: "yes", false: "NO"}[m.Holds]
		}
		fmt.Fprintf(w, "| %s | %s | %s | %s | %s |\n", t.Text, t.HoldsFrom, t.Runs, reading, holds)
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
