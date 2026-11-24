package game

import (
	"slices"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/econ"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
)

// Leanings and disposition (GDD 4.18): how an NPC leans, what it can know
// of a character's alignment, and how it holds the character for it.

// Moods an NPC holds toward a character, from its disposition; none is "".
const (
	MoodWarm    = "warm"
	MoodCold    = "cold"
	MoodHostile = "hostile"
)

// entryRobbed is the memory a theft leaves on the NPC robbed.
const entryRobbed = "robbed"

// leaningRow is the npcs.leanings row an NPC draws from: its role's own
// leaning, else the archetype of the faction holding its home region, else
// none.
func (g *Game) leaningRow(s npc.Stub) string {
	if row := g.r.NPC.Role(s.Role); row != nil && row.Leaning != "" {
		return row.Leaning
	}
	if r := g.World.RegionAt(s.Home); r >= 0 {
		if fi := g.World.Regions[r].Holder; fi >= 0 && fi < len(g.World.Factions) {
			return g.World.Factions[fi].Archetype
		}
	}
	return sheets.LeanNone
}

// LeaningOf is how an NPC leans: a saved NPC's stored leaning once drawn,
// else one draw on npc.leaning keyed by its id against its row's odds.
func (g *Game) LeaningOf(s npc.Stub) string {
	if n := g.NPCs.Get(s.ID); n != nil && n.Leaning != "" {
		return n.Leaning
	}
	return g.leanFrom(g.leaningRow(s), s.ID)
}

// leanFrom draws the leaning of NPC id against an npcs.leanings row.
func (g *Game) leanFrom(row, id string) string {
	i := slices.IndexFunc(g.r.Book.Leanings, func(l sheets.Leaning) bool { return l.ID == row })
	if i < 0 {
		return npc.LeaningNone
	}
	l := g.r.Book.Leanings[i]
	switch v := int64(g.r.draw.Below(fixed.Hundredths, "npc.leaning", draw.Str(id))); {
	case v < l.Upright:
		return npc.LeaningUpright
	case v < l.Upright+l.Crooked:
		return npc.LeaningCrooked
	}
	return npc.LeaningNone
}

// drawLeaning stores a saved NPC's leaning at a meeting, once; it reports
// whether it drew, so the caller chains the NPC.
func (g *Game) drawLeaning(n *npc.NPC) bool {
	if n.Leaning != "" {
		return false
	}
	n.Leaning = g.LeaningOf(n.Stub)
	return true
}

// factionKeyOf is the standing an NPC's choices and thefts from it move:
// the syndicate's for its fences and notables, else standingKey's.
func (g *Game) factionKeyOf(s npc.Stub) string {
	if row := g.r.NPC.Role(s.Role); row != nil && row.Leaning == syndicateKey {
		return syndicateKey
	}
	fi := econ.Keepers
	if r := g.World.RegionAt(s.Home); r >= 0 && g.World.Regions[r].Holder >= 0 {
		fi = g.World.Regions[r].Holder
	}
	return standingKey(fi, s.Home)
}

// canKnow reports whether an NPC knows a character's band: Notorious and
// Upright are known to all; otherwise only a public move made since it
// last met the character (at a first meeting, within know-days) in its
// home region, on its route, or in a region bordering its home's, one hop
// of gossip. Nothing is pushed: the ring is read at the meeting.
func (g *Game) canKnow(s npc.Stub, n *npc.NPC, c *Char, t int64) bool {
	if b := g.Band(c); b == bandNotorious || b == bandUpright {
		return true
	}
	known := char.KnownOf(c.C)
	if len(known) == 0 {
		return false
	}
	since := t - sheets.IntParam(g.r.Book.AlignParams, "know-days")*sheets.TicksPerDay
	if n != nil {
		if m := n.Meeting(c.C.ID); m != nil {
			switch {
			case m.Tick < t:
				since = m.Tick
			case m.Count > 1:
				since = m.Prev
			}
		}
	}
	home := g.World.RegionAt(s.Home)
	var near []int
	if home >= 0 {
		near = g.World.Regions[home].Neighbours
	}
	for _, k := range known {
		if k.Tick <= since {
			continue
		}
		if (home >= 0 && k.Region == home) || slices.Contains(near, k.Region) || (n != nil && slices.Contains(n.Route, k.At)) {
			return true
		}
	}
	return false
}

// Disposition is how an NPC holds a character (GDD 4.18): an NPC of a
// faction the character betrayed holds the grudge whatever else; otherwise
// what its memory holds plus the shift its leaning gives the band it can
// know.
func (g *Game) Disposition(c *Char, id string) int64 {
	s, n, ok := g.personOf(c, id)
	if !ok {
		return 0
	}
	return g.disposition(c, s, n, g.Tick())
}

// Mood is warm, cold or hostile, or "" between.
func (g *Game) Mood(c *Char, id string) string { return g.moodOf(g.Disposition(c, id)) }

func (g *Game) moodOf(d int64) string {
	switch {
	case d >= g.r.NPC.Param("disposition-warm"):
		return MoodWarm
	case d <= g.r.NPC.Param("disposition-hostile"):
		return MoodHostile
	case d <= g.r.NPC.Param("disposition-cold"):
		return MoodCold
	}
	return ""
}

// disposition is Disposition for a stub, saved (n) or not.
func (g *Game) disposition(c *Char, s npc.Stub, n *npc.NPC, t int64) int64 {
	if c.GrudgeWith(g.factionKeyOf(s), t/sheets.TicksPerDay) {
		return g.r.NPC.Param("grudge-disposition")
	}
	var v int64
	switch i := slices.IndexFunc(c.C.People, func(d char.Disposition) bool { return d.Notable == s.ID }); {
	case i >= 0:
		v = c.C.People[i].Value
	case n != nil && g.robbedBy(n, c, t):
		v = g.r.NPC.Param("robbed-disposition")
	}
	if !g.canKnow(s, n, c, t) {
		return v
	}
	lean := g.LeaningOf(s)
	for _, row := range g.r.Book.BandShifts {
		if row.ID == lean {
			return v + row.Shift(g.Band(c))
		}
	}
	return v
}

// robbedBy reports whether an NPC remembers the character robbing or
// wronging it.
func (g *Game) robbedBy(n *npc.NPC, c *Char, t int64) bool {
	for _, kind := range []string{entryRobbed, entryWronged} {
		if _, ok := g.r.NPC.About(n, c.C.ID, kind, t); ok {
			return true
		}
	}
	return false
}

// personOf finds an NPC a character may be asked about: one saved, one on
// its tile now, a den's fence or a syndicate notable.
func (g *Game) personOf(c *Char, id string) (npc.Stub, *npc.NPC, bool) {
	if n := g.NPCs.Get(id); n != nil {
		return n.Stub, n, true
	}
	here := g.PeopleHere(c, c.C.At)
	if i := slices.IndexFunc(here, func(p Person) bool { return p.ID == id }); i >= 0 {
		return here[i].Stub, nil, true
	}
	for _, s := range g.SyndicateNotables() {
		if s.ID == id {
			return s, nil, true
		}
	}
	for _, d := range g.Dens() {
		if d.Fence == id {
			s, ok := g.fenceStub(d.Origin)
			return s, nil, ok
		}
	}
	return npc.Stub{}, nil, false
}
