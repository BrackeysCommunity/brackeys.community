package tile

import (
	"encoding/json"
	"testing"
)

func TestPlanFloorsInOrder(t *testing.T) {
	var p Plan
	for _, f := range []FloorDraw{{N: 3, Way: 2}, {N: 2, Way: 1}, {N: 3, Way: 0}, {N: 2, Way: 0}, {N: 1, Way: -1}} {
		p.SetFloor(f)
	}
	p.SetFloor(FloorDraw{N: 2, Way: 1, Beats: 9})
	want := [][2]int64{{1, -1}, {2, 0}, {2, 1}, {3, 0}, {3, 2}}
	if len(p.Drawn) != len(want) {
		t.Fatalf("drawn %+v", p.Drawn)
	}
	for i, w := range want {
		if p.Drawn[i].N != w[0] || p.Drawn[i].Way != w[1] {
			t.Fatalf("drawn out of order: %+v", p.Drawn)
		}
	}
	if f, ok := p.Floor(2, 1); !ok || f.Beats != 9 {
		t.Fatalf("a redrawn floor: %+v %v", f, ok)
	}
	if _, ok := p.Floor(3, 1); ok {
		t.Fatal("a floor never reached reads as stored")
	}

	p.SetWays(Ways{N: 2, Way: [WaysPerFork]Way{{Fork: "b"}}})
	p.SetWays(Ways{N: 1, Way: [WaysPerFork]Way{{Fork: "a"}}})
	if w, ok := p.WaysOf(2); !ok || w[0].Fork != "b" || p.Ways[0].N != 1 {
		t.Fatalf("ways: %+v", p.Ways)
	}
	if _, ok := p.WaysOf(3); ok {
		t.Fatal("ways never drawn read as stored")
	}
}

func TestContentKeepsTileStored(t *testing.T) {
	s := State{Content: &Content{Drawn: 1, Native: true}}
	if s.Empty() {
		t.Fatal("a tile holding content reads as empty")
	}
	if !(Fix{}).Empty() || (Fix{Floors: 4}).Empty() {
		t.Fatal("Fix.Empty")
	}
}

// A fix or content without ground encodes as it did before ground pins.
func TestGroundOmitted(t *testing.T) {
	for _, v := range []any{Fix{Site: "site"}, Content{Drawn: 3, Pin: "pin-1"}} {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		var m map[string]any
		if err := json.Unmarshal(b, &m); err != nil {
			t.Fatal(err)
		}
		if _, ok := m["ground"]; ok {
			t.Fatalf("%s carries ground", b)
		}
	}
	f := Fix{Ground: &GroundFix{Terrain: "forest", Ring: true}}
	if f.Empty() {
		t.Fatal("a ground fix reads as empty")
	}
	b, err := json.Marshal(Content{Ground: &GroundFix{Terrain: "forest"}})
	if err != nil {
		t.Fatal(err)
	}
	if want := `{"drawn":0,"ground":{"terrain":"forest"}}`; string(b) != want {
		t.Fatalf("content ground encodes as %s, not %s", b, want)
	}
}
