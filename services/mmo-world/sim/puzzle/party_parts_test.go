package puzzle_test

import (
	"testing"

	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/puzzle"
)

func TestMachineCountdownPartsParty(t *testing.T) {
	p := puzzles(t)
	s := partySpec(puzzle.BigRewire, 9, 2, 0)
	solo := p.Countdown(s.Family, s.Level, s.Tier, 0)
	var party *puzzle.Part
	parts := p.MachineCountdownParts(s, 0)
	for i := range parts {
		if parts[i].Label == "party" {
			party = &parts[i]
		}
	}
	if party == nil || party.Unit != puzzle.UnitPercent {
		t.Fatalf("no party part in %v", parts)
	}
	if got, want := fixed.PercentPlus(solo, party.Value), p.PartyCountdown(s, 0); got != want {
		t.Errorf("the party part gives %d, the machine's countdown is %d", got, want)
	}
	s.Party, s.Seats = "", 0
	for _, x := range p.MachineCountdownParts(s, 0) {
		if x.Label == "party" {
			t.Errorf("a solo machine has a party part")
		}
	}
}
