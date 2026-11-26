package harness

import (
	"bytes"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/sheets"
)

func readingsBook() *sheets.Book {
	return &sheets.Book{Targets: []sheets.Target{
		{ID: "both-hold", Text: "Both runs hold it", Runs: "economy", HoldsFrom: "MM5"},
		{ID: "one-misses", Text: "One run misses it", Runs: "economy, crime", HoldsFrom: "MM5"},
		{ID: "cost-flat", Text: "A day costs the same", Runs: "social", HoldsFrom: "MM4"},
		{ID: "only-why", Text: "Only a reason", Runs: "economy", HoldsFrom: "MM9"},
		{ID: "never-read", Text: "Nothing reads it", Runs: "map", HoldsFrom: "MM13"},
		{ID: "alone-why", Text: "Alone without a reading", Runs: "social", HoldsFrom: "MM4"},
	}}
}

func TestReadingsMerge(t *testing.T) {
	b := readingsBook()
	rs := []Readings{
		{Label: "economy-10", Rows: []Measured{
			{Target: "both-hold", Value: "a", Holds: true},
			{Target: "one-misses", Value: "b", Holds: true},
			{Target: "only-why", Value: unmeasured + "read at 1,000"},
		}},
		{Label: "crime-10", Rows: []Measured{
			{Target: "both-hold", Value: "c", Holds: true},
			{Target: "one-misses", Value: "d", Holds: false},
		}},
		{Label: "social", Rows: []Measured{
			{Target: "cost-flat", Value: "+20.8%", Holds: false},
			{Target: "alone-why", Value: "held beside the suite", Holds: true},
		}},
		{Label: "social-alone", Alone: true, Rows: []Measured{
			{Target: "cost-flat", Value: "+6.5%", Holds: true},
			{Target: "alone-why", Value: unmeasured + "too short"},
		}},
	}
	got := map[string]EpochRow{}
	for _, r := range Merge(b, rs) {
		got[r.ID] = r
	}
	want := map[string]string{"both-hold": HoldsYes, "one-misses": HoldsNo, "cost-flat": HoldsYes, "only-why": HoldsNone, "never-read": HoldsNone, "alone-why": HoldsYes}
	for id, h := range want {
		if got[id].Holds != h {
			t.Errorf("%s holds %q, want %q (%+v)", id, got[id].Holds, h, got[id])
		}
	}
	if n := len(got["one-misses"].Readings); n != 2 {
		t.Errorf("one-misses shows %d readings, want both", n)
	}
	if r := got["cost-flat"].Readings; len(r) != 1 || r[0].Label != "social-alone" || !r[0].Alone {
		t.Errorf("the alone reading does not supersede: %+v", r)
	}
	if r := got["alone-why"].Readings; len(r) != 2 {
		t.Errorf("an alone run that measured nothing superseded a reading: %+v", r)
	}
	if r := got["only-why"].Readings; len(r) != 1 || r[0].Measured || r[0].Holds {
		t.Errorf("an unmeasured reading: %+v", r)
	}
	if r := got["never-read"].Readings; r == nil || len(r) != 0 {
		t.Errorf("no readings should be an empty list: %#v", r)
	}
}

func TestReadingsParseReport(t *testing.T) {
	b := readingsBook()
	in := []Measured{
		{Target: "both-hold", Value: "350–433 coin, a | in a value", Holds: true},
		{Target: "one-misses", Value: "12.00%", Holds: false},
		{Target: "only-why", Value: unmeasured + "read from 1,000 players"},
	}
	var out bytes.Buffer
	Report(&out, b, in)
	// A later book may change a target's runs column; rows match by text.
	edited := readingsBook()
	edited.Targets[1].Runs = "crime"
	got := ParseReport(out.String(), edited)
	if !slices.Equal(got, in) {
		t.Fatalf("parsed\n%+v\nwant\n%+v\nfrom\n%s", got, in, out.String())
	}
}

