package game

// UpIn reads the members up and still in a shared encounter, in seat order.
func (g *Game) UpIn(sh *Shared) []*Char { return g.upIn(sh) }

// AtFork reads the members standing at a fork, free to choose.
func (g *Game) AtFork(sh *Shared) []*Char { return g.atFork(sh) }

// SeatsOf reads who would sit at a shared encounter's or fork's machine now.
func (g *Game) SeatsOf(sh *Shared) []*Char { return g.seatsOf(sh) }

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
