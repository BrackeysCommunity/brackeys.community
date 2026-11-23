package item

import (
	"slices"
	"strings"

	"jams.team/mmo-world/sim/sheets"
)

// Found holds the materials a world made in play (GDD 4.17), beside the
// sheet's. It is rebuilt from game state, never saved itself, and a nil
// Found holds nothing.
type Found struct {
	rows []sheets.Material // sorted by id
}

func (f *Found) find(id string) (int, bool) {
	return slices.BinarySearchFunc(f.rows, id, func(m sheets.Material, id string) int { return strings.Compare(m.ID, id) })
}

// Add registers a material; one already held is left as it was.
func (f *Found) Add(m sheets.Material) bool {
	i, ok := f.find(m.ID)
	if ok {
		return false
	}
	m.Tags = slices.Clone(m.Tags)
	f.rows = slices.Insert(f.rows, i, m)
	return true
}

// Get is a found material's row.
func (f *Found) Get(id string) (sheets.Material, bool) {
	if f == nil {
		return sheets.Material{}, false
	}
	i, ok := f.find(id)
	if !ok {
		return sheets.Material{}, false
	}
	return f.rows[i], true
}

// List is every found material, by id.
func (f *Found) List() []sheets.Material {
	if f == nil {
		return nil
	}
	return slices.Clone(f.rows)
}
