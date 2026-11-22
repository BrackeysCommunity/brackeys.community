package game

import (
	"slices"
	"strings"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
)

// ThreadKinds is the prefix of a personal thread's facts, which only its
// own character reads (GDD 12.8).
const ThreadKinds = "thread."

// ThreadFact reports whether a fact kind is a personal thread's.
func ThreadFact(kind string) bool { return strings.HasPrefix(kind, ThreadKinds) }

// SeesFact reports whether a character may read a fact: a thread's facts
// are its own character's alone.
func SeesFact(c *Char, f fact.Fact) bool {
	if !ThreadFact(f.Kind) {
		return true
	}
	return c != nil && slices.Contains(f.Subjects, char.Ref(c.C.ID))
}

// debtKinds are the memories an NPC wants settled: a visit it queues about
// one of them is a debt (GDD 12.8).
var debtKinds = []string{entryHelped, entryWronged, entryTraded, entryFought}

// Memory kinds a sale and a fight beside an NPC leave.
const (
	entryTraded = "traded"
	entryFought = "fought"
)

// pendDebt queues the debt thread when an NPC queues a visit to a
// character about what one did for, or to, the other.
func (g *Game) pendDebt(n *npc.NPC, c *Char, e npc.Entry, t int64) {
	if g.Story == nil || !slices.Contains(debtKinds, e.Kind) {
		return
	}
	g.pendOnce(arc.Pending{Kind: arc.PendDebt, Char: c.C.ID, Ref: npc.Ref(n.Stub.ID), Tick: t, Fact: fact.ID(e.Fact)})
}

// pendOnce queues a candidate unless the same one already waits.
func (g *Game) pendOnce(p arc.Pending) {
	if slices.ContainsFunc(g.Story.Pending, func(q arc.Pending) bool { return q.Kind == p.Kind && q.Char == p.Char && q.Ref == p.Ref }) {
		return
	}
	g.pend(p)
}

// returned queues the return thread for a character's first command after
// return-days away, at the settlement it last stood in. It runs before the
// command moves Acted.
func (g *Game) returned(c *Char, t int64) {
	if g.Story == nil {
		return
	}
	if t-max(c.Acted, c.Born) < g.r.Story.ReturnDays*sheets.TicksPerDay {
		return
	}
	last := -1
	var at int64
	for _, v := range c.Visits {
		if last < 0 || v.Tick > at {
			last, at = v.Settlement, v.Tick
		}
	}
	if last < 0 {
		return
	}
	g.pendOnce(arc.Pending{Kind: arc.PendReturn, Char: c.C.ID, Ref: arc.SettlementRef(last), Tick: t})
}

// threadGate lets the notables of a faction a character stands high with
// offer it a thread with nothing pending (GDD 5.4): the debt of an NPC of
// theirs it has met, else the rival, once per personal rest.
func (g *Game) threadGate(c *Char, t int64) {
	s := g.Story
	if s == nil || g.threadBusy(c, t) {
		return
	}
	fi, ok := g.offering(c)
	if !ok {
		return
	}
	if id, ok := g.theirNPC(c, fi); ok {
		g.pend(arc.Pending{Kind: arc.PendDebt, Char: c.C.ID, Ref: npc.Ref(id), Tick: t})
		return
	}
	g.pend(arc.Pending{Kind: arc.PendRival, Char: c.C.ID, Ref: arc.FactionRef(fi), Tick: t})
}

// threadBusy reports whether a character has a thread running, resting
// or waiting to be cast.
func (g *Game) threadBusy(c *Char, t int64) bool {
	s := g.Story
	ref := char.Ref(c.C.ID)
	if slices.ContainsFunc(s.Pending, func(p arc.Pending) bool { return p.Char == c.C.ID }) {
		return true
	}
	if slices.ContainsFunc(s.Rests, func(r ScopeRest) bool { return r.Scope == arc.Personal && r.Ref == ref && r.Until > t }) {
		return true
	}
	return slices.ContainsFunc(g.openArcs(arc.Personal), func(a *Arc) bool { return a.Char == c.C.ID })
}

// offering is the standing faction whose notables offer a thread: the
// highest standing at thread-standing or more, the lowest index on a tie.
func (g *Game) offering(c *Char) (int, bool) {
	best, at := -1, int64(0)
	for fi, f := range g.World.Factions {
		if f.Fallen {
			continue
		}
		if v := c.C.Standing.Get(factionOwner(fi)); v >= g.r.Story.ThreadStanding && (best < 0 || v > at) {
			best, at = fi, v
		}
	}
	return best, best >= 0
}

// theirNPC is the saved NPC of faction fi the character met last: one
// whose home the faction holds.
func (g *Game) theirNPC(c *Char, fi int) (string, bool) {
	for i := len(c.C.Company) - 1; i >= 0; i-- {
		id, ok := strings.CutPrefix(c.C.Company[i].Who, npcPrefix)
		if !ok {
			continue
		}
		if n := g.NPCs.Get(id); n != nil && g.standingKey(n) == factionOwner(fi) {
			return id, true
		}
	}
	return "", false
}

// structural: how a character's company names an NPC.
const npcPrefix = "npc:"
