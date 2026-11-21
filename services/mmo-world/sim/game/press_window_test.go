package game_test

import (
	"testing"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/game"
)

// A plain press on a shared encounter is a party pick, so the service
// must stamp it: without a clock the window never opens.
func TestPressOpensThePartyWindow(t *testing.T) {
	if !game.Timed(game.Press) {
		t.Fatal("press is not stamped with the service clock")
	}
	p := newPartyGame(t)
	cs := testkit.Party(t, p.g, 2)
	sh := testkit.PartyMachineBeat(t, p.g, cs, "rewire", 2)
	p.act(cs[0], game.Command{Kind: game.Press, Option: nonMachine(t, p.g, cs[0]), Now: 1000})
	if sh.Opened != 1000 {
		t.Fatalf("the first press opened the window at %d", sh.Opened)
	}
	res := p.act(cs[0], game.Command{Kind: game.PartyWindow, Target: sh.ID, Now: 1000 + p.g.PartyWindowMs()})
	if len(res.Pressed) != 2 {
		t.Fatalf("the window resolved the beat for %d", len(res.Pressed))
	}
}