func TestReadingsLabelRun(t *testing.T) {
	for _, c := range []struct {
		label, run string
		n          int
		alone      bool
	}{
		{"economy-10-s1", "economy", 10, false},
		{"economy-1000", "economy", 1000, false},
		{"social-alone", "social", 0, true},
		{"spike-e-40", "spike-e", 40, false},
		{"terrain-1000p", "terrain", 1000, false},
		{"battle", "battle", 0, false},
		{"check", "check", 0, false},
		{"mystery", "mystery", 0, false},
	} {
		run, n, alone := labelRun(c.label)
		if run != c.run || n != c.n || alone != c.alone {
			t.Errorf("%s: %s %d %v, want %s %d %v", c.label, run, n, alone, c.run, c.n, c.alone)
		}
	}
}

func TestReadingsReadSuite(t *testing.T) {
	b := readingsBook()
	dir := t.TempDir()
	mk := func(label string) string {
		p := filepath.Join(dir, label)
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
		return p
	}
	written := Readings{Label: "economy-10", Run: "economy", N: 10, Env: map[string]string{"ECONOMY_SEED": "1"}, Commit: "abc", Book: "other", Secs: 3,
		Rows: []Measured{{Target: "both-hold", Value: "a", Holds: true}}}
	if err := WriteReadings(mk("economy-10"), written); err != nil {
		t.Fatal(err)
	}
	legacy := mk("social-alone")
	if err := os.WriteFile(filepath.Join(legacy, ReadingsFile), []byte(`[{"Target":"cost-flat","Value":"+6.5%","Holds":true}]`), 0o644); err != nil {
		t.Fatal(err)
	}
	var table bytes.Buffer
	Report(&table, b, []Measured{{Target: "one-misses", Value: "d", Holds: false}})
	parsed := mk("crime-1000")
	_ = os.WriteFile(filepath.Join(parsed, "stdout.txt"), table.Bytes(), 0o644)
	_ = os.WriteFile(filepath.Join(parsed, "secs.txt"), []byte("374s\n"), 0o644)
	_ = os.WriteFile(filepath.Join(mk("spike-a"), "stdout.txt"), []byte("no table here\n"), 0o644)
	mk("empty")

	rs, err := ReadSuite(dir, b)
	if err != nil {
		t.Fatal(err)
	}
	digest, _ := b.Digest()
	var labels []string
	for _, r := range rs {
		labels = append(labels, r.Label)
	}
	if !slices.Equal(labels, []string{"crime-1000", "economy-10", "social-alone", "spike-a"}) {
		t.Fatalf("labels %v", labels)
	}
	if r := rs[1]; r.Book != "other" || r.Commit != "abc" || r.Env["ECONOMY_SEED"] != "1" || len(r.Rows) != 1 {
		t.Errorf("a written readings.json read back as %+v", r)
	}
	if r := rs[0]; r.Run != "crime" || r.N != 1000 || r.Secs != 374 || r.Book != digest || len(r.Rows) != 1 || r.Rows[0].Holds {
		t.Errorf("a stdout-only label read as %+v", r)
	}
	if r := rs[2]; !r.Alone || r.Run != "social" || len(r.Rows) != 1 || !r.Rows[0].Holds {
		t.Errorf("a bare list of readings read as %+v", r)
	}
	if r := rs[3]; len(r.Rows) != 0 || r.Run != "spike-a" {
		t.Errorf("a label with no table read as %+v", r)
	}
}

func writeEpoch(t *testing.T, dir string, seq int, book string) {
	t.Helper()
	if err := WriteEpoch(filepath.Join(dir, EpochFile(seq, book)), &Epoch{Seq: seq, Book: book}); err != nil {
		t.Fatal(err)
	}
}

func TestEpochLast(t *testing.T) {
	dir := t.TempDir()
	if e, err := LastEpoch(filepath.Join(dir, "missing"), "x"); e != nil || err != nil {
		t.Fatalf("a missing dir: %v %v", e, err)
	}
	a, bk, c := strings.Repeat("a", 64), strings.Repeat("b", 64), strings.Repeat("c", 64)
	writeEpoch(t, dir, 1, a)
	writeEpoch(t, dir, 2, bk)
	writeEpoch(t, dir, 3, bk)
	_ = os.WriteFile(filepath.Join(dir, "README.txt"), []byte("not an epoch"), 0o644)
	for _, k := range []struct {
		book string
		seq  int
	}{{bk, 1}, {c, 3}, {a, 3}} {
		e, err := LastEpoch(dir, k.book)
		if err != nil || e == nil || e.Seq != k.seq {
			t.Errorf("LastEpoch(%s…) = %+v, %v; want seq %d", k.book[:4], e, err, k.seq)
		}
	}
	single := t.TempDir()
	writeEpoch(t, single, 1, a)
	if e, err := LastEpoch(single, a); e != nil || err != nil {
		t.Errorf("only the current book: %+v, %v", e, err)
	}
	if err := WriteEpoch(filepath.Join(dir, EpochFile(4, c)), &Epoch{Seq: 5, Book: c}); err == nil {
		t.Error("an epoch written under another seq's name")
	}
	if err := WriteEpoch(filepath.Join(dir, EpochFile(4, a)), &Epoch{Seq: 4, Book: c}); err == nil {
		t.Error("an epoch written under another book's name")
	}
}

