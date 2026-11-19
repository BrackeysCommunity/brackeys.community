package harness

import (
	"jams.team/mmo-world/sim/craft"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/sheets"
)

// Play is fight.Systems plus a crafter, under one book and key set.
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
	s, err := fight.Wire(b, k)
	if err != nil {
		return nil, err
	}
	return &Play{Book: b, Keys: k, Deriver: s.Deriver, Growth: s.Growth, Mounts: s.Mounts, Crafter: craft.New(b, s.Deriver, s.Growth, k.Roll),
		Puzzles: s.Puzzles, Fight: s.Fight}, nil
}
