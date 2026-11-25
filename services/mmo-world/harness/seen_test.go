package harness

import (
	"bytes"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/history"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/world"
)

// TestSeen plays the seen run on two seeds a history: the run's world
// record matches the world's own, and it prints the four verdict lines.
func TestSeen(t *testing.T) {
	if testing.Short() {
		t.Skip("plays ten histories")
	}
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	v, err := seenRun(b, dir, 2)
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := writeLines(&out, v); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	want := []*regexp.Regexp{
		regexp.MustCompile(`^condition 1: (holds|fails) \(.+\)$`),
		regexp.MustCompile(`^condition 2: (holds|fails) \(.+\)$`),
		regexp.MustCompile(`^cost: .+ µs day 1 / .+ µs day 300 `),
		regexp.MustCompile(`^adopt: (yes|no)$`),
	}
	if len(lines) != len(want) {
		t.Fatalf("%d verdict lines: %q", len(lines), lines)
	}
	for i, re := range want {
		if !re.MatchString(lines[i]) {
			t.Errorf("verdict line %d reads %q", i+1, lines[i])
		}
		t.Log(lines[i])
	}
	if strings.Contains(out.String(), "is off in") {
		t.Errorf("the run's world record is not the world's: %s", out.String())
	}
	if (lines[3] == "adopt: yes") != (v.Condition1 && v.Condition2 && v.CostHolds) {
		t.Errorf("adopt reads %q for %+v", lines[3], v)
	}
	md, err := os.ReadFile(filepath.Join(dir, "seen.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, l := range lines {
		if !strings.Contains(string(md), l) {
			t.Errorf("seen.md lacks %q", l)
		}
	}
}

// TestSeenRecordLeavesOutPins: a visit counts toward a server's record
// only where nothing a pin did could reach it.
func TestSeenRecordLeavesOutPins(t *testing.T) {
	at := hex.Hex{Q: 3, R: -1}
	pin := world.Pin{ID: "pin-1", At: hex.Hex{}, Reach: 3, Tick: 10}
	clean := &tile.Content{Digest: &history.Digest{}}
	cases := []struct {
		name string
		c    *tile.Content
		tick int64
		want bool
	}{
		{"before the pin", clean, 10, false},
		{"after the pin, in its reach", clean, 11, true},
		{"fixed by a pin", &tile.Content{Pin: "pin-2", Digest: &history.Digest{}}, 5, true},
		{"grounded", &tile.Content{Ground: &tile.GroundFix{Terrain: "plain"}, Digest: &history.Digest{}}, 5, true},
		{"digest read a pin", &tile.Content{Digest: &history.Digest{Pins: []string{"pin-3"}}}, 5, true},
		{"unreached", nil, 5, true},
	}
	for _, c := range cases {
		if got := pinTouched(c.c, []world.Pin{pin}, at, c.tick); got != c.want {
			t.Errorf("%s: touched %v, want %v", c.name, got, c.want)
		}
	}
	far := hex.Hex{Q: 9, R: 0}
	if pinTouched(clean, []world.Pin{pin}, far, 20) {
		t.Error("a tile outside the pin's reach is touched")
	}
}
