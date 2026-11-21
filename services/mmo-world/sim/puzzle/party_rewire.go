package puzzle

// Party versions of Rewire. Big rewire: every seat sees one big box and
// holds one wire at a time, and two held wires that cross drop every hand.
// Split panel: wires seats know their wires' colours, ports seats which
// glyph each colour goes to, and only talk solves it.
const (
	BigRewire  = "big-rewire"
	SplitPanel = "split-panel"
)

func init() {
	registerParty(BigRewire, Rewire, bigRewire{})
	registerParty(SplitPanel, Rewire, splitPanel{})
}

// structural: a Rewire move's kind; a big rewire's empty hand.
const (
	rewirePlug = 0
	rewireGrab = 1
	rewireMark = 2
	noWire     = -1
)

// plugWire is solo Rewire's plug: wire a into port b, the wire that was
// there taking a's old port. It reports whether every wire is home.
func plugWire(l *Layout, at []int64, a, b int64) bool {
	for w, port := range at {
		if port == b {
			at[w] = at[a]
		}
	}
	at[a] = b
	for w, port := range at {
		if port != l.Target[w] {
			return false
		}
	}
	return true
}

func homePorts(n int64) []int64 {
	at := make([]int64, n)
	for i := range at {
		at[i] = int64(i)
	}
	return at
}

type bigRewire struct{}

func (bigRewire) Lay(*Layout, Kit) {}

type bigRewirePlay struct {
	untimed
	l    *Layout
	at   []int64 // each wire's port
	hold []int64 // the wire each seat holds
}

func (bigRewire) Start(l *Layout) Play {
	p := &bigRewirePlay{l: l, at: homePorts(l.Size), hold: make([]int64, l.Seats)}
	for s := range p.hold {
		p.hold[s] = noWire
	}
	return p
}

func (p *bigRewirePlay) Apply(m Move) Status {
	n := p.l.Size
	if !seated(p.l, m) || !in(m.A, n) {
		return Broke
	}
	s := m.Seat
	switch m.C {
	case rewireGrab:
		if p.hold[s] == noWire && !p.held(m.A) {
			p.hold[s] = m.A
		}
		return Going
	case rewirePlug:
		if !in(m.B, n) {
			return Broke
		}
		if p.hold[s] != m.A {
			return Going
		}
		for t, h := range p.hold {
			if int64(t) != s && h != noWire && (m.A-h)*(m.B-p.at[h]) < 0 {
				for i := range p.hold {
					p.hold[i] = noWire
				}
				return Going
			}
		}
		p.hold[s] = noWire
		return until(plugWire(p.l, p.at, m.A, m.B))
	}
	return Broke
}

func (p *bigRewirePlay) held(w int64) bool {
	for _, h := range p.hold {
		if h == w {
			return true
		}
	}
	return false
}

func (p *bigRewirePlay) Snapshot() []int64 {
	return append(append([]int64(nil), p.at...), p.hold...)
}

// Solve passes the wires round the seats, one held at a time, so nothing
// crosses.
func (bigRewire) Solve(l *Layout) Log {
	var ms []Move
	for w, port := range l.Target {
		t, s := int64(w)*halves*pressMs, int64(w)%l.Seats
		ms = append(ms, Move{At: t, A: int64(w), C: rewireGrab, Seat: s},
			Move{At: t + pressMs, A: int64(w), B: port, C: rewirePlug, Seat: s})
	}
	return Log{Moves: ms}
}

func (bigRewire) Deal(l *Layout) []Layout { return dealWhole(l) }

type splitPanel struct{}

// Lay gives every wire a colour, and each colour the glyph of its wire's
// port.
func (splitPanel) Lay(l *Layout, k Kit) {
	l.Key = k.perm(l.Size)
	l.Code = make([]int64, l.Size)
	for w, c := range l.Key {
		l.Code[c] = l.Glyph[l.Target[w]]
	}
}

// Even seats hold wires and odd seats read ports; each side's seats share
// its wires or colours round robin by rank.
func panelSides(seats int64) (wires, ports int64) {
	return (seats + 1) / halves, seats / halves
}

func wiresSeat(s int64) bool { return s%halves == 0 }

func panelRank(s int64) int64 { return s / halves }

type splitPanelPlay struct {
	untimed
	l    *Layout
	at   []int64
	mark []int64 // the port each seat has lit
}

func (splitPanel) Start(l *Layout) Play {
	p := &splitPanelPlay{l: l, at: homePorts(l.Size), mark: make([]int64, l.Seats)}
	for s := range p.mark {
		p.mark[s] = noWire
	}
	return p
}

func (p *splitPanelPlay) Apply(m Move) Status {
	n := p.l.Size
	if !seated(p.l, m) {
		return Broke
	}
	wires, _ := panelSides(p.l.Seats)
	switch m.C {
	case rewirePlug:
		if !in(m.A, n) || !in(m.B, n) {
			return Broke
		}
		if !wiresSeat(m.Seat) || m.A%wires != panelRank(m.Seat) {
			return Going
		}
		return until(plugWire(p.l, p.at, m.A, m.B))
	case rewireMark:
		if !in(m.B, n) {
			return Broke
		}
		if !wiresSeat(m.Seat) {
			p.mark[m.Seat] = m.B
		}
		return Going
	}
	return Broke
}

func (p *splitPanelPlay) Snapshot() []int64 {
	return append(append([]int64(nil), p.at...), p.mark...)
}

// Solve plugs in solo order: the ports seat that reads the wire's colour
// lights its port, then the wire's seat plugs it.
func (splitPanel) Solve(l *Layout) Log {
	wires, ports := panelSides(l.Seats)
	var ms []Move
	for w, port := range l.Target {
		t := int64(w) * halves * pressMs
		reader := halves*(l.Key[w]%ports) + 1
		plugger := halves * (int64(w) % wires)
		ms = append(ms, Move{At: t, B: port, C: rewireMark, Seat: reader},
			Move{At: t + pressMs, A: int64(w), B: port, C: rewirePlug, Seat: plugger})
	}
	return Log{Moves: ms}
}

// Deal shows a wires seat its own wires' colours and a ports seat the
// glyphs and its share of the colours' codes; nobody sees the answer.
func (splitPanel) Deal(l *Layout) []Layout {
	wires, ports := panelSides(l.Seats)
	out := make([]Layout, l.Seats)
	for s := range out {
		v := cloneLayout(l)
		v.Target, v.Glyph, v.Code, v.Key = nil, nil, nil, nil
		rank := panelRank(int64(s))
		if wiresSeat(int64(s)) {
			v.Key = hideBut(l.Key, func(w int64) bool { return w%wires == rank })
		} else {
			v.Glyph = append([]int64(nil), l.Glyph...)
			v.Code = hideBut(l.Code, func(c int64) bool { return c%ports == rank })
		}
		out[s] = v
	}
	return out
}
