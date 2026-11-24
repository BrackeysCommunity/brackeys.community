package game

import (
	"slices"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/hex"
)

// The watch (GDD 6.5, 5.5): a character wanted at a settlement is stopped
// at its gate, and until it pays or runs it may only talk, look, pay the
// fine or flee.

// StoppedNow is the settlement the watch holds a character at, while any
// of its Wanted entries still applies there.
func (g *Game) StoppedNow(c *Char) (int, bool) {
	at := char.StoppedAt(c.C)
	if at == 0 || c.C.At != g.SettlementHex(at-1) || len(g.wantedAt(c, at-1, g.Tick())) == 0 {
		return 0, false
	}
	return at - 1, true
}

// watchGuard refuses what a stopped character may not do.
func (g *Game) watchGuard(c *Char, kind string) error {
	if Operator(kind) || passive(kind) {
		return nil
	}
	if _, ok := g.StoppedNow(c); !ok {
		return nil
	}
	switch kind {
	case PayFine, Flee, Talk, Choose, Look:
		return nil
	case Press, PartyPick, MachineArm, MachineSolve, DeckSwap:
		if c.Fight != nil {
			return nil
		}
	}
	return refuse(StoppedCode, "the watch holds %s: pay the fine or run", c.C.ID)
}

// watchStops is the watch at a settlement's gate: a character entering it
// while wanted there ends its journey and is held, the fine it would pay
// told.
func (g *Game) watchStops(c *Char, h hex.Hex, t int64) error {
	g.unstop(c)
	if _, ok := g.StoppedNow(c); ok {
		return nil
	}
	n, ok := g.SettlementAt(h)
	if !ok {
		return nil
	}
	idx := g.wantedAt(c, n, t)
	if len(idx) == 0 {
		return nil
	}
	endJourney(c)
	g.unfollow(c)
	c.C.Align().Stopped = n + 1
	s := g.settleWanted(c, idx, true, t)
	g.touchOnce(c)
	_, err := g.fact(c, factWatchStopped, t, append([]fact.Datum{fact.N("settlement", int64(n)), fact.N("fine", s.coin+s.fine)}, fact.At(h)...)...)
	return err
}

// unstop ends a hold the watch no longer has: the character has left the
// gate, or nothing it was held for applies there now.
func (g *Game) unstop(c *Char) {
	a := c.C.Alignment
	if a == nil || a.Stopped == 0 {
		return
	}
	if c.C.At != g.SettlementHex(a.Stopped-1) || len(g.wantedAt(c, a.Stopped-1, g.Tick())) == 0 {
		a.Stopped = 0
		g.touchOnce(c)
	}
}

// unfollow stops a held character following its party's leader on.
func (g *Game) unfollow(c *Char) {
	p := g.partyOf(c)
	if p == nil || p.Leader == c.C.ID {
		return
	}
	if m := &p.Members[p.Seat(c.C.ID)]; m.Follows {
		m.Follows = false
		g.saw(p.IDs()...)
	}
}

// payFine pays the watch off where it holds the character, or where it
// stands wanted.
func (g *Game) payFine(c *Char, cmd Command) error {
	if err := ready(c); err != nil {
		return err
	}
	n, ok := g.StoppedNow(c)
	if !ok {
		m, here := g.SettlementAt(c.C.At)
		if !here || len(g.wantedAt(c, m, g.Tick())) == 0 {
			return refuse(NotStopped, "the watch here wants nothing of %s", c.C.ID)
		}
		n = m
	}
	return g.payOff(c, n, cmd.Key, g.Tick())
}

// flee runs from the watch holding the character: a chase at the
// settlement's tier, lost at the first failed beat.
func (g *Game) flee(c *Char, cmd Command) error {
	if err := ready(c); err != nil {
		return err
	}
	n, ok := g.StoppedNow(c)
	if !ok {
		return refuse(NotStopped, "the watch is not holding %s", c.C.ID)
	}
	k, ok := g.TheftKind(KindFlee)
	if !ok {
		return refuse(BadArgs, "there is no running from the watch")
	}
	h := g.SettlementHex(n)
	g.beginTheft(c, k, h, &Theft{Kind: KindFlee, Victim: refKey(arc.SettlementRef(n)), Place: n, At: h})
	return nil
}

// fleeEnded is a flight's end. Caught, the character goes down, the
// goods it still holds go back with no fine, and what the watch here
// wanted it for ends; away, it is through the gate, still wanted until
// the entries run out.
func (g *Game) fleeEnded(c *Char, e *fight.Encounter, th *Theft, key string, t int64) error {
	n := th.Place
	h := g.SettlementHex(n)
	release := func() {
		if a := c.C.Alignment; a != nil && a.Stopped == n+1 {
			a.Stopped = 0
		}
		g.touchOnce(c)
	}
	switch {
	case th.Failed:
		var worth int64
		ws := char.WantedOf(c.C)
		for _, i := range g.wantedAt(c, n, t) {
			worth += ws[i].Worth
		}
		f, err := g.fact(c, factWatchCaught, t, append([]fact.Datum{fact.N("settlement", int64(n)), fact.N("worth", worth)}, fact.At(h)...)...)
		if err != nil {
			return err
		}
		if !c.C.Has(char.Down, t) {
			c.C.Set(char.Down, 0)
			c.C.Fights.Downs++
			c.C.Fights.DownedAt = append(c.C.Fights.DownedAt, c.C.At)
			if _, err := g.fact(c, "character.down", t); err != nil {
				return err
			}
		}
		if err := g.takeBack(c, n, key, f.ID, t); err != nil {
			return err
		}
		release()
	case e.Result == fight.Won:
		release()
		_, err := g.fact(c, factWatchFled, t, append([]fact.Datum{fact.N("settlement", int64(n))}, fact.At(h)...)...)
		return err
	}
	return nil
}

// FineAt is what paying off the watch at settlement n takes now: the
// lifted coin back and the fine; ok is false when nothing applies there.
func (g *Game) FineAt(c *Char, n int) (int64, bool) {
	idx := g.wantedAt(c, n, g.Tick())
	if len(idx) == 0 {
		return 0, false
	}
	s := g.settleWanted(c, idx, true, g.Tick())
	return s.coin + s.fine, true
}

// WantedFine is what paying off one Wanted entry alone takes now.
func (g *Game) WantedFine(c *Char, i int) int64 {
	if i < 0 || i >= len(char.WantedOf(c.C)) {
		return 0
	}
	s := g.settleWanted(c, []int{i}, true, g.Tick())
	return s.coin + s.fine
}

// WantedPlaces are the settlements a Wanted entry applies at now, in
// place order.
func (g *Game) WantedPlaces(c *Char, i int) []int {
	var out []int
	for n := range g.Places {
		if slices.Contains(g.wantedAt(c, n, g.Tick()), i) {
			out = append(out, n)
		}
	}
	return out
}
