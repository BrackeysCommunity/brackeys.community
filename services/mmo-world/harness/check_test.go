package harness

import (
	"jams.team/mmo-world/sheetfs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestCheckIsGreen(t *testing.T) {
	for _, r := range Check(sheetfs.ModuleRoot(), CheckOptions{}) {
		if !r.OK() {
			t.Errorf("%s: %v", r.Name, r.Problems)
		}
	}
}

// copyTree copies the module into a temp dir so a test can plant a fault.
func copyTree(t *testing.T) string {
	t.Helper()
	src, dst := sheetfs.ModuleRoot(), t.TempDir()
	err := filepath.WalkDir(src, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		if d.IsDir() {
			if rel == "lint/testdata" {
				return filepath.SkipDir
			}
			return os.MkdirAll(filepath.Join(dst, rel), 0o755)
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(dst, rel), b, 0o644)
	})
	if err != nil {
		t.Fatal(err)
	}
	return dst
}

func edit(t *testing.T, root, rel, old, new string) {
	t.Helper()
	p := filepath.Join(root, rel)
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), old) {
		t.Fatalf("%s does not contain %q", rel, old)
	}
	if err := os.WriteFile(p, []byte(strings.Replace(string(b), old, new, 1)), 0o644); err != nil {
		t.Fatal(err)
	}
}

func failed(results []Result) map[string]string {
	out := map[string]string{}
	for _, r := range results {
		if !r.OK() {
			out[r.Name] = strings.Join(r.Problems, "\n")
		}
	}
	return out
}

// Each planted fault fails the check that owns it.
func TestCheckFailsOnPlantedFaults(t *testing.T) {
	cases := []struct {
		name  string
		plant func(t *testing.T, root string)
		check string
		says  string
	}{
		{"over budget", func(t *testing.T, r string) {
			edit(t, r, "sheets/items/materials.json", `"edge": 6,`, `"edge": 60,`)
		}, "budgets", "over its tier budget"},
		{"unknown column", func(t *testing.T, r string) {
			edit(t, r, "sheets/items/tiers.json", `"budget": 70,`, `"budget": 70, "bonus": 3,`)
		}, "rows match their schema", "bonus"},
		{"dangling reference", func(t *testing.T, r string) {
			edit(t, r, "sheets/tags/rules.json", `"charged"`, `"chargd"`)
		}, "sheets load", `"chargd" is not an id in tags.vocabulary`},
		{"param without a quantity unit", func(t *testing.T, r string) {
			edit(t, r, "sheets/items/params.json", `"unit": "pts"`, `"unit": "tag"`)
		}, "rows match their schema", "unit"},
		{"float where a whole number goes", func(t *testing.T, r string) {
			edit(t, r, "sheets/world/gauges.json", `"max": 1000,`, `"max": 1000.5,`)
		}, "rows match their schema", ""},
		{"stale schema", func(t *testing.T, r string) {
			edit(t, r, "sheets/schema/items.tiers.schema.json", `"x-unit": "pts"`, `"x-unit": "coin"`)
		}, "schemas are current", "items.tiers"},
		{"unnamed material", func(t *testing.T, r string) {
			edit(t, r, "packs/wasteland/names.json", `"ref": "items.materials:timber"`, `"ref": "items.materials:reedflax"`)
		}, "pack names everything shown", "items.materials:timber"},
		{"map style without fog:seen", func(t *testing.T, r string) {
			edit(t, r, "packs/wasteland/map-style.json", `"id": "fog-seen"`, `"id": "fog-seen-old"`)
		}, "pack names everything shown", "no entry for fog:seen"},
		{"family with no title", func(t *testing.T, r string) {
			edit(t, r, "sheets/puzzles/titles.json", `"family": "splice"`, `"family": "scrub"`)
		}, "play sheets", "no title for splice"},
		{"tuning cell with no row", func(t *testing.T, r string) {
			edit(t, r, "sheets/puzzles/tuning.json", `"key": "band"`, `"key": "width"`)
		}, "play sheets", `pressure reads "band"`},
		{"bad rule", func(t *testing.T, r string) {
			edit(t, r, "sheets/tags/rules.json", `"steps": 1`, `"steps": 0`)
		}, "rules compile", "band needs steps"},
		{"tuning literal in sim", func(t *testing.T, r string) {
			p := filepath.Join(r, "sim/fixed/planted.go")
			if err := os.WriteFile(p, []byte("package fixed\n\nfunc threatLine(g int64) bool { return g >= 600 }\n"), 0o644); err != nil {
				t.Fatal(err)
			}
		}, "sim rules and no literals", "number 600"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			root := copyTree(t)
			c.plant(t, root)
			f := failed(Check(root, CheckOptions{SkipLint: c.check != "sim rules and no literals"}))
			got, ok := f[c.check]
			if !ok {
				t.Fatalf("%q did not fail; failures: %v", c.check, f)
			}
			if !strings.Contains(got, c.says) {
				t.Fatalf("%q failed without %q:\n%s", c.check, c.says, got)
			}
		})
	}
}

func TestPlayRunsSmall(t *testing.T) {
	if testing.Short() {
		t.Skip("runs the harness")
	}
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if _, err := CraftRun(b, dir, 300); err != nil {
		t.Fatal(err)
	}
	t.Setenv("BATTLE_ONLY", "even")
	readings, err := BattleRun(b, dir, 7)
	if err != nil || len(readings) != 1 {
		t.Fatal(readings, err)
	}
}

func TestTargetRunsCoverReportAndSuite(t *testing.T) {
	runs := targetRuns()
	for _, r := range reportRuns {
		if _, ok := Runs[r.run]; !ok && r.run != SuiteCheck {
			t.Errorf("report run %q is no run", r.run)
		}
	}
	for _, s := range Suite {
		if _, ok := Runs[s.Run]; !ok && s.Run != SuiteCheck {
			t.Errorf("suite label %s runs %q, which is no run", s.Label, s.Run)
		}
	}
	for _, name := range []string{
		"activity", "battle", "content", "craft", "crime", "delve", "economy", "emergence",
		"growth", "load", "map", "puzzles", "replay", "search", "season", "seen", "social", "terrain", "world",
	} {
		if !slices.Contains(runs, name) {
			t.Errorf("a target may no longer name %q", name)
		}
	}
}
