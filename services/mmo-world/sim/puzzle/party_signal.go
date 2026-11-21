package puzzle

// Relay chain: each seat tunes its own panel of knobs, and the chain
// passes the signal only when every panel locks within the window. A
// panel left locked too long before the last one drops back to zero.
const RelayChain = "relay-chain"

func init() { registerParty(RelayChain, Signal, relayChain{}) }

// structural: a panel that is not locked.
const unlocked = -1

type relayChain struct{}

func (relayChain) Lay(*Layout, Kit) {}

// relayPanel is the seat whose panel holds knob i: panels are runs of equal
// length in seat order.
func relayPanel(l *Layout, knob int64) int64 { return knob / (l.Size / l.Seats) }

type relayChainPlay struct {
	untimed
	l     *Layout
	knobs []int64
	lock  []int64 // ms each seat's panel locked at
}

func (relayChain) Start(l *Layout) Play {
	p := &relayChainPlay{l: l, knobs: make([]int64, l.Size), lock: make([]int64, l.Seats)}
	for s := range p.lock {
		p.lock[s] = unlocked
	}
	return p
}

// Apply sets knob A to B, by the seat whose panel it is on.
func (p *relayChainPlay) Apply(m Move) Status {
	l := p.l
	if !seated(l, m) || !in(m.A, l.Size) || !in(m.B, l.Range) {
		return Broke
	}
	s := m.Seat
	if relayPanel(l, m.A) != s {
		return Going
	}
	p.knobs[m.A] = m.B
	switch {
	case !p.tuned(s):
		p.lock[s] = unlocked
		return Going
	case p.lock[s] == unlocked:
		p.lock[s] = m.At
	}
	last := m.At
	for _, at := range p.lock {
		if at == unlocked {
			return Going
		}
		last = max(last, at)
	}
	held := true
	for t, at := range p.lock {
		if at < last-l.Window {
			held = false
			p.reset(int64(t))
		}
	}
	return until(held)
}

func (p *relayChainPlay) tuned(s int64) bool {
	per := p.l.Size / p.l.Seats
	for i := s * per; i < (s+1)*per; i++ {
		if p.knobs[i] != p.l.Target[i] {
			return false
		}
	}
	return true
}

func (p *relayChainPlay) reset(s int64) {
	per := p.l.Size / p.l.Seats
	for i := s * per; i < (s+1)*per; i++ {
		p.knobs[i] = 0
	}
	p.lock[s] = unlocked
}

func (p *relayChainPlay) Snapshot() []int64 {
	return append(append([]int64(nil), p.knobs...), p.lock...)
}

// Solve tunes every panel in step, knob by knob, so they all lock on the
// same press.
func (relayChain) Solve(l *Layout) Log {
	per := l.Size / l.Seats
	var ms []Move
	for j := range per {
		for s := range l.Seats {
			i := s*per + j
			ms = append(ms, Move{At: pressMs * (j + 1), A: i, B: l.Target[i], Seat: s})
		}
	}
	return Log{Moves: ms}
}

func (relayChain) Deal(l *Layout) []Layout { return dealWhole(l) }
