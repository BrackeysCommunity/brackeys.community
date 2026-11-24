package harness

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/sheets"
)

func proposalsBook(t *testing.T) *sheets.Book {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func verdicts(t *testing.T, b *sheets.Book, in string) map[string]ProposalResult {
	t.Helper()
	rows, err := ReadProposals(in)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]ProposalResult{}
	for _, r := range CheckProposals(b, rows) {
		out[r.ID] = r
	}
	return out
}

func TestProposals(t *testing.T) {
	b := proposalsBook(t)
	arcs := len(b.Arcs)
	got := verdicts(t, b, filepath.Join("testdata", "proposals"))
	if len(b.Arcs) != arcs {
		t.Fatalf("checking proposals changed the book's arcs: %d, was %d", len(b.Arcs), arcs)
	}
	if r := got["the-dry-wells"]; !r.Accepted() {
		t.Fatalf("the valid row was refused: %v", r.Problems)
	}
	for id, want := range map[string]string{
		"the-bad-omen":    `when "no-such-predicate" is not a registered predicate`,
		"the-bad-harvest": `effect "famine" is not a story effect`,
	} {
		r, ok := got[id]
		if !ok || r.Accepted() || !strings.Contains(strings.Join(r.Problems, "\n"), want) {
			t.Errorf("%s: problems %q, want one saying %q", id, r.Problems, want)
		}
	}

	var out bytes.Buffer
	if n := PrintProposals(&out, CheckProposals(b, mustRows(t, filepath.Join("testdata", "proposals")))); n != 1 {
		t.Fatalf("accepted %d rows, want 1:\n%s", n, out.String())
	}
	if !strings.Contains(out.String(), "1 of 3 rows accepted") {
		t.Fatalf("summary missing:\n%s", out.String())
	}
}

func mustRows(t *testing.T, in string) []ProposedRow {
	t.Helper()
	rows, err := ReadProposals(in)
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

// A row is refused for what the book would refuse: an id it already holds,
// a second proposal of the same id, a field no row has, and a shape the
// story checks reject.
func TestProposalsRefuseWhatTheBookRefuses(t *testing.T) {
	b := proposalsBook(t)
	valid := mustRows(t, filepath.Join("testdata", "proposals", "valid.json"))[0]
	edit := func(f func(map[string]any)) ProposedRow {
		var m map[string]any
		if err := json.Unmarshal(valid.Raw, &m); err != nil {
			t.Fatal(err)
		}
		f(m)
		raw, err := json.Marshal(m)
		if err != nil {
			t.Fatal(err)
		}
		return ProposedRow{File: "edited.json", Index: 1, Raw: raw}
	}
	rows := []ProposedRow{
		edit(func(m map[string]any) { m["id"] = b.Arcs[0].ID }),
		edit(func(m map[string]any) { m["id"] = b.Troubles[0].ID }),
		valid,
		valid,
		edit(func(m map[string]any) { m["id"], m["script"] = "the-scripted", "run()" }),
		edit(func(m map[string]any) {
			m["id"] = "the-two-stages"
			st := m["stages"].([]any)
			m["stages"] = append(st, st[0])
		}),
	}
	rs := CheckProposals(b, rows)
	want := []string{"is already a story.arcs row", "is already a story.troubles row", "", "proposed by an earlier row",
		"unknown field", "a region or personal arc has one stage"}
	for i, r := range rs {
		joined := strings.Join(r.Problems, "\n")
		if want[i] == "" {
			if !r.Accepted() {
				t.Errorf("row %d refused: %s", i+1, joined)
			}
			continue
		}
		if !strings.Contains(joined, want[i]) {
			t.Errorf("row %d: problems %q, want one saying %q", i+1, joined, want[i])
		}
	}
}

func TestProposalsReadShapes(t *testing.T) {
	for name, body := range map[string]string{
		"list":  `[{"id":"a"},{"id":"b"}]`,
		"rows":  `{"rows":[{"id":"a"},{"id":"b"}]}`,
		"sheet": `{"sheet":"story.arcs","rows":[{"id":"a"},{"id":"b"}]}`,
	} {
		rows, err := proposedRows([]byte(body))
		if err != nil || len(rows) != 2 {
			t.Errorf("%s: %d rows, %v", name, len(rows), err)
		}
	}
	if _, err := proposedRows([]byte(`{"sheet":"story.troubles","rows":[]}`)); err == nil {
		t.Error("a story.troubles file was read as proposals")
	}
}
