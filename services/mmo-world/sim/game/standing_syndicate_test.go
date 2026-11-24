package game

import (
	"testing"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/npc"
)

// A choice that takes a made character under 0 with a fence unmakes it.
func TestFenceChoiceUnmakes(t *testing.T) {
	g := storyGame(t)
	c := mustCreate(t, g, "threat", "knife")
	d, ok := g.DenAt(c.C.At)
	if !ok {
		t.Fatal("no den where characters start")
	}
	makeMade(c)
	if err := g.addSyndicateStanding(c, 1, 0, g.Tick()); err != nil {
		t.Fatal(err)
	}
	fence := topicMeet(t, g, c, d.Fence)
	g.r.NPC.Remember(fence, npc.Entry{Kind: entryWronged, Player: c.C.ID, Weight: 60, Tick: g.Tick()}, g.Tick())
	if _, ok := topicOffered(g, c, fence, "grudge"); !ok {
		t.Fatal("a wronged fence raises no grudge")
	}
	if _, err := g.Act(Command{Key: "threaten", Char: c.C.ID, Kind: Choose, NPC: fence.Stub.ID, Option: "grudge/threaten"}); err != nil {
		t.Fatal(err)
	}
	if char.IsMade(c.C) || len(factsOf(g, factUnmade)) != 1 {
		t.Fatalf("under 0 with the syndicate: made %v, %d unmade facts", char.IsMade(c.C), len(factsOf(g, factUnmade)))
	}
	audit(t, g)
}

// Standing raised to the gate at a fence queues the invitation.
func TestFenceStandingQueuesTheInvitation(t *testing.T) {
	g := guardGame(t)
	c, d := atDen(t, g, "raised")
	c.C.Align().Value = -15
	n := g.NPCs.Get(d.Fence)
	if n == nil {
		talkTo(t, g, c, d.Fence)
		n = g.NPCs.Get(d.Fence)
	}
	met, err := g.npcFact(c, n, "npc.met", g.Tick())
	if err != nil {
		t.Fatal(err)
	}
	if err := g.standing(c, n, g.r.Story.Gate-c.C.Standing.Get(syndicateKey), met.ID, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if ps := pendingOf(g, c, arc.PendInvite); len(ps) != 1 {
		t.Fatalf("the invitation pending %+v", ps)
	}
}
