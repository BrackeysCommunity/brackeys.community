package puzzle

// Signal: set every knob to its Target value, out of Range.
const Signal = "signal"

func init() { register(Signal, signal{}) }

type signal struct{}

func (signal) Lay(l *Layout, k Kit) {
	l.Target = make([]int64, l.Size)
	for i := range l.Target {
		l.Target[i] = k.below(l.Range)
	}
}

type signalPlay struct {
	untimed
	l     *Layout
	knobs []int64
}

func (signal) Start(l *Layout) Play { return &signalPlay{l: l, knobs: make([]int64, l.Size)} }

// Apply sets knob A to value B.
func (p *signalPlay) Apply(m Move) Status {
	if !in(m.A, p.l.Size) || !in(m.B, p.l.Range) {
		return Broke
	}
	p.knobs[m.A] = m.B
	for i, v := range p.knobs {
		if v != p.l.Target[i] {
			return Going
		}
	}
	return Done
}

func (p *signalPlay) Snapshot() []int64 { return append([]int64(nil), p.knobs...) }

func (signal) Solve(l *Layout) Log {
	var ms presses
	for i, t := range l.Target {
		ms.add(int64(i), t, 0)
	}
	return Log{Moves: ms}
}

func (f signal) Hints(l *Layout) []Move { return f.Solve(l).Moves }