func TestEpochReportDiffChange(t *testing.T) {
	b := &sheets.Book{}
	rows := func(holds ...string) []EpochRow {
		var out []EpochRow
		for i, h := range holds {
			r := EpochRow{ID: string(rune('a' + i)), Text: "target " + string(rune('a'+i)), Holds: h}
			if h != HoldsNone {
				r.Readings = []Labelled{{Label: "run", Value: "v", Holds: h == HoldsYes, Measured: true}}
			}
			out = append(out, r)
		}
		return out
	}
	before := &Epoch{Seq: 1, Book: strings.Repeat("1", 64), Commit: "base", Targets: rows(HoldsYes, HoldsYes, HoldsNo, HoldsYes, HoldsNone, HoldsYes, HoldsYes)}
	after := &Epoch{Book: strings.Repeat("2", 64), Commit: "head", Targets: rows(HoldsYes, HoldsYes, HoldsYes, HoldsNo, HoldsYes, HoldsNone)}
	after.Targets[1].Readings[0].Value = "w"
	after.Targets = append(after.Targets, EpochRow{ID: "new-row", Text: "target new", Holds: HoldsNo, Readings: []Labelled{{Label: "run", Value: "x", Measured: true}}})
	for _, t := range append(before.Targets, after.Targets...) {
		b.Targets = append(b.Targets, sheets.Target{ID: t.ID, Text: t.Text, Runs: "battle"})
	}
	want := []string{ChangeSame, ChangeMoved, ChangeNowHolds, ChangeNowMisses, ChangeNew, ChangeUnmeasured, ChangeNew, ChangeRemoved}
	var out bytes.Buffer
	ReportDiff(&out, b, before, after)
	var got []string
	for line := range strings.SplitSeq(out.String(), "\n") {
		if strings.HasPrefix(line, "| target ") {
			cells := strings.Split(strings.Trim(line, "| "), " | ")
			got = append(got, cells[len(cells)-1])
		}
	}
	if !slices.Equal(got, want) {
		t.Fatalf("change column %v, want %v\n%s", got, want, out.String())
	}
	if m := NowMisses(before, after); !slices.Equal(m, []string{"d"}) {
		t.Errorf("NowMisses = %v", m)
	}
	if !strings.Contains(out.String(), "epoch 0001, book `111111111111`, commit `base`") {
		t.Errorf("the header does not name the before epoch:\n%s", out.String())
	}
	var none bytes.Buffer
	ReportDiff(&none, b, nil, after)
	if !strings.Contains(none.String(), "Before: no epoch.") || NowMisses(nil, after) != nil {
		t.Errorf("against no epoch:\n%s", none.String())
	}
}

// The committed epoch files load, name their seq and book, and the first
// is the book the closed test runs on.
func TestEpochFilesCommitted(t *testing.T) {
	es, err := Epochs(filepath.Join(sheetfs.ModuleRoot(), "harness", "epochs"))
	if err != nil {
		t.Fatal(err)
	}
	if len(es) == 0 || es[0].Seq != 1 || !strings.HasPrefix(es[0].Book, "1767b7ef") {
		t.Fatalf("epoch files: %+v", es)
	}
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range es {
		for _, r := range e.Targets {
			if !slices.ContainsFunc(b.Targets, func(t sheets.Target) bool { return t.ID == r.ID }) {
				t.Errorf("epoch %04d reads %s, which meta.targets no longer has", e.Seq, r.ID)
			}
		}
	}
}
