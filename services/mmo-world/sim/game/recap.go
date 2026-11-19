package game

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// Look marks that a character's owner opened the hub: the next recap
// starts from here.
const Look = "look"

func (g *Game) look(c *Char) error {
	c.Seen = g.Tick()
	return nil
}

// Recap rules, in the order the recap selects (GDD 3.3). structural.
const (
	RecapCost    = iota + 1 // what cost the player
	RecapPaid               // what paid them
	RecapDue                // their goals and pledges falling due
	RecapVisit              // NPCs who want a word
	RecapNear               // heavy facts near where they stand
	RecapLargest            // the world's heaviest since they left
)

// recapKinds are the fact kinds each personal rule takes.
var recapKinds = map[int][]string{
	RecapCost: {"item.broke", "item.dormant", "encounter.lost", "character.down", "mount.unfed", "ambush.defaulted", "ledger.corrected"},
	RecapPaid: {"order.filled", "find.made", "kind.discovered", "encounter.won", "item.milestone", "dungeon.floor-cleared", "travel.arrived", "gather.done", "forage.done"},
}

// RecapLine is one line of a recap: a fact, or an NPC asking for a word.
type RecapLine struct {
	Rule int       `json:"rule"`
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
// seen, and the world's heavy facts in the same span, by the six rules;
// ties go to the newer fact.
func (g *Game) Recap(c *Char, own, heavy []fact.Fact) Recap {
	since := c.Seen
	var lines []RecapLine
	taken := map[fact.ID]bool{}
	add := func(rule int, fs []fact.Fact) {
		slices.SortStableFunc(fs, func(a, b fact.Fact) int { return cmp.Compare(b.ID, a.ID) })
		for _, f := range fs {
			if !taken[f.ID] {
				taken[f.ID] = true
				lines = append(lines, RecapLine{Rule: rule, Fact: f})
			}
		}
	}
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
		lines = append(lines, RecapLine{Rule: RecapVisit, NPC: n.ID})
	}
	near := g.r.wp("recap-range")
	var close, rest []fact.Fact
	for _, f := range heavy {
		if f.Tick <= since || f.Weight < g.r.wp("news-weight") {
			continue
		}
		if at, ok := g.factAt(f); ok && hex.Distance(at, c.C.At) <= near {
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

// factAt is the tile a fact names, or its region's centre.
func (g *Game) factAt(f fact.Fact) (hex.Hex, bool) {
	q, okq := f.Get(keyQ)
	r, okr := f.Get(keyR)
	if okq && okr {
		return hex.Hex{Q: q.N, R: r.N}, true
	}
	if i, ok := world.ParseRegionRef(f.Region); ok && i < len(g.World.Regions) {
		return g.r.Gen.Region(g.World.Regions[i].Lattice).Centre, true
	}
	return hex.Hex{}, false
}

// RecapWindow is how far back a recap reads facts, at most.
func (g *Game) RecapWindow() int64 { return g.r.wp("recap-days") * sheets.TicksPerDay }
