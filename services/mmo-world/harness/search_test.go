package harness

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// TestSearchOnly: SEARCH_ONLY picks climbs by name, every one when unset,
// and refuses a name that is no climb.
func TestSearchOnly(t *testing.T) {
	for _, x := range []struct {
		env  string
		want []string
	}{{"", []string{"build", "loop", "staging"}}, {"staging", []string{"staging"}}, {"loop, build", []string{"build", "loop"}}} {
		t.Setenv("SEARCH_ONLY", x.env)
		on, err := searchOnly()
		if err != nil {
			t.Fatalf("SEARCH_ONLY=%q: %v", x.env, err)
		}
		var got []string
		for _, c := range searchClimbs {
			if on[c.name] {
				got = append(got, c.name)
			}
		}
		if strings.Join(got, ",") != strings.Join(x.want, ",") {
			t.Errorf("SEARCH_ONLY=%q runs %v, want %v", x.env, got, x.want)
		}
	}
	t.Setenv("SEARCH_ONLY", "stagin")
	if _, err := searchOnly(); err == nil {
		t.Error("SEARCH_ONLY=stagin was taken")
	}
}

// TestSearchDrawLabels: every draw the build climb makes is under
// search.build and every one the loop climb makes under search.loop, and
// neither label is drawn anywhere else in the package.
func TestSearchDrawLabels(t *testing.T) {
	want := map[string]string{"search_build.go": "buildLabel", "search_loop.go": "loopLabel"}
	draws := map[string]bool{"Below": true, "Draw": true, "Percent": true, "Stream": true, "Chance": true}
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	fs := token.NewFileSet()
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fs, f, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		label, mine := want[f]
		seen := 0
		ast.Inspect(file, func(n ast.Node) bool {
			switch x := n.(type) {
			case *ast.BasicLit:
				if v, err := strconv.Unquote(x.Value); err == nil && (v == buildLabel || v == loopLabel) && !mine {
					t.Errorf("%s: %s names the label %q", f, fs.Position(x.Pos()), v)
				}
			case *ast.CallExpr:
				sel, ok := x.Fun.(*ast.SelectorExpr)
				if !ok || !draws[sel.Sel.Name] || !mine || len(x.Args) < 2 {
					return true
				}
				seen++
				if id, ok := x.Args[1].(*ast.Ident); !ok || id.Name != label {
					t.Errorf("%s: %s draws under something other than %s", f, fs.Position(x.Pos()), label)
				}
			}
			return true
		})
		if mine && seen == 0 {
			t.Errorf("%s draws nothing under %s", f, label)
		}
	}
	if buildLabel == loopLabel || buildLabel == "search.staging" || loopLabel == "search.staging" {
		t.Error("the climbs share a label")
	}
}

// TestSearchBuildSmall: the build climb at a small size reads all four of
// its targets, and plays the same twice.
func TestSearchBuildSmall(t *testing.T) {
	b := stagingBook(t)
	first, err := climbBuild(b, 20)
	if err != nil {
		t.Fatal(err)
	}
	second, err := climbBuild(b, 20)
	if err != nil {
		t.Fatal(err)
	}
	if first.digest != second.digest {
		t.Fatalf("the build climb played differently twice: %s and %s", first.digest, second.digest)
	}
	if len(first.climb) != searchPolicies*searchGenerations || len(first.puzzles) != searchPolicies*searchGenerations {
		t.Errorf("the climb played %d loadouts and %d puzzle policies, want %d each", len(first.climb), len(first.puzzles), searchPolicies*searchGenerations)
	}
	for _, c := range first.kinds {
		if c.best.kind.Vec.TopTwo() < c.plays[0].kind.Vec.TopTwo() || !c.seed {
			t.Errorf("tier %d %s: the climb ended below the Craft run's search best", c.tier, c.slot)
		}
		if c.best.kind.Tier != c.tier || c.best.kind.Slot != c.slot {
			t.Errorf("tier %d %s: the climbed kind is tier %d %s", c.tier, c.slot, c.best.kind.Tier, c.best.kind.Slot)
		}
	}
	for i, x := range first.best.policy.tiers {
		ft := b.FightTiers[i]
		if x.practice > ft.ExpectedPractice || x.practice < 0 {
			t.Errorf("a loadout fights at practice %d past tier %d's expected %d", x.practice, ft.Tier, ft.ExpectedPractice)
		}
	}
	var doc lineDoc
	got := map[string]Measured{}
	for _, m := range first.section(b, doc.p) {
		got[m.Target] = m
	}
	for _, id := range []string{"top-kinds-near-median", "tag-pairing-share", "class-share", "puzzle-solve-rate"} {
		if m, ok := got[id]; !ok || strings.HasPrefix(m.Value, unmeasured) {
			t.Errorf("the build climb does not measure %s: %+v", id, m)
		}
	}
	for _, want := range []string{"# Search run: build", "## Kinds", "### The matrix on the climbed kit", "## Puzzles"} {
		if !strings.Contains(doc.b.String(), want) {
			t.Errorf("the build section lacks %q", want)
		}
	}
}

