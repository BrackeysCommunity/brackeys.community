package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"jams.team/mmo-world/harness"
	"jams.team/mmo-world/sim/sheets"
)

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
