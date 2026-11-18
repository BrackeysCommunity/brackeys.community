package world_test

import (
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"

	"jams.team/mmo-world/harness"
)

var update = flag.Bool("update", false, "rerecord the replay fixtures")

var fixtures = []struct {
	label         string
	before, after int
	explore       bool
}{
	{"replay-unattended", 10, 10, false},
	{"replay-explorer", 8, 12, true},
}

// A snapshot plus recorded actions replays to the recorded digest. When
// a sheet or a rule changes on purpose, rerecord with -update and say so
// in the commit.
func TestReplayFixtures(t *testing.T) {
	b := book(t)
	for _, f := range fixtures {
		path := filepath.Join("testdata", "replay", f.label+".json")
		if *update {
			r, err := harness.RecordReplay(b, f.label, f.before, f.after, f.explore)
			if err != nil {
				t.Fatal(err)
			}
			raw, err := json.Marshal(r)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, raw, 0o644); err != nil {
				t.Fatal(err)
			}
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var r harness.Replay
		if err := json.Unmarshal(raw, &r); err != nil {
			t.Fatal(err)
		}
		got, err := r.Play(b)
		if err != nil {
			t.Fatal(err)
		}
		if got != r.Digest {
			t.Fatalf("%s: replay reached %s, recorded %s; if a sheet or rule changed on purpose, rerecord with -update", f.label, got, r.Digest)
		}
	}
}
