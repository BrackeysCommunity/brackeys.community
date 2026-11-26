package store_test

import (
	"testing"
	"time"

	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
)

// A world on 24-hour days starts its clock at the UTC midnight before its
// founding, so its day ticks fall at 00:00 UTC (GDD 2.2); a short test tick
// starts at the founding itself.
func TestFoundedAtUTCMidnight(t *testing.T) {
	now := time.Date(2026, 11, 25, 14, 37, 12, 0, time.FixedZone("x", -5*3600))
	at := store.FoundedAt(now, 600)
	if want := time.Date(2026, 11, 25, 0, 0, 0, 0, time.UTC); !at.Equal(want) {
		t.Fatalf("founded at %v, want %v", at, want)
	}
	m := store.Meta{StartedAt: at, TickSeconds: 600}
	if due := m.DueTick(time.Date(2026, 11, 26, 0, 0, 0, 0, time.UTC)); due%sheets.TicksPerDay != 0 {
		t.Fatalf("midnight UTC is tick %d, not a day's tick", due)
	}
	if at := store.FoundedAt(now, 30); !at.Equal(now) {
		t.Fatalf("a short tick founded at %v, want %v", at, now)
	}
}
