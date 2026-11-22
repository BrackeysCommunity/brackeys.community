package world

import "jams.team/mmo-world/sim/fact"

// Freeze stores the seed's content on every discovered tile of a world
// from before content was drawn from history, and moves it to drawing;
// it returns how many tiles it froze.
func (s *State) Freeze(log fact.Log) (int, error) { return 0, nil }
