package mapview_test

import (
	"testing"

	"jams.team/mmo-world/sim/hex"
)

func TestRegionRows(t *testing.T) {
	m := newBaseWorld(t)
	// A tile a short gap east of the disc on home's row joins the disc's
	// run; the lone tile far off starts its own.
	near := m.home.Add(hex.Direction(0).Scale(baseDisc + 3))
	m.discover(t, near)
	b := m.build()
	var runs []int
	for i, row := range b.Regions.Rows {
		if row.R == m.home.R {
			runs = append(runs, i)
		}
		if i > 0 {
			prev := b.Regions.Rows[i-1]
			if prev.R > row.R || prev.R == row.R && prev.Q+int64(len(prev.Slots)) >= row.Q {
				t.Fatalf("rows out of order or overlapping: %+v then %+v", prev, row)
			}
		}
	}
	if len(runs) != 2 {
		t.Fatalf("home's row has %d runs, want 2", len(runs))
	}
	first, second := b.Regions.Rows[runs[0]], b.Regions.Rows[runs[1]]
	west := m.home.Q - baseDisc
	if first.Q != west || first.Q+int64(len(first.Slots))-1 != near.Q {
		t.Fatalf("the disc's run spans %d to %d, want %d to %d", first.Q, first.Q+int64(len(first.Slots))-1, west, near.Q)
	}
	for q := m.home.Q + baseDisc + 1; q < near.Q; q++ {
		if s := first.Slots[q-first.Q]; s != -1 {
			t.Fatalf("gap tile %d holds slot %d", q, s)
		}
	}
	if second.Q != m.lone.Q || len(second.Slots) != 1 {
		t.Fatalf("the lone tile's run: %+v", second)
	}

	for _, r := range b.Regions.Regions {
		if r.Name == "" || r.Terrain == "" {
			t.Fatalf("region %s has no name or biome", r.Ref)
		}
	}
}
