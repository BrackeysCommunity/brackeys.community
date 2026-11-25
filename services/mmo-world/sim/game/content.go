package game

import (
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/world"
)

// A tile's content is drawn at its first reach and stored (GDD 4.17).
// Every read here takes the stored content where there is some, and the
// seed's native function on a tile nobody has reached, which knows
// nothing of history or pins.

// Content is a tile's stored content; false while nobody has reached it.
func (g *Game) Content(h hex.Hex) (*tile.Content, bool) {
	c := g.World.Content(h)
	return c, c != nil
}

// Creatures are the archetypes a tile holds, its lead first; a haunt's
// scavenger leads over the stored content.
func (g *Game) Creatures(h hex.Hex) []string { return g.hauntedLead(h, g.livesOn(h)) }

// livesOn are the archetypes a tile's content holds, its lead first.
func (g *Game) livesOn(h hex.Hex) []string {
	b := g.World.Baseline(h)
	lead := g.r.Gen.Region(b.Region).Creature
	if c, ok := g.Content(h); ok && c.Lead != "" {
		lead = c.Lead
	}
	return g.r.Gen.CreaturesOn(b.Terrain, lead)
}

// Plan is the plan of the dungeon whose entrance is h; false where none
// stands.
func (g *Game) Plan(h hex.Hex) (gen.Plan, bool) {
	c, ok := g.Content(h)
	if !ok {
		return g.r.Gen.Dungeon(h)
	}
	if c.Dungeon == nil {
		return gen.Plan{}, false
	}
	return planOf(h, c.Dungeon), true
}

func planOf(h hex.Hex, p *tile.Plan) gen.Plan {
	return gen.Plan{Hex: h, Kind: p.Kind, Floors: p.Floors, Guardian: p.Guardian, Up: p.Up, SeedTier: p.SeedTier}
}

// drawnPlan is a stored plan whose floors are drawn at their first reach,
// with the key it was drawn under. A frozen plan the seed made keeps the
// seed's floors, so it is not one.
func (g *Game) drawnPlan(h hex.Hex) (*tile.Plan, gen.Plan, string, bool) {
	c, ok := g.Content(h)
	if !ok || c.Dungeon == nil {
		return nil, gen.Plan{}, "", false
	}
	p := planOf(h, c.Dungeon)
	if c.Native {
		if n, ok := g.r.Gen.Dungeon(h); ok && n.Kind == p.Kind && n.Floors == p.Floors {
			return nil, gen.Plan{}, "", false
		}
	}
	return c.Dungeon, p, c.Key, true
}

// Floor is floor n of the dungeon at h by way, stepped from its seed tier.
func (g *Game) Floor(h hex.Hex, n, way int64) gen.FloorPlan {
	p, ok := g.Plan(h)
	if !ok {
		return gen.FloorPlan{}
	}
	return g.FloorAt(h, n, way, p.SeedTier)
}

// FloorAt is floor n by way stepped from a live tier, as stored or as the
// seed makes it. A drawn floor nobody has reached yet reads N == 0.
func (g *Game) FloorAt(h hex.Hex, n, way, tier int64) gen.FloorPlan {
	tp, p, _, ok := g.drawnPlan(h)
	if !ok {
		if _, ok := g.Plan(h); !ok {
			return gen.FloorPlan{}
		}
		return g.r.Gen.FloorAt(h, n, way, tier)
	}
	f, ok := tp.Floor(n, way)
	if !ok {
		return gen.FloorPlan{}
	}
	return g.r.Gen.FloorFrom(p, genDraw(*f), wayIn(tp, n, way), waysOf(tp, n), tier)
}

// floorTags are the tags floor n by way carries, known before it is
// drawn: its kind's, the entrance's and the way in's.
func (g *Game) floorTags(h hex.Hex, n, way, tier int64) []tags.Tag {
	tp, p, _, ok := g.drawnPlan(h)
	if !ok || n < firstFloor || n > p.Floors {
		return nil
	}
	return g.r.Gen.FloorFrom(p, gen.FloorDraw{N: n, Way: way}, wayIn(tp, n, way), nil, tier).Tags
}

// reachFloor is FloorAt for whoever stands on the floor: a drawn floor is
// drawn and stored at its first reach, in tick t, with its ways down. Two
// parties reaching it find the same floor, whichever came first.
func (g *Game) reachFloor(h hex.Hex, n, way, tier, t int64) gen.FloorPlan {
	tp, p, key, ok := g.drawnPlan(h)
	if !ok || n < firstFloor || n > p.Floors {
		return g.FloorAt(h, n, way, tier)
	}
	if _, ok := tp.Floor(n, way); !ok {
		at := g.World.DigestAt(h, t).Key()
		for _, m := range []int64{n - 1, n} {
			if _, ok := tp.WaysOf(m); m >= firstFloor && m < p.Floors && !ok {
				tp.SetWays(tile.Ways{N: m, Way: tileWays(g.r.Gen.DrawWays(p, key, at, m))})
			}
		}
		tp.SetFloor(tileDraw(g.r.Gen.DrawFloor(p, key, at, n, way)))
		g.World.MarkEdited(h)
	}
	return g.FloorAt(h, n, way, tier)
}

