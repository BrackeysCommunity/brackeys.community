package puzzle

// Rewire: plug each wire into its port. Target[w] is wire w's port and
// Glyph[p] port p's glyph; look-alike ports share one.
const Rewire = "rewire"

func init() { register(Rewire, rewire{}) }

type rewire struct{}

func (rewire) Lay(l *Layout, k Kit) {
	n := l.Size
	l.Target = derange(k.perm(n), k)
	l.Glyph = make([]int64, n)
	for i := range l.Glyph {
		l.Glyph[i] = int64(i)
	}
	for _, i := range k.perm(n)[:min(l.Decoys, n-1)] {
		l.Glyph[i] = (i + 1) % n
	}
}

// derange makes sure no wire starts at its own port.
func derange(t []int64, k Kit) []int64 {
	n := int64(len(t))
	for i := range t {
		if t[i] == int64(i) {
			j := (int64(i) + 1 + k.below(n-1)) % n
			t[i], t[j] = t[j], t[i]
		}
	}
	return t
}

type rewirePlay struct {
	untimed
	l  *Layout
	at []int64 // each wire's port
}

func (rewire) Start(l *Layout) Play {
	p := &rewirePlay{l: l, at: make([]int64, l.Size)}
	for i := range p.at {
		p.at[i] = int64(i)
	}
	return p
}

// Apply plugs wire A into port B; the wire that was there takes A's port.
func (p *rewirePlay) Apply(m Move) Status {
	n := p.l.Size
	if !in(m.A, n) || !in(m.B, n) {
		return Broke
	}
	for w, port := range p.at {
		if port == m.B {
			p.at[w] = p.at[m.A]
		}
	}
	p.at[m.A] = m.B
	for w, port := range p.at {
		if port != p.l.Target[w] {
			return Going
		}
	}
	return Done
}

func (p *rewirePlay) Snapshot() []int64 { return append([]int64(nil), p.at...) }

func (rewire) Solve(l *Layout) Log {
	var ms presses
	for w, port := range l.Target {
		ms.add(int64(w), port, 0)
	}
	return Log{Moves: ms}
}

func (f rewire) Hints(l *Layout) []Move { return f.Solve(l).Moves }
