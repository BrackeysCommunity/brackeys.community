package fight

import (
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/item"
)

// Within gives an item xp through add under a staged xp allowance (GDD
// 14.5): as much of xp as left still allows, the item's stamp counted as
// AddXP counts it, and left spent only by what the item took. A nil left
// is no allowance, and add takes xp whole.
func Within(left *int64, in *item.Instance, xp int64, add func(xp int64)) {
	if left == nil {
		add(xp)
		return
	}
	x := allowed(xp, in.Stamp, *left)
	level, was := in.Level, in.XP
	add(x)
	if in.Level != level || in.XP != was {
		*left -= stamped(x, in.Stamp)
	}
}

// stamped is xp with an item's stamp, as AddXP adds it.
func stamped(xp, stamp int64) int64 { return xp + xp*stamp/fixed.Hundredths }

// allowed is the most of xp whose stamped worth fits in left.
func allowed(xp, stamp, left int64) int64 {
	if left <= 0 || xp <= 0 {
		return 0
	}
	if stamped(xp, stamp) <= left {
		return xp
	}
	x := min(xp, left)
	if d := fixed.Hundredths + stamp; d > 0 {
		x = min(xp, left*fixed.Hundredths/d)
	}
	for x < xp && stamped(x+1, stamp) <= left {
		x++
	}
	for x > 0 && stamped(x, stamp) > left {
		x--
	}
	return x
}
