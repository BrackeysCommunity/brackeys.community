package harness

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sheetdiff"
	"jams.team/mmo-world/sim/sheets"
)

// ReadingsFile is what a run writes beside its outputs.
const ReadingsFile = "readings.json"

// Readings is what one run writes beside its outputs, as readings.json.
type Readings struct {
	Label  string            `json:"label"` // the suite's label, or the run's name
	Run    string            `json:"run"`
	N      int               `json:"n"`
	Env    map[string]string `json:"env,omitempty"` // the run's switches: ECONOMY_SEED, SEARCH_ONLY, ...
	Alone  bool              `json:"alone,omitempty"`
	Commit string            `json:"commit"`
	Book   string            `json:"book"` // the sheets digest the run read
	Secs   int64             `json:"secs"`
	Rows   []Measured        `json:"rows"`
}

// Epoch is one book's stored readings: harness/epochs/NNNN-<book[:12]>.json.
type Epoch struct {
	Seq     int        `json:"seq"`
	Book    string     `json:"book"`
	Commit  string     `json:"commit"`
	Taken   string     `json:"taken"` // YYYY-MM-DD
	Note    string     `json:"note"`
	Labels  []RunLabel `json:"labels"`  // the runs the readings came from
	Targets []EpochRow `json:"targets"` // in meta.targets order
}

// RunLabel is one run of an epoch, without its rows.
type RunLabel struct {
	Label  string            `json:"label"`
	Run    string            `json:"run"`
	N      int               `json:"n"`
	Env    map[string]string `json:"env,omitempty"`
	Alone  bool              `json:"alone,omitempty"`
	Commit string            `json:"commit,omitempty"`
	Book   string            `json:"book,omitempty"`
	Secs   int64             `json:"secs"`
}

// EpochRow is one target and every reading of it.
type EpochRow struct {
	ID       string     `json:"id"`
	Text     string     `json:"text"`
	Holds    string     `json:"holds"` // "yes", "no" or "–" (nothing measured)
	Readings []Labelled `json:"readings"`
}

// Labelled is one reading of a target and the run it came from.
type Labelled struct {
	Label    string `json:"label"`
	Value    string `json:"value"`
	Holds    bool   `json:"holds"`
	Measured bool   `json:"measured"` // false: Value says why not
	Alone    bool   `json:"alone,omitempty"`
}

// The Holds of an epoch row.
const (
	HoldsYes  = "yes"
	HoldsNo   = "no"
	HoldsNone = "–"
)

// The Change column of ReportDiff.
const (
	ChangeSame       = "same"
	ChangeMoved      = "moved"
	ChangeNowHolds   = "now holds"
	ChangeNowMisses  = "now misses"
	ChangeNew        = "new"
	ChangeUnmeasured = "unmeasured"
	ChangeRemoved    = "removed"
)

// WriteReadings writes dir/readings.json.
func WriteReadings(dir string, r Readings) error {
	if r.Rows == nil {
		r.Rows = []Measured{}
	}
	return writeJSON(filepath.Join(dir, ReadingsFile), r)
}

