package tile

import (
	"encoding/json"
	"testing"
)

// A save from before floors were recorded reads its floor 1 as before:
// cleared until the refill, and carried over when a deeper floor clears.
func TestOldDungeonLoads(t *testing.T) {
	var s State
	if err := json.Unmarshal([]byte(`{"hex":{"Q":3,"R":-1},"passage":[0,0,0,0,0,0],"fire":{},"dungeon":{"floorsCleared":1,"clearedAt":500,"guardianHealth":0}}`), &s); err != nil {
		t.Fatal(err)
	}
	d := s.Dungeon
	if d == nil || !d.Cleared(1, 500+99, 100) || d.Cleared(1, 500+100, 100) || d.Cleared(2, 510, 100) {
		t.Fatalf("old floor 1 read as %+v", d)
	}
	out, err := json.Marshal(d)
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != `{"floorsCleared":1,"clearedAt":500,"guardianHealth":0}` {
		t.Fatalf("an old dungeon writes back as %s", out)
	}
	d.Clear(2, 1, 520)
	if !d.Cleared(1, 550, 100) || !d.Cleared(2, 550, 100) || d.FloorsCleared != 2 || d.ClearedAt != 520 {
		t.Fatalf("after floor 2: %+v", d)
	}
	if d.Floor(2).Way != 1 || d.Floor(1).Way != 0 {
		t.Fatalf("ways %+v", d.Floors)
	}
	d.Clear(1, 0, 530)
	if d.FloorsCleared != 2 || d.ClearedAt != 520 || d.Floor(1).ClearedAt != 530 {
		t.Fatalf("a shallower clear moved the deepest: %+v", d)
	}
	var none *Dungeon
	if none.Cleared(1, 0, 100) || none.Falls(0) != 0 || none.Floor(1) != nil {
		t.Fatal("no dungeon reads as something")
	}
}

// Falls count across floors from a tick, and old ones are forgotten.
func TestFalls(t *testing.T) {
	d := &Dungeon{}
	d.Fall(3, "a", 10, 100)
	d.Fall(1, "b", 50, 100)
	d.Fall(3, "c", 60, 100)
	if d.Falls(0) != 3 || d.Falls(50) != 2 || d.Falls(61) != 0 || len(d.Floors) != 3 {
		t.Fatalf("falls %+v", d.Floors)
	}
	d.Fall(2, "d", 120, 100)
	if d.Falls(0) != 3 || len(d.Floor(3).Fell) != 1 || d.Floor(3).Fell[0].Who != "c" {
		t.Fatalf("the fall at 10 is still kept: %+v", d.Floors)
	}
	if d.FloorsCleared != 0 || d.Cleared(1, 120, 100) {
		t.Fatal("a fall cleared a floor")
	}
}
