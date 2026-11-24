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

// SeesFact reports whether a character may read a fact, as Visible rules.
func SeesFact(c *Char, f fact.Fact) bool {
	viewer := ""
	if c != nil {
		viewer = c.C.ID
	}
	return Visible(viewer, f.Kind, f.Subjects)
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
// theirs it has met, else the rival, once per personal rest. A faction
// offers no more than its cap at once, and a character whose offer left
// the queue uncast is offered none until its offer rest ends.
func (g *Game) threadGate(c *Char, t int64) {
	s := g.Story
	if s == nil || g.threadBusy(c, t) || g.resting(scopeOffer, char.Ref(c.C.ID), t) {
		return
	}
	fi, ok := g.offering(c)
	if !ok {
		return
	}
	via := arc.FactionRef(fi)
	if !g.offerRoom(via) {
		return
	}
	if id, ok := g.theirNPC(c, fi); ok {
		g.pend(arc.Pending{Kind: arc.PendDebt, Char: c.C.ID, Ref: npc.Ref(id), Tick: t, Via: via, Offer: true})
		return
	}
	g.pend(arc.Pending{Kind: arc.PendRival, Char: c.C.ID, Ref: via, Tick: t, Via: via, Offer: true})
}

// structural: the rest scope that keeps the thread gate from a character,
// and the population offers-per-thousand counts by.
const (
	scopeOffer  = "offer"
	perThousand = 1000
)

// threadBusy reports whether a character has a thread running, resting
// or waiting to be cast.
func (g *Game) threadBusy(c *Char, t int64) bool {
	if slices.ContainsFunc(g.Story.Pending, func(p arc.Pending) bool { return p.Char == c.C.ID }) {
		return true
	}
	return g.resting(arc.Personal, char.Ref(c.C.ID), t) || g.threads().open[c.C.ID]
}

// resting reports whether ref rests at scope past tick t.
func (g *Game) resting(scope string, ref fact.Ref, t int64) bool {
	rs := g.Story.Rests
	i, ok := slices.BinarySearchFunc(rs, ScopeRest{Scope: scope, Ref: ref}, cmpRest)
	return ok && rs[i].Until > t
}

// offerCap is how many threads one faction may have offered at once,
// pending or running.
func (g *Game) offerCap() int64 {
	p := g.r.Story
	return p.OffersFloor + p.OffersPerThousand*(g.Active()/perThousand)
}

// offerRoom reports whether a faction is under its cap: its pending
// candidates and its running threads, the gate's and its beaten rivals'.
// The active count is only taken once the floor is reached.
func (g *Game) offerRoom(via fact.Ref) bool {
	load := g.threads().load[via]
	for _, p := range g.Story.Pending {
		if p.Faction() == via {
			load++
		}
	}
	return load < g.r.Story.OffersFloor || load < g.offerCap()
}

// offerLeft rests a character from the gate when its offer leaves the
// queue without being cast, so the gate does not offer it again at once.
func (g *Game) offerLeft(p arc.Pending) {
	if !p.Offer {
		return
	}
	g.Story.rest(ScopeRest{Scope: scopeOffer, Ref: char.Ref(p.Char), Until: g.Tick() + g.r.Story.OfferRestDays*sheets.TicksPerDay})
}

// threadIndex is the open personal threads: who follows one, and how many
// each offering faction has running. It holds no pending candidate, so a
// pend, an unpend or a forget leaves it whole.
type threadIndex struct {
	head **Arc // the arcs it indexes, by their first and their length
	n    int
	open map[string]bool
	load map[fact.Ref]int64
}

// threads is the story's thread index, built afresh when an arc opened or
// ended since, or when it does not index the arcs the story holds.
func (g *Game) threads() *threadIndex {
	s := g.Story
	if x := s.threads; x != nil && x.indexes(s.Arcs) {
		return x
	}
	x := &threadIndex{open: map[string]bool{}, load: map[fact.Ref]int64{}}
	for _, a := range s.Arcs {
		if a.over() || a.Scope != arc.Personal {
			continue
		}
		x.open[a.Char] = true
		if a.Via != (fact.Ref{}) {
			x.load[a.Via]++
		}
	}
	x.n = len(s.Arcs)
	if x.n > 0 {
		x.head = &s.Arcs[0]
	}
	s.threads = x
	return x
}

func (x *threadIndex) indexes(arcs []*Arc) bool {
	return x.n == len(arcs) && (x.n == 0 || x.head == &arcs[0])
}

// Queued counts the personal thread candidates queued since the story
// loaded, by where they came from: the thread gate, a won side against a
// faction, and every other hook.
type Queued struct {
	Gate, Winners, Other int64
}

func (q *Queued) add(p arc.Pending) {
	switch {
	case p.Offer:
		q.Gate++
	case p.Faction() != (fact.Ref{}):
		q.Winners++
	default:
		q.Other++
	}
}

// Queued is what the story has queued since it loaded, never saved.
func (g *Game) Queued() Queued {
	if g.Story == nil {
		return Queued{}
	}
	return g.Story.queued
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
