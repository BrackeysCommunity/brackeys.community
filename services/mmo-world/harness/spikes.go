package harness

import (
	"jams.team/mmo-world/sim/sheets"
)

// Run is a harness run or spike: it writes its raw output under out and
// returns its readings (a spike has none).
type Run func(b *sheets.Book, out string, n int) ([]Measured, error)

// Runs are the harness runs and spikes by name.
var Runs = map[string]Run{
	"world":    WorldRun,
	"craft":    CraftRun,
	"battle":   BattleRun,
	"social":   SocialRun,
	"economy":  EconomyRun,
	"puzzles":  PuzzlesRun,
	"activity": ActivityRun,
	"spike-a":  spike(spikeA),
	"spike-b":  spike(spikeB),
	"spike-e":  spike(spikeE),
}

func spike(f func(*sheets.Book, string, int) error) Run {
	return func(b *sheets.Book, out string, n int) ([]Measured, error) { return nil, f(b, out, n) }
}
