package game

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/fact"
)

// TestStampWithoutEmergence: a world without emergence still stamps a
// server's staging with that server, and stamps nothing a plain command
// writes afterwards.
func TestStampWithoutEmergence(t *testing.T) {
	g, c, home := houseGame(t)
	g.Emergence = nil
	g.wireEmergence()
	at := stageTile(t, g, home)
	mustAct(t, g, stageOrder("s1", c, "a", true, false, StageCmd{Template: "drop-small", Settlement: home, At: at}))
	facts := g.Log.Since(0)
	i := slices.IndexFunc(facts, func(f fact.Fact) bool { return f.Kind == factStagedOpened })
	if i < 0 {
		t.Fatal("no staged.opened fact")
	}
	if s := StampedServer(facts[i]); s != "a" {
		t.Fatalf("staged.opened is stamped by %q, want a", s)
	}
	n := fact.ID(g.Log.Len())
	mustAct(t, g, Command{Key: "b2", Kind: Create, Server: "b", Note: "Cedar"})
	after := g.Log.Since(n)
	if len(after) == 0 {
		t.Fatal("the plain command wrote no fact")
	}
	for _, f := range after {
		if f.StagedBy != nil {
			t.Fatalf("%s from a plain command is stamped %v", f.Kind, f.StagedBy)
		}
	}
}
