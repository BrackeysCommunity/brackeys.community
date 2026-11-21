package game

import (
	"cmp"
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/party"
)

// PartyMax is the most members a party holds.
func (g *Game) PartyMax() int64 { return g.r.Fight.Param("party-size-max") }

// within reports whether two characters stand within a party's reach of
// each other: the same or a neighbouring tile, on the same floor.
func within(a, b *Char) bool { return a.C.Floor == b.C.Floor && party.Within(a.C.At, b.C.At) }

// partyInvite invites a character into the inviter's party, or, from a
// lone character, into the party that forms when it is taken (GDD 7.5).
func (g *Game) partyInvite(c *Char, cmd Command) error {
	t := g.Char(cmd.Target)
	if t == nil || t == c {
		return refuse(BadArgs, "an invitation names another character")
	}
	if t.Party != "" {
		return refuse(InParty, "%s is in a party already", t.C.ID)
	}
	if !within(c, t) {
		return refuse(OutOfReach, "%s is out of reach", t.C.ID)
	}
	p := g.partyOf(c)
	if p != nil && p.Full(g.PartyMax()) {
		return refuse(PartyFull, "the party holds %d already", len(p.Members))
	}
	if t.Banned || t.Fight != nil && (c.Fight == nil || t.Fight.Shared == "" || t.Fight.Shared != c.Fight.Shared) {
		return refuse(Busy, "%s is in an encounter of its own", t.C.ID)
	}
	until := g.Tick() + g.r.Fight.Param("party-invite-ticks")
	if p != nil {
		p.Invite(t.C.ID, c.C.ID, until)
	} else {
		g.Invites = slices.DeleteFunc(g.Invites, func(x party.Invite) bool { return x.By == c.C.ID && x.To == t.C.ID })
		g.Invites = append(g.Invites, party.Invite{To: t.C.ID, By: c.C.ID, Until: until})
	}
	g.saw(t.C.ID)
	return nil
}

// partyJoin takes an invitation: into the inviter's party, or a new one
// the inviter leads.
func (g *Game) partyJoin(c *Char, cmd Command) error {
	by := g.Char(cmd.Target)
	if by == nil {
		return refuse(NoInvite, "no invitation from %q", cmd.Target)
	}
	tick := g.Tick()
	p := g.partyOf(by)
	held := false
	if p != nil {
		x, ok := p.InviteFor(c.C.ID, tick)
		held = ok && x.By == by.C.ID
	}
	lone := slices.ContainsFunc(g.Invites, func(x party.Invite) bool { return x.By == by.C.ID && x.To == c.C.ID && tick <= x.Until })
	if !held && !lone {
		return refuse(NoInvite, "%s holds no invitation from %s", c.C.ID, by.C.ID)
	}
	if c.Party != "" {
		return refuse(InParty, "%s is in a party already", c.C.ID)
	}
	if !within(c, by) {
		return refuse(OutOfReach, "%s is out of reach", by.C.ID)
	}
	if p != nil && p.Full(g.PartyMax()) {
		return refuse(PartyFull, "the party holds %d already", len(p.Members))
	}
	g.Invites = slices.DeleteFunc(g.Invites, func(x party.Invite) bool { return x.To == c.C.ID && x.By == by.C.ID })
	if p == nil {
		g.NextParty++
		p = &party.Party{ID: "pt-" + strconv.FormatInt(g.NextParty, decimal), Leader: by.C.ID, Formed: tick,
			Members: []party.Member{{ID: by.C.ID, Joined: tick}}}
		g.Parties = append(g.Parties, p)
		by.Party = p.ID
		g.touchOnce(by)
		p.Join(c.C.ID, tick)
		c.Party = p.ID
		// An inviter's other lone invitations are into this party now.
		for _, x := range g.Invites {
			if x.By == by.C.ID {
				p.Invite(x.To, x.By, x.Until)
			}
		}
		g.Invites = slices.DeleteFunc(g.Invites, func(x party.Invite) bool { return x.By == by.C.ID })
		_, err := g.factWith(c, []fact.Ref{char.Ref(by.C.ID), party.Ref(p.ID)}, "party.formed", tick, fact.S("party", p.ID), fact.S("leader", by.C.ID))
		return err
	}
	p.Join(c.C.ID, tick)
	c.Party = p.ID
	g.saw(p.IDs()...)
	_, err := g.factWith(c, []fact.Ref{party.Ref(p.ID)}, "party.joined", tick, fact.S("party", p.ID), fact.N("members", int64(len(p.Members))))
	return err
}

