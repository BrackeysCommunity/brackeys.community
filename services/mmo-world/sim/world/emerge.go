package world

import (
	"fmt"

	"jams.team/mmo-world/sim/fact"
)

// structural: a tile's road levels are track, road and paved (tile.State.Road).
const (
	RoadTrack = 1
	RoadPaved = 3
)

func checkRoad(_ *State, a Action) error {
	if a.Units < RoadTrack || a.Units > RoadPaved {
		return fmt.Errorf("world: road of level %d", a.Units)
	}
	return nil
}

// applyRoad raises a tile's road to the action's level. A road is stored
// state, never generation (GDD 13.2), and a tile holding one is never
// pruned.
func applyRoad(s *State, _ fact.Log, a Action) error {
	if t := s.Tile(a.Hex); t != nil && t.Road >= a.Units {
		return nil
	}
	s.touch(a.Hex).Road = a.Units
	return nil
}
