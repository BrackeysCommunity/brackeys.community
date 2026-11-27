package sheetdiff

import (
	"reflect"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/sheets"
)

func load(t *testing.T) *sheets.Book {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestEverySheetClassified(t *testing.T) {
	for _, d := range sheets.Defs() {
		if _, ok := Visible(d.Name); !ok {
			t.Errorf("%s is neither visible nor hidden", d.Name)
		}
		if matches(visibleSheets, d.Name) && matches(hiddenSheets, d.Name) {
			t.Errorf("%s is both visible and hidden", d.Name)
		}
	}
	for _, list := range [][]string{visibleSheets, hiddenSheets} {
		for _, s := range list {
			if _, ok := sheets.DefByName(s); !ok && !areaHasSheet(s) {
				t.Errorf("%s names no sheet", s)
			}
		}
	}
}

func areaHasSheet(entry string) bool {
	for _, d := range sheets.Defs() {
		if entry == d.Area+".*" {
			return true
		}
	}
	return false
}

func TestSameBookNoChange(t *testing.T) {
	if got := Diff(load(t), load(t)); len(got) != 0 {
		t.Fatalf("one book against itself: %+v", got)
	}
}

func TestDiff(t *testing.T) {
	from, to := load(t), load(t)

	mat := &to.Materials[0]
	mat.Vector.Edge++
	econ := &to.EconomyParams[0]
	econ.Value++
	added := to.Durability[len(to.Durability)-1]
	added.ID = "added-for-the-test"
	to.Durability = append(to.Durability, added)
	removed := to.Starts[len(to.Starts)-1]
	to.Starts = to.Starts[:len(to.Starts)-1]
	to.MapParams[0].Value++
	to.WorldParams[0].Value++
	hidden := &to.Classes[0]
	hidden.Hidden = true
	hidden.Leans += " and more"

	got := Diff(from, to)
	find := func(sheet, row, column string) *Change {
		for i := range got {
			if c := &got[i]; c.Sheet == sheet && c.Row == row && c.Column == column {
				return c
			}
		}
		t.Fatalf("no change at %s %s %s in %+v", sheet, row, column, got)
		return nil
	}

	c := find("items.materials", mat.ID, "vector.edge")
	if c.Kind != Changed || c.Unit != "pts" || !c.Seen || c.After == c.Before {
		t.Errorf("material edge: %+v", c)
	}
	if c.Name == "" || c.Name == mat.ID {
		t.Errorf("material edge has no name from pack.names: %+v", c)
	}
	c = find("economy.params", econ.ID, "value")
	if c.Unit != econ.Unit || !c.Seen {
		t.Errorf("a params cell takes its row's unit %q: %+v", econ.Unit, c)
	}
	c = find("wear.durability", added.ID, "")
	if c.Kind != Added || c.After == "" || !c.Seen {
		t.Errorf("added row: %+v", c)
	}
	c = find("items.starts", removed.ID, "")
	if c.Kind != Removed || c.Before == "" || !c.Seen {
		t.Errorf("removed row: %+v", c)
	}
	if c := find("map.params", to.MapParams[0].ID, "value"); c.Seen {
		t.Errorf("a map cell is shown: %+v", c)
	}
	for _, col := range []string{"leans", "hidden"} {
		if c := find("classes.classes", hidden.ID, col); c.Seen {
			t.Errorf("a hidden class's change is shown: %+v", c)
		}
	}
	seen, unseen := Notes(from, to)
	if len(seen)+int(unseen) != len(Diff(from, to)) {
		t.Fatalf("notes %d seen + %d unseen, diff %d", len(seen), unseen, len(Diff(from, to)))
	}
	if len(seen) != 4 {
		t.Errorf("seen %d, want the material, the param, the added and the removed row: %+v", len(seen), seen)
	}
	if unseen < 4 {
		t.Errorf("unseen %d, want the map and world cells and the hidden class's two", unseen)
	}
	splitSeen, splitUnseen := Split(Diff(from, to))
	if !reflect.DeepEqual(splitSeen, seen) || splitUnseen != unseen {
		t.Errorf("split %d seen + %d unseen, notes %d + %d", len(splitSeen), splitUnseen, len(seen), unseen)
	}
}

func TestHiddenClassAbility(t *testing.T) {
	from, to := load(t), load(t)
	to.Abilities[0].Text += " (changed)"
	class := to.Abilities[0].Class
	for i := range from.Classes {
		if from.Classes[i].ID == class {
			from.Classes[i].Hidden = true
			to.Classes[i].Hidden = true
		}
	}
	seen, unseen := Notes(from, to)
	if len(seen) != 0 || unseen != 1 {
		t.Fatalf("an ability of a hidden class: seen %+v, unseen %d", seen, unseen)
	}
}
