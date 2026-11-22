package puzzle

import "jams.team/mmo-world/sim/fixed"

// MachineCountdownParts are a machine's countdown reasons: the solo parts,
// plus for a party version a "party" percent, its row's countdown less a
// hundred, so they sum to PartyCountdown.
func (p *Puzzles) MachineCountdownParts(s Spec, practice int64) []Part {
	out := p.CountdownParts(s.Family, s.Level, s.Tier, practice)
	if s.Party == "" {
		return out
	}
	row, _ := p.partyRow(s.Party)
	if d := row.Countdown - fixed.Hundredths; d != 0 {
		out = append(out, Part{"party", d, UnitPercent})
	}
	return out
}

// PartyCountdown is a party machine's countdown in milliseconds: the row's
// percent of the solo countdown at the best practice among its seats.
func (p *Puzzles) PartyCountdown(s Spec, practice int64) int64 {
	row, _ := p.partyRow(s.Party)
	return fixed.PercentOf(p.Countdown(s.Family, s.Level, s.Tier, practice), row.Countdown)
}

// MachineCountdown is a machine's countdown in milliseconds: a party
// version's, or the family's own for a solo one.
func (p *Puzzles) MachineCountdown(s Spec, practice int64) int64 {
	if s.Party != "" {
		return p.PartyCountdown(s, practice)
	}
	return p.Countdown(s.Family, s.Level, s.Tier, practice)
}
