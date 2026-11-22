package world

import (
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/tile"
)

// Freeze stores the seed's content on every discovered tile of a world
// from before content was drawn from history, and moves it to drawing;
// it returns how many tiles it froze. What players already saw on those
// tiles stays exactly as it was (GDD 4.17).
func (s *State) Freeze(log fact.Log) (int, error) {
	if s.Drawn() {
		return 0, &Refusal{Code: CodeAlreadyFrozen, Msg: "this world already draws its content from history"}
	}
	var froze []*tile.State
	for _, t := range s.Tiles {
		if t.Discovered != nil && t.Content == nil {
			froze = append(froze, t)
		}
	}
	f, err := s.weights.New(s.Tick, "world.content-frozen", "", nil, nil, fact.N("tiles", int64(len(froze))))
	if err != nil {
		return 0, err
	}
	for _, t := range froze {
		n := s.g.Native(t.Hex)
		s.setContent(t.Hex, &tile.Content{Drawn: s.Tick, Native: true, Lead: n.Lead, Stock: n.Stock, Dungeon: storedPlan(n.Dungeon)})
	}
	s.ContentVersion = ContentDrawn
	if log != nil {
		if _, err := log.Append(f); err != nil {
			return 0, err
		}
	}
	return len(froze), nil
}
