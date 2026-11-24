package game

import (
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/sheets"
)

// betray is a character turning on a faction it stood well with (GDD
// 5.10, 4.5): its standing falls to betrayal-standing at most, its
// alignment takes the betrayal act, and the faction holds a grudge for
// grudge-days, a second betrayal running it on from today. Betraying the
// syndicate unmakes a made character. Other factions are untouched.
func (g *Game) betray(c *Char, faction string, act string, cause fact.ID, t int64) error {
	floor := sheets.IntParam(g.r.Book.TheftParams, "betrayal-standing")
	now := c.C.Standing.Get(faction)
	standing := min(now, floor)
	f, err := g.factCaused(c, []fact.Ref{standingRef(faction)}, factBetrayed, t, cause,
		fact.S("faction", faction), fact.S("act", act), fact.N("standing", standing))
	if err != nil {
		return err
	}
	if standing != now {
		c.C.Standing.Bump(faction, standing-now)
	}
	if err := g.moveFor(c, ActBetrayal, f.ID, "", t); err != nil {
		return err
	}
	day := t / sheets.TicksPerDay
	a := c.C.Align()
	a.Grudges = slices.DeleteFunc(a.Grudges, func(gr char.Grudge) bool { return gr.Ends <= day })
	ends := day + sheets.IntParam(g.r.Book.TheftParams, "grudge-days")
	if i := slices.IndexFunc(a.Grudges, func(gr char.Grudge) bool { return gr.Faction == faction }); i >= 0 {
		a.Grudges[i].Ends = max(a.Grudges[i].Ends, ends)
	} else {
		a.Grudges = append(a.Grudges, char.Grudge{Faction: faction, Ends: ends})
	}
	if faction == syndicateKey {
		return g.unmake(c, f.ID, t)
	}
	return nil
}

// unmake ends a made character's place in the syndicate.
func (g *Game) unmake(c *Char, cause fact.ID, t int64) error {
	if !char.IsMade(c.C) {
		return nil
	}
	c.C.Alignment.Made = false
	_, err := g.factCaused(c, nil, factUnmade, t, cause)
	return err
}

// GrudgeWith reports whether a faction, by standing key, still holds a
// grudge against the character on a world day.
func (c *Char) GrudgeWith(faction string, day int64) bool {
	return slices.ContainsFunc(char.GrudgesOf(c.C), func(gr char.Grudge) bool { return gr.Faction == faction && day < gr.Ends })
}

// standingRef is the fact ref a standing key names: a world faction as
// the story names it, else the key itself as a faction.
func standingRef(key string) fact.Ref {
	if id, ok := strings.CutPrefix(key, ownerFaction); ok {
		if fi, err := strconv.Atoi(id); err == nil && fi >= 0 {
			return arc.FactionRef(fi)
		}
	}
	return fact.Ref{Kind: kindFactionRef, ID: key}
}

// structural: the ref kind a faction fact subject takes.
const kindFactionRef = "faction"
