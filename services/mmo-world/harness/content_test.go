package harness

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"jams.team/mmo-world/sheetfs"
)

// TestContentRunSmall plays the content run on two seeds a history: every
// row is there and holds, and a second run reads the same.
func TestContentRunSmall(t *testing.T) {
	if testing.Short() {
		t.Skip("plays eight histories twice")
	}
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	first, err := ContentRun(b, dir, 2)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{}
	for _, tg := range b.Targets {
		if tg.Runs == "content" {
			want[tg.ID] = true
		}
	}
	if len(first) != len(want) {
		t.Fatalf("%d readings for %d content targets: %+v", len(first), len(want), first)
	}
	for _, m := range first {
		if !want[m.Target] {
			t.Errorf("reading for %q, not a content target", m.Target)
		}
		if !m.Holds {
			t.Errorf("%s does not hold: %s", m.Target, m.Value)
		}
	}
	for _, name := range []string{"content.md", "readings.json"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Error(err)
		}
	}
	var saved []Measured
	raw, err := os.ReadFile(filepath.Join(dir, "readings.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &saved); err != nil || len(saved) != len(first) {
		t.Fatalf("readings.json holds %d readings (%v)", len(saved), err)
	}

	second, err := ContentRun(b, t.TempDir(), 2)
	if err != nil {
		t.Fatal(err)
	}
	for i := range first {
		a, c := first[i], second[i]
		if a.Target == "content-cost-flat" {
			// The clock moves; the visit counts do not.
			a.Value, c.Value = visits(a.Value), visits(c.Value)
		}
		if a != c {
			t.Errorf("second run reads %+v, first %+v", c, a)
		}
	}
}

func visits(v string) string {
	_, after, _ := strings.Cut(v, "; ")
	return after
}
