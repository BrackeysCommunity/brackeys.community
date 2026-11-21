package game

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
)

// A key counts for the third way only while its holder is among the
// pushers: if the holder leaves, the others do not go down for free.
func TestForkThirdWayNeedsAKeyAtTheVote(t *testing.T) {
	g := guardGame(t)
	h, _ := dungeonFor(t, g, "", 3)
	cs := formParty(t, g, 3, h)
	sh := toFork(t, g, cs)
	if slices.Contains(sh.Fork.Open, gen.WayHidden) {
		t.Skip("the third way stands open at this fork")
	}
	cs[0].Keys = []string{h.Ref()}
	act(t, g, cs[1], DungeonPush, WayOption(gen.WayHidden))
	act(t, g, cs[2], DungeonPush, WayOption(gen.WayHidden))
	act(t, g, cs[0], DungeonLeave, "")
	if len(cs[0].Keys) != 1 {
		t.Fatal("the holder who left lost its key")
	}
	for _, c := range cs[1:] {
		if c.Delving == nil || c.Delving.Way != gen.WayOpen {
			t.Fatalf("%s went down way %+v, want the open way", c.C.ID, c.Delving)
		}
	}
}

func TestForkVoteHiddenCountsOnlyWhenAllowed(t *testing.T) {
	present := []*Char{{C: char.New("a", hex.Hex{})}, {C: char.New("b", hex.Hex{})}}
	f := &ForkState{Choices: []Choice{{Who: "a", Push: true, Way: gen.WayHidden}, {Who: "b"}}}
	if way, push, _ := forkVote(f, present, "a", false); way != gen.WayOpen || len(push) != 1 {
		t.Fatalf("unallowed third way: way %d, %d pushers", way, len(push))
	}
	if way, _, _ := forkVote(f, present, "a", true); way != gen.WayHidden {
		t.Fatalf("allowed third way: way %d", way)
	}
}
