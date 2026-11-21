package game

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
)

// SetReady is an operator's command: it brings a character's worn gear and
// its fighting practice up to a tier's expected levels, so a closed-world
// tester or a proof run meets the fights a tier aims at without the weeks
// that earn them. Nothing is minted: only what it wears is raised.
const SetReady = "set-ready"

// readySkills are the practices a tier's expected practice is read for.
var readySkills = []string{"fight", "travel", "gather", practiceLockpick}

func (g *Game) setReady(c *Char, cmd Command) error {
	tiers := int64(len(g.r.Book.FightTiers))
	if cmd.Note == "" || cmd.Units < 1 || cmd.Units > tiers {
		return refuse(BadArgs, "readying needs a tier from 1 to %d and a note", tiers)
	}
	if err := idle(c); err != nil {
		return err
	}
	ReadyAt(g.r, c, cmd.Units, cmd.Units)
	_, err := g.fact(c, "character.readied", g.Tick(), fact.N("tier", cmd.Units), fact.S("note", cmd.Note))
	return err
}

// ReadyAt raises a character's worn gear to one tier's expected level and
// its practice to another's, never lowering either.
func ReadyAt(r *Rules, c *Char, gear, practiced int64) {
	for _, slot := range []string{char.Hand, char.Body} {
		if in := c.C.In(slot, 0); in != nil {
			in.Level = max(in.Level, r.Fight.Tier(gear).ExpectedLevel)
		}
	}
	ft := r.Fight.Tier(practiced)
	for _, skill := range readySkills {
		i := slices.IndexFunc(c.C.Practice, func(k char.Skill) bool { return k.ID == skill })
		if i < 0 {
			c.C.Practice = append(c.C.Practice, char.Skill{ID: skill})
			i = len(c.C.Practice) - 1
		}
		c.C.Practice[i].Level = max(c.C.Practice[i].Level, ft.ExpectedPractice)
	}
	slices.SortFunc(c.C.Practice, func(a, b char.Skill) int { return cmp.Compare(a.ID, b.ID) })
}
