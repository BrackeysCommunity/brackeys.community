package world

import (
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
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
// or on a tile that holds content already. Its digest reads no arrival of
// the same tick (see arrivals), so arrivals in one tick store the same
// content whichever comes first.
func (s *State) Reach(log fact.Log, h hex.Hex, t int64) error {
	if !s.Drawn() || s.Content(h) != nil {
		return nil
	}
	site := s.g.Baseline(h).Site
	p := s.ReserveAt(h)
	if p != nil && p.Fix.Site != "" {
		site = p.Fix.Site
	}
	d := s.DigestAt(h, t)
	key := d.Key()
	// A terrain pin's ground lands with the tile's first reach, and the
	// lead is drawn for the ground it lands.
	gp := s.groundPinAt(h, t)
	var dr gen.Drawn
	if gp != nil {
		dr = s.g.ContentOn(h, s.g.GroundTile(h, groundOf(gp.Fix.Ground)), site, d, key)
	} else {
		dr = s.g.Content(h, site, d, key)
	}
	c := contentOf(dr)
	c.Drawn, c.Key, c.Digest = t, key, &d
	if gp != nil && gp != p {
		s.landRing(&c, gp)
	}
	if p != nil {
		if err := s.applyFix(&c, h, p, t, log); err != nil {
			return err
		}
	}
	s.setContent(h, &c)
	return nil
}

// contentOf is drawn content as a tile keeps it.
func contentOf(d gen.Drawn) tile.Content {
	return tile.Content{SiteKind: d.SiteKind, Lead: d.Lead, Stock: d.Stock, Dungeon: storedPlan(d.Dungeon)}
}

// Content is a tile's stored content, or nil while nobody has reached it.
func (s *State) Content(h hex.Hex) *tile.Content {
	if t := s.Tile(h); t != nil {
		return t.Content
	}
	return nil
}

// setContent stores a tile's content and lists the tile as edited.
func (s *State) setContent(h hex.Hex, c *tile.Content) {
	s.touch(h).Content = c
	s.noteGround(h, c)
	s.MarkEdited(h)
}

// MarkEdited lists h among the tiles a command's save writes,
// for content changed in place.
func (s *State) MarkEdited(h hex.Hex) {
	if s.edited == nil {
		s.edited = map[hex.Hex]bool{}
	}
	s.edited[h] = true
}

// storedPlan is a drawn dungeon plan as a tile keeps it, before any floor
// is reached.
func storedPlan(p *gen.Plan) *tile.Plan {
	if p == nil {
		return nil
	}
	return &tile.Plan{Kind: p.Kind, Floors: p.Floors, Guardian: p.Guardian, Up: p.Up, SeedTier: p.SeedTier}
}
