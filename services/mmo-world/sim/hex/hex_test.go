package hex_test

import (
	"testing"

	"jams.team/mmo-world/sim/hex"
)

func TestBasics(t *testing.T) {
	if n := len(hex.Ring(hex.Hex{}, 24)); n != 144 {
		t.Fatalf("ring of 24 has %d tiles", n)
	}
	c := hex.Hex{Q: 3, R: -1}
	for _, h := range hex.Ring(c, 5) {
		if hex.Distance(h, c) != 5 {
			t.Fatalf("%v is not 5 steps out", h)
		}
	}
	if n := len(hex.Disc(25)); n != 1951 || hex.DiscSize(25) != 1951 {
		t.Fatalf("disc of 25 has %d tiles", n)
	}
	for d, n := range c.Neighbours() {
		if hex.Distance(c, n) != 1 || c.DirectionTo(n) != d {
			t.Fatalf("neighbour %d of %v is %v", d, c, n)
		}
	}
	line := hex.Line(hex.Hex{}, hex.Hex{Q: 7, R: -3})
	for i := 1; i < len(line); i++ {
		if hex.Distance(line[i-1], line[i]) != 1 {
			t.Fatalf("line skips at %d: %v", i, line)
		}
	}
	h := hex.Hex{Q: 5, R: -2}
	if h.Rotate(6) != h || h.Rotate(3) != h.Scale(-1) || h.Mirror().Mirror() != h || h.Rotate(1).Len() != h.Len() {
		t.Fatal("rotate or mirror is wrong")
	}
	if hex.FloorDiv(-7, 2) != -4 || hex.DivRound(-5, 2) != -3 || hex.DivRound(5, 2) != 3 {
		t.Fatal("division rounds the wrong way")
	}
}

// A wall with one gap: the path goes through the gap, never onto a tile
// the caller does not know, and Reach agrees with its cost.
func TestPathAroundWall(t *testing.T) {
	known := map[hex.Hex]bool{}
	for _, h := range hex.Disc(6) {
		known[h] = true
	}
	wall := map[hex.Hex]bool{}
	for r := int64(-6); r <= 6; r++ {
		if r != 5 {
			wall[hex.Hex{Q: 0, R: r}] = true
		}
	}
	step := func(_, to hex.Hex) (int64, bool) {
		if !known[to] || wall[to] {
			return 0, false
		}
		return 1, true
	}
	a, b := hex.Hex{Q: -3, R: 0}, hex.Hex{Q: 3, R: 0}
	path, cost, ok := hex.Path(a, b, step, 1, 0)
	if !ok || path[0] != a || path[len(path)-1] != b || cost != int64(len(path)-1) {
		t.Fatalf("path %v cost %d ok %v", path, cost, ok)
	}
	through := false
	for i, h := range path {
		if !known[h] || wall[h] {
			t.Fatalf("path steps on %v", h)
		}
		if i > 0 && hex.Distance(path[i-1], h) != 1 {
			t.Fatalf("path jumps at %d", i)
		}
		through = through || h == (hex.Hex{Q: 0, R: 5})
	}
	if !through {
		t.Fatal("path missed the only gap")
	}
	if got := hex.Reach([]hex.Hex{a}, step, 0)[b]; got != cost {
		t.Fatalf("reach says %d, path %d", got, cost)
	}
	again, _, _ := hex.Path(a, b, step, 1, 0)
	if len(again) != len(path) {
		t.Fatal("path is not the same twice")
	}
	for i := range path {
		if again[i] != path[i] {
			t.Fatal("path is not the same twice")
		}
	}
	wall[hex.Hex{Q: 0, R: 5}] = true
	if _, _, ok := hex.Path(a, b, step, 1, 0); ok {
		t.Fatal("found a path through a closed wall")
	}
}

func TestQueueOrder(t *testing.T) {
	q := &hex.Queue{}
	for i, c := range []int64{5, 1, 4, 1, 3} {
		q.Push(hex.Hex{Q: int64(i)}, c)
	}
	last := int64(-1)
	for q.Len() > 0 {
		_, c := q.Pop()
		if c < last {
			t.Fatal("queue popped out of order")
		}
		last = c
	}
}

func TestDiscOffsetWalksTheDisc(t *testing.T) {
	for r := range int64(6) {
		for k, h := range hex.Disc(r) {
			if got := hex.DiscOffset(r, int64(k)); got != h {
				t.Fatalf("radius %d, tile %d: %v, want %v", r, k, got, h)
			}
		}
	}
}
