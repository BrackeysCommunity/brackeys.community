package harness

import (
	"os"
	"path/filepath"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/sheets"
)

// TestSeasonRunSmall plays season zero on two seeds: each writes its
// finale and its close into season 1, keeps the ledger clean, the first
// seed replays to its digest, and the run reads the season-zero row.
func TestSeasonRunSmall(t *testing.T) {
	if testing.Short() {
		t.Skip("plays three seasons of 15 world days")
	}
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	runs, again, err := playSeasons(b, 2)
	if err != nil {
		t.Fatal(err)
	}
	zero := sheets.IntParam(b.StoryParams, "season-zero-days")
	days := sheets.IntParam(b.StoryParams, "season-days")
	for _, r := range runs {
		if !r.finale || !r.closed {
			t.Errorf("seed %q: finale %v, close %v", r.seed, r.finale, r.closed)
		}
		if r.closedTick != zero*sheets.TicksPerDay {
			t.Errorf("seed %q closed at tick %d, not on day %d", r.seed, r.closedTick, zero)
		}
		if r.clock.N != 1 || r.clock.Start != zero || r.clock.Days != days {
			t.Errorf("seed %q: clock after the close %+v, want season 1 from day %d of %d days", r.seed, r.clock, zero, days)
		}
		if len(r.audit) > 0 {
			t.Errorf("seed %q: ledger %v", r.seed, r.audit)
		}
		if r.actions == 0 {
			t.Errorf("seed %q: no player acted", r.seed)
		}
		t.Logf("seed %q: %d arcs, %d decided by players, %d lapsed, sides offered %d, backs %d", r.seed, len(r.arcs), r.decided(), r.lapsed(), r.offered, r.backs)
	}
	if runs[0].seed != "" || again.seed != "" || again.digest != runs[0].digest {
		t.Errorf("seed %q again: digest %s, first %s", again.seed, again.digest, runs[0].digest)
	}
	if runs[0].digest == runs[1].digest {
		t.Errorf("two seeds gave one digest %s", runs[0].digest)
	}
	m := seasonReading(runs, again.digest == runs[0].digest)
	if m.Target != "season-zero" {
		t.Fatalf("reading for %q", m.Target)
	}
	t.Logf("season-zero: %s (holds %v)", m.Value, m.Holds)
	dir := t.TempDir()
	if err := seasonDoc(b, runs, again, m).save(dir, "season.md"); err != nil {
		t.Fatal(err)
	}
	if fi, err := os.Stat(filepath.Join(dir, "season.md")); err != nil || fi.Size() == 0 {
		t.Fatalf("report: %v", err)
	}
}

// TestSeasonStageDecided reads a stage as decided by players only when a
// side won with its mark met by enough distinct backers.
func TestSeasonStageDecided(t *testing.T) {
	two := []string{"c-1", "c-2"}
	cases := []struct {
		name string
		s    seasonStage
		want bool
	}{
		{"won by two", seasonStage{won: "a", sides: []seasonSide{{side: "a", mark: 50, units: 50, backers: two}}}, true},
		{"won by one", seasonStage{won: "a", sides: []seasonSide{{side: "a", mark: 50, units: 50, backers: two[:1]}}}, false},
		{"mark unmet", seasonStage{won: "a", sides: []seasonSide{{side: "a", mark: 50, units: 49, backers: two}}}, false},
		{"lapsed", seasonStage{lapsed: true, sides: []seasonSide{{side: "a", mark: 50, units: 50, backers: two}}}, false},
		{"the other side filled", seasonStage{won: "a", sides: []seasonSide{{side: "a", mark: 50}, {side: "b", mark: 50, units: 50, backers: two}}}, false},
	}
	for _, c := range cases {
		if got := c.s.decided(); got != c.want {
			t.Errorf("%s: decided %v, want %v", c.name, got, c.want)
		}
	}
}
