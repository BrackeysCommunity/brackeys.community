package harness

import (
	"fmt"
	"maps"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"jams.team/mmo-world/sim/sheets"
)

func nameIndex(b *sheets.Book) map[string]string {
	out := map[string]string{}
	for _, n := range b.Names {
		out[n.Ref] = n.Name
	}
	return out
}

func mapList(m map[string]int) string {
	var parts []string
	for _, k := range slices.Sorted(maps.Keys(m)) {
		parts = append(parts, fmt.Sprintf("%s %d", k, m[k]))
	}
	return strings.Join(parts, ", ")
}

func q[T int | int64 | time.Duration](sorted []T, f float64) T {
	if len(sorted) == 0 {
		return 0
	}
	i := int(math.Ceil(f*float64(len(sorted)))) - 1
	return sorted[max(0, min(i, len(sorted)-1))]
}

func pct(a, b int) float64 {
	if b == 0 {
		return 0
	}
	return 100 * float64(a) / float64(b)
}

func abs64(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}

// mdDoc is a report built line by line and written to the run's folder.
type mdDoc struct{ b strings.Builder }

// p writes one formatted line.
func (d *mdDoc) p(f string, a ...any) { fmt.Fprintf(&d.b, f+"\n", a...) }

func (d *mdDoc) Write(out, name string) error {
	return os.WriteFile(filepath.Join(out, name), []byte(d.b.String()), 0o644)
}

// either is yes when ok, else no.
func either(ok bool, yes, no string) string {
	if ok {
		return yes
	}
	return no
}

// holds is the pass/fail mark of a target in every report.
func holds(ok bool) string { return either(ok, "yes", "**NO**") }

func comma(n int64) string {
	s := fmt.Sprint(n)
	neg := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	if neg {
		return "-" + s
	}
	return s
}

func cellKey(tier int64, slot string) string { return fmt.Sprint(tier, "/", slot) }
