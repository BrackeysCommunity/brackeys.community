package puzzle

// Pin lock: set each pin, in Order, to its Target height. False pins sit
// after the real ones and set nothing.
const Pins = "lock-pins"

func init() { register(Pins, pins{}) }

type pins struct{}

func (pins) Lay(l *Layout, k Kit) {
	n := l.Size
	l.Order = k.perm(n)
	l.Target = make([]int64, n)
	for i := range l.Target {
		l.Target[i] = 1 + k.below(sides)
	}
	for i := range l.Decoys {
		l.False = append(l.False, n+i)
	}
}

type pinsPlay struct {
	untimed
	l *Layout
	k int64 // pins set
}

func (pins) Start(l *Layout) Play { return &pinsPlay{l: l} }

// Apply sets pin A at height B: the next pin at its height holds; anything
// else drops every pin.
func (p *pinsPlay) Apply(m Move) Status {
	l := p.l
	switch {
	case !in(m.A, l.Size+int64(len(l.False))):
		return Broke
	case m.A == l.Order[p.k] && m.B == l.Target[m.A]:
		p.k++
	default:
		p.k = 0
	}
	return until(p.k == l.Size)
}

func (p *pinsPlay) Snapshot() []int64 { return []int64{p.k} }

func (pins) Solve(l *Layout) Log {
	var ms presses
	for _, pin := range l.Order {
		ms.add(pin, l.Target[pin], 0)
	}
	return Log{Moves: ms}
}

func (f pins) Hints(l *Layout) []Move { return f.Solve(l).Moves }
