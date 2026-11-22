package world

import (
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/tile"
)

// Freeze stores the seed's content on every discovered tile of a world
// from before content was drawn from history, and on the extra tiles
// someone stands on or is about to discover, and moves it to drawing; it
// returns how many tiles it froze. What players already saw on those
// tiles stays exactly as it was (GDD 4.17).
func (s *State) Freeze(log fact.Log, extra []hex.Hex) (int, error) {
	if s.Drawn() {
		return 0, &Refusal{Code: CodeAlreadyFrozen, Msg: "this world already draws its content from history"}
	}
	var froze []hex.Hex
	seen := map[hex.Hex]bool{}
	for _, t := range s.Tiles {
		if t.Discovered != nil && t.Content == nil {
			froze = append(froze, t.Hex)
			seen[t.Hex] = true
		}
	}
	for _, h := range extra {
		if seen[h] || s.Content(h) != nil {
			continue
		}
		seen[h] = true
		froze = append(froze, h)
	}
	f, err := s.weights.New(s.Tick, "world.content-frozen", "", nil, nil, fact.N("tiles", int64(len(froze))))
	if err != nil {
		return 0, err
	}
	for _, h := range froze {
		n := s.g.Native(h)
		s.setContent(h, &tile.Content{Drawn: s.Tick, Native: true, Lead: n.Lead, Stock: n.Stock, Dungeon: storedPlan(n.Dungeon)})
	}
	s.ContentVersion = ContentDrawn
	if log != nil {
		if _, err := log.Append(f); err != nil {
			return 0, err
		}
	}
	return len(froze), nil
}
