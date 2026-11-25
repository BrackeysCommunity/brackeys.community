package game

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/item"
)

// A hot staged item is refused at the fence before the den's NPC is saved
// or a fact is written, so the game is exactly as it was.
func TestFenceRefusesAHotStagedItem(t *testing.T) {
	g := guardGame(t)
	c, d := atDen(t, g, "a")
	c.C.Align().Made = true
	if len(c.C.Pack) == 0 {
		t.Fatal("a new character carries no item")
	}
	in := c.C.Pack[0]
	c.C.Equipped = slices.DeleteFunc(c.C.Equipped, func(e char.Equipped) bool { return e.Item == in.ID })
	mark := g.hotMark("npc:x", "", c.C.At, g.Tick())
	in.Hot = &mark
	in.Staged = &item.Stage{At: d.Place, Server: "a"}
	pay := fixed.PercentFloor(g.ItemValue(in), g.syp("back-room-pays"))
	g.Market.Trader[d.Place] = max(pay, 1)

	before, err := g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	facts := g.Log.Len()
	_, err = g.Act(Command{Key: "fence-staged", Char: c.C.ID, Kind: Fence, Item: in.ID})
	refusedCode(t, err, StagedLocal, "fencing a hot staged item")
	if after, _ := g.Digest(); after != before {
		t.Fatal("the refused fence changed the game")
	}
	if g.Log.Len() != facts {
		t.Fatalf("the refused fence left %d facts behind", g.Log.Len()-facts)
	}
}