// ReachFloor is reachFloor at the live tier, in the tick a command's
// reach falls in: for tools that stand characters straight on a floor.
func (g *Game) ReachFloor(h hex.Hex, n, way int64) gen.FloorPlan {
	return g.reachFloor(h, n, way, g.tierAt(h), g.reachTick())
}

// wayIn is the way floor n was reached by, from the ways stored on the
// floor above; nil for the first floor.
func wayIn(p *tile.Plan, n, way int64) *gen.Way {
	if n <= firstFloor || way < gen.WayOpen || way > gen.WayHidden {
		return nil
	}
	ws, ok := p.WaysOf(n - 1)
	if !ok {
		return nil
	}
	w := genWay(ws[way])
	return &w
}

func waysOf(p *tile.Plan, n int64) *[tile.WaysPerFork]gen.Way {
	ws, ok := p.WaysOf(n)
	if !ok {
		return nil
	}
	var out [tile.WaysPerFork]gen.Way
	for i, w := range ws {
		out[i] = genWay(w)
	}
	return &out
}

func genWay(w tile.Way) gen.Way {
	if w.Fork == "" {
		return gen.Way{}
	}
	return gen.Way{Fork: w.Fork, Tags: tags.Of(w.Tags)}
}

func tileWays(ws [tile.WaysPerFork]gen.Way) [tile.WaysPerFork]tile.Way {
	var out [tile.WaysPerFork]tile.Way
	for i, w := range ws {
		if w.Fork != "" {
			out[i] = tile.Way{Fork: w.Fork, Tags: tagStrings(w.Tags)}
		}
	}
	return out
}

func genDraw(f tile.FloorDraw) gen.FloorDraw {
	return gen.FloorDraw{N: f.N, Way: f.Way, Beats: f.Beats, Machine: f.Machine, Family: f.Family, Pick: f.Pick}
}

func tileDraw(f gen.FloorDraw) tile.FloorDraw {
	return tile.FloorDraw{N: f.N, Way: f.Way, Beats: f.Beats, Machine: f.Machine, Family: f.Family, Pick: f.Pick}
}

// SiteKind is what kind of site stands on a reached tile; "" for none or
// a native one.
func (g *Game) SiteKind(h hex.Hex) string {
	if c, ok := g.Content(h); ok {
		return c.SiteKind
	}
	return ""
}

// siteKindTags are the tags a reached tile's site kind brings an
// encounter there.
func (g *Game) siteKindTags(h hex.Hex) []tags.Tag {
	k := g.SiteKind(h)
	if k == "" {
		return nil
	}
	kind, ok := sheets.Lookup(g.r.Book.SiteKinds)[k]
	if !ok {
		return nil
	}
	return tags.Of(kind.Tags)
}

// Placed is who staged a reached tile's content, if a server did (GDD
// 14.5).
func (g *Game) Placed(h hex.Hex) *tile.Placed {
	if c, ok := g.Content(h); ok {
		return c.Placed
	}
	return nil
}

// Stock is the units a tile's node of a material starts with.
func (g *Game) Stock(h hex.Hex, material string) int64 {
	if c, ok := g.Content(h); ok {
		if n, ok := c.Stock[material]; ok {
			return n
		}
	}
	return g.tp("node-stock")
}

// slot is the slot standing on h: a stored pin's over the scaffold's.
func (g *Game) slot(h hex.Hex) string {
	if c, ok := g.Content(h); ok && c.Site != "" {
		return c.Site
	}
	return g.r.Gen.Baseline(h).Site
}

// reachTick is the tick a writer's reach falls in: the one its queued
// actions apply in.
func (g *Game) reachTick() int64 { return g.Tick() + 1 }

// Reach reaches h in the tick a command's reach falls in, so its content
// is drawn and stored before anyone stands on it; the counterpart of
// ReachFloor.
func (g *Game) Reach(h hex.Hex) error { return g.World.Reach(g.Log, h, g.reachTick()) }

// Teleport puts a character on h as an arrival does: the tile is reached
// now and its discovery is queued for the next tick.
func (g *Game) Teleport(c *Char, h hex.Hex) error {
	if err := g.Reach(h); err != nil {
		return err
	}
	c.C.At = h
	// Callers stand on the tile left behind.
	c.Callers = nil
	g.Pending = append(g.Pending, world.Action{Kind: world.ActDiscover, Hex: h, By: char.Ref(c.C.ID)})
	return nil
}
