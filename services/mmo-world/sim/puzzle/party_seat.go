package puzzle

// structural: the puzzles.party deals value that hides from each seat
// what the others hold.
const dealsSplit = "split"

// MachineCountdown is a machine's countdown in milliseconds: a party
// version's, or the family's own for a solo one.
func (p *Puzzles) MachineCountdown(s Spec, practice int64) int64 {
	if s.Party != "" {
		return p.PartyCountdown(s, practice)
	}
	return p.Countdown(s.Family, s.Level, s.Tier, practice)
}

// Glimpse is the next seat's part of a split machine, for a seat whose
// practice gives it; nil for any other machine.
func (p *Puzzles) Glimpse(s Spec, seat, practice int64) *Layout {
	if s.Party == "" || p.party[s.Party].Deals != dealsSplit || !p.Gifts(practice).Glimpse {
		return nil
	}
	parts := p.Deal(s)
	if len(parts) == 1 {
		return nil
	}
	next := parts[(seat+1)%int64(len(parts))]
	return &next
}
