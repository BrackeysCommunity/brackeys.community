package puzzle

// Keycard: swipe the card through the reader at the speed each pass
// wants. Size is the passes; Target the milliseconds each pass's swipe
// should take, and Range the slowest swipe the reader times. Par is how
// far off a swipe may be, the bad swipes the reader forgives, and the
// fastest swipe it can time.
const Keycard = "keycard"

func init() { register(Keycard, keycard{}) }

const (
	kcWidth = iota
	kcStrikes
	kcFastest
)

// structural: Solve's hand swipes every 1500 ms.
const keycardSwipeMs = 1500

type keycard struct{}

func (keycard) Keys() []string { return []string{"width", "strikes", "drift", "fastest"} }

func (keycard) Lay(l *Layout, k Kit) {
	width, drift, fastest := k.Tune("width"), k.Tune("drift"), k.Tune("fastest")
	l.Par = []int64{width, k.Tune("strikes"), fastest}
	lo := fastest + width
	hi := max(lo, l.Range-width)
	l.Target = make([]int64, l.Size)
	t := k.S.Between(lo, hi)
	for i := range l.Target {
		if i > 0 {
			t = min(hi, max(lo, t+k.S.Between(-drift, drift)))
		}
		l.Target[i] = t
	}
}

type keycardPlay struct {
	untimed
	l    *Layout
	k    int64 // passes read
	bad  int64
	last int64 // ms of the swipe before
}

func (keycard) Start(l *Layout) Play { return &keycardPlay{l: l} }

// Apply is one swipe that took A ms and ended at the move's stamp. A
// swipe longer than the time since the last one could not have happened.
func (p *keycardPlay) Apply(m Move) Status {
	if m.A < 1 || m.A > m.At-p.last {
		return Broke
	}
	p.last = m.At
	par := p.l.Par
	if off := m.A - p.l.Target[p.k]; off >= -par[kcWidth] && off <= par[kcWidth] {
		p.k++
		return until(p.k == p.l.Size)
	}
	p.bad++
	if p.bad > par[kcStrikes] {
		return Broke
	}
	return Going
}

// Snapshot is the passes read, the bad swipes and the last swipe's ms.
func (p *keycardPlay) Snapshot() []int64 { return []int64{p.k, p.bad, p.last} }

func (keycard) Solve(l *Layout) Log {
	var log Log
	var at int64
	for _, t := range l.Target {
		at += max(keycardSwipeMs, l.Range)
		log.Moves = append(log.Moves, Move{At: at, A: t})
	}
	return log
}

func (f keycard) Hints(l *Layout) []Move { return f.Solve(l).Moves }
