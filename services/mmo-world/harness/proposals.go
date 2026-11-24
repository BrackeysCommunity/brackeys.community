package harness

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/sheets"
)

// Proposals check candidate story.arcs rows, such as the offline arc
// proposal job writes, against the book (GDD 12.9). A row is data a person
// approves by copying it into the next rules epoch; nothing here writes a
// sheet.

// ProposedRow is one candidate row as read, and where it came from.
type ProposedRow struct {
	File  string
	Index int // 1-based within its file
	Raw   json.RawMessage
}

// ProposalResult is a candidate row and why it was refused; no problems
// means the book takes it.
type ProposalResult struct {
	ProposedRow
	ID       string
	Problems []string
}

// Accepted reports whether the book takes the row.
func (r ProposalResult) Accepted() bool { return len(r.Problems) == 0 }

// ReadProposals reads candidate rows from a file, or from every .json file
// of a directory in name order. A file is a story.arcs sheet, an object
// with rows, or a bare list of rows.
func ReadProposals(in string) ([]ProposedRow, error) {
	info, err := os.Stat(in)
	if err != nil {
		return nil, err
	}
	files := []string{in}
	if info.IsDir() {
		files, err = filepath.Glob(filepath.Join(in, "*.json"))
		if err != nil {
			return nil, err
		}
		slices.Sort(files)
		if len(files) == 0 {
			return nil, fmt.Errorf("%s: no .json files", in)
		}
	}
	var out []ProposedRow
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			return nil, err
		}
		rows, err := proposedRows(b)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", f, err)
		}
		for i, r := range rows {
			out = append(out, ProposedRow{File: f, Index: i + 1, Raw: r})
		}
	}
	return out, nil
}

func proposedRows(b []byte) ([]json.RawMessage, error) {
	b = bytes.TrimSpace(b)
	var rows []json.RawMessage
	if len(b) > 0 && b[0] == '[' {
		return rows, json.Unmarshal(b, &rows)
	}
	var file struct {
		Sheet string            `json:"sheet"`
		Rows  []json.RawMessage `json:"rows"`
	}
	if err := json.Unmarshal(b, &file); err != nil {
		return nil, err
	}
	if file.Sheet != "" && file.Sheet != "story.arcs" {
		return nil, fmt.Errorf("sheet %q is not story.arcs", file.Sheet)
	}
	if file.Rows == nil {
		return nil, fmt.Errorf("no rows")
	}
	return file.Rows, nil
}

// CheckProposals checks each row alone: it must decode, take an id no sheet or earlier row holds, name a registered predicate and story effects, and leave the book valid and compiling.
func CheckProposals(b *sheets.Book, rows []ProposedRow) []ProposalResult {
	taken := b.StoryIDs()
	effects := sheets.StoryEffectKinds()
	out := make([]ProposalResult, 0, len(rows))
	for _, pr := range rows {
		res := ProposalResult{ProposedRow: pr}
		var row sheets.ArcRow
		dec := json.NewDecoder(bytes.NewReader(pr.Raw))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&row); err != nil {
			res.Problems = append(res.Problems, "does not decode as a story.arcs row: "+err.Error())
			out = append(out, res)
			continue
		}
		res.ID = row.ID
		if what, ok := taken[row.ID]; ok {
			res.Problems = append(res.Problems, "id "+strconv.Quote(row.ID)+" is already "+what)
		}
		if _, ok := arc.Predicates[row.When]; !ok {
			res.Problems = append(res.Problems, "when "+strconv.Quote(row.When)+" is not a registered predicate")
		}
		for _, k := range rowEffectKinds(row) {
			if !slices.Contains(effects, k) {
				res.Problems = append(res.Problems, "effect "+strconv.Quote(k)+" is not a story effect")
			}
		}
		if res.Accepted() {
			res.Problems = withRow(b, row)
		}
		if res.Accepted() {
			taken[row.ID] = "proposed by an earlier row"
		}
		out = append(out, res)
	}
	return out
}

// rowEffectKinds are the kinds of every side's win and every lapse.
func rowEffectKinds(row sheets.ArcRow) []string {
	var out []string
	for _, st := range row.Stages {
		for _, sd := range st.Sides {
			for _, e := range sd.Won {
				out = append(out, e.Kind)
			}
		}
		for _, e := range st.Lapse {
			out = append(out, e.Kind)
		}
	}
	return out
}

// withRow validates and compiles a copy of the book with the row added to
// story.arcs, and returns what either refuses.
func withRow(b *sheets.Book, row sheets.ArcRow) []string {
	nb := *b
	nb.Arcs = append(slices.Clone(b.Arcs), row)
	var out []string
	if err := nb.Validate(); err != nil {
		for line := range strings.SplitSeq(err.Error(), "\n") {
			if line = strings.TrimSpace(line); line != "" {
				out = append(out, line)
			}
		}
		return out
	}
	if _, err := arc.Compile(&nb); err != nil {
		out = append(out, err.Error())
	}
	return out
}

// PrintProposals writes each row's verdict and returns how many the book
// takes.
func PrintProposals(w io.Writer, rs []ProposalResult) int {
	accepted := 0
	for _, r := range rs {
		id := r.ID
		if id == "" {
			id = "(no id)"
		}
		where := fmt.Sprintf("%s row %d", filepath.Base(r.File), r.Index)
		if r.Accepted() {
			accepted++
			fmt.Fprintf(w, "accepted %s (%s)\n", id, where)
			continue
		}
		fmt.Fprintf(w, "refused  %s (%s)\n", id, where)
		for _, p := range r.Problems {
			fmt.Fprintf(w, "         %s\n", p)
		}
	}
	fmt.Fprintf(w, "%d of %d rows accepted\n", accepted, len(rs))
	return accepted
}
