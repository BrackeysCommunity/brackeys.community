package game

import (
	"slices"

	"jams.team/mmo-world/sim/sheets"
)

// Found materials (GDD 4.17, 9.3): materials a world made in play, kept in
// Emergence and read beside the sheet's by item lookup, salvage, prices,
// wants and material tags. The sheet's own rows never change.

// foundMaterial registers a material the world made, once; false if it was
// already known or emergence is off.
func (g *Game) foundMaterial(m sheets.Material) bool {
	if g.Emergence == nil || g.knownMaterial(m.ID) {
		return false
	}
	m.Tags = slices.Clone(m.Tags)
	g.Emergence.Materials = append(g.Emergence.Materials, m)
	g.registerFound(m)
	return true
}

// registerFound puts a found material where the item, price and tag rules
// read it.
func (g *Game) registerFound(m sheets.Material) {
	if g.foundReg != nil {
		g.foundReg.Add(m)
	}
}

// knownMaterial reports whether a material is the sheet's or found.
func (g *Game) knownMaterial(id string) bool {
	_, ok := g.material(id)
	return ok
}

// material is a material by id: the sheet's, else one the world found.
func (g *Game) material(id string) (sheets.Material, bool) {
	if m, ok := g.r.materials[id]; ok {
		return *m, true
	}
	return g.foundReg.Get(id)
}
