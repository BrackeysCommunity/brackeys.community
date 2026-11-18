package harness

import (
	"jams.team/mmo-world/sim/craft"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/sheets"
)

// Play is every item and fight system wired to one book and key set.
type Play struct {
	Book    *sheets.Book
	Keys    keys.Set
	Deriver *item.Deriver
	Growth  *item.Growth
	Mounts  *item.Mounts
	Crafter *craft.Crafter
	Puzzles *puzzle.Puzzles
	Fight   *fight.Rules
}

// NewPlay wires the systems.
func NewPlay(b *sheets.Book, k keys.Set) (*Play, error) {
	d := item.NewDeriver(b, k.Quirk)
	g := item.NewGrowth(b, d, k.Roll)
	p := puzzle.New(b, k.Generation)
	f, err := fight.New(b, d, g, p, k)
	if err != nil {
		return nil, err
	}
	return &Play{Book: b, Keys: k, Deriver: d, Growth: g, Mounts: item.NewMounts(b, g), Crafter: craft.New(b, d, g, k.Roll), Puzzles: p, Fight: f}, nil
}
