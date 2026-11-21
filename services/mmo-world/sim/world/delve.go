package world

import (
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/tile"
)

// DungeonAt is the record of the dungeon whose entrance is h, made if it
// has none, for what a command changes there at once: a name given, the
// guardian's pool pressed. Replays run the same commands in order, so the
// change is replayed with them.
func (s *State) DungeonAt(h hex.Hex) *tile.Dungeon {
	t := s.touch(h)
	if t.Dungeon == nil {
		t.Dungeon = &tile.Dungeon{}
	}
	return t.Dungeon
}
