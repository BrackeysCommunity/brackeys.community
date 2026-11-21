package puzzle

import "jams.team/mmo-world/sim/fixed"

// MachineCountdownParts is what a machine's countdown is made of: the solo
// parts, and for a party version its row's adjustment as a percent added:
// the row is a percent of the solo countdown, so it adds its distance from
// a hundred.
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
