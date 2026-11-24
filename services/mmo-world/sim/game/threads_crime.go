package game

import (
	"slices"
	"strings"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
)

// The syndicate's two threads (GDD 4.5, 12.9): the invitation that makes a
// character one of its own, and the watch captain's word about a den.

// structural: the informer's template, the invitation's side that makes
// the character, the cast role of the NPC a thread is said to, the watch
// captain's role and the causes a den moves for.
const (
	informerTemplate = "the-informer"
	sideTakeTheJob   = "take-the-job"
	roleThreadNPC    = "npc"
	roleWatchCaptain = "settlement-watch"
	denMoveInformed  = "informed"
	denMoveLapsed    = "lapsed"
)

// syndicateVia is the syndicate as the thread gate counts its offers.
var syndicateVia = fact.Ref{Kind: syndicateKey, ID: syndicateIssuer}

var _ arc.Crime = (*storyView)(nil)

func init() {
	crimeEffects[arc.EffectMade] = madeEffect
	crimeEffects[arc.EffectInform] = informEffect
	crimeEffects[arc.EffectDenMoves] = denMovesEffect
	meetHooks = append(meetHooks, (*Game).pendInformer)
}

// Den is the den nearest a character at or above the syndicate's gate
// and not made, with the captain over it.
func (v *storyView) Den(id string) (fence, notable string, settlement int, ok bool) {
	g := v.g
	c := g.Char(id)
	if c == nil || char.IsMade(c.C) || !g.pastGate(c) {
		return "", "", -1, false
	}
	d, ok := g.nearestDen(c.C.At)
	if !ok {
		return "", "", -1, false
	}
	return d.Fence, g.captainOver(d), d.Place, true
}

// Captain is a watch captain's settlement and the nearest den within
// informer-reach of it, while the character is still crooked or made.
func (v *storyView) Captain(id, captain string) (settlement, den int, ok bool) {
	g := v.g
	c := g.Char(id)
	if c == nil || !g.informable(c) {
		return -1, -1, false
	}
	n := g.NPCs.Get(captain)
	if n == nil {
		return -1, -1, false
	}
	return g.captainsDen(n)
}

// captainOver is the syndicate captain a den answers to, as
// SyndicateNotables homes them.
func (g *Game) captainOver(d Den) string {
	per := max(1, g.syp("dens-per-captain"))
	return captainID(int64(d.Index) / per)
}

// informable reports whether a watch captain would take a character's word
// about a den: it is crooked or worse, or made.
func (g *Game) informable(c *Char) bool { return char.IsMade(c.C) || g.crookedOrWorse(c) }

// captainsDen is a watch captain's settlement and the den nearest it,
// when that den lies within informer-reach.
func (g *Game) captainsDen(n *npc.NPC) (settlement, den int, ok bool) {
	if n.Stub.Role != roleWatchCaptain {
		return -1, -1, false
	}
	at, ok := g.SettlementAt(n.Stub.Home)
	if !ok || g.Places[at].Ruined != 0 {
		return -1, -1, false
	}
	d, ok := g.nearestDen(n.Stub.Home)
	if !ok || hex.Distance(d.At, n.Stub.Home) > g.r.Story.InformerReach {
		return -1, -1, false
	}
	return at, d.Place, true
}

// pendInformer queues the informer when a crooked or made character meets
// a watch captain near a den, at most once an informer rest.
func (g *Game) pendInformer(c *Char, n *npc.NPC, t int64) error {
	s := g.Story
	if s == nil || !g.informable(c) {
		return nil
	}
	if _, _, ok := g.captainsDen(n); !ok {
		return nil
	}
	who := char.Ref(c.C.ID)
	if g.threadBusyFor(c, arc.PendInformer, arc.ScopeInformer, informerTemplate, t) {
		return nil
	}
	g.pend(arc.Pending{Kind: arc.PendInformer, Char: c.C.ID, Ref: npc.Ref(n.Stub.ID), Tick: t, Fact: g.metFact(c, n, t)})
	s.rest(ScopeRest{Scope: arc.ScopeInformer, Ref: who, Until: t + g.r.Story.InformerRestDays*sheets.TicksPerDay})
	return nil
}

// threadBusyFor reports whether a character has a personal thread of a
// kind pending, resting at its scope or open.
func (g *Game) threadBusyFor(c *Char, kind, scope, template string, t int64) bool {
	if slices.ContainsFunc(g.Story.Pending, func(p arc.Pending) bool { return p.Kind == kind && p.Char == c.C.ID }) {
		return true
	}
	return g.resting(scope, char.Ref(c.C.ID), t) || g.threadOpen(c, template)
}

