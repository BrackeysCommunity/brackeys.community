package world_test

import (
	"testing"

	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/world"
)

// A road rises to the level asked, never falls, and outlives the day's prune.
func TestActRoadOnlyRaises(t *testing.T) {
	s, log := start(t, "world-road")
	h := hex.Hex{Q: 3, R: -2}
	road := func(level int64) {
		t.Helper()
		if _, _, err := world.Advance(s, log, []world.Action{{Kind: world.ActRoad, Hex: h, Units: level}}, s.Tick+1); err != nil {
			t.Fatal(err)
		}
	}
	level := func() int64 {
		if tl := s.Tile(h); tl != nil {
			return tl.Road
		}
		return 0
	}
	road(world.RoadTrack)
	if level() != world.RoadTrack {
		t.Fatalf("road %d after a track", level())
	}
	road(world.RoadPaved)
	road(world.RoadTrack)
	if level() != world.RoadPaved {
		t.Fatalf("road %d: a lower level lowered it", level())
	}
	if err := s.AdvanceDay(log); err != nil {
		t.Fatal(err)
	}
	if level() != world.RoadPaved {
		t.Fatal("the day's prune dropped a road")
	}
	for _, bad := range []int64{0, world.RoadPaved + 1} {
		tick := s.Tick
		if _, _, err := world.Advance(s, log, []world.Action{{Kind: world.ActRoad, Hex: h, Units: bad}}, s.Tick+1); err == nil {
			t.Fatalf("a road of level %d passed", bad)
		}
		if s.Tick != tick || level() != world.RoadPaved {
			t.Fatal("a refused road changed the world")
		}
	}
}