// partyLeave leaves a party between encounters.
func (g *Game) partyLeave(c *Char) error {
	if g.partyOf(c) == nil {
		return refuse(NotInParty, "%s is in no party", c.C.ID)
	}
	if c.Fight != nil && c.Fight.Shared != "" {
		return refuse(Busy, "%s is in a shared encounter: back out of it first", c.C.ID)
	}
	if sh := g.sharedOf(c); sh != nil {
		g.leaveShared(sh, c)
		g.saw(sh.Members...)
	}
	return g.quitParty(c, g.Tick())
}

// quitParty takes a character out of its party, passing the lead on; a
// party left with one member ends, and that member goes on alone.
func (g *Game) quitParty(c *Char, tick int64) error {
	g.Invites = slices.DeleteFunc(g.Invites, func(x party.Invite) bool { return x.By == c.C.ID || x.To == c.C.ID })
	for _, p := range g.Parties {
		p.Invites = slices.DeleteFunc(p.Invites, func(x party.Invite) bool { return x.To == c.C.ID })
	}
	p := g.partyOf(c)
	if p == nil {
		return nil
	}
	ended := p.Leave(c.C.ID)
	c.Party = ""
	if _, err := g.factWith(c, []fact.Ref{party.Ref(p.ID)}, "party.left", tick, fact.S("party", p.ID)); err != nil {
		return err
	}
	if !ended {
		g.saw(p.IDs()...)
		return nil
	}
	g.Parties = slices.DeleteFunc(g.Parties, func(x *party.Party) bool { return x == p })
	for _, m := range p.Members {
		if o := g.Char(m.ID); o != nil {
			o.Party = ""
			g.touchOnce(o)
		}
	}
	_, err := g.factWith(c, []fact.Ref{party.Ref(p.ID)}, "party.ended", tick, fact.S("party", p.ID))
	return err
}

// waitsOnMachine reports whether a kind waits while its character's party
// has a machine armed: nothing may resolve the beat or the fork first, and
// no seat may walk off it (a carry up leaves the fork).
func waitsOnMachine(kind string) bool {
	switch kind {
	case Press, PartyPick, PartyWindow, PartyLeave, DungeonPush, DungeonLeave, DeckSwap, CarryHome:
		return true
	}
	return false
}

// partyTurn lets invitations lapse.
func (g *Game) partyTurn(tick int64) error {
	g.Invites = slices.DeleteFunc(g.Invites, func(x party.Invite) bool { return tick > x.Until })
	for _, p := range g.Parties {
		p.Expire(tick)
	}
	return nil
}

// joining are who an encounter a character begins takes in: the members
// of its party on its tile and floor who are free and among no other
// encounter or fork, in join order; alone, just the character.
func (g *Game) joining(c *Char) []*Char {
	p := g.partyOf(c)
	if p == nil {
		return []*Char{c}
	}
	var out []*Char
	for _, id := range p.IDs() {
		m := g.Char(id)
		switch {
		case m == nil:
		case m == c:
			out = append(out, m)
		case m.C.At == c.C.At && m.C.Floor == c.C.Floor && !m.Banned && m.Armed == nil && ready(m) == nil && g.sharedOf(m) == nil:
			out = append(out, m)
		}
	}
	return out
}

// unshare takes a character out of any shared encounter or fork it is in,
// as a back-out: the encounter goes on for the rest, and one left to none
// still up ends unpaid.
func (g *Game) unshare(c *Char) {
	sh := g.sharedOf(c)
	if sh == nil {
		return
	}
	e := g.encounterOf(sh)
	if e != nil && !e.Over && !slices.Contains(e.Gone, c.C.ID) {
		e.Gone = append(e.Gone, c.C.ID)
	}
	g.leaveShared(sh, c)
	if sh.Machine.Armed() {
		sh.Machine.Seats = slices.DeleteFunc(sh.Machine.Seats, func(id string) bool { return id == c.C.ID })
	}
	if e != nil && len(g.upIn(sh)) == 0 {
		for _, o := range g.in(sh) {
			o.Fight = nil
			g.touchOnce(o)
		}
		g.dropShared(sh)
		return
	}
	for _, o := range g.in(sh) {
		g.touchOnce(o)
	}
}

// PartyWindowMs is how long a beat's or a fork's first choice waits for
// the rest, in ms.
func (g *Game) PartyWindowMs() int64 {
	return g.r.Fight.Param("party-pick-window") * msPerSecond
}

// structural: the sheets give windows in seconds; the service's clock is
// in ms.
const msPerSecond = 1000

// OpenWindows are the shared encounters and forks whose window is open
// and not waiting on a machine, oldest first.
func (g *Game) OpenWindows() []*Shared {
	var out []*Shared
	for _, sh := range g.Shared {
		if sh.Opened > 0 && !sh.Machine.Armed() {
			out = append(out, sh)
		}
	}
	slices.SortStableFunc(out, func(a, b *Shared) int { return cmp.Compare(a.Opened, b.Opened) })
	return out
}
