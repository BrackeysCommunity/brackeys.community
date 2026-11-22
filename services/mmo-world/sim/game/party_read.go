package game

import (
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/puzzle"
)

// UpIn reads the members up and still in a shared encounter, in seat order.
func (g *Game) UpIn(sh *Shared) []*Char { return g.upIn(sh) }

// AtFork reads the members standing at a fork, free to choose.
func (g *Game) AtFork(sh *Shared) []*Char { return g.atFork(sh) }

// SeatsOf reads who sits at a shared encounter's or fork's machine: its
// seats once armed, else those who would sit at it now.
func (g *Game) SeatsOf(sh *Shared) []*Char {
	if !sh.Machine.Armed() {
		return g.seatsOf(sh)
	}
	return g.seatChars(sh.Machine)
}

// EncounterOf reads a shared encounter's encounter, nil once it is over.
func (g *Game) EncounterOf(sh *Shared) *fight.Encounter {
	if e := g.encounterOf(sh); e != nil && !e.Over {
		return e
	}
	return nil
}

// RestMachine reads the party machine a character's shared encounter or
// fork holds at rest, and where it comes from.
func (g *Game) RestMachine(c *Char) (source string, spec puzzle.Spec, ok bool) {
	sh := g.sharedOf(c)
	if sh == nil {
		return "", puzzle.Spec{}, false
	}
	for _, src := range []string{SourceGuardian, SourceFork, SourceParty} {
		if spec, err := g.partySpec(sh, c, src); err == nil {
			return src, spec, true
		}
	}
	return "", puzzle.Spec{}, false
}

// PickOf reads the option a member holds on a shared beat, or "".
func (sh *Shared) PickOf(who string) string { return sh.pickOf(who) }

// IsDown reads whether a character is down.
func IsDown(c *Char) bool { return notDown(c) != nil }

// Within reads whether two characters are in reach of each other.
func Within(a, b *Char) bool { return within(a, b) }

// WindowDue reads when a shared pick window closes, or 0 when none is open
// or it waits on an armed machine.
func (g *Game) WindowDue(sh *Shared) int64 {
	if sh.Opened == 0 || sh.Machine.Armed() {
		return 0
	}
	return sh.Opened + g.PartyWindowMs()
}