// TestSearchLoopClimb: at 100 players the loop climbs at 10 for its days
// and confirms the richest mix at 100, the same twice, and reads
// richest-loop-band on the band.
func TestSearchLoopClimb(t *testing.T) {
	b := stagingBook(t)
	t.Setenv("ECONOMY_DAYS", strconv.Itoa(economyWarmup+2))
	first, err := climbLoop(b, searchClimbFrom)
	if err != nil {
		t.Fatal(err)
	}
	second, err := climbLoop(b, searchClimbFrom)
	if err != nil {
		t.Fatal(err)
	}
	if first.digest != second.digest {
		t.Fatalf("the loop climb played differently twice: %s and %s", first.digest, second.digest)
	}
	if len(first.climb) != searchPolicies*searchGenerations {
		t.Fatalf("the climb played %d mixes, want %d", len(first.climb), searchPolicies*searchGenerations)
	}
	seen := map[string]bool{}
	for _, l := range first.climb {
		if seen[l.policy.mix.String()] {
			t.Errorf("the mix %s was played twice", l.policy.mix)
		}
		seen[l.policy.mix.String()] = true
		if l.res.size != searchClimbFrom/searchShare || len(l.res.days) != loopClimbDays {
			t.Errorf("%s played %d players for %d days", l.policy.name, l.res.size, len(l.res.days))
		}
		if l.res.read.loop.players == 0 {
			t.Errorf("%s: nobody played the mix", l.policy.name)
		}
	}
	if top := first.richest(); top.policy.mix != first.confirmed.policy.mix || first.confirmed.res.size != searchClimbFrom {
		t.Errorf("confirmed %s at %d, want the richest %s at %d", first.confirmed.policy.mix, first.confirmed.res.size, top.policy.mix, searchClimbFrom)
	}
	var doc lineDoc
	m := first.section(b, doc.p)
	if m.Target != "richest-loop-band" || strings.HasPrefix(m.Value, unmeasured) || !strings.Contains(m.Value, first.confirmed.policy.mix.String()) {
		t.Errorf("richest-loop-band at 100 players: %+v", m)
	}
}

// TestSearchSmallClimbs: below 100 players the default run plays the
// widest loop seed once and every climb writes its section, staging's
// exactly as SEARCH_ONLY=staging writes it.
func TestSearchSmallClimbs(t *testing.T) {
	b := stagingBook(t)
	run := func(only string) (string, map[string]Measured) {
		t.Setenv("SEARCH_ONLY", only)
		out := t.TempDir()
		rs, err := SearchRun(b, out, 20)
		if err != nil {
			t.Fatal(err)
		}
		doc, err := os.ReadFile(filepath.Join(out, "search.md"))
		if err != nil {
			t.Fatal(err)
		}
		got := map[string]Measured{}
		for _, m := range rs {
			got[m.Target] = m
		}
		return untimed.ReplaceAllString(string(doc), "| – |"), got
	}
	staging, alone := run("staging")
	all, rows := run("")
	if !strings.HasPrefix(staging, "# Search run: staging") {
		t.Fatalf("SEARCH_ONLY=staging writes another section first:\n%.200s", staging)
	}
	_, tail, ok := strings.Cut(all, "# Search run: staging")
	if !ok || "# Search run: staging"+tail != staging {
		t.Error("the default run's staging section differs from SEARCH_ONLY=staging's")
	}
	for id, m := range alone {
		if rows[id] != m {
			t.Errorf("%s reads %+v alone and %+v beside the other climbs", id, m, rows[id])
		}
	}
	if len(alone) != 3 {
		t.Errorf("SEARCH_ONLY=staging reads %d rows, want 3", len(alone))
	}
	for _, want := range []string{"# Search run: build", "# Search run: loop", "Below 100 players the run plays the widest seed"} {
		if !strings.Contains(all, want) {
			t.Errorf("search.md lacks %q", want)
		}
	}
	m := rows["richest-loop-band"]
	if !strings.HasPrefix(m.Value, unmeasured) || m.Holds {
		t.Errorf("richest-loop-band at 20 players is read on the band: %+v", m)
	}
}

// TestSearchStagingDigests: the staging climb's twin of the strongest
// seed at 20 players soaks to the digests it gave before the build and
// loop climbs joined it.
func TestSearchStagingDigests(t *testing.T) {
	b := stagingBook(t)
	ts, err := stagingTwins(b, 20, stagingSmallDays, strongestSeed())
	if err != nil {
		t.Fatal(err)
	}
	for i, want := range []string{
		"6a025b1de6fc337e296b9d44f63fe56a69527e219da902a27720e13bfdb13cfd", // staged
		"9f0b29b3eb406cb4c865101d02398eca472a8f7e9ace80bcd5cc412c03575cf4", // unstaged
		"ae94af756a02b5a34e45998830145ca159aa4717adcc61434f304b3f235c1d2c", // staged, nothing taken
		"3263b1e6d759f7224b8603103200e64790bbae80b21bfec6d298287eada791d2", // staging-free
	} {
		if got := ts.soaks()[i].digest; got != want {
			t.Errorf("staging twin %d soaked to %s, want %s", i, got, want)
		}
	}
}

// TestBattleCraftReadingsKept: sharing the Battle run's cells and the
// Craft run's sample with the build climb moved none of their readings.
func TestBattleCraftReadingsKept(t *testing.T) {
	b := stagingBook(t)
	t.Setenv("BATTLE_ONLY", "")
	for _, x := range []struct {
		name string
		run  Run
		n    int
		want string
	}{
		{"battle", BattleRun, 14, "4be7730ad8e8e96241340338d2b0d7aca80a6f3a248e09bc42a83a21468e8d3e"},
		{"craft", CraftRun, 3000, "1c61d85d91c71cd8434df6a27b745dea2c24c644a19fc86bd8d8d4672f6153df"},
	} {
		rs, err := x.run(b, t.TempDir(), x.n)
		if err != nil {
			t.Fatal(err)
		}
		h := sha256.New()
		for _, m := range rs {
			fmt.Fprintf(h, "%s|%s|%t\n", m.Target, m.Value, m.Holds)
		}
		if got := hex.EncodeToString(h.Sum(nil)); got != x.want {
			t.Errorf("%s -n %d reads %s, want %s:\n%+v", x.name, x.n, got, x.want, rs)
		}
	}
}
