package puzzle

import (
	"slices"

	"jams.team/mmo-world/sim/fixed"
)

// Scrub: rub the grit off the cells that hold the reading without
// rubbing a cracked cell through. Size is the grid's side. Init is each
// cell's layers of grit, False the cracked cells, Target the cells of the
// reading, and Track the step and cell of each patch of grit that creeps
// back.
const Scrub = "scrub"

func init() { register(Scrub, scrub{}) }

const (
	scStep = iota
	scCell
	scRow
)

// structural: a cell under two layers or more shows nothing, so every
// cell starts with at least two; Solve's hand rubs every 2 steps.
const (
	scrubHidden = 2
	scrubEvery  = 2
)

type scrub struct{}

func (scrub) Keys() []string { return []string{"layers", "coverage", "creep", "creep-gap"} }

func (scrub) Lay(l *Layout, k Kit) {
	cells := l.Size * l.Size
	layers := max(scrubHidden, k.Tune("layers"))
	l.Init = make([]int64, cells)
	for c := range l.Init {
		l.Init[c] = scrubHidden + k.below(layers-scrubHidden+1)
	}
	order := k.perm(cells)
	cracked := min(l.Decoys, cells-1)
	sound := order[cracked:]
	reading := max(1, fixed.PercentFloor(int64(len(sound)), k.Tune("coverage")))
	l.False = slices.Sorted(slices.Values(order[:cracked]))
	l.Target = slices.Sorted(slices.Values(sound[:reading]))
	gap := k.Tune("creep-gap")
	for i := range k.Tune("creep") {
		l.Track = append(l.Track, (i+1)*gap, l.Target[k.below(reading)])
	}
}

type scrubPlay struct {
	clock
	l       *Layout
	grit    []int64
	cracked []bool
	next    int // patches crept back
}

func (scrub) Start(l *Layout) Play {
	p := &scrubPlay{clock: newClock(l), l: l, grit: slices.Clone(l.Init), cracked: make([]bool, len(l.Init))}
	for _, c := range l.False {
		p.cracked[c] = true
	}
	return p
}

func (p *scrubPlay) Run(at int64) (Status, int64) { return p.run(at, p.tick) }

func (p *scrubPlay) tick(k int64) Status {
	t := p.l.Track
	for ; p.next*scRow < len(t) && t[p.next*scRow+scStep] <= k; p.next++ {
		c := t[p.next*scRow+scCell]
		p.grit[c] = min(p.l.Init[c], p.grit[c]+1)
	}
	return Going
}

// Apply rubs cell A once. A cracked cell rubbed down to its last layer
// breaks.
func (p *scrubPlay) Apply(m Move) Status {
	if !in(m.A, int64(len(p.grit))) {
		return Broke
	}
	if p.cracked[m.A] && p.grit[m.A] <= 1 {
		return Broke
	}
	p.grit[m.A] = max(0, p.grit[m.A]-1)
	for _, c := range p.l.Target {
		if p.grit[c] > 0 {
			return Going
		}
	}
	return Done
}

// Snapshot is every cell's grit.
func (p *scrubPlay) Snapshot() []int64 { return slices.Clone(p.grit) }

// Solve rubs the first cell of the reading that still has grit on it.
func (f scrub) Solve(l *Layout) Log {
	play := f.Start(l).(*scrubPlay)
	var log Log
	for k := int64(scrubEvery); k < solveCap; k += scrubEvery {
		at := k * l.Step
		play.Run(at)
		i := slices.IndexFunc(l.Target, func(c int64) bool { return play.grit[c] > 0 })
		if i < 0 {
			break
		}
		m := Move{At: at, A: l.Target[i]}
		log.Moves = append(log.Moves, m)
		if play.Apply(m) != Going {
			break
		}
	}
	return log
}

// Hints warn of the cracked cells.
func (scrub) Hints(l *Layout) []Move {
	out := make([]Move, len(l.False))
	for i, c := range l.False {
		out[i] = Move{A: c}
	}
	return out
}
