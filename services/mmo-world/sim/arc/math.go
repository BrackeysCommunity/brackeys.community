package arc

import (
	"math/bits"

	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/tally"
)

// Mark is a side's mark: per unit for each active character, never fewer
// characters than the floor, so an unattended side cannot be met at 0.
func Mark(per, active, floor int64) int64 {
	return per * max(active, floor)
}

// DefenceMark is a raid's mark after the wall's cut (wall tiers × cut
// percent off), at least 1 (GDD 12.10).
func DefenceMark(per, active, floor, tiers, cut int64) int64 {
	left := max(fixed.Hundredths-max(tiers, 0)*max(cut, 0), 0)
	return max(fixed.PercentFloor(Mark(per, active, floor), left), 1)
}

// Reward is a side's escrow: mark × worth × pay%, capped at share% of
// budget, so a side never mints past the places' day budgets (GDD 10.2).
func Reward(mark, worth, pay, budget, share int64) int64 {
	want := fixed.PercentFloor(max(mark, 0)*max(worth, 0), pay)
	return max(min(want, fixed.PercentFloor(max(budget, 0), share)), 0)
}

// Pay is one contributor's coin from a side.
type Pay struct {
	Who  string
	Coin int64
}

// Split pays share% of reward × min(1, filled/mark) by contribution, sorted by
// who; back is what returns to the sponsor's sink. Rounding goes back, and a
// contributor whose part rounds to nothing is not listed.
func Split(reward, share, mark int64, progress tally.Tally) (pays []Pay, back int64) {
	reward = max(reward, 0)
	var filled int64
	for _, c := range progress {
		if c.N > 0 {
			filled += c.N
		}
	}
	if filled == 0 {
		return nil, reward
	}
	pot := fixed.PercentFloor(reward, min(max(share, 0), fixed.Hundredths))
	if mark > 0 && filled < mark {
		pot = mulDiv(pot, filled, mark)
	}
	paid := int64(0)
	for _, c := range progress {
		if c.N <= 0 {
			continue
		}
		coin := mulDiv(pot, c.N, filled)
		if coin == 0 {
			continue
		}
		pays = append(pays, Pay{Who: c.Key, Coin: coin})
		paid += coin
	}
	return pays, reward - paid
}

// mulDiv is floor(a × b / d) for non-negative a, b and positive d whose
// quotient fits, without overflowing the product.
func mulDiv(a, b, d int64) int64 {
	hi, lo := bits.Mul64(uint64(a), uint64(b))
	q, _ := bits.Div64(hi, lo, uint64(d))
	return int64(q)
}

// Standing turns accrued coin's worth into whole standing past what was
// given: one point per per of worth, never negative.
func Standing(worth, given, per int64) int64 {
	if per <= 0 {
		return 0
	}
	return max(max(worth, 0)/per-given, 0)
}

// RegionSlots is how many region arcs run at once: atOnce per perRegions
// awake regions, rounded down, and always at least one.
func RegionSlots(atOnce, perRegions, awake int64) int64 {
	if perRegions <= 0 {
		return max(atOnce, 1)
	}
	return max(max(awake, 0)*atOnce/perRegions, 1)
}
