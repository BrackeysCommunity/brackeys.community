package game

import (
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/puzzle"
)

// race marks a fork machine just armed as racing every other context
// armed at the same machine: one floor, one way in (GDD 7.11).
func (g *Game) race(sh *Shared) {
	m := sh.Machine
	for _, o := range g.Shared {
		om := o.Machine
		if o == sh || !om.Armed() || om.Source != SourceFork || om.Spec.Place != m.Spec.Place || om.Spec.Beat != m.Spec.Beat {
			continue
		}
		m.Rival, om.Rival = o.ID, sh.ID
		g.saw(o.Members...)
		return
	}
}

// raced settles a race once one side's log lands: solved, it takes the
// machine, and the rival's haywires in the same command; failed, the
// rival races no more.
func (g *Game) raced(sh *Shared, m *PartyMachine, res puzzle.Result, tick int64) error {
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
		s.LastMachine = &MachineDone{Source: om.Source, Family: om.Spec.Family, Level: om.Spec.Level, Tick: tick, Result: lost}
		g.touchOnce(s)
	}
	o.Machine, o.LostRace = nil, sh.ID
	return nil
}
