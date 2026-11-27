package main

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"jams.team/mmo-world/harness"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/sheets"
)

// asHarness makes the test binary the harness command, so the suite's
// labels can run it as their subprocess.
const asHarness = "MMO_HARNESS_TEST_AS_MAIN"

func TestMain(m *testing.M) {
	if os.Getenv(asHarness) == "1" {
		main()
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func testBook(text string) *sheets.Book {
	return &sheets.Book{Targets: []sheets.Target{
		{ID: "coin-band", Text: "Coin stays in its band", Runs: "economy", HoldsFrom: "MM5"},
		{ID: "cost-flat", Text: text, Runs: "social", HoldsFrom: "MM4"},
	}}
}

func digestOf(t *testing.T, b *sheets.Book) string {
	t.Helper()
	d, err := b.Digest()
	if err != nil {
		t.Fatal(err)
	}
	return d
}

// TestCommitOf: HEAD of a clean module, marked +dirty once it has an
// untracked file.
func TestCommitOf(t *testing.T) {
	t.Setenv("MMO_COMMIT", "")
	dir := t.TempDir()
	git := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"}, args...)...)
		out, err := cmd.Output()
		if err != nil {
			t.Fatalf("git %v: %v", args, err)
		}
		return strings.TrimSpace(string(out))
	}
	git("init", "-q")
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	git("add", "a.txt")
	git("commit", "-q", "-m", "one")
	head := git("rev-parse", "HEAD")
	if got := commitOf(dir); got != head {
		t.Errorf("clean: %q, want %q", got, head)
	}
	if err := os.WriteFile(filepath.Join(dir, "b.txt"), []byte("b"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := commitOf(dir); got != head+"+dirty" {
		t.Errorf("dirty: %q, want %q", got, head+"+dirty")
	}
}

func TestReportCheck(t *testing.T) {
	root := t.TempDir()
	b := testBook("A day costs the same")
	var out bytes.Buffer
	if ok, err := report(&out, root, b, reportOptions{check: true}); ok || err != nil {
		t.Fatalf("no epoch file passes -check: %v %v %s", ok, err, out.String())
	}
	dir := filepath.Join(root, epochsDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	other := testBook("A day costs about the same")
	if err := harness.WriteEpoch(filepath.Join(dir, harness.EpochFile(1, digestOf(t, other))), &harness.Epoch{Seq: 1, Book: digestOf(t, other)}); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	if ok, err := report(&out, root, b, reportOptions{check: true}); ok || err != nil || !strings.Contains(out.String(), harness.EpochFile(2, digestOf(t, b))) {
		t.Fatalf("an epoch file of another book passes -check: %v %v %s", ok, err, out.String())
	}
	if err := harness.WriteEpoch(filepath.Join(dir, harness.EpochFile(2, digestOf(t, b))), &harness.Epoch{Seq: 2, Book: digestOf(t, b)}); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	if ok, err := report(&out, root, b, reportOptions{check: true}); !ok || err != nil {
		t.Fatalf("this book's epoch file fails -check: %v %v %s", ok, err, out.String())
	}
}

func TestReportInWriteStrict(t *testing.T) {
	root, in := t.TempDir(), t.TempDir()
	dir := filepath.Join(root, epochsDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	base, head := testBook("A day costs about the same"), testBook("A day costs the same")
	before := &harness.Epoch{Seq: 1, Book: digestOf(t, base), Commit: "base", Targets: []harness.EpochRow{
		{ID: "coin-band", Text: "Coin stays in its band", Holds: harness.HoldsYes, Readings: []harness.Labelled{{Label: "economy-1000", Value: "375–433", Holds: true, Measured: true}}},
	}}
	if err := harness.WriteEpoch(filepath.Join(dir, harness.EpochFile(1, before.Book)), before); err != nil {
		t.Fatal(err)
	}
	for _, r := range []harness.Readings{
		{Label: "economy-1000", Run: "economy", N: 1000, Commit: "head", Book: digestOf(t, head), Rows: []harness.Measured{{Target: "coin-band", Value: "340–433", Holds: false}}},
		{Label: "social-alone", Run: "social", Alone: true, Commit: "head", Book: digestOf(t, head), Rows: []harness.Measured{{Target: "cost-flat", Value: "+6.5%", Holds: true}}},
	} {
		p := filepath.Join(in, r.Label)
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := harness.WriteReadings(p, r); err != nil {
			t.Fatal(err)
		}
	}

	var out bytes.Buffer
	ok, err := report(&out, root, head, reportOptions{in: in, write: dir, note: "launch", strict: true})
	if err != nil || ok {
		t.Fatalf("-strict passes a target that now misses: %v %v", ok, err)
	}
	for _, want := range []string{"| Coin stays in its band | economy | economy-1000: 375–433 | economy-1000: 340–433 | yes → **NO** | now misses |", "| A day costs the same | social | – | social-alone: +6.5% | – → yes | new |", "commit `head`"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("report lacks %q:\n%s", want, out.String())
		}
	}
	md, err := os.ReadFile(filepath.Join(in, "report.md"))
	if err != nil || !bytes.Equal(md, out.Bytes()) {
		t.Errorf("report.md differs from what was printed: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(in, "report.json"))
	var rows []harness.EpochRow
	if err != nil || json.Unmarshal(raw, &rows) != nil || len(rows) != 2 || rows[0].Holds != harness.HoldsNo {
		t.Errorf("report.json: %v %s", err, raw)
	}
	written, err := harness.ReadEpoch(filepath.Join(dir, harness.EpochFile(2, digestOf(t, head))))
	if err != nil || written.Seq != 2 || written.Commit != "head" || written.Note != "launch" || len(written.Labels) != 2 {
		t.Fatalf("written epoch: %+v %v", written, err)
	}

	out.Reset()
	if ok, err := report(&out, root, head, reportOptions{}); !ok || err != nil || !strings.Contains(out.String(), "After: epoch 0002") || !strings.Contains(out.String(), "Before: epoch 0001") {
		t.Errorf("report with no flags: %v %v\n%s", ok, err, out.String())
	}
	if _, err := report(&out, root, head, reportOptions{in: in, write: filepath.Join(dir, "launch.json")}); err == nil {
		t.Error("-write to a file not named for its epoch")
	}
}

func TestSwitchesKeepNoSecret(t *testing.T) {
	t.Setenv("ECONOMY_SEED", "3")
	t.Setenv("LOAD_TOKEN", "never")
	t.Setenv("MMO_API_TOKEN", "never")
	got := switches()
	if got["ECONOMY_SEED"] != "3" {
		t.Errorf("switches %v lack ECONOMY_SEED", got)
	}
	for k, v := range got {
		if v == "never" {
			t.Errorf("switches keep %s", k)
		}
	}
}

// TestAllCheckSeason runs harness all -only check,season into a temp dir:
// each label's files, suite.json, and the report against epoch 0001 with
// the check's outcome under its title.
func TestAllCheckSeason(t *testing.T) {
	if testing.Short() {
		t.Skip("runs the check and the season run")
	}
	t.Setenv(asHarness, "1")
	root := sheetfs.ModuleRoot()
	b, err := sheetfs.LoadBook(root)
	if err != nil {
		t.Fatal(err)
	}
	against, err := filepath.Glob(filepath.Join(root, epochsDir, "0001-*.json"))
	if err != nil || len(against) != 1 {
		t.Fatalf("epoch 0001: %v %v", against, err)
	}
	out := t.TempDir()
	var stdout, log bytes.Buffer
	ok, err := runAll(t.Context(), &stdout, &log, root, b, allOptions{out: out, jobs: 2, only: []string{"check", "season"},
		report: reportOptions{against: against[0], commit: "test-commit"}})
	if err != nil {
		t.Fatalf("%v\n%s", err, log.String())
	}
	t.Log(log.String())
	for _, f := range []string{"check/stdout.txt", "check/stderr.txt", "check/exit.txt", "check/secs.txt",
		"season/stdout.txt", "season/season.md", "season/readings.json", "season/exit.txt", "season/secs.txt",
		harness.SuiteFile, "report.md", "report.json"} {
		if _, err := os.Stat(filepath.Join(out, f)); err != nil {
			t.Error(err)
		}
	}
	var suite harness.SuiteResult
	raw, err := os.ReadFile(filepath.Join(out, harness.SuiteFile))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &suite); err != nil {
		t.Fatal(err)
	}
	if suite.Commit != "test-commit" || len(suite.Labels) != 2 || suite.Labels[0].Label != "check" || suite.Labels[1].Label != "season" {
		t.Fatalf("suite.json: %+v", suite)
	}
	season := suite.Labels[1]
	if season.Exit != 0 {
		stderr, _ := os.ReadFile(filepath.Join(out, "season", "stderr.txt"))
		t.Fatalf("season exit %d: %s", season.Exit, stderr)
	}
	var r harness.Readings
	raw, err = os.ReadFile(filepath.Join(out, "season", harness.ReadingsFile))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &r); err != nil || r.Label != "season" || r.Commit != "test-commit" || len(r.Rows) == 0 {
		t.Fatalf("season readings: %+v %v", r, err)
	}
	md, err := os.ReadFile(filepath.Join(out, "report.md"))
	if err != nil {
		t.Fatal(err)
	}
	check := map[bool]string{true: "Check: pass.", false: "Check: **fail**"}[suite.Labels[0].Exit == 0]
	if !strings.Contains(string(md), check) || !strings.Contains(string(md), "Before: epoch 0001") {
		t.Errorf("report.md has no %q or no before:\n%s", check, md)
	}
	if !strings.Contains(string(md), "| A season's stages") && !strings.Contains(string(md), "season") {
		t.Errorf("report.md reads no season row")
	}
	if ok != (suite.Labels[0].Exit == 0) {
		t.Errorf("all returned %v with check exit %d", ok, suite.Labels[0].Exit)
	}
	var rows []harness.EpochRow
	raw, err = os.ReadFile(filepath.Join(out, "report.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &rows); err != nil || len(rows) != len(b.Targets) {
		t.Fatalf("report.json: %d rows, %d targets, %v", len(rows), len(b.Targets), err)
	}
	for _, row := range rows {
		if row.ID == "season-zero" && row.Holds == harness.HoldsNone {
			t.Errorf("season-zero unread: %+v", row)
		}
	}
}
