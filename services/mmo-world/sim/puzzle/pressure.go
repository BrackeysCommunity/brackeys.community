package puzzle

import (
	"slices"

	"jams.team/mmo-world/sim/fixed"
)

// Pressure: open and close valves until every needle sits in the band
// and stays there. A valve lifts its own needle and drops its
// neighbours'. Init is each needle at rest, out of Range. Par is the
// band's low and high marks, what a turn adds to its needle and takes
// from the neighbours, the steps to hold, and the hundredths of a unit
// the Goal needle leaks a step. Order and Turn are the valve and
// direction of each turn the generator gave the machine. Shape 1 is a
// ring manifold: the first and last valves are neighbours too.
const Pressure = "pressure"

func init() { register(Pressure, pressure{}) }

const (
	prLo = iota
	prHi
	prNudge
	prCouple
	prHold
	prLeak
)

// structural: Solve's hand turns a valve every 600 ms.
const pressureTurnMs = 600

type pressure struct{}

func (pressure) Keys() []string { return []string{"band", "nudge", "couple", "hold", "leak"} }

func (pressure) Lay(l *Layout, k Kit) {
	n := l.Size
	band := k.Tune("band")
	lo := (l.Range - band) / halves
	hi := lo + band
	nudge, couple, leak := k.Tune("nudge"), k.Tune("couple"), k.Tune("leak")
	l.Par = []int64{lo, hi, nudge, couple, seconds(k.Tune("hold")), leak}
	l.Goal = k.below(n)
	x := make([]int64, n)
	for i := range x {
		x[i] = (lo + hi) / halves
	}
	if leak > 0 {
		// Solved, the leaking needle has the whole band to fall through.
		x[l.Goal] = hi - 1
	}
	// A turn that would pin a needle at either end could not be undone.
	ring := l.Shape == ringShape
	turn := func(a, dir int64) bool {
		y := slices.Clone(x)
		turnValve(y, a, dir, nudge, couple, ring)
		if slices.Min(y) < 1 || slices.Max(y) > l.Range-1 {
			return false
		}
		x = y
		l.Order, l.Turn = append(l.Order, a), append(l.Turn, dir)
		return true
	}
	for range l.Decoys {
		a, dir := k.below(n), k.sign()
		if !turn(a, dir) {
			turn(a, -dir)
		}
	}
	// A machine that would settle with no hand on it is turned further.
	w, dir := int64(0), int64(1)
	if l.Goal == w {
		w++
	}
	for range l.Range {
		if !settles(x, l) {
			break
		}
		if !turn(w, dir) {
			dir = -dir
			if !turn(w, dir) {
				break
			}
		}
	}
	l.Init = x
}

// structural: the shape whose valves stand in a ring.
const ringShape = 1

func turnValve(v []int64, a, dir, nudge, couple int64, ring bool) {
	v[a] += dir * nudge
	n := int64(len(v))
	if ring {
		// With two valves both neighbours are the one other valve.
		left, right := (a-1+n)%n, (a+1)%n
		if left != a {
			v[left] -= dir * couple
		}
		if right != a && right != left {
			v[right] -= dir * couple
		}
		return
	}
	if a > 0 {
		v[a-1] -= dir * couple
	}
	if a+1 < n {
		v[a+1] -= dir * couple
	}
}

// settles reports whether the needles would come to rest in the band
// untouched: all of them there already, or only the leaking one above it.
func settles(v []int64, l *Layout) bool {
	lo, hi := l.Par[prLo], l.Par[prHi]
	for i, x := range v {
		switch {
		case x >= lo && x <= hi:
		case int64(i) == l.Goal && l.Par[prLeak] > 0 && x > hi:
		default:
			return false
		}
	}
	return true
}

type pressurePlay struct {
	clock
	l    *Layout
	v    []int64
	acc  int64 // hundredths leaked that have not yet moved the needle
	held int64 // steps every needle has sat in the band
}

func (pressure) Start(l *Layout) Play {
	return &pressurePlay{clock: newClock(l), l: l, v: slices.Clone(l.Init)}
}

func (p *pressurePlay) Run(at int64) (Status, int64) { return p.run(at, p.tick) }

func (p *pressurePlay) tick(int64) Status {
	par, goal := p.l.Par, p.l.Goal
	p.acc += par[prLeak]
	for p.acc >= fixed.Hundredths {
		p.acc -= fixed.Hundredths
		p.v[goal] = max(0, p.v[goal]-1)
	}
	for _, x := range p.v {
		if x < par[prLo] || x > par[prHi] {
			p.held = 0
			return Going
		}
	}
	p.held++
	return until(p.held >= par[prHold])
}

// Apply turns valve A: B is 1 to open it, -1 to close it. A needle driven
// off the top of the gauge bursts the machine.
func (p *pressurePlay) Apply(m Move) Status {
	if !in(m.A, p.l.Size) || (m.B != 1 && m.B != -1) {
		return Broke
	}
	turnValve(p.v, m.A, m.B, p.l.Par[prNudge], p.l.Par[prCouple], p.l.Shape == ringShape)
	for i, x := range p.v {
		p.v[i] = max(0, x)
		if x >= p.l.Range {
			return Broke
		}
	}
	return Going
}

// Snapshot is every needle, then the leak not yet shown and the steps held.
func (p *pressurePlay) Snapshot() []int64 { return append(slices.Clone(p.v), p.acc, p.held) }

// Solve undoes the generator's turns, last first, then waits out the hold.
func (pressure) Solve(l *Layout) Log {
	var log Log
	var at int64
	for j := len(l.Order) - 1; j >= 0; j-- {
		at += pressureTurnMs
		log.Moves = append(log.Moves, Move{At: at, A: l.Order[j], B: -l.Turn[j]})
	}
	log.End = at + (l.Par[prHold]+1)*l.Step
	return log
}

func (f pressure) Hints(l *Layout) []Move { return f.Solve(l).Moves }
