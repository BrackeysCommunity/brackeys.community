package world_test

import (
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// Floors clear one by one; a recorded clear-floor still applies, as floor
// 1; falls are kept per floor and counted on the tile; a bad floor is
// refused before anything changes.
func TestFloorActions(t *testing.T) {
	s, log := start(t, "world-floors")
	h := hex.Hex{Q: 5, R: -2}
	by := char.Ref("delver")
	step := func(acts ...world.Action) error {
		_, _, err := world.Advance(s, log, acts, s.Tick+1)
		return err
	}
	if err := step(world.Action{Kind: world.ActClearFloor, Hex: h, By: by, Units: 1}); err != nil {
		t.Fatal(err)
	}
	d := s.Tile(h).Dungeon
	refill := int64(sheets.TicksPerDay)
	if !d.Cleared(1, s.Tick, refill) || d.FloorsCleared != 1 || d.ClearedAt != s.Tick {
		t.Fatalf("clear-floor: %+v", d)
	}
	if err := step(world.Action{Kind: world.ActFloorCleared, Hex: h, By: by, Floor: 3, Way: 2}); err != nil {
		t.Fatal(err)
	}
	if !d.Cleared(3, s.Tick, refill) || d.Cleared(2, s.Tick, refill) || d.Floor(3).Way != 2 || d.FloorsCleared != 3 {
		t.Fatalf("floor 3: %+v", d)
	}
	lost := s.Tile(h).BattlesLost
	if err := step(world.Action{Kind: world.ActFloorFell, Hex: h, By: by, Floor: 2}); err != nil {
		t.Fatal(err)
	}
	if d.Falls(0) != 1 || d.Floor(2).Fell[0].Who != "delver" || s.Tile(h).BattlesLost != lost+1 {
		t.Fatalf("fall: %+v, %d lost", d.Floors, s.Tile(h).BattlesLost)
	}
	before := digest(t, s, log)
	tick := s.Tick
	for _, bad := range []world.Action{
		{Kind: world.ActFloorCleared, Hex: h, By: by},
		{Kind: world.ActFloorCleared, Hex: h, By: by, Floor: 1, Way: 4},
		{Kind: world.ActFloorFell, Hex: h, Floor: 1},
	} {
		if err := step(bad); err == nil {
			t.Fatalf("%+v passed", bad)
		}
	}
	if s.Tick != tick || digest(t, s, log) != before {
		t.Fatal("a refused floor action changed the world")
	}
}
