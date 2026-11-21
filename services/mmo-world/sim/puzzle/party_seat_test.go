package puzzle_test

import (
	"reflect"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/puzzle"
)

// A party version that deals a seat less than the whole machine says so
// in its row, and a row that says so hides something.
func TestDealsMatchRows(t *testing.T) {
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	p := puzzle.New(b, keys.Throwaway("puzzle-test").Generation)
	for _, row := range b.PartyVersions {
		if puzzle.PartyFamily(row.ID) == "" {
			continue
		}
		hid := false
		for _, seats := range []int64{2, 3} {
			for level := int64(1); level <= 6; level++ {
				s := partySpec(row.ID, level, seats, 0)
				whole := p.Make(s)
				for _, part := range p.Deal(s) {
					if !reflect.DeepEqual(part, whole) {
						hid = true
					}
				}
			}
		}
		if split := row.Deals == "split"; hid != split {
			t.Errorf("%s: deals %q but hides something is %v", row.ID, row.Deals, hid)
		}
	}
}
