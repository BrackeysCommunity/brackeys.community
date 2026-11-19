package fight

import (
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/sheets"
)

// Systems are the item and fight systems wired to one book and key set.
type Systems struct {
	Deriver *item.Deriver
	Growth  *item.Growth
	Mounts  *item.Mounts
	Puzzles *puzzle.Puzzles
	Fight   *Rules
}

// Wire builds the systems, each under the key it draws from.
func Wire(b *sheets.Book, k keys.Set) (Systems, error) {
	d := item.NewDeriver(b, k.Quirk)
	g := item.NewGrowth(b, d, k.Roll)
	p := puzzle.New(b, k.Generation)
	f, err := New(b, d, g, p, k)
	if err != nil {
		return Systems{}, err
	}
	return Systems{Deriver: d, Growth: g, Mounts: item.NewMounts(b, g), Puzzles: p, Fight: f}, nil
}