// ReadSuite reads every readings.json under dir. A label dir with only a
// stdout.txt is read from its Report table, rows matched by target text,
// as is a readings.json holding a bare list of readings; their run, size
// and aloneness come from the label, their book is b's.
func ReadSuite(dir string, b *sheets.Book) ([]Readings, error) {
	digest, err := b.Digest()
	if err != nil {
		return nil, err
	}
	var out []Readings
	err = filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || !d.IsDir() {
			return err
		}
		r, ok, err := readLabel(p, b, digest)
		if ok {
			out = append(out, r)
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	slices.SortStableFunc(out, func(a, b Readings) int { return strings.Compare(a.Label, b.Label) })
	return out, nil
}

func readLabel(dir string, b *sheets.Book, digest string) (Readings, bool, error) {
	label := filepath.Base(dir)
	inferred := func(rows []Measured) Readings {
		run, n, alone := labelRun(label)
		return Readings{Label: label, Run: run, N: n, Alone: alone, Book: digest, Secs: readSecs(dir), Rows: rows}
	}
	raw, err := os.ReadFile(filepath.Join(dir, ReadingsFile))
	switch {
	case err == nil:
		raw = bytes.TrimSpace(raw)
		if bytes.HasPrefix(raw, []byte("[")) {
			var rows []Measured
			if err := json.Unmarshal(raw, &rows); err != nil {
				return Readings{}, false, fmt.Errorf("%s: %w", filepath.Join(dir, ReadingsFile), err)
			}
			return inferred(rows), true, nil
		}
		var r Readings
		if err := json.Unmarshal(raw, &r); err != nil {
			return Readings{}, false, fmt.Errorf("%s: %w", filepath.Join(dir, ReadingsFile), err)
		}
		if r.Label == "" {
			r.Label = label
		}
		if r.Run == "" {
			r.Run, _, _ = labelRun(r.Label)
		}
		return r, true, nil
	case !errors.Is(err, fs.ErrNotExist):
		return Readings{}, false, err
	}
	stdout, err := os.ReadFile(filepath.Join(dir, "stdout.txt"))
	if errors.Is(err, fs.ErrNotExist) {
		return Readings{}, false, nil
	}
	if err != nil {
		return Readings{}, false, err
	}
	return inferred(ParseReport(string(stdout), b)), true, nil
}

// readSecs reads a suite label's secs.txt ("374s"); 0 when it has none.
func readSecs(dir string) int64 {
	raw, err := os.ReadFile(filepath.Join(dir, "secs.txt"))
	if err != nil {
		return 0
	}
	n, _ := strconv.ParseInt(strings.TrimSuffix(strings.TrimSpace(string(raw)), "s"), 10, 64)
	return n
}

// ParseReport reads the readings back out of a Report table. A row is
// matched to its target by text; a row nothing measured is left out.
func ParseReport(text string, b *sheets.Book) []Measured {
	byText := map[string]string{}
	for _, t := range b.Targets {
		byText[t.Text] = t.ID
	}
	var out []Measured
	seen := map[string]bool{}
	for line := range strings.SplitSeq(text, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "| ") || !strings.HasSuffix(line, " |") {
			continue
		}
		cells := strings.Split(strings.TrimSuffix(strings.TrimPrefix(line, "| "), " |"), " | ")
		// structural: target, holds from, runs, the reading, the mark.
		if len(cells) < 5 {
			continue
		}
		id, ok := byText[cells[0]]
		if !ok || seen[id] {
			continue
		}
		reading, mark := strings.Join(cells[3:len(cells)-1], " | "), cells[len(cells)-1]
		m := Measured{Target: id, Value: reading}
		switch {
		case mark == holds(true):
			m.Holds = true
		case mark == holds(false):
		case strings.HasPrefix(reading, unmeasured):
		default:
			continue
		}
		seen[id] = true
		out = append(out, m)
	}
	return out
}

// labelRun reads a suite label: its run is the longest run name it starts
// with, its size the first number after it, and "-alone" marks it alone.
func labelRun(label string) (run string, n int, alone bool) {
	names := append(slices.Collect(maps.Keys(Runs)), "check")
	slices.SortFunc(names, func(a, b string) int { return len(b) - len(a) })
	run = label
	rest := ""
	for _, name := range names {
		if label == name || strings.HasPrefix(label, name+"-") {
			run, rest = name, strings.TrimPrefix(label, name)
			break
		}
	}
	for tok := range strings.SplitSeq(rest, "-") {
		if tok == "alone" {
			alone = true
		}
		digits := tok[:len(tok)-len(strings.TrimLeftFunc(tok, func(r rune) bool { return r >= '0' && r <= '9' }))]
		if n == 0 && digits != "" {
			n, _ = strconv.Atoi(digits)
		}
	}
	return run, n, alone
}

// Merge reads every target across the runs: a target holds only if every
// measured reading of it holds, and the readings of a run read alone
// supersede the others for the targets they carry.
func Merge(b *sheets.Book, rs []Readings) []EpochRow {
	out := make([]EpochRow, 0, len(b.Targets))
	for _, t := range b.Targets {
		var all []Labelled
		aloneMeasured := false
		for _, r := range rs {
			for _, m := range r.Rows {
				if m.Target != t.ID {
					continue
				}
				measured := !strings.HasPrefix(m.Value, unmeasured)
				all = append(all, Labelled{Label: r.Label, Value: m.Value, Holds: m.Holds && measured, Measured: measured, Alone: r.Alone})
				aloneMeasured = aloneMeasured || (r.Alone && measured)
			}
		}
		if aloneMeasured {
			all = slices.DeleteFunc(all, func(l Labelled) bool { return !l.Alone })
		}
		row := EpochRow{ID: t.ID, Text: t.Text, Holds: HoldsNone, Readings: all}
		if row.Readings == nil {
			row.Readings = []Labelled{}
		}
		for _, l := range all {
			switch {
			case !l.Measured:
			case !l.Holds:
				row.Holds = HoldsNo
			case row.Holds == HoldsNone:
				row.Holds = HoldsYes
			}
		}
		out = append(out, row)
	}
	return out
}

