package tile

import "testing"

func TestDecay(t *testing.T) {
	for _, c := range []struct{ v, pct, want int64 }{
		{1, 1, 0},
		{1, 10, 0},
		{50, 100, 0},
		{50, 0, 50},
		{0, 10, 0},
		{-3, 10, -3},
		{100, 10, 90},
		{99, 10, 89},
	} {
		if got := decay(c.v, c.pct); got != c.want {
			t.Errorf("decay(%d, %d) = %d, want %d", c.v, c.pct, got, c.want)
		}
	}
}

func TestDecayReachesZero(t *testing.T) {
	v := int64(1_000_000)
	for step := 0; v > 0; step++ {
		if step > 2000 {
			t.Fatalf("decay at 1%% still at %d after %d steps", v, step)
		}
		v = decay(v, 1)
	}
}
