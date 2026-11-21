package puzzle

import "jams.team/mmo-world/sim/fixed"

// Crank: wind the dynamo into the band and keep it there, through the
// load spikes, until it has charged. Each quarter turn kicks the speed
// up; drag takes it down every step, harder inside a spike. Par is the
// band's low and high marks, the speed that blows the machine, a quarter
// turn's kick, the drag a step, the extra drag in a spike and the steps
// of charge needed. Track is each spike's first step and its length.
const Crank = "crank"

func init() { register(Crank, crank{}) }

const (
	crLo = iota
	crHi
	crBlow
	crKick
	crDrag
	crSpikeDrag
	crNeed
)

const (
	crStart = iota
	crLength
	crRow
)

// Move codes: a quarter turn, and the mark a hint draws where a spike
// starts, which is never played.
const (
	crankTurn = 1 + iota
	crankWarn
)

type crank struct{}

func (crank) Keys() []string {
	return []string{"band", "blow", "kick", "drag", "spike-drag", "spike-steps", "need", "wind", "window"}
}

func (crank) Lay(l *Layout, k Kit) {
	centre, band := l.Range/halves, k.Tune("band")
	l.Par = []int64{centre - band, centre + band, centre + band + k.Tune("blow"), k.Tune("kick"),
		k.Tune("drag"), k.Tune("spike-drag"), seconds(k.Tune("need"))}
	// Spikes fall after the wind-up and before the window closes, one to
	// a slot.
	from := k.Tune("wind")
	to := fixed.PercentFloor(k.Steps, k.Tune("window"))
	slot := max(to-from, l.Size) / l.Size
	length := min(k.Tune("spike-steps"), slot-1)
	for i := range l.Size {
		l.Track = append(l.Track, from+i*slot+k.below(slot-length), length)
	}
}

type crankPlay struct {
	clock
	l      *Layout
	speed  int64
	charge int64 // steps spent in the band
}

func (crank) Start(l *Layout) Play { return &crankPlay{clock: newClock(l), l: l} }

func (p *crankPlay) Run(at int64) (Status, int64) { return p.run(at, p.tick) }

func (p *crankPlay) tick(k int64) Status {
	par := p.l.Par
	d := par[crDrag]
	for t := p.l.Track; len(t) >= crRow; t = t[crRow:] {
		if k >= t[crStart] && k < t[crStart]+t[crLength] {
			d += par[crSpikeDrag]
		}
	}
	p.speed = max(0, p.speed-d)
	if p.speed >= par[crLo] && p.speed <= par[crHi] {
		p.charge++
	}
	return until(p.charge >= par[crNeed])
}

// Apply is one quarter turn of the crank. Wound past its limit, the
// dynamo blows.
func (p *crankPlay) Apply(m Move) Status {
	if m.A != crankTurn {
		return Broke
	}
	p.speed += p.l.Par[crKick]
	if p.speed > p.l.Par[crBlow] {
		return Broke
	}
	return Going
}

// Snapshot is the speed and the charge.
func (p *crankPlay) Snapshot() []int64 { return []int64{p.speed, p.charge} }

// Solve turns whenever the speed has dropped under the middle of the band.
func (f crank) Solve(l *Layout) Log {
	play := f.Start(l).(*crankPlay)
	var log Log
	for k := range int64(solveCap) {
		at := k * l.Step
		if st, _ := play.Run(at); st != Going {
			log.End = at
			break
		}
		if play.speed < l.Range/halves {
			m := Move{At: at, A: crankTurn}
			play.Apply(m)
			log.Moves = append(log.Moves, m)
		}
	}
	return log
}

// Hints mark where each spike starts.
func (crank) Hints(l *Layout) []Move {
	var out []Move
	for t := l.Track; len(t) >= crRow; t = t[crRow:] {
		out = append(out, Move{At: t[crStart] * l.Step, A: crankWarn})
	}
	return out
}
