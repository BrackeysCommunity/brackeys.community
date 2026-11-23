package game

import (
	"slices"

	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/sheets"
)

// Found classes (GDD 5.8): a hidden class is earned as any class is, but
// stays off the classes everyone sees until someone crosses it. The first
// is recorded, as with a first discovery, and the class is then shown.

// classFound records the first crossing of a hidden class while the world
// keeps emergence: a class promotion naming the crosser, the cause its
// unlock.
func (g *Game) classFound(c *Char, row *sheets.Class, unlocked fact.ID) error {
	if !row.Hidden || g.Emergence == nil || slices.Contains(g.FoundClasses, row.ID) {
		return nil
	}
	g.FoundClasses = append(g.FoundClasses, row.ID)
	_, err := g.promoteTrace(Promoting{Type: emerge.Class, Region: g.World.RegionAt(c.C.At), Of: row.ID, First: c.C.ID, Cause: unlocked})
	return err
}

// ClassShown reports whether a class is shown to everyone: any class the
// sheets do not hide, and a hidden one once found.
func (g *Game) ClassShown(id string) bool {
	row := g.classRow(id)
	return row != nil && (!row.Hidden || slices.Contains(g.FoundClasses, id))
}
