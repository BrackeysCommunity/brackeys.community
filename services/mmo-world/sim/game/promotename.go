package game

import (
	"strings"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/sheets"
)

// PromoteName is a promotion's first renaming it, once, within its days
// (GDD 4.17): Option names the promotion, Note the name.
const PromoteName = "promote-name"

// Refusals of a rename.
const (
	NotFirst   = "not-first"   // only the promotion's first renames it
	NameClosed = "name-closed" // the days to rename it have run out
)

const factPromotionRenamed = "promotion.renamed"

// CanRename is why viewer may not rename a promotion now, or nil.
func (g *Game) CanRename(p *emerge.Promotion, viewer string) error {
	switch {
	case p == nil || !emerge.Renamable(p.Type):
		id := ""
		if p != nil {
			id = p.ID
		}
		return refuse(NoSuchRow, "no promotion %q to rename", id)
	case viewer == "" || p.First != viewer:
		return refuse(NotFirst, "only %s's first renames it", p.Shown())
	case p.Named != "":
		return refuse(Named, "it is named %s", p.Named)
	case g.Tick() >= p.Tick+g.r.Emerge.P.RenameDays*sheets.TicksPerDay:
		return refuse(NameClosed, "%s could be renamed for %d days", p.Shown(), g.r.Emerge.P.RenameDays)
	}
	return nil
}

// screenName is a given name trimmed, or BadName when the board would not
// take it.
func (g *Game) screenName(s string) (string, error) {
	name := strings.TrimSpace(s)
	if name == "" || int64(len([]rune(name))) > g.gp("title-length") || g.blocked(name) != "" {
		return "", refuse(BadName, "a name is 1 to %d characters the board takes", g.gp("title-length"))
	}
	return name, nil
}

// promoteName renames a style, variant, material or legend for its first,
// the name screened as a dungeon's is. A refusal changes nothing.
func (g *Game) promoteName(c *Char, cmd Command) error {
	var p *emerge.Promotion
	if g.Emergence != nil {
		p = g.Emergence.Promotion(cmd.Option)
	}
	if err := g.CanRename(p, c.C.ID); err != nil {
		if p == nil {
			return refuse(NoSuchRow, "no promotion %q to rename", cmd.Option)
		}
		return err
	}
	name, err := g.screenName(cmd.Note)
	if err != nil {
		return err
	}
	was := p.Shown()
	p.Named = name
	_, err = g.worldFact(c.C.At, factPromotionRenamed, []fact.Ref{promotionRef(p.ID), char.Ref(c.C.ID)}, []fact.ID{p.Fact},
		fact.S("id", p.ID), fact.S("name", name), fact.S("was", was))
	return err
}
