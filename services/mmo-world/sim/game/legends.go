package game

import (
	"maps"
	"slices"
	"strings"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/season"
	"jams.team/mmo-world/sim/tags"
)

// Legends (GDD 13.2): a standing goal unmet a whole season after enough
// attempts makes a legend of what it hunts, and an item named by enough
// heavy deeds in a season becomes one. Each gets a name, a trait and a
// place the director can cast.

func init() {
	registerEmerge(emergeHook{Name: "legends", Order: legendsOrder, Renown: itemLegend,
		Promote: map[emerge.Type]func(*Game, *emerge.Promotion) error{emerge.Legend: legendMade}, Close: legendsClose})
}

// structural: legends read the goal lines at the close, after they are kept.
const legendsOrder = linesOrder + 1

// lineStood reports whether a line stood all season (GDD 13.2): its goal
// stands until met and is still up, or the world kept it posted on enough
// of the season's days.
func (g *Game) lineStood(l *emerge.Line, c season.Clock) bool {
	if x := g.GoalOf(l.Goal); l.Standing && x != nil && x.Open() {
		return true
	}
	return g.postedShare(l.Days, c.Days)
}

// legendsClose makes a legend of each standing Defeat line nobody met this
// season with the line's attempts, its target's at most once a region
// while that legend lives.
func legendsClose(g *Game, _ int64) error {
	c, ok := g.clock()
	if !ok {
		return nil
	}
	e := g.Emergence
	need := g.r.Emerge.Lines[string(emerge.Legend)].Count
	for _, sig := range slices.Sorted(maps.Keys(e.Lines)) {
		l := e.Lines[sig]
		if l.Met || l.Archetype == "" || l.Attempts.Season != e.Season || int64(len(l.Attempts.IDs)) < need || !g.lineStood(l, c) {
			continue
		}
		of := fact.Ref{Kind: kindCreature, ID: l.Archetype}
		if g.legendOf(of, l.Region) != nil {
			continue
		}
		first := ""
		if x := g.GoalOf(l.Goal); x != nil && g.Char(x.Poster) != nil {
			first = x.Poster
		}
		at := l.At
		if _, err := g.promoteTrace(Promoting{Type: emerge.Legend, Region: l.Region, At: &at, Of: of.String(), First: first}); err != nil {
			return err
		}
	}
	return nil
}

// itemLegend makes a legend of an item once enough heavy facts in a season
// have named it, its holder its first.
func itemLegend(g *Game, s *emerge.Subject, f fact.Fact) error {
	if s.Ref.Kind != renownItem || s.Done != "" || s.HeavyIn(g.Emergence.Season) < g.r.Emerge.Lines[string(emerge.Legend)].Heavy {
		return nil
	}
	p := Promoting{Type: emerge.Legend, Region: s.Region, Of: s.Ref.String(), Cause: f.ID}
	if s.Region >= 0 {
		at := s.At
		p.At = &at
	}
	for _, ref := range f.Subjects {
		if c := g.Char(ref.ID); ref.Kind == renownCharacter && c != nil {
			if in := c.C.Item(s.Ref.ID); in != nil {
				p.First = c.C.ID
				p.Data = []fact.Datum{fact.S(datumOfName, g.KindName(in.Kind))}
				break
			}
		}
	}
	made, err := g.promoteTrace(p)
	if err != nil || made == nil {
		return err
	}
	s.Done = made.ID
	return nil
}

// legendMade gives a new legend its trait, drawn by its id, and its place
// in the cast.
func legendMade(g *Game, p *emerge.Promotion) error {
	kind, id, _ := strings.Cut(p.Of, ":")
	rec := &emerge.LegendRec{ID: p.ID, Trait: g.legendTrait(p.ID), Of: fact.Ref{Kind: kind, ID: id}, Region: p.Region}
	if p.At != nil {
		rec.At = *p.At
	}
	g.Emergence.Legends = append(g.Emergence.Legends, rec)
	if c := g.Char(p.First); kind == renownItem && c != nil {
		if in := c.C.Item(id); in != nil {
			in.Legend = g.traitTag(rec.Trait)
		}
	}
	return nil
}

// traitTag is the tag a legend trait row gives.
func (g *Game) traitTag(trait string) tags.Tag {
	for _, r := range g.r.Book.LegendTraits {
		if r.ID == trait {
			return tags.Tag(r.Tag)
		}
	}
	return ""
}

// legendTrait is the emergence.legend-traits row a legend carries.
func (g *Game) legendTrait(id string) string {
	rows := g.r.Book.LegendTraits
	if len(rows) == 0 {
		return ""
	}
	return rows[g.r.draw.Below(uint64(len(rows)), emerge.DrawLegend, draw.Str(id))].ID
}

// legendOf is the living legend of a thing in a region, if any.
func (g *Game) legendOf(of fact.Ref, region int) *emerge.LegendRec {
	for _, l := range g.Emergence.Legends {
		if l.Of == of && l.Region == region && l.Laid == 0 {
			return l
		}
	}
	return nil
}
