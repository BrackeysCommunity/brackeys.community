package world

import (
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/tile"
)

// structural: the content versions.
const (
	ContentNative = 0
	ContentDrawn  = 1
)

// Reach draws and stores a tile's content at its first reach, in tick t.
// It does nothing on a world from before content was drawn from history,
// or on a tile that holds content already.
func (s *State) Reach(log fact.Log, h hex.Hex, t int64) error { return nil }

// Content is a tile's stored content, or nil while nobody has reached it.
func (s *State) Content(h hex.Hex) *tile.Content {
	if t := s.Tile(h); t != nil {
		return t.Content
	}
	return nil
}

// setContent stores a tile's content and lists the tile as edited.
func (s *State) setContent(h hex.Hex, c *tile.Content) { //nolint:unused // called once discovery draws content
	s.touch(h).Content = c
	if s.edited == nil {
		s.edited = map[hex.Hex]bool{}
	}
	s.edited[h] = true
}
