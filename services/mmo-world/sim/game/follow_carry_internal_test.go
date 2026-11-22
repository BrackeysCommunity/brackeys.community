package game

import (
	"testing"

	"jams.team/mmo-world/sim/char"
)

func TestFollowerCarriesTheDownedAlong(t *testing.T) {
	g := guardGame(t)
	start := mustCreate(t, g, "start", "knife").C.At
	cs := formParty(t, g, 2, start)
	lead, f := cs[0], cs[1]
	d := mustCreate(t, g, "downed", "knife")
	d.C.At = start
	d.C.Set(char.Down, 0)
	f.Carrying, d.CarriedBy = d.C.ID, f.C.ID
	act(t, g, f, Follow, "")

	dir := -1
	for _, m := range g.Choose(lead).Moves {
		if m.Open {
			dir = m.Dir
			break
		}
	}
	if dir < 0 {
		t.Fatal("the leader cannot move")
	}
	if _, err := g.Act(Command{Key: "lead-step", Char: lead.C.ID, Kind: Step, Dir: dir}); err != nil {
		t.Fatal(err)
	}
	for lead.Long != nil {
		advance(t, g)
	}
	to := start.Neighbour(dir)
	if lead.C.At != to || f.C.At != to {
		t.Fatalf("leader at %v, follower at %v, want %v", lead.C.At, f.C.At, to)
	}
	if d.C.At != f.C.At {
		t.Fatalf("the carried one was left at %v, the follower is at %v", d.C.At, f.C.At)
	}
	if f.Carrying != d.C.ID {
		t.Fatal("the follower set the carried one down away from home")
	}
}
