// Package sheetdiff lists what changed between two books, cell by cell,
// and which of those changes a player may be told about (GDD 18.5). The
// harness's Report and the world's epoch notes both read books through it.
package sheetdiff

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/sheets"
)

// Change is one changed cell, or one added or removed row.
type Change struct {
	Sheet  string // a sheets.Defs() name
	Row    string // the row's id, or "#n" for a sheet without ids
	Name   string // the row's name in words where pack.names or the row names it
	Column string // the json name; empty when the row was added or removed
	Kind   string // "changed", "added", "removed"
	Before string
	After  string
	Unit   string // the column's unit tag
	Seen   bool   // the sheet (and row) is visible
}

// The kinds of change.
const (
	Changed = "changed"
	Added   = "added"
	Removed = "removed"
)

// Diff lists every change from one book to the next: in Defs order, then
// row order (rows of to, then the rows only from had), then column order.
func Diff(from, to *sheets.Book) []Change {
	var out []Change
	fromNames, toNames := names(from), names(to)
	fromHidden, toHidden := hiddenClasses(from), hiddenClasses(to)
	for _, d := range sheets.Defs() {
		visible, _ := Visible(d.Name)
		a, b := rowsOf(from, d), rowsOf(to, d)
		ka, kb := keyed(a), keyed(b)
		for i := range b.Len() {
			row := b.Index(i)
			key := rowKey(row, i)
			seen := visible && !hiddenRow(d.Name, row, toHidden)
			name := nameOf(d.Name, key, row, toNames)
			j, ok := ka[key]
			if !ok {
				out = append(out, Change{Sheet: d.Name, Row: key, Name: name, Kind: Added, After: rowJSON(row), Seen: seen})
				continue
			}
			old := a.Index(j)
			if !visible || hiddenRow(d.Name, old, fromHidden) {
				seen = false
			}
			before := map[string]cell{}
			for _, c := range cells(old) {
				before[c.column] = c
			}
			for _, cell := range cells(row) {
				if was := before[cell.column]; was.value != cell.value {
					unit := cell.unit
					if unit == "" {
						unit = was.unit
					}
					out = append(out, Change{Sheet: d.Name, Row: key, Name: name, Column: cell.column, Kind: Changed, Before: was.value, After: cell.value, Unit: unit, Seen: seen})
				}
			}
		}
		for j := range a.Len() {
			row := a.Index(j)
			key := rowKey(row, j)
			if _, ok := kb[key]; ok {
				continue
			}
			seen := visible && !hiddenRow(d.Name, row, fromHidden)
			out = append(out, Change{Sheet: d.Name, Row: key, Name: nameOf(d.Name, key, row, fromNames), Kind: Removed, Before: rowJSON(row), Seen: seen})
		}
	}
	return out
}

// Notes splits a diff into what a player may read and a count of the rest.
func Notes(from, to *sheets.Book) (seen []Change, unseen int64) {
	return Split(Diff(from, to))
}

// Split parts changes into the ones a player may read and a count of the rest.
func Split(changes []Change) (seen []Change, unseen int64) {
	for _, c := range changes {
		if c.Seen {
			seen = append(seen, c)
		} else {
			unseen++
		}
	}
	return seen, unseen
}

// visibleSheets are the sheets whose rows cards already show; an entry
// ending in ".*" covers its whole area.
var visibleSheets = []string{
	"items.materials", "items.tiers", "items.processes", "items.methods", "items.slots",
	"items.traits", "items.pairings", "items.starts",
	"growth.xp-by-deed", "growth.exploit-offers",
	"fights.odds-bands", "fights.options", "fights.states", "fights.hunts",
	"wear.*",
	"economy.params", "economy.standing", "economy.route-risk",
	"goals.params",
	"mounts.*",
	"settlements.structures", "settlements.guild-works", "settlements.params",
	"classes.classes", "classes.abilities", "classes.params",
	"puzzles.families", "puzzles.practice", "puzzles.params", "puzzles.titles",
	"liveops.*",
	"alignment.bands", "alignment.acts",
	"theft.kinds",
}

// hiddenSheets are the sheets a player is told only the count of changes
// to: generation rows are spoilers, derivation rows are no card's.
var hiddenSheets = []string{
	"meta.*", "map.*", "tiles.*", "world.*", "creatures.*", "npcs.*", "factions.*",
	"story.*", "emergence.*", "tags.*", "pack.*",
	"items.axes", "items.axis-tags", "items.resonance", "items.compose", "items.params",
	"growth.level-curve", "growth.params",
	"fights.margins", "fights.tiers", "fights.beats", "fights.beat-tags", "fights.trait-effects", "fights.params",
	"economy.reference",
	"goals.words",
	"settlements.starting",
	"alignment.params",
	"theft.params",
	"puzzles.haywire", "puzzles.layouts", "puzzles.tuning", "puzzles.party", "puzzles.shapes",
}