// NewEpoch merges a suite's readings into an epoch of b's book. Seq is
// left 0 until the epoch is written.
func NewEpoch(b *sheets.Book, rs []Readings, commit, note, taken string) (*Epoch, error) {
	digest, err := b.Digest()
	if err != nil {
		return nil, err
	}
	e := &Epoch{Book: digest, Commit: commit, Taken: taken, Note: note, Labels: []RunLabel{}, Targets: Merge(b, rs)}
	for _, r := range rs {
		e.Labels = append(e.Labels, RunLabel{Label: r.Label, Run: r.Run, N: r.N, Env: r.Env, Alone: r.Alone, Commit: r.Commit, Book: r.Book, Secs: r.Secs})
	}
	return e, nil
}

// SuiteCommit is the one commit every reading names, or "" when they name
// none or several.
func SuiteCommit(rs []Readings) string {
	commit := ""
	for _, r := range rs {
		switch {
		case r.Commit == "":
		case commit == "":
			commit = r.Commit
		case commit != r.Commit:
			return ""
		}
	}
	return commit
}

var epochName = regexp.MustCompile(`^(\d{4})-([0-9a-f]{12})\.json$`)

// EpochFile is the epoch file's name for a sequence number and book.
func EpochFile(seq int, book string) string {
	// structural: the name keeps the book's first 12 hex digits.
	const short = 12
	return fmt.Sprintf("%04d-%s.json", seq, book[:min(short, len(book))])
}

// EpochSeq reads the sequence number and short book from an epoch file's
// name; ok is false for any other name.
func EpochSeq(path string) (seq int, book string, ok bool) {
	m := epochName.FindStringSubmatch(filepath.Base(path))
	if m == nil {
		return 0, "", false
	}
	seq, _ = strconv.Atoi(m[1])
	return seq, m[2], true
}

// ReadEpoch reads one epoch file.
func ReadEpoch(path string) (*Epoch, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var e Epoch
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&e); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return &e, nil
}

// WriteEpoch writes an epoch file; its name must carry its seq and book.
func WriteEpoch(path string, e *Epoch) error {
	seq, short, ok := EpochSeq(path)
	if !ok || seq != e.Seq || !strings.HasPrefix(e.Book, short) {
		return fmt.Errorf("%s: an epoch of seq %d and book %s is written as %s", path, e.Seq, e.Book, EpochFile(e.Seq, e.Book))
	}
	return writeJSON(path, e)
}

// Epochs reads every epoch file in dir, by seq; none when dir is missing.
func Epochs(dir string) ([]*Epoch, error) {
	entries, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []*Epoch
	for _, ent := range entries {
		seq, short, ok := EpochSeq(ent.Name())
		if !ok {
			continue
		}
		e, err := ReadEpoch(filepath.Join(dir, ent.Name()))
		if err != nil {
			return nil, err
		}
		if e.Seq != seq || !strings.HasPrefix(e.Book, short) {
			return nil, fmt.Errorf("%s holds seq %d and book %s", ent.Name(), e.Seq, e.Book)
		}
		out = append(out, e)
	}
	slices.SortFunc(out, func(a, b *Epoch) int { return a.Seq - b.Seq })
	for i := 1; i < len(out); i++ {
		if out[i].Seq == out[i-1].Seq {
			return nil, fmt.Errorf("%s: two epoch files of seq %d", dir, out[i].Seq)
		}
	}
	return out, nil
}

// LastEpoch is the highest-numbered epoch whose book is not book: the book
// the world last took. nil when there is none.
func LastEpoch(dir, book string) (*Epoch, error) {
	es, err := Epochs(dir)
	if err != nil {
		return nil, err
	}
	for i := len(es) - 1; i >= 0; i-- {
		if es[i].Book != book {
			return es[i], nil
		}
	}
	return nil, nil
}

