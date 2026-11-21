package puzzle

import "slices"

// Pipe crew: Leak with the pipe split into runs, one a seat, and a gauge
// for each run. A run left to drain empties the whole tank.
const PipeCrew = "pipe-crew"

func init() { registerParty(PipeCrew, Leak, pipeCrew{}) }

type pipeCrew struct{}

func (pipeCrew) Lay(*Layout, Kit) {}

// runOf is the run a slot is on, and the seat that holds it.
func runOf(slot, seats int64) int64 { return slot % seats }

type pipePlay struct {
	*leakPlay
	g []int64 // each run's gauge
}

func (pipeCrew) Start(l *Layout) Play {
	p := &pipePlay{leakPlay: leak{}.Start(l).(*leakPlay), g: make([]int64, l.Seats)}
	for r := range p.g {
		p.g[r] = l.Par[lkGauge]
	}
	return p
}

func (p *pipePlay) Run(at int64) (Status, int64) { return p.run(at, p.tick) }

// tick is Leak's, with each open slot draining its own run's gauge.
func (p *pipePlay) tick(k int64) Status {
	t := p.l.Track
	for ; p.next*lkRow < len(t) && t[p.next*lkRow+lkAt] <= k; p.next++ {
		row := t[p.next*lkRow:]
		p.left[row[lkSlot]], p.hold[row[lkSlot]], p.until[row[lkSlot]] = row[lkTaps], row[lkHold], 0
	}
	var wet int64
	for s := range p.l.Size {
		if p.until[s] > 0 && p.until[s] <= k {
			p.until[s] = 0
		}
		if p.left[s] > 0 {
			wet++
		}
		if p.open(s) {
			p.g[runOf(s, p.l.Seats)] -= p.l.Par[lkDrain]
		}
	}
	for _, g := range p.g {
		if g <= 0 {
			return Broke
		}
	}
	return until(p.next*lkRow >= len(t) && wet == 0)
}

// Apply is Leak's tap by the run's seat, charged to that run's gauge.
func (p *pipePlay) Apply(m Move) Status {
	if !seated(p.l, m) || !in(m.A, p.l.Size) {
		return Broke
	}
	r := runOf(m.A, p.l.Seats)
	if m.Seat != r {
		return Going
	}
	if !p.open(m.A) {
		p.g[r] -= p.l.Par[lkMiss]
		return Going
	}
	p.left[m.A]--
	if p.left[m.A] > 0 {
		p.until[m.A] = p.n + p.hold[m.A]
	}
	return Going
}

// Snapshot is every run's gauge, then Leak's state without its gauge.
func (p *pipePlay) Snapshot() []int64 {
	return slices.Concat(p.g, []int64{int64(p.next)}, p.left, p.until)
}

// Solve is Leak's: each open slot tapped a moment after it opens, one tap
// a step, by the slot's run's seat.
func (pipeCrew) Solve(l *Layout) Log {
	play := pipeCrew{}.Start(l).(*pipePlay)
	since := make([]int64, l.Size)
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
				m := Move{At: at, A: s, Seat: runOf(s, l.Seats)}
				play.Apply(m)
				log.Moves = append(log.Moves, m)
				since[s] = 0
				break
			}
		}
	}
	return log
}

func (pipeCrew) Deal(l *Layout) []Layout { return dealWhole(l) }
