package world

import (
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
)

// Freeze stores the seed's content on every discovered tile and on extra,
// and moves the world to drawing; it returns how many tiles it froze.
// Those tiles read exactly as before (GDD 4.17).
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
		c := contentOf(s.g.Native(h))
		c.Drawn, c.Native = s.Tick, true
		s.setContent(h, &c)
	}
	s.ContentVersion = ContentDrawn
	if log != nil {
		if _, err := log.Append(f); err != nil {
			return 0, err
		}
	}
	return len(froze), nil
}
