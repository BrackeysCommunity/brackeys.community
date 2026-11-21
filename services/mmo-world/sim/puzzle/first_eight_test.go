package puzzle_test

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/puzzle"
)

var firstEight = []string{puzzle.Rewire, puzzle.Pins, puzzle.Dial, puzzle.Maze, puzzle.Circuit, puzzle.Signal, puzzle.Fuse, puzzle.Override}

// firstCase is one pinned machine of the first eight families: its layout,
// and what five logs replay to.
type firstCase struct {
	Family    string        `json:"family"`
	Level     int64         `json:"level"`
	Tier      int64         `json:"tier"`
	Place     string        `json:"place"`
	Beat      int64         `json:"beat"`
	Countdown int64         `json:"countdown"`
	Layout    puzzle.Layout `json:"layout"`
	Solve     []puzzle.Move `json:"solve"`
	Full      puzzle.Result `json:"full"`  // Solve's own stamps
	Quick     puzzle.Result `json:"quick"` // a move every 100 ms
	Half      puzzle.Result `json:"half"`  // the first half of quick
	Bad       puzzle.Result `json:"bad"`   // quick with its middle move out of range
	Empty     puzzle.Result `json:"empty"`
}

func firstEightCases(p *puzzle.Puzzles) []firstCase {
	places := []string{"tile:3,-2", "floor:barrow/2", "tile:0,0"}
	var out []firstCase
	for _, fam := range firstEight {
		for level := int64(1); level <= 12; level++ {
			for tier := int64(1); tier <= 4; tier++ {
				for i, place := range places {
					w := puzzle.Where{Place: place, Beat: (level + tier + int64(i)) % 6}
					l := p.Generate(fam, level, tier, w)
					cd := p.Countdown(fam, level, tier, 0)
					solve := puzzle.Solve(l)
					quick := slices.Clone(solve)
					for j := range quick {
						quick[j].At = int64(j) * 100
					}
					bad := slices.Clone(quick)
					bad[len(bad)/2].A = -1
					out = append(out, firstCase{
						Family: fam, Level: level, Tier: tier, Place: place, Beat: w.Beat, Countdown: cd,
						Layout: l, Solve: solve,
						Full:  p.Replay(l, solve, cd, w),
						Quick: p.Replay(l, quick, cd, w),
						Half:  p.Replay(l, quick[:len(quick)/2], cd, w),
						Bad:   p.Replay(l, bad, cd, w),
						Empty: p.Replay(l, nil, cd, w),
					})
				}
			}
		}
	}
	return out
}

// firstEightLines is the fixture's form: a JSON array, one case a line.
func firstEightLines(t *testing.T, cases []firstCase) [][]byte {
	t.Helper()
	lines := make([][]byte, len(cases))
	for i, c := range cases {
		b, err := json.Marshal(c)
		if err != nil {
			t.Fatal(err)
		}
		lines[i] = b
	}
	return lines
}

// The first eight families lay out and replay exactly as the fixture
// records. The fixture is never rewritten.
func TestFirstEightUnchanged(t *testing.T) {
	want, err := os.ReadFile(filepath.Join("testdata", "first-eight.json"))
	if err != nil {
		t.Fatal(err)
	}
	lines := firstEightLines(t, firstEightCases(puzzles(t)))
	got := append(append([]byte("[\n"), bytes.Join(lines, []byte(",\n"))...), []byte("\n]\n")...)
	if bytes.Equal(got, want) {
		return
	}
	wantLines := bytes.Split(want, []byte("\n"))
	for i, l := range lines {
		if i+1 >= len(wantLines) || !bytes.Equal(bytes.TrimSuffix(wantLines[i+1], []byte(",")), l) {
			t.Fatalf("case %d differs from the fixture:\n got %s", i, l)
		}
	}
	t.Fatalf("%d cases, the fixture holds %d lines", len(lines), len(wantLines))
}
