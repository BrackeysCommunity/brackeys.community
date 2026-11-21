package puzzle

// Double swipe: Keycard with two readers that must both read a pass
// within Window of each other. Target is the first reader's speeds and Key
// the second's. The readers change hands on each pass.
const DoubleSwipe = "double-swipe"

func init() { registerParty(DoubleSwipe, Keycard, doubleSwipe{}) }

// structural: a double swipe has two readers.
const swipeReaders = 2

type doubleSwipe struct{}

// Lay draws the second reader's speeds by Keycard's own drift rule.
func (doubleSwipe) Lay(l *Layout, k Kit) {
	second := *l
	keycard{}.Lay(&second, k)
	l.Key = second.Target
}

type swipePlay struct {
	untimed
	l    *Layout
	k    int64 // passes read
	bad  int64
	last [swipeReaders]int64 // ms of each reader's swipe before
	good [swipeReaders]int64 // ms of each reader's good swipe on this pass; -1 for none
}

func (doubleSwipe) Start(l *Layout) Play {
	return &swipePlay{l: l, good: [swipeReaders]int64{-1, -1}}
}

func (p *swipePlay) readerSeat(r int64) int64 {
	return holder(r, passTurn(p.l, p.k), p.l.Seats)
}

// Apply is a swipe of reader B that took A ms, by the seat holding it.
func (p *swipePlay) Apply(m Move) Status {
	if !seated(p.l, m) || !in(m.B, swipeReaders) || m.A < 1 {
		return Broke
	}
	if m.Seat != p.readerSeat(m.B) {
		return Going
	}
	if m.A > m.At-p.last[m.B] {
		return Broke
	}
	p.last[m.B] = m.At
	par, want := p.l.Par, p.l.Target
	if m.B == 1 {
		want = p.l.Key
	}
	if off := m.A - want[p.k]; off < -par[kcWidth] || off > par[kcWidth] {
		p.bad++
		p.good[m.B] = -1
		if p.bad > par[kcStrikes] {
			return Broke
		}
		return Going
	}
	p.good[m.B] = m.At
	a, b := p.good[0], p.good[1]
	switch {
	case a < 0 || b < 0:
	case max(a-b, b-a) <= p.l.Window:
		p.k++
		p.good = [swipeReaders]int64{-1, -1}
		return until(p.k == p.l.Size)
	case a < b:
		p.good[0] = -1
	default:
		p.good[1] = -1
	}
	return Going
}

// Snapshot is the passes read, the bad swipes and each reader's good swipe.
func (p *swipePlay) Snapshot() []int64 { return []int64{p.k, p.bad, p.good[0], p.good[1]} }

// Solve swipes both readers together at Keycard's pace.
func (doubleSwipe) Solve(l *Layout) Log {
	var log Log
	var at int64
	for j := range l.Size {
		at += max(keycardSwipeMs, l.Range)
		for r, want := range [swipeReaders][]int64{l.Target, l.Key} {
			log.Moves = append(log.Moves, Move{At: at, A: want[j], B: int64(r),
				Seat: holder(int64(r), passTurn(l, j), l.Seats)})
		}
	}
	return log
}

func (doubleSwipe) Deal(l *Layout) []Layout { return dealWhole(l) }
