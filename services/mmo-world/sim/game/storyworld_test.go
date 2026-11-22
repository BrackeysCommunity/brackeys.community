package game

import (
	"testing"

	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

// A faction's city reads as a city to the story's predicates.
func TestFactionCityReadsAsCity(t *testing.T) {
	g := storyGame(t)
	faction := 0
	n := len(g.Places)
	g.Places = append(g.Places, &Place{N: n, Hex: hex.Ring(g.SettlementHex(0), 6)[0], Lattice: factionLattice, Name: "Factionhold", Founded: g.Tick(), Faction: &faction})
	if g.Places[n].City != nil {
		t.Fatal("the test place should stand as a faction city, not a guild city")
	}
	places := g.storyView().Places()
	if !places[n].City {
		t.Error("a faction city reads as a plain settlement to the story")
	}
	if places[0].City != g.isCity(0) {
		t.Error("a settlement's city flag disagrees with isCity")
	}
}

// TestBountyHeldAllDay: a bounty posted at the day tick holds its reward
// from the day budget all that day, and not past the next day tick.
func TestBountyHeldAllDay(t *testing.T) {
	g := storyGame(t)
	day := g.Tick()/sheets.TicksPerDay + 1
	g.World.Tick = day * sheets.TicksPerDay
	const reward = 7
	g.Goals = []*Goal{{ID: "g-review-bounty", Board: 0, Issuer: goal.Ref{Kind: goal.ByFaction, ID: "0"}, State: goal.Live,
		Cond: goal.Condition{Verb: goal.Reach, Count: 1}, Reward: reward, Posted: g.Tick()}}
	if got := g.bountyHeld(0); got != reward {
		t.Fatalf("at the posting tick bountyHeld holds %d, want %d", got, reward)
	}
	g.World.Tick += 3
	if got := g.bountyHeld(0); got != reward {
		t.Errorf("later the same day bountyHeld holds %d, want %d", got, reward)
	}
	g.World.Tick = (day + 1) * sheets.TicksPerDay
	if got := g.bountyHeld(0); got != 0 {
		t.Errorf("after the next day tick bountyHeld still holds %d of it", got)
	}
}

// TestBountyHeldOnceMet: a bounty met mid-day still holds its reward from
// the day budget for a stage started later that day.
func TestBountyHeldOnceMet(t *testing.T) {
	g := storyGame(t)
	g.World.Tick = (g.Tick()/sheets.TicksPerDay + 1) * sheets.TicksPerDay
	const reward = 7
	x := &Goal{ID: "g-review-bounty", Board: 0, Issuer: goal.Ref{Kind: goal.ByFaction, ID: "0"}, State: goal.Live,
		Cond: goal.Condition{Verb: goal.Reach, Count: 1}, Reward: reward, Posted: g.Tick()}
	g.Goals = []*Goal{x}
	x.State = goal.Done
	g.World.Tick += 3
	if got := g.bountyHeld(0); got != reward {
		t.Errorf("a bounty met earlier today holds %d, want %d", got, reward)
	}
	if g.bountyOpen(0) {
		t.Error("a met bounty still shows as open")
	}
}
