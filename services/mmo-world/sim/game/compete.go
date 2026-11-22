package game

import (
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/puzzle"
)

// race marks a fork machine just armed as racing the first other context
// armed at the same machine and racing nobody yet: one floor, one way in
// (GDD 7.11). A third to arm races nobody.
func (g *Game) race(sh *Shared) {
	m := sh.Machine
	for _, o := range g.Shared {
		om := o.Machine
		if o == sh || !om.Armed() || om.Source != SourceFork || om.Spec.Place != m.Spec.Place || om.Spec.Beat != m.Spec.Beat {
			continue
		}
		if r, _ := g.RivalOf(o); r != nil {
			continue
		}
		m.Rival, om.Rival = o.ID, sh.ID
		g.saw(o.Members...)
		return
	}
}

// raced settles a race once one side's log lands: solved, it takes the
// machine and the rival haywires, its fork worked with only the open way
// left; failed, the rival races no more.
func (g *Game) raced(sh *Shared, m *PartyMachine, res puzzle.Result, tick, now int64) error {
	o := g.SharedByID(m.Rival)
	if o == nil || !o.Machine.Armed() || o.Machine.Rival != sh.ID {
		return nil
	}
	om := o.Machine
	if !res.Solved {
		om.Rival = ""
		g.saw(o.Members...)
		return nil
	}
	seats := g.seatChars(om)
	lost := puzzle.Result{Haywire: g.haywireOf(om.Spec, false)}
	g.partyHaywired(seats, om.Spec.Place, lost.Haywire, tick, 0)
	for _, s := range seats {
		if _, err := g.factWith(s, sh.refs(), "machine.lost-race", tick, fact.S("family", om.Spec.Family), fact.S("haywire", lost.Haywire),
			fact.S("winner", sh.ID)); err != nil {
			return err
		}
	}
	if o.Fork != nil {
		o.Fork.Worked = true
		o.Fork.Open = []int64{gen.WayOpen}
	}
	g.endPartyMachine(o, om, lost, now, tick, nil)
	o.LostRace = sh.ID
	return nil
}

// endPartyMachine closes a party's machine: the pick window moves on by the
// time it was armed, and every seat holds its result; all but the actor
// are woken.
func (g *Game) endPartyMachine(sh *Shared, m *PartyMachine, res puzzle.Result, now, tick int64, actor *Char) {
	if sh.Machine == m {
		sh.Machine = nil
	}
	if sh.Opened > 0 && m.At > 0 && now > m.At {
		sh.Opened += now - m.At
	}
	for _, s := range g.seatChars(m) {
		s.LastMachine = &MachineDone{Source: m.Source, Family: m.Spec.Family, Level: m.Spec.Level, Tick: tick, Result: res}
		if s != actor {
			g.touchOnce(s)
		}
	}
}

// RivalOf is the other context racing sh's armed fork machine, and when it
// armed: nil while none races it.
func (g *Game) RivalOf(sh *Shared) (*Shared, int64) {
	if !sh.Machine.Armed() || sh.Machine.Rival == "" {
		return nil, 0
	}
	o := g.SharedByID(sh.Machine.Rival)
	if o == nil || !o.Machine.Armed() {
		return nil, 0
	}
	return o, o.Machine.At
}
