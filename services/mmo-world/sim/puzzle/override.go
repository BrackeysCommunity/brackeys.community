package puzzle

// Override: repeat a growing sequence of symbols, round by round. Order
// is the whole sequence; round r plays its first r symbols.
const Override = "override"

func init() { register(Override, override{}) }

type override struct{}

func (override) Lay(l *Layout, k Kit) {
	l.Order = make([]int64, l.Size)
	for i := range l.Order {
		l.Order[i] = k.below(l.Range)
	}
}

type overridePlay struct {
	untimed
	seq []int64 // every press expected, all rounds
	k   int64
}

func (override) Start(l *Layout) Play {
	p := &overridePlay{}
	for r := range l.Size {
		p.seq = append(p.seq, l.Order[:r+1]...)
	}
	return p
}

// Apply presses symbol A; a wrong one breaks the machine.
func (p *overridePlay) Apply(m Move) Status {
	if m.A != p.seq[p.k] {
		return Broke
	}
	p.k++
	return until(p.k == int64(len(p.seq)))
}

func (p *overridePlay) Snapshot() []int64 { return []int64{p.k} }

func (override) Solve(l *Layout) Log {
	var ms presses
	for r := range l.Size {
		for _, x := range l.Order[:r+1] {
			ms.add(x, 0, 0)
		}
	}
	return Log{Moves: ms}
}

func (f override) Hints(l *Layout) []Move { return f.Solve(l).Moves }
