package puzzle

// Dial lock: turn each dial in turn to its Target number, the way its
// Turn says (1, or -1 for a reversal).
const Dial = "lock-dial"

func init() { register(Dial, dial{}) }

type dial struct{}

func (dial) Lay(l *Layout, k Kit) {
	n := l.Size
	l.Target = make([]int64, n)
	l.Turn = make([]int64, n)
	for i := range l.Target {
		l.Target[i] = k.below(l.Range)
		l.Turn[i] = 1
	}
	for _, i := range k.perm(n)[:min(l.Decoys, n)] {
		l.Turn[i] = -1
	}
}

type dialPlay struct {
	untimed
	l *Layout
	k int64 // dials clicked
}

func (dial) Start(l *Layout) Play { return &dialPlay{l: l} }

// Apply leaves dial A at number B, turned the way C says: the dial in
// turn clicks at its number; touching another dial drops them all.
func (p *dialPlay) Apply(m Move) Status {
	l := p.l
	switch {
	case !in(m.A, l.Size):
		return Broke
	case m.A != p.k:
		p.k = 0
	case m.B == l.Target[m.A] && m.C == l.Turn[m.A]:
		p.k++
	}
	return until(p.k == l.Size)
}

func (p *dialPlay) Snapshot() []int64 { return []int64{p.k} }

func (dial) Solve(l *Layout) Log {
	var ms presses
	for i, t := range l.Target {
		ms.add(int64(i), t, l.Turn[i])
	}
	return Log{Moves: ms}
}

func (f dial) Hints(l *Layout) []Move { return f.Solve(l).Moves }
