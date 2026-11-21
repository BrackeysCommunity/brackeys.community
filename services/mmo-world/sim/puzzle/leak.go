package puzzle

import (
	"slices"

	"jams.team/mmo-world/sim/fixed"
)

// Leak: tap each leak shut as it springs, before the gauge runs dry. A
// leak that needs more than one tap is clamped by a tap, then slips open
// again. Size is the slots along the pipe. Par is the gauge when full,
// what each open slot drains a step, and what a tap on a dry slot costs.
// Track is each leak's step, slot, taps and the steps a clamp holds.
const Leak = "leak"

func init() { register(Leak, leak{}) }

const (
	lkGauge = iota
	lkDrain
	lkMiss
)

const (
	lkAt = iota
	lkSlot
	lkTaps
	lkHold
	lkRow
)

// structural: Solve's hand reaches a leak 6 steps after it opens.
const leakReach = 6

type leak struct{}

func (leak) Keys() []string {
	return []string{"gauge", "drain", "miss", "gap", "taps", "slip", "rest", "window"}
}

func (leak) Lay(l *Layout, k Kit) {
	l.Par = []int64{k.Tune("gauge"), k.Tune("drain"), k.Tune("miss")}
	gap, taps := max(1, k.Tune("gap")), max(1, k.Tune("taps"))
	slip, rest := k.Tune("slip"), k.Tune("rest")
	closes := fixed.PercentFloor(k.Steps, k.Tune("window"))
	free := make([]int64, l.Size) // the step each slot can leak again
	t := gap
	for i := range l.Decoys {
		t = max(t, slices.Min(free))
		// The first leak always springs, or there would be no machine.
		if i > 0 && t >= closes {
			break
		}
		var open []int64
		for s, at := range free {
			if at <= t {
				open = append(open, int64(s))
			}
		}
		slot, n := open[k.below(int64(len(open)))], 1+k.below(taps)
		l.Track = append(l.Track, t, slot, n, slip)
		free[slot] = t + n*(slip+rest)
		t += gap/halves + k.below(gap)
	}
}

type leakPlay struct {
	clock
	l     *Layout
	gauge int64
	next  int     // leaks sprung
	left  []int64 // taps each slot still needs; 0 is dry
	until []int64 // the step a slot's clamp slips; 0 is not clamped
	hold  []int64
}

func (leak) Start(l *Layout) Play {
	return &leakPlay{clock: newClock(l), l: l, gauge: l.Par[lkGauge],
		left: make([]int64, l.Size), until: make([]int64, l.Size), hold: make([]int64, l.Size)}
}

func (p *leakPlay) Run(at int64) (Status, int64) { return p.run(at, p.tick) }

func (p *leakPlay) open(slot int64) bool { return p.left[slot] > 0 && p.until[slot] == 0 }

func (p *leakPlay) tick(k int64) Status {
	t := p.l.Track
	for ; p.next*lkRow < len(t) && t[p.next*lkRow+lkAt] <= k; p.next++ {
		row := t[p.next*lkRow:]
		p.left[row[lkSlot]], p.hold[row[lkSlot]], p.until[row[lkSlot]] = row[lkTaps], row[lkHold], 0
	}
	var open, wet int64
	for s := range p.l.Size {
		if p.until[s] > 0 && p.until[s] <= k {
			p.until[s] = 0
		}
		if p.left[s] > 0 {
			wet++
		}
		if p.open(s) {
			open++
		}
	}
	p.gauge -= p.l.Par[lkDrain] * open
	if p.gauge <= 0 {
		return Broke
	}
	return until(p.next*lkRow >= len(t) && wet == 0)
}

// Apply taps slot A. On an open leak it takes one of its taps, and clamps
// the leak for its hold when it needs more; anywhere else it knocks the
// pipe.
func (p *leakPlay) Apply(m Move) Status {
	if !in(m.A, p.l.Size) {
		return Broke
	}
	if !p.open(m.A) {
		p.gauge -= p.l.Par[lkMiss]
		return Going
	}
	p.left[m.A]--
	if p.left[m.A] > 0 {
		p.until[m.A] = p.n + p.hold[m.A]
	}
	return Going
}

// Snapshot is the gauge, the leaks sprung, each slot's taps left, then each
// slot's clamp step.
func (p *leakPlay) Snapshot() []int64 {
	return slices.Concat([]int64{p.gauge, int64(p.next)}, p.left, p.until)
}

// Solve taps each open slot a moment after it opens, one tap a step.
func (f leak) Solve(l *Layout) Log {
	play := f.Start(l).(*leakPlay)
	since := make([]int64, l.Size) // the step each slot opened; 0 while it is not open
	var log Log
	for k := int64(1); k < solveCap; k++ {
		at := k * l.Step
		if st, _ := play.Run(at); st != Going {
			log.End = at
			break
		}
		for s := range l.Size {
			switch {
			case !play.open(s):
				since[s] = 0
			case since[s] == 0:
				since[s] = k
			}
		}
		for s := range l.Size {
			if since[s] > 0 && k-since[s] >= leakReach {
				m := Move{At: at, A: s}
				play.Apply(m)
				log.Moves = append(log.Moves, m)
				since[s] = 0
				break
			}
		}
	}
	return log
}

// Hints name the slot of each leak, at the moment it springs.
func (leak) Hints(l *Layout) []Move {
	var out []Move
	for t := l.Track; len(t) >= lkRow; t = t[lkRow:] {
		out = append(out, Move{At: t[lkAt] * l.Step, A: t[lkSlot]})
	}
	return out
}
