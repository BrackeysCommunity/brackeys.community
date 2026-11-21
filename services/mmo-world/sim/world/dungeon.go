package world

import (
	"fmt"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/tile"
)

// Dungeon floors, recorded one by one (GDD 4.9).
const (
	ActFloorCleared = "floor-cleared" // Floor of the dungeon on Hex cleared, left by Way (+1; 0 none)
	ActFloorFell    = "floor-fell"    // By went down on Floor of the dungeon on Hex
)

// structural: a fork's ways are 0 to 2, recorded +1.
const waysRecorded = 3

func init() {
	actions[ActFloorCleared] = struct {
		check func(*State, Action) error
		apply func(*State, fact.Log, Action) error
	}{checkFloor, floorCleared}
	actions[ActFloorFell] = struct {
		check func(*State, Action) error
		apply func(*State, fact.Log, Action) error
	}{func(s *State, a Action) error {
		if err := needsBy(s, a); err != nil {
			return err
		}
		return checkFloor(s, a)
	}, floorFell}
}

func checkFloor(_ *State, a Action) error {
	if a.Floor < 1 || a.Way < 0 || a.Way > waysRecorded {
		return fmt.Errorf("world: %s of floor %d by way %d", a.Kind, a.Floor, a.Way)
	}
	return nil
}

func (s *State) dungeon(a Action) *tile.Dungeon {
	t := s.touch(a.Hex)
	if t.Dungeon == nil {
		t.Dungeon = &tile.Dungeon{}
	}
	return t.Dungeon
}

func floorCleared(s *State, _ fact.Log, a Action) error {
	s.dungeon(a).Clear(a.Floor, a.Way, s.Tick)
	return nil
}

// floorFell keeps the falls haunting reads, and counts the loss on the
// tile as any fall does.
func floorFell(s *State, _ fact.Log, a Action) error {
	s.dungeon(a).Fall(a.Floor, a.By.ID, s.Tick, s.tp.HauntedDays*ticksPerDay)
	s.touch(a.Hex).BattlesLost++
	return nil
}
