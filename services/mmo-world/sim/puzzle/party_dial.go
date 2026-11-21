package puzzle

// Two-hand lock: the dials click in pairs, each dial held by its own
// seat, and a pair holds only when both are set within the window.
const TwoHandLock = "two-hand-lock"

func init() { registerParty(TwoHandLock, Dial, twoHand{}) }

// structural: dials click in pairs; an unset dial's click time.
const (
	dialPair = 2
	unclick  = -1
)

type twoHand struct{}

func (twoHand) Lay(*Layout, Kit) {}

type twoHandPlay struct {
	untimed
	l     *Layout
	k     int64           // dials clicked
	click [dialPair]int64 // ms each dial of the open pair was set
}

func (twoHand) Start(l *Layout) Play {
	p := &twoHandPlay{l: l}
	p.clear()
	return p
}

func (p *twoHandPlay) clear() { p.click = [dialPair]int64{unclick, unclick} }

func dialHolder(l *Layout, dial int64) int64 { return dial % l.Seats }

// pairOf is the open pair's first dial and how many dials it has; the
// last dial of an odd lock is a pair of one.
func (p *twoHandPlay) pairOf() (first, size int64) {
	first = p.k / dialPair * dialPair
	return first, min(dialPair, p.l.Size-first)
}

// Apply sets dial A at number B, turned the way C says, by its holder:
// touching a dial outside the open pair drops every dial, as solo.
func (p *twoHandPlay) Apply(m Move) Status {
	l := p.l
	if !seated(l, m) || !in(m.A, l.Size) {
		return Broke
	}
	if m.Seat != dialHolder(l, m.A) {
		return Going
	}
	first, size := p.pairOf()
	if m.A < first || m.A >= first+size {
		p.k = 0
		p.clear()
		return Going
	}
	if m.B != l.Target[m.A] || m.C != l.Turn[m.A] {
		return Going
	}
	p.click[m.A-first] = m.At
	lo, hi := p.click[0], p.click[0]
	for _, c := range p.click[:size] {
		if c == unclick {
			return Going
		}
		lo, hi = min(lo, c), max(hi, c)
	}
	if hi-lo <= l.Window {
		p.k += size
	}
	p.clear()
	return until(p.k == l.Size)
}

func (p *twoHandPlay) Snapshot() []int64 { return []int64{p.k, p.click[0], p.click[1]} }

// Solve sets both dials of each pair at the same moment.
func (twoHand) Solve(l *Layout) Log {
	var ms []Move
	for i, t := range l.Target {
		at := int64(i) / dialPair * partyStepMs
		ms = append(ms, Move{At: at, A: int64(i), B: t, C: l.Turn[i], Seat: dialHolder(l, int64(i))})
	}
	return Log{Moves: ms}
}

func (twoHand) Deal(l *Layout) []Layout { return dealWhole(l) }