// threadOpen reports whether a character follows an open thread of a
// template.
func (g *Game) threadOpen(c *Char, template string) bool {
	if !g.threads().open[c.C.ID] {
		return false
	}
	return slices.ContainsFunc(g.Story.Arcs, func(a *Arc) bool { return !a.over() && a.Template == template && a.Char == c.C.ID })
}

// metFact is this tick's npc.met between a character and an NPC, the
// informer's cause.
func (g *Game) metFact(c *Char, n *npc.NPC, t int64) fact.ID {
	for id := fact.ID(g.Log.Len()); id > 0; id-- {
		f, ok := g.Log.Get(id)
		if !ok || f.Tick != t {
			return 0
		}
		if f.Kind == "npc.met" && slices.Contains(f.Subjects, char.Ref(c.C.ID)) && slices.Contains(f.Subjects, npc.Ref(n.Stub.ID)) {
			return f.ID
		}
	}
	return 0
}

// syndicateRest rests a character from the invitation it did not take and
// from the informer once one ends, so neither is queued again at once.
func (g *Game) syndicateRest(a *Arc, t int64) {
	who := char.Ref(a.Char)
	switch {
	case a.Template == inviteTemplate && a.Outcome != sideTakeTheJob:
		g.Story.rest(ScopeRest{Scope: arc.ScopeInvite, Ref: who, Until: t + g.r.Story.InviteRestDays*sheets.TicksPerDay})
	case a.Template == informerTemplate:
		g.Story.rest(ScopeRest{Scope: arc.ScopeInformer, Ref: who, Until: t + g.r.Story.InformerRestDays*sheets.TicksPerDay})
	}
}

// madeEffect makes the thread's character one of the syndicate's own. One
// whose syndicate standing has fallen under 0 since it was cast is not made:
// the made never sit under 0, where the next standing change would unmake
// them with no betrayal.
func madeEffect(x effect) error {
	var also []fact.Ref
	if ref, ok := x.a.Cast.Get(roleThreadNPC); ok {
		also = append(also, ref)
	}
	for _, c := range x.whom() {
		if c.C.Standing.Get(syndicateKey) < 0 {
			continue
		}
		c.C.Align().Made = true
		x.g.touchOnce(c)
		if _, err := x.g.factCaused(c, also, factMade, x.t, x.cause); err != nil {
			return err
		}
	}
	return nil
}

// informEffect is naming the fence to the watch: a good act, a betrayal
// of the syndicate for the made, and the named den moves on.
func informEffect(x effect) error {
	g := x.g
	for _, c := range x.whom() {
		if err := g.moveFor(c, ActInformed, x.cause, "", x.t); err != nil {
			return err
		}
		if char.IsMade(c.C) {
			if err := g.betray(c, syndicateKey, ActInformed, x.cause, x.t); err != nil {
				return err
			}
		}
		g.touchOnce(c)
	}
	if err := x.moveDen(denMoveInformed); err != nil {
		return err
	}
	for _, c := range x.whom() {
		if err := g.fenceCheck(c, x.t); err != nil {
			return err
		}
	}
	return nil
}

// denMovesEffect moves the den the watch heard of, with nothing said.
func denMovesEffect(x effect) error { return x.moveDen(denMoveLapsed) }

// moveDen moves the den standing in the settlement the effect's role
// names; a den already gone from there is left be.
func (x effect) moveDen(cause string) error {
	ref, ok := x.ref()
	if !ok {
		return nil
	}
	n, ok := arc.RefIndex(ref)
	if ref.Kind != kindSettlement || !ok || n >= len(x.g.Places) {
		return nil
	}
	d, ok := x.g.DenAt(x.g.Places[n].Hex)
	if !ok {
		return nil
	}
	return x.g.moveDen(d, cause, x.t)
}

// trustedFence is the fence a made character trusted at the syndicate's
// trusted standing met last, through whom the syndicate offers a thread.
func (g *Game) trustedFence(c *Char) (string, bool) {
	if !char.IsMade(c.C) || c.C.Standing.Get(syndicateKey) < g.syp("trusted") {
		return "", false
	}
	for i := len(c.C.Company) - 1; i >= 0; i-- {
		id, ok := strings.CutPrefix(c.C.Company[i].Who, npcPrefix)
		if ok && isFenceID(id) && g.NPCs.Get(id) != nil {
			return id, true
		}
	}
	return "", false
}
