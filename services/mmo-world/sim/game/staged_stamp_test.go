package game

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/world"
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
	for _, f := range facts[i:] {
		if s := StampedServer(f); s != "a" {
			t.Fatalf("%s from the staging is stamped by %q, want a", f.Kind, s)
		}
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

// TestPinStampWithoutEmergence: a world without emergence stamps every
// fact a staff house pin writes with its server.
func TestPinStampWithoutEmergence(t *testing.T) {
	g, c, home := houseGame(t)
	g.Emergence = nil
	g.wireEmergence()
	gd := g.ServerGuild("a")
	region := g.r.Gen.RegionOf(g.SettlementHex(home))
	by := world.PinBy{Role: world.PinStaff, Server: "a", Char: c.C.ID, Label: gd.G.Name, Region: &region}
	lead := func(h hex.Hex) tile.Fix {
		a := g.r.Gen.Archetypes(h)
		if len(a) == 0 {
			return tile.Fix{}
		}
		return tile.Fix{Lead: a[len(a)-1]}
	}
	var at *hex.Hex
	for r := int64(1); r <= 40 && at == nil; r++ {
		for _, h := range hex.Ring(g.SettlementHex(home), r) {
			if f := lead(h); !f.Empty() && g.World.CheckPin(h, 1, f, by, false) == nil {
				at = &h
				break
			}
		}
	}
	if at == nil {
		t.Fatal("found no tile a pin may stand on")
	}
	n := fact.ID(g.Log.Len())
	mustAct(t, g, Command{Key: "p1", Char: c.C.ID, Kind: HousePin, Server: "a", Staff: true, Pin: &PinCmd{At: *at, Reach: 1, Fix: lead(*at)}})
	written := g.Log.Since(n)
	if len(written) == 0 {
		t.Fatal("the pin wrote no fact")
	}
	for _, f := range written {
		if s := StampedServer(f); s != "a" {
			t.Fatalf("%s from the pin is stamped by %q, want a", f.Kind, s)
		}
	}
}
