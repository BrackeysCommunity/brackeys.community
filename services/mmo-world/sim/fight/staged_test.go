package fight

import (
	"testing"

	"jams.team/mmo-world/sim/item"
)

// TestWithin: an allowance lets through the most xp whose stamped worth
// fits, spends what the item took and nothing when it took none, and no
// allowance leaves xp whole.
func TestWithin(t *testing.T) {
	cases := []struct {
		stamp, xp, left, given, after int64
		capped                        bool
	}{
		{0, 30, 150, 30, 120, false},
		{0, 30, 20, 20, 0, false},
		{0, 30, 0, 0, 0, false},
		{50, 30, 150, 30, 105, false},
		{50, 30, 20, 13, 1, false},
		{10, 45, 7, 7, 0, false},
		{0, 30, 150, 30, 150, true},
	}
	for i, c := range cases {
		in := &item.Instance{ID: "it", Stamp: c.stamp}
		left := c.left
		var given int64
		Within(&left, in, c.xp, func(xp int64) {
			given = xp
			if !c.capped {
				in.XP += stamped(xp, in.Stamp)
			}
		})
		if given != c.given || left != c.after {
			t.Fatalf("case %d: gave %d leaving %d, want %d leaving %d", i, given, left, c.given, c.after)
		}
		if stamped(given, c.stamp) > c.left {
			t.Fatalf("case %d: %d stamped is past the allowance %d", i, stamped(given, c.stamp), c.left)
		}
	}
	in := &item.Instance{ID: "it"}
	var given int64
	Within(nil, in, 45, func(xp int64) { given = xp })
	if given != 45 {
		t.Fatalf("no allowance gave %d of 45", given)
	}
}
