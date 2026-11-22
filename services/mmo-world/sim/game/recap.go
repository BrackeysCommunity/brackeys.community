package game

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

// Look marks that a character's owner opened the hub: the next recap
// starts from here.
const Look = "look"

func (g *Game) look(c *Char) error {
	c.Seen = g.Tick()
	return nil
}

// Recap rules (GDD 3.3). The recap selects cost, paid, due, visit, then
// arc and trouble, then near and largest. structural.
const (
	RecapCost    = iota + 1 // what cost the player
	RecapPaid               // what paid them
	RecapDue                // reserved: goals and pledges falling due
	RecapVisit              // NPCs who want a word
	RecapNear               // heavy facts near where they stand
	RecapLargest            // the world's heaviest since they left
	RecapArc                // arcs that ended: the world's, its regions' and its own threads
	RecapTrouble            // troubles held or lost at its places
)

// Kinds of recap line the story adds, as the wire names them.
const (
	RecapKindArc     = "arc"
	RecapKindTrouble = "trouble"
)

// Fact kinds the story's recap rules read.
const (
	factArcEnded    = "arc.ended"
	factThreadEnded = "thread.ended"
	factTroubleHeld = "trouble.held"
	factTroubleLost = "trouble.lost"
)

// recapKinds are the fact kinds each personal rule takes.
var recapKinds = map[int][]string{
	RecapCost: {"item.broke", "item.dormant", "encounter.lost", "character.down", "mount.unfed", "ambush.defaulted", "ledger.corrected"},
	RecapPaid: {"order.filled", "find.made", "kind.discovered", "encounter.won", "item.milestone", "dungeon.floor-cleared", "travel.arrived", "gather.done", "forage.done"},
}

// RecapLine is one line of a recap: a fact, or an NPC asking for a word.
type RecapLine struct {
	Rule int       `json:"rule"`
	Kind string    `json:"kind,omitempty"`
	Fact fact.Fact `json:"fact"`
	NPC  string    `json:"npc,omitempty"`
}

// Recap is what happened while a character's owner was away: at most
// recap-lines lines, then how many more there were.
type Recap struct {
	Since int64       `json:"since"`
	Lines []RecapLine `json:"lines"`
	More  int         `json:"more"`
}

// Recap selects from the facts naming the character since it was last
// seen, and the world's heavy facts in the same span, by the recap rules;
// ties go to the newer fact. Another character's thread is never read.
func (g *Game) Recap(c *Char, own, heavy []fact.Fact) Recap {
	since := c.Seen
	own, heavy = seenBy(c, own), seenBy(c, heavy)
	var lines []RecapLine
	taken := map[fact.ID]bool{}
	addKind := func(rule int, kind string, fs []fact.Fact) {
		slices.SortStableFunc(fs, func(a, b fact.Fact) int { return cmp.Compare(b.ID, a.ID) })
		for _, f := range fs {
			if !taken[f.ID] {
				taken[f.ID] = true
				lines = append(lines, RecapLine{Rule: rule, Kind: kind, Fact: f})
			}
		}
	}
	add := func(rule int, fs []fact.Fact) { addKind(rule, "", fs) }
	for _, rule := range []int{RecapCost, RecapPaid} {
		var fs []fact.Fact
		for _, f := range own {
			if f.Tick > since && slices.Contains(recapKinds[rule], f.Kind) {
				fs = append(fs, f)
			}
		}
		add(rule, fs)
	}
	for _, n := range g.Visitors(c) {
		lines = append(lines, RecapLine{Rule: RecapVisit, NPC: n.Stub.ID})
	}
	if g.Story != nil {
		arcs, troubles := g.recapStory(c, since, own, heavy)
		addKind(RecapArc, RecapKindArc, arcs)
		addKind(RecapTrouble, RecapKindTrouble, troubles)
	}
	near := g.r.wp("recap-range")
	var close, rest []fact.Fact
	for _, f := range heavy {
		if f.Tick <= since || f.Weight < g.NewsWeight() {
			continue
		}
		if at, ok := g.World.FactAt(f); ok && hex.Distance(at, c.C.At) <= near {
			close = append(close, f)
		} else {
			rest = append(rest, f)
		}
	}
	add(RecapNear, close)
	if len(rest) > 0 {
		slices.SortStableFunc(rest, func(a, b fact.Fact) int { return cmp.Or(cmp.Compare(b.Weight, a.Weight), cmp.Compare(b.ID, a.ID)) })
		add(RecapLargest, rest[:1])
	}
	most := int(g.r.wp("recap-lines"))
	out := Recap{Since: since, Lines: lines}
	if len(lines) > most {
		out.Lines, out.More = lines[:most], len(lines)-most
	}
	return out
}

// seenBy are the facts a character may read.
func seenBy(c *Char, fs []fact.Fact) []fact.Fact {
	if !slices.ContainsFunc(fs, func(f fact.Fact) bool { return !SeesFact(c, f) }) {
		return fs
	}
	return slices.DeleteFunc(slices.Clone(fs), func(f fact.Fact) bool { return !SeesFact(c, f) })
}

// recapStory are the story's lines since a character was last seen: the
// arcs that ended in the world, in a region it stands in or has visited
// a place in, and its own threads; and the troubles held or lost at the
// places it has visited.
func (g *Game) recapStory(c *Char, since int64, own, heavy []fact.Fact) (arcs, troubles []fact.Fact) {
	places := make([]int64, 0, len(c.Visits))
	regions := []int{g.World.RegionAt(c.C.At)}
	for _, v := range c.Visits {
		places = append(places, int64(v.Settlement))
		if v.Settlement >= 0 && v.Settlement < len(g.Places) {
			regions = append(regions, g.World.RegionAt(g.Places[v.Settlement].Hex))
		}
	}
	mine := func(f fact.Fact) bool {
		for _, s := range f.Subjects {
			if s == (fact.Ref{Kind: scopeSubject, ID: arc.ScopeWorld}) {
				return true
			}
			if r, ok := arc.RefIndex(s); ok && s == arc.RegionRef(r) && slices.Contains(regions, r) {
				return true
			}
		}
		return false
	}
	seen := map[fact.ID]bool{}
	for _, f := range append(slices.Clone(own), heavy...) {
		if f.Tick <= since || seen[f.ID] {
			continue
		}
		seen[f.ID] = true
		switch f.Kind {
		case factArcEnded:
			if mine(f) {
				arcs = append(arcs, f)
			}
		case factThreadEnded:
			if slices.Contains(f.Subjects, char.Ref(c.C.ID)) {
				arcs = append(arcs, f)
			}
		case factTroubleHeld, factTroubleLost:
			if d, ok := f.Get(datumSettlement); ok && slices.Contains(places, d.N) {
				troubles = append(troubles, f)
			}
		}
	}
	return arcs, troubles
}

// NewsWeight is the minimum weight for regional news.
func (g *Game) NewsWeight() int64 { return g.r.wp("news-weight") }

// RecapWindow is the maximum lookback, in ticks.
func (g *Game) RecapWindow() int64 { return g.r.wp("recap-days") * sheets.TicksPerDay }
