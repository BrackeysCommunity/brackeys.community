package puzzle

// Fuse: pull the fuses in Order. Clues each say one fuse comes before
// another; some repeat what others already say.
const Fuse = "fuse"

func init() { register(Fuse, fuse{}) }

type fuse struct{}

func (fuse) Lay(l *Layout, k Kit) {
	n := l.Size
	l.Order = k.perm(n)
	for i := int64(1); i < n; i++ {
		l.Clues = append(l.Clues, Clue{l.Order[i-1], l.Order[i]})
	}
	for range l.Decoys {
		a := k.below(n - 1)
		b := a + 1 + k.below(n-a-1)
		l.Clues = append(l.Clues, Clue{l.Order[a], l.Order[b]})
	}
	c := l.Clues
	k.S.Shuffle(len(c), func(i, j int) { c[i], c[j] = c[j], c[i] })
}

type fusePlay struct {
	untimed
	l *Layout
	k int64 // fuses pulled
}

func (fuse) Start(l *Layout) Play { return &fusePlay{l: l} }

// Apply pulls fuse A; any but the next in order blows the box.
func (p *fusePlay) Apply(m Move) Status {
	if m.A != p.l.Order[p.k] {
		return Broke
	}
	p.k++
	return until(p.k == p.l.Size)
}

func (p *fusePlay) Snapshot() []int64 { return []int64{p.k} }

func (fuse) Solve(l *Layout) Log {
	var ms presses
	for _, f := range l.Order {
		ms.add(f, 0, 0)
	}
	return Log{Moves: ms}
}

func (f fuse) Hints(l *Layout) []Move { return f.Solve(l).Moves }
