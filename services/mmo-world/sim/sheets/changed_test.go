package sheets_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/sheets"
)

func TestChanged(t *testing.T) {
	a := live(t)
	if got := sheets.Changed(a, a); len(got) != 0 {
		t.Fatalf("a book against itself changed %v", got)
	}
	b := *a
	b.StockBands = slices.Clone(a.StockBands)
	b.StockBands[0].Weight++
	d, ok := sheets.DefByName("map.stock-bands")
	if got := sheets.Changed(a, &b); !ok || !slices.Equal(got, []string{d.Name}) {
		t.Fatalf("one edited row changed %v", got)
	}
}
