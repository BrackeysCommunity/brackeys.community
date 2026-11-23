package game

import (
	"slices"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

// Camps and haunts (GDD 13.2): a site cleared often enough gains a tier-1
// station, and one where many fell is haunted and led by a scavenger. Both
// are records laid over the site; its stored content stays frozen.

func init() {
	registerEmerge(emergeHook{
		Name: "sites",
		Promote: map[emerge.Type]func(*Game, *emerge.Promotion) error{
			emerge.Camp:  campPromoted,
			emerge.Haunt: hauntPromoted,
		},
	})
}

// structural: the station a camp on a site kind with no emergence.camps
// row gains (GDD 13.2).
const campFallback = "bench"

// campPromoted gives the cleared site its station by the site's kind.
func campPromoted(g *Game, p *emerge.Promotion) error {
	if p.At == nil {
		return nil
	}
	station := campFallback
	if row, ok := sheets.Lookup(g.r.Book.Camps)[p.Of]; ok && p.Of != "" {
		station = row.Station
	}
	g.Emergence.Camps[*p.At] = &emerge.CampRec{ID: p.ID, Station: station}
	return nil
}

// hauntPromoted haunts the site and picks the scavenger that leads there
// now, from those already living there when there are any.
func hauntPromoted(g *Game, p *emerge.Promotion) error {
	if p.At == nil {
		return nil
	}
	h := *p.At
	g.Emergence.Haunts[h] = &emerge.HauntRec{ID: p.ID, Lead: g.scavenger(h)}
	return nil
}

// scavenger is the archetype a haunt on h is led by: one carrying the haunt
// line's tag, drawn under emergence.haunt; "" when no archetype carries it.
func (g *Game) scavenger(h hex.Hex) string {
	tag := g.r.Emerge.Lines.Line(emerge.Haunt).Tag
	carries := func(c *sheets.Creature) bool { return c != nil && slices.Contains(c.Tags, tag) }
	rows := sheets.Lookup(g.r.Book.Creatures)
	var pool []string
	for _, a := range g.livesOn(h) {
		if carries(rows[a]) {
			pool = append(pool, a)
		}
	}
	if len(pool) == 0 {
		for _, c := range g.r.Book.Creatures {
			if len(c.Biomes) > 0 && carries(&c) {
				pool = append(pool, c.ID)
			}
		}
		slices.Sort(pool)
	}
	if len(pool) == 0 {
		return ""
	}
	return pool[g.r.draw.Below(uint64(len(pool)), emerge.DrawHaunt, draw.Int(h.Q), draw.Int(h.R))]
}

// campAt is the camp on a tile.
func (g *Game) campAt(h hex.Hex) (*emerge.CampRec, bool) {
	if g.Emergence == nil {
		return nil, false
	}
	c := g.Emergence.Camps[h]
	return c, c != nil
}

// hauntAt is the haunt on a tile.
func (g *Game) hauntAt(h hex.Hex) (*emerge.HauntRec, bool) {
	if g.Emergence == nil {
		return nil, false
	}
	x := g.Emergence.Haunts[h]
	return x, x != nil
}

// campStations is the station a camp holds where no settlement stands: its
// structure at the first tier, which a place chartered there supersedes.
func (g *Game) campStations(h hex.Hex) []Station {
	c, ok := g.campAt(h)
	if !ok {
		return nil
	}
	if row := g.r.structures[c.Station]; row == nil || !row.Station {
		return nil
	}
	return []Station{{Kind: c.Station, Tier: g.r.firstTier()}}
}

// hauntedLead puts a haunt's scavenger first among a tile's archetypes,
// adding it where it did not live before.
func (g *Game) hauntedLead(h hex.Hex, kinds []string) []string {
	x, ok := g.hauntAt(h)
	if !ok || x.Lead == "" {
		return kinds
	}
	out := make([]string, 0, len(kinds)+1)
	out = append(out, x.Lead)
	for _, k := range kinds {
		if k != x.Lead {
			out = append(out, k)
		}
	}
	return out
}

// hauntedPlace adds the haunted place tag to an overland encounter on a
// haunted site, so the rules that read it apply (GDD 4.15).
func (g *Game) hauntedPlace(h hex.Hex, site []tags.Tag) []tags.Tag {
	if _, ok := g.hauntAt(h); !ok || slices.Contains(site, tagHaunted) {
		return site
	}
	return append(slices.Clip(site), tagHaunted)
}
