package service

import (
	"testing"

	"jams.team/mmo-world/api"
)

// TestTickRingWraps fills the ring past its size: it keeps the latest
// timings, oldest first.
func TestTickRingWraps(t *testing.T) {
	var r tickRing
	if got := r.after(-1); got == nil || len(got) != 0 {
		t.Fatalf("an empty ring reads %+v", got)
	}
	last := int64(tickRingSize + 10)
	for tick := int64(1); tick <= last; tick++ {
		r.add(api.TickTime{Tick: tick, StepMs: tick})
	}
	got := r.after(-1)
	if len(got) != tickRingSize || got[0].Tick != last-tickRingSize+1 || got[len(got)-1].Tick != last {
		t.Fatalf("the ring holds %d from %d to %d", len(got), got[0].Tick, got[len(got)-1].Tick)
	}
	if tail := r.after(last - 3); len(tail) != 3 || tail[0].Tick != last-2 {
		t.Fatalf("after %d: %+v", last-3, tail)
	}
}