// Visible says whether a sheet's changes are shown, and whether the sheet
// is classified at all; an unclassified sheet is not shown.
func Visible(sheet string) (visible, classified bool) {
	if matches(visibleSheets, sheet) {
		return true, true
	}
	return false, matches(hiddenSheets, sheet)
}

func matches(list []string, sheet string) bool {
	area, _, _ := strings.Cut(sheet, ".")
	for _, s := range list {
		if s == sheet || s == area+".*" {
			return true
		}
	}
	return false
}

func rowsOf(b *sheets.Book, d sheets.Def) reflect.Value {
	if b == nil {
		return reflect.MakeSlice(reflect.SliceOf(d.Row), 0, 0)
	}
	return b.Rows(d)
}

func rowKey(row reflect.Value, i int) string {
	if id := row.FieldByName("ID"); id.IsValid() && id.Kind() == reflect.String && id.String() != "" {
		return id.String()
	}
	return "#" + strconv.Itoa(i+1)
}

func keyed(rows reflect.Value) map[string]int {
	out := make(map[string]int, rows.Len())
	for i := range rows.Len() {
		out[rowKey(rows.Index(i), i)] = i
	}
	return out
}

// names maps "sheet:id" to what pack.names calls it.
func names(b *sheets.Book) map[string]string {
	out := map[string]string{}
	if b == nil {
		return out
	}
	for _, n := range b.Names {
		out[n.Ref] = n.Name
	}
	return out
}

func nameOf(sheet, key string, row reflect.Value, named map[string]string) string {
	if n, ok := named[sheet+":"+key]; ok {
		return n
	}
	if f := row.FieldByName("Name"); f.IsValid() && f.Kind() == reflect.String {
		return f.String()
	}
	return ""
}

// hiddenClasses are the classes found only after launch.
func hiddenClasses(b *sheets.Book) map[string]bool {
	out := map[string]bool{}
	if b == nil {
		return out
	}
	for _, c := range b.Classes {
		if c.Hidden {
			out[c.ID] = true
		}
	}
	return out
}

// hiddenRow is a row with its hidden flag set, or an ability of a hidden
// class: neither is on any card until someone crosses it (GDD 5.8).
func hiddenRow(sheet string, row reflect.Value, hidden map[string]bool) bool {
	if f := row.FieldByName("Hidden"); f.IsValid() && f.Kind() == reflect.Bool && f.Bool() {
		return true
	}
	if sheet == "classes.abilities" {
		if f := row.FieldByName("Class"); f.IsValid() && hidden[f.String()] {
			return true
		}
	}
	return false
}

type cell struct {
	column, value, unit string
}

// cells flattens a row into its columns in field order; a nested struct's
// columns are "parent.child".
func cells(row reflect.Value) []cell {
	var out []cell
	rowUnit := ""
	if u := row.FieldByName("Unit"); u.IsValid() && u.Kind() == reflect.String {
		rowUnit = u.String()
	}
	var walk func(v reflect.Value, prefix string)
	walk = func(v reflect.Value, prefix string) {
		t := v.Type()
		for i := range t.NumField() {
			f := t.Field(i)
			fv := v.Field(i)
			col := prefix + sheets.JSONName(f)
			if _, stringer := fv.Interface().(fmt.Stringer); fv.Kind() == reflect.Struct && !stringer {
				walk(fv, col+".")
				continue
			}
			unit := f.Tag.Get("unit")
			if unit == "row" {
				unit = rowUnit
			}
			out = append(out, cell{column: col, value: cellString(fv), unit: unit})
		}
	}
	walk(row, "")
	return out
}

func cellString(v reflect.Value) string {
	if s, ok := v.Interface().(fmt.Stringer); ok {
		return s.String()
	}
	switch v.Kind() {
	case reflect.String:
		return v.String()
	case reflect.Bool:
		if v.Bool() {
			return "yes"
		}
		return "no"
	case reflect.Int, reflect.Int64, reflect.Int32:
		return strconv.FormatInt(v.Int(), 10)
	case reflect.Slice:
		if v.Type().Elem().Kind() != reflect.Struct {
			parts := make([]string, v.Len())
			for i := range parts {
				parts[i] = cellString(v.Index(i))
			}
			return strings.Join(parts, ", ")
		}
	}
	j, err := json.Marshal(v.Interface())
	if err != nil {
		return fmt.Sprint(v.Interface())
	}
	return string(j)
}

func rowJSON(row reflect.Value) string {
	j, err := json.Marshal(row.Interface())
	if err != nil {
		return fmt.Sprint(row.Interface())
	}
	return string(j)
}