// ChangeOf is the Change column of one target from before to after; a
// nil after is a target the book no longer has.
func ChangeOf(before, after *EpochRow) string {
	switch {
	case after == nil:
		return ChangeRemoved
	case after.Holds == HoldsNone:
		return ChangeUnmeasured
	case before == nil || before.Holds == HoldsNone:
		return ChangeNew
	case before.Holds != after.Holds && after.Holds == HoldsYes:
		return ChangeNowHolds
	case before.Holds != after.Holds:
		return ChangeNowMisses
	case slices.Equal(values(before), values(after)):
		return ChangeSame
	default:
		return ChangeMoved
	}
}

// values are a row's readings without their labels, so a renamed label
// alone does not move a row.
func values(r *EpochRow) []string {
	out := make([]string, 0, len(r.Readings))
	for _, l := range r.Readings {
		out = append(out, l.Value)
	}
	slices.Sort(out)
	return out
}

// NowMisses are the targets that held before and miss after.
func NowMisses(before, after *Epoch) []string {
	var out []string
	if after == nil {
		return nil
	}
	prior := rowsByID(before)
	for i := range after.Targets {
		row := &after.Targets[i]
		if ChangeOf(prior[row.ID], row) == ChangeNowMisses {
			out = append(out, row.ID)
		}
	}
	return out
}

func rowsByID(e *Epoch) map[string]*EpochRow {
	out := map[string]*EpochRow{}
	if e == nil {
		return out
	}
	for i := range e.Targets {
		out[e.Targets[i].ID] = &e.Targets[i]
	}
	return out
}

// reportRuns are the seven runs Report's header names labels for.
var reportRuns = []struct{ run, title string }{
	{"check", "Check"}, {"battle", "Battle"}, {"craft", "Craft"}, {"economy", "Economy"},
	{"world", "World"}, {"content", "Content"}, {"search", "Search"},
}

// ReportDiff writes Report before and after as markdown: every target of
// after, with its readings before and after and what changed.
func ReportDiff(w io.Writer, b *sheets.Book, before, after *Epoch) {
	p := func(f string, a ...any) { fmt.Fprintf(w, f+"\n", a...) }
	p("# Report: before and after")
	p("")
	if before == nil {
		p("Before: no epoch.")
	} else {
		p("Before: epoch %04d, book `%s`, commit `%s`, taken %s%s.", before.Seq, shortID(before.Book), shortID(before.Commit), before.Taken, noteOf(before))
	}
	p("After: %s, book `%s`, commit `%s`, taken %s%s.", epochOf(after), shortID(after.Book), shortID(after.Commit), after.Taken, noteOf(after))
	p("")
	p("| Run | Before | After |")
	p("| --- | --- | --- |")
	named := map[string]bool{}
	for _, r := range reportRuns {
		named[r.run] = true
		p("| %s | %s | %s |", r.title, labelsOf(before, func(l RunLabel) bool { return l.Run == r.run }), labelsOf(after, func(l RunLabel) bool { return l.Run == r.run }))
	}
	other := func(l RunLabel) bool { return !named[l.Run] }
	p("| Others | %s | %s |", labelsOf(before, other), labelsOf(after, other))
	p("")
	for _, l := range after.Labels {
		if l.Book != "" && l.Book != after.Book {
			p("- **%s** read book `%s`, not this one.", l.Label, shortID(l.Book))
		}
	}

	prior := rowsByID(before)
	runs := map[string]string{}
	for _, t := range b.Targets {
		runs[t.ID] = t.Runs
	}
	counts := map[string]int{}
	held := map[string]int{}
	type line struct{ row, change string }
	var lines []line
	cell := HoldsNone
	if before != nil {
		cell = fmt.Sprintf("epoch %04d, `%s`", before.Seq, shortID(before.Book))
	}
	afterIDs := map[string]bool{}
	for i := range after.Targets {
		row := &after.Targets[i]
		afterIDs[row.ID] = true
		was := prior[row.ID]
		change := ChangeOf(was, row)
		counts[change]++
		held[row.Holds]++
		lines = append(lines, line{fmt.Sprintf("| %s | %s | %s | %s | %s → %s | %s |", esc(row.Text), runs[row.ID], readingsCell(was), readingsCell(row), holdsCell(was), holdsCell(row), change), change})
	}
	if before != nil {
		for i := range before.Targets {
			row := &before.Targets[i]
			if !afterIDs[row.ID] {
				counts[ChangeRemoved]++
				lines = append(lines, line{fmt.Sprintf("| %s | %s | %s | %s | %s → %s | %s |", esc(row.Text), runs[row.ID], readingsCell(row), HoldsNone, holdsCell(row), HoldsNone, ChangeRemoved), ChangeRemoved})
			}
		}
	}
	p("")
	p("%d targets after: %d hold, %d miss, %d not measured.", len(after.Targets), held[HoldsYes], held[HoldsNo], held[HoldsNone])
	var parts []string
	for _, c := range []string{ChangeNowMisses, ChangeNowHolds, ChangeMoved, ChangeSame, ChangeNew, ChangeUnmeasured, ChangeRemoved} {
		if counts[c] > 0 {
			parts = append(parts, fmt.Sprintf("%d %s", counts[c], c))
		}
	}
	p("Changes: %s.", strings.Join(parts, ", "))
	p("")
	p("| Target | Runs | Before (%s) | After | Holds before → after | Change |", cell)
	p("| --- | --- | --- | --- | --- | --- |")
	for _, l := range lines {
		p("%s", l.row)
	}
}

