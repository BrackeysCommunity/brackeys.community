package arc

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/tally"
)

func TestMark(t *testing.T) {
	for _, c := range []struct{ per, active, floor, want int64 }{
		{25, 0, 2, 50},
		{25, 1, 2, 50},
		{25, 2, 2, 50},
		{25, 10, 2, 250},
		{25, 100, 2, 2500},
		{1, 3, 2, 3},
		{25, 1, 1, 25},
	} {
		if got := Mark(c.per, c.active, c.floor); got != c.want {
			t.Errorf("Mark(%d, %d, %d) = %d, want %d", c.per, c.active, c.floor, got, c.want)
		}
	}
}

func TestDefenceMark(t *testing.T) {
	for _, c := range []struct{ per, active, floor, tiers, cut, want int64 }{
		{7, 0, 2, 0, 20, 14},
		{7, 10, 2, 0, 20, 70},
		{7, 10, 2, 1, 20, 56},
		{7, 10, 2, 3, 20, 28},
		{7, 1, 2, 3, 20, 5},  // 14 × 40% = 5.6, rounded down
		{7, 1, 1, 3, 20, 2},  // 7 × 40% = 2.8
		{7, 10, 2, 5, 20, 1}, // the cut takes it all; never below 1
		{7, 10, 2, 9, 20, 1},
		{1, 1, 1, 3, 20, 1},
	} {
		if got := DefenceMark(c.per, c.active, c.floor, c.tiers, c.cut); got != c.want {
			t.Errorf("DefenceMark(%d, %d, %d, %d, %d) = %d, want %d", c.per, c.active, c.floor, c.tiers, c.cut, got, c.want)
		}
	}
}

func TestReward(t *testing.T) {
	for _, c := range []struct{ mark, worth, pay, budget, share, want int64 }{
		{50, 4, 50, 1000, 50, 100},  // 50 × 4 × 50% under 500
		{250, 4, 50, 1000, 50, 500}, // 500 meets the cap
		{250, 4, 50, 600, 50, 300},  // capped at 300
		{50, 1, 50, 0, 50, 0},       // no budget, no escrow
		{3, 1, 50, 1000, 50, 1},     // 1.5 rounds down
	} {
		if got := Reward(c.mark, c.worth, c.pay, c.budget, c.share); got != c.want {
			t.Errorf("Reward(%d, %d, %d, %d, %d) = %d, want %d", c.mark, c.worth, c.pay, c.budget, c.share, got, c.want)
		}
	}
}

func progressOf(kv ...any) tally.Tally {
	var p tally.Tally
	for i := 0; i < len(kv); i += 2 {
		p.Bump(kv[i].(string), int64(kv[i+1].(int)))
	}
	return p
}

func TestSplit(t *testing.T) {
	for _, c := range []struct {
		name          string
		reward, share int64
		mark          int64
		progress      tally.Tally
		pays          []Pay
		back          int64
	}{
		{name: "nobody", reward: 100, share: 50, mark: 50, back: 100},
		{name: "zero counts", reward: 100, share: 50, mark: 50, progress: progressOf("c-1", 0), back: 100},
		{name: "full, even", reward: 100, share: 50, mark: 50, progress: progressOf("c-2", 25, "c-1", 25),
			pays: []Pay{{"c-1", 25}, {"c-2", 25}}, back: 50},
		{name: "half filled", reward: 100, share: 50, mark: 50, progress: progressOf("c-1", 25),
			pays: []Pay{{"c-1", 25}}, back: 75},
		{name: "partial, uneven", reward: 100, share: 50, mark: 50, progress: progressOf("c-1", 10, "c-2", 20),
			pays: []Pay{{"c-1", 10}, {"c-2", 20}}, back: 70},
		{name: "rounding goes back", reward: 100, share: 50, mark: 30, progress: progressOf("c-1", 10, "c-2", 10, "c-3", 10),
			pays: []Pay{{"c-1", 16}, {"c-2", 16}, {"c-3", 16}}, back: 52},
		{name: "over-filled caps at the share", reward: 100, share: 50, mark: 50, progress: progressOf("c-1", 60, "c-2", 40),
			pays: []Pay{{"c-1", 30}, {"c-2", 20}}, back: 50},
		{name: "a crumb is not listed", reward: 10, share: 50, mark: 100, progress: progressOf("c-1", 1, "c-2", 99),
			pays: []Pay{{"c-2", 4}}, back: 6},
		{name: "the whole reward", reward: 90, share: 100, mark: 3, progress: progressOf("c-1", 1, "c-2", 2),
			pays: []Pay{{"c-1", 30}, {"c-2", 60}}, back: 0},
		{name: "no reward", reward: 0, share: 50, mark: 5, progress: progressOf("c-1", 5)},
	} {
		pays, back := Split(c.reward, c.share, c.mark, c.progress)
		if !slices.Equal(pays, c.pays) || back != c.back {
			t.Errorf("%s: pays %v back %d, want %v back %d", c.name, pays, back, c.pays, c.back)
		}
		var paid int64
		for _, p := range pays {
			paid += p.Coin
		}
		if paid+back != max(c.reward, 0) {
			t.Errorf("%s: %d paid and %d back do not add to %d", c.name, paid, back, c.reward)
		}
	}
}

func TestSplitLargeNumbers(t *testing.T) {
	const huge = int64(1) << 60
	pays, back := Split(huge, 50, huge, progressOf("c-1", int(huge/2), "c-2", int(huge/2)))
	if len(pays) != 2 || pays[0].Coin != huge/4 || pays[1].Coin != huge/4 || back != huge/2 {
		t.Fatalf("pays %v back %d", pays, back)
	}
}

// Standing accrues: each new contribution adds worth, and only whole
// points past what was given are handed out.
func TestStanding(t *testing.T) {
	var worth, given int64
	for _, c := range []struct{ add, want int64 }{
		{5, 0}, {10, 0}, {5, 1}, {19, 0}, {1, 1}, {100, 5}, {0, 0},
	} {
		worth += c.add
		got := Standing(worth, given, 20)
		if got != c.want {
			t.Fatalf("after %d worth with %d given: %d, want %d", worth, given, got, c.want)
		}
		given += got
	}
	if given != 7 || worth != 140 {
		t.Fatalf("given %d for %d worth", given, worth)
	}
	if Standing(59, 0, 60) != 0 || Standing(120, 0, 60) != 2 || Standing(120, 3, 60) != 0 {
		t.Fatal("standing against at 60 a point")
	}
	if Standing(100, 0, 0) != 0 {
		t.Fatal("a zero rate gives nothing")
	}
}

func TestRegionSlots(t *testing.T) {
	for _, c := range []struct{ atOnce, per, awake, want int64 }{
		{2, 6, 0, 1},
		{2, 6, 1, 1},
		{2, 6, 5, 1},
		{2, 6, 6, 2},
		{2, 6, 8, 2},
		{2, 6, 9, 3},
		{2, 6, 12, 4},
		{2, 6, 600, 200},
		{3, 0, 50, 3},
	} {
		if got := RegionSlots(c.atOnce, c.per, c.awake); got != c.want {
			t.Errorf("RegionSlots(%d, %d, %d) = %d, want %d", c.atOnce, c.per, c.awake, got, c.want)
		}
	}
}
