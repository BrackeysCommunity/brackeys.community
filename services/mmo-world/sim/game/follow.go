package game

import (
	"strconv"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/party"
	"jams.team/mmo-world/sim/world"
)

// follow sets or clears a member's following of the party's leader
// (GDD 7.5): a follower on the leader's tile enters each tile the leader
// does, on the same tick.
func (g *Game) follow(c *Char, on bool) error {
	p := g.partyOf(c)
	if p == nil {
		return refuse(NotInParty, "%s is in no party", c.C.ID)
	}
	if p.Leader == c.C.ID {
		return refuse(BadArgs, "the leader follows nobody")
	}
	m := &p.Members[p.Seat(c.C.ID)]
	if l := g.Char(p.Leader); on && (l == nil || l.C.At != c.C.At || l.C.Floor != c.C.Floor) {
		return refuse(OutOfReach, "a follower stands on the leader's tile")
	}
	if m.Follows == on {
		return refuse(BadArgs, "%s already does that", c.C.ID)
	}
	m.Follows = on
	g.saw(p.IDs()...)
	return nil
}

// followersOn are the members following a leader who stand where the
// leader is about to leave, in join order.
func (g *Game) followersOn(l *Char, from hex.Hex) []*Char {
	p := g.partyOf(l)
	if p == nil || p.Leader != l.C.ID {
		return nil
	}
	var out []*Char
	for _, m := range p.Members {
		if !m.Follows {
			continue
		}
		if f := g.Char(m.ID); f != nil && f.C.At == from && f.C.Floor == l.C.Floor {
			out = append(out, f)
		}
	}
	return out
}

// slowest is a leader's step cost waited out for its followers: the
// slowest of them sets the party's pace.
func (g *Game) slowest(l *Char, from, to hex.Hex, cost, t int64) int64 {
	for _, f := range g.followersOn(l, from) {
		if fc, _, ok := g.EnterCost(f, from, to, t); ok {
			cost = max(cost, fc)
		}
	}
	return cost
}

// followed takes each follower onto the tile the leader entered, paying
// the provisions the leader's step owed. One who cannot (busy, down,
// or short of provisions) drops off, and the party hears of it.
func (g *Game) followed(l *Char, followers []*Char, to hex.Hex, owe, t int64, acts []world.Action) ([]world.Action, error) {
	p := g.partyOf(l)
	step := l.Long.Steps
	for _, f := range followers {
		if idle(f) != nil || f.C.Provisions < owe {
			p.Members[p.Seat(f.C.ID)].Follows = false
			if _, err := g.factWith(f, []fact.Ref{char.Ref(l.C.ID), party.Ref(p.ID)}, "party.dropped", t, append(fact.At(f.C.At), fact.S("party", p.ID))...); err != nil {
				return acts, err
			}
			g.saw(p.IDs()...)
			continue
		}
		g.touchOnce(f)
		dir := f.C.At.DirectionTo(to)
		f.C.Walk(to, g.r.limits)
		f.C.Facing = dir
		g.visited(f, to, t)
		acts = append(acts, world.Action{Kind: world.ActVisit, Hex: to, By: char.Ref(f.C.ID), Dir: &dir, Quiet: g.charScale(f, "tracks-left", fixed.Hundredths) <= 0})
		f.C.Deeds.Bump(DeedHauled, f.Carried())
		f.C.Practise("travel", 1, g.r.Growth.Params())
		if owe > 0 {
			key := ledger.SubKey(l.Long.Key, "follow", f.C.ID, strconv.FormatInt(step, decimal))
			if err := g.receive(f, ledger.Move(key, "provisions", t, ledger.Char(f.C.ID), ledger.ToProvisions, ledger.Provisions, owe)); err != nil {
				return acts, err
			}
		}
		if _, err := g.fact(f, "travel.entered", t, append(fact.At(to), fact.N("ticks", l.Long.StepTicks), fact.S("follows", l.C.ID))...); err != nil {
			return acts, err
		}
		if f.Carrying != "" {
			if err := g.carried(f, to, t); err != nil {
				return acts, err
			}
		}
		if err := g.arrived(f, to, ledger.SubKey(l.Long.Key, "follow", f.C.ID, "arrive", strconv.FormatInt(step, decimal)), t); err != nil {
			return acts, err
		}
	}
	return acts, nil
}