// SheetChanges writes the cell diff from one book to the next.
func SheetChanges(w io.Writer, from, to *sheets.Book) {
	changes := sheetdiff.Diff(from, to)
	seen, unseen := sheetdiff.Notes(from, to)
	fmt.Fprintf(w, "\n## Sheet changes\n\n%d changes: %d a player is told of in the epoch notes, %d counted unseen.\n", len(changes), len(seen), unseen)
	if len(changes) == 0 {
		return
	}
	fmt.Fprintln(w)
	fmt.Fprintln(w, "| Sheet | Row | Column | Change | Before | After | Unit | Seen |")
	fmt.Fprintln(w, "| --- | --- | --- | --- | --- | --- | --- | --- |")
	for _, c := range changes {
		row := c.Row
		if c.Name != "" {
			row += " (" + c.Name + ")"
		}
		fmt.Fprintf(w, "| %s | %s | %s | %s | %s | %s | %s | %s |\n", c.Sheet, esc(row), orDash(c.Column), c.Kind, esc(orDash(c.Before)), esc(orDash(c.After)), orDash(c.Unit), either(c.Seen, "yes", "no"))
	}
}

func epochOf(e *Epoch) string {
	if e.Seq == 0 {
		return "these readings"
	}
	return fmt.Sprintf("epoch %04d", e.Seq)
}

func noteOf(e *Epoch) string {
	if e.Note == "" {
		return ""
	}
	return ": " + e.Note
}

func shortID(s string) string {
	// structural: a digest or commit is named by its first 12 hex digits.
	const n = 12
	if s == "" {
		return HoldsNone
	}
	return s[:min(n, len(s))]
}

func labelsOf(e *Epoch, keep func(RunLabel) bool) string {
	if e == nil {
		return HoldsNone
	}
	var out []string
	for _, l := range e.Labels {
		if keep(l) {
			out = append(out, l.Label)
		}
	}
	if len(out) == 0 {
		return HoldsNone
	}
	return strings.Join(out, ", ")
}

func readingsCell(r *EpochRow) string {
	if r == nil || len(r.Readings) == 0 {
		return HoldsNone
	}
	parts := make([]string, 0, len(r.Readings))
	for _, l := range r.Readings {
		s := l.Label
		if l.Alone && !strings.HasSuffix(l.Label, "alone") {
			s += " (alone)"
		}
		s += ": " + l.Value
		if len(r.Readings) > 1 && l.Measured {
			s += " (" + holds(l.Holds) + ")"
		}
		parts = append(parts, esc(s))
	}
	return strings.Join(parts, "; ")
}

func holdsCell(r *EpochRow) string {
	switch {
	case r == nil:
		return HoldsNone
	case r.Holds == HoldsNo:
		return holds(false)
	default:
		return r.Holds
	}
}

func orDash(s string) string { return either(s == "", HoldsNone, s) }

func esc(s string) string {
	return strings.NewReplacer("|", `\|`, "\n", " ").Replace(s)
}
