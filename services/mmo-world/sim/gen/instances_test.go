package gen_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
)

// TestOriginInstances: the ring of eight is eight relays round the origin
// at the ring's size, and the triangle's three pylons and vault sit on
// its centre off the origin.
func TestOriginInstances(t *testing.T) {
	b := book(t)
	g := newGen(t, b, "instances")
	ring, ok := g.OriginInstance("ring-of-eight")
	if !ok || ring.Centre != (gen.Hex{}) || len(ring.Points) != 8 {
		t.Fatalf("ring %+v", ring)
	}
	for _, p := range ring.Points {
		if p.Place != "relay" || hex.Distance(p.Hex, gen.Hex{}) != 24 || p.Instance != ring.ID {
			t.Fatalf("ring point %+v", p)
		}
	}
	tri, ok := g.OriginInstance("triangle-of-pylons")
	if !ok || len(tri.Points) != 4 || hex.Distance(tri.Centre, gen.Hex{}) != 40 {
		t.Fatalf("triangle %+v", tri)
	}
	var places []string
	for _, p := range tri.Points {
		places = append(places, p.Place)
		if p.Place == "vault" && p.Hex != tri.Centre {
			t.Fatalf("the vault %v is off the centre %v", p.Hex, tri.Centre)
		}
	}
	if !slices.Equal(places, []string{"pylon", "pylon", "pylon", "vault"}) {
		t.Fatalf("triangle places %v", places)
	}
	if _, ok := g.OriginInstance("frontier-line"); ok {
		t.Fatal("a frontier rule has an origin instance")
	}
	if _, ok := g.OriginInstance("no-such-rule"); ok {
		t.Fatal("a missing rule has an instance")
	}
	tri.Points[0].Hex = gen.Hex{Q: 999}
	if again, _ := g.OriginInstance("triangle-of-pylons"); again.Points[0].Hex == tri.Points[0].Hex {
		t.Fatal("an instance hands out the generator's own points")
	}
}

// TestInstanceOfAChunkPoint: every point a chunk holds is a point of the
// instance it names, and stands.
func TestInstanceOfAChunkPoint(t *testing.T) {
	g := newGen(t, book(t), "instances")
	seen := 0
	for _, cc := range []gen.ChunkCoord{g.ChunkOf(gen.Hex{}), g.ChunkOf(gen.Hex{Q: 24}), g.ChunkOf(gen.Hex{Q: -24, R: 24})} {
		for _, p := range g.Patterns(cc) {
			in, ok := g.InstanceOf(p)
			if !ok || in.Rule != p.Rule || in.Centre != p.Centre || !slices.Contains(in.Points, p) || !g.Standing(p) {
				t.Fatalf("point %+v: instance %+v %v", p, in, ok)
			}
			seen++
		}
	}
	if seen == 0 {
		t.Fatal("no pattern points near the origin")
	}
	ring, _ := g.OriginInstance("ring-of-eight")
	moved := ring.Points[0]
	moved.Hex = moved.Hex.Add(gen.Hex{Q: 1})
	if g.Standing(moved) {
		t.Fatal("a point off its tile stands")
	}
}

// TestInstancesLeaveTheScaffold: reading instances first changes no
// chunk's points.
func TestInstancesLeaveTheScaffold(t *testing.T) {
	b := book(t)
	read, fresh := newGen(t, b, "instances"), newGen(t, b, "instances")
	for _, rule := range b.Patterns {
		read.OriginInstance(rule.ID)
		read.Instances(rule.ID, gen.Hex{Q: 30, R: -10}, 60)
	}
	for _, h := range []gen.Hex{{}, {Q: 24}, {Q: 40, R: -20}, {Q: -60, R: 30}} {
		cc := read.ChunkOf(h)
		if !slices.Equal(read.Patterns(cc), fresh.Patterns(cc)) {
			t.Fatalf("chunk %v differs after reading instances", cc)
		}
	}
}
