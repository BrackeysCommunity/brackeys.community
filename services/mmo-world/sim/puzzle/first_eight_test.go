package puzzle_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/sheets"
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
// records, on the puzzle sheets it was made from. The fixture is never
// rewritten.
func TestFirstEightUnchanged(t *testing.T) {
	want, err := os.ReadFile(filepath.Join("testdata", "first-eight.json"))
	if err != nil {
		t.Fatal(err)
	}
	lines := firstEightLines(t, firstEightCases(frozenPuzzles(t)))
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

// The first-eight fixture and the golden vectors were made from the
// puzzle sheets at c038fea2. Those files are kept here byte for byte, with
// every puzzle cell added since in files of their own at the value that
// leaves the old machines as they were, so the live sheets can move on.
const frozenCommit = "c038fea2"

var frozenDir = filepath.Join("testdata", "mm7-sheets")

// frozenFiles are the files copied from frozenCommit's sheets/puzzles,
// with their sha256.
var frozenFiles = map[string]string{
	"families.json": "84ad47d819129d167a1b7be3d61807c4722417d3554f1787cbf4e2c53b8db06a",
	"haywire.json":  "90476feb860b12ee0fca2d4d57b3f7d33f8552a3d23c5d500e3e4930f4ff8c4d",
	"layouts.json":  "d2cc309f1bc4603663996048321be8eb5b641df859b255dff8780c1d6f0990ef",
	"params.json":   "ad0f53bb2f25fe293328f4eb36c74b33f554b9f2a6eba2d30982b41a20c9d512",
	"practice.json": "3b083ad394d8f5f4a219b4493363367a30f670faf4616d6ef560d1ed4ab3fdec",
	"titles.json":   "971ec6db3139f645d54edf6438f41a2d5a89790796a981277e4bfe73db30dbff",
	"tuning.json":   "677d63e981ae65f244c9fd568b32c1174d6bab321c461c875b90cf348c9ff492",
}

// frozenAdded are the frozen files that hold what came after.
var frozenAdded = []string{"params-mm8.json", "shapes.json"}

func sheetOf(t *testing.T, f sheets.File) string {
	t.Helper()
	var env struct {
		Sheet string `json:"sheet"`
	}
	if err := json.Unmarshal(f.Data, &env); err != nil {
		t.Fatalf("%s: %v", f.Path, err)
	}
	return env.Sheet
}

// frozenBook is the live book with every puzzle sheet swapped for the
// frozen copy. The pack's names go too: they name live rows the frozen
// sheets lack, and no machine reads them.
func frozenBook(t *testing.T) *sheets.Book {
	t.Helper()
	files, err := sheetfs.ReadSheetFiles(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	files = slices.DeleteFunc(files, func(f sheets.File) bool {
		s := sheetOf(t, f)
		return strings.HasPrefix(s, "puzzles.") || s == "pack.names"
	})
	err = filepath.WalkDir(frozenDir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(p, ".json") {
			return err
		}
		b, err := os.ReadFile(p)
		files = append(files, sheets.File{Path: filepath.ToSlash(p), Data: b})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	b, err := sheets.Load(files)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func frozenPuzzles(t *testing.T) *puzzle.Puzzles {
	t.Helper()
	return puzzle.New(frozenBook(t), keys.Throwaway("puzzle-test").Generation)
}

// The frozen copy is the commit's puzzle sheets, unchanged, and holds
// every puzzle cell the live sheets hold.
func TestFrozenSheets(t *testing.T) {
	dir := filepath.Join(frozenDir, "puzzles")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	want := slices.Sorted(slices.Values(append(slices.Collect(maps.Keys(frozenFiles)), frozenAdded...)))
	if !slices.Equal(names, want) {
		t.Fatalf("%s holds %v, want %v", dir, names, want)
	}
	root := sheetfs.ModuleRoot()
	_, gitErr := exec.Command("git", "-C", root, "cat-file", "-e", frozenCommit+"^{commit}").Output()
	for n, sum := range frozenFiles {
		b, err := os.ReadFile(filepath.Join(dir, n))
		if err != nil {
			t.Fatal(err)
		}
		if got := sha256.Sum256(b); hex.EncodeToString(got[:]) != sum {
			t.Errorf("%s is not %s's", n, frozenCommit)
		}
		if gitErr != nil {
			continue
		}
		old, err := exec.Command("git", "-C", root, "show", frozenCommit+":./sheets/puzzles/"+n).Output()
		if err != nil {
			t.Fatalf("git show %s: %v", n, err)
		}
		if !bytes.Equal(old, b) {
			t.Errorf("%s differs from git show %s", n, frozenCommit)
		}
	}
	if gitErr != nil {
		t.Logf("%s is not in this checkout; compared by sha256 only", frozenCommit)
	}

	live, frozen := book(t), frozenBook(t)
	have := map[string]bool{}
	for _, r := range frozen.PuzzleParams {
		have[r.ID] = true
	}
	for _, r := range live.PuzzleParams {
		if !have[r.ID] {
			t.Errorf("puzzles.params %s has no frozen value", r.ID)
		}
	}
	for _, s := range frozen.PuzzleShapes {
		if s.Shape != 0 {
			t.Errorf("puzzles.shapes %s: the frozen sheets hold shape 0 alone", s.ID)
		}
	}
	if len(frozen.PartyVersions) != 0 {
		t.Errorf("the frozen sheets hold party versions")
	}
}
