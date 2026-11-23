package agent

import (
	"testing"

	"jams.team/mmo-world/api"
)

func TestEarnerChoosesTheSideItCanServe(t *testing.T) {
	e := &Earner{Role: Gatherer, Back: testBacker()}
	stage := []api.SideOption{
		{Goal: "g-1", Arc: "arc-1", Side: "keep-watch", Wants: "goods", Tag: "timber", Left: 100},
		{Goal: "g-2", Arc: "arc-1", Side: "hunt", Wants: "beats", Left: 100},
	}
	p := api.Purse{Market: true, Goods: []api.Goods{{Material: "timber", Units: 9}}}
	if got := e.choose(p, stage); got != "g-1" {
		t.Fatalf("carrying timber it chose %q, want the timber side", got)
	}
	p.Goods = nil
	if got := e.choose(p, stage); got != "g-2" {
		t.Fatalf("with nothing to give it chose %q, want the beats side", got)
	}
	// A side ahead draws the backers who can serve it.
	stage[0].Left = 40
	p.Goods = []api.Goods{{Material: "timber", Units: 2}}
	if got := e.choose(p, stage); got != "g-1" {
		t.Fatalf("with the timber side ahead it chose %q", got)
	}
	stage[0].Left, stage[1].Left = 100, 40
	if got := e.choose(p, stage); got != "g-2" {
		t.Fatalf("with the hunt ahead it chose %q", got)
	}
	// Away from a market it reads no board and chooses nothing yet.
	p.Market = false
	if got := e.choose(p, stage); got != "" {
		t.Fatalf("away from a market it chose %q", got)
	}
}
