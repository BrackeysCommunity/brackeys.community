package gen

import "jams.team/mmo-world/sim/draw"

// LatticeID names a point of a jittered lattice by its lattice coordinates.
type LatticeID struct{ I, J int64 }

// lattice is a triangular lattice of the given spacing: point (i, j) sits
// at (i·s, j·s) plus the lattice's keyed offset, moved by up to jitter
// tiles. Every point has six neighbours the spacing apart.
type lattice struct {
	g       *Gen
	purpose string
	spacing int64
	jitter  int64
	offset  Hex
	cache   map[LatticeID]Hex
	// prefer, when set, moves a point to the first tile of its jitter disc,
	// in keyed order, that it accepts; failing all, to the first.
	prefer func(Hex) bool
}

func (g *Gen) newLattice(purpose string, spacing, jitter int64, offset bool) *lattice {
	l := &lattice{g: g, purpose: purpose, spacing: spacing, jitter: jitter, cache: map[LatticeID]Hex{}}
	if offset {
		l.offset = Hex{
			Q: int64(g.d.Below(uint64(spacing), draw.Purpose(purpose+".offset"), draw.Int(0))),
			R: int64(g.d.Below(uint64(spacing), draw.Purpose(purpose+".offset"), draw.Int(1))),
		}
	}
	return l
}

// structural: a lattice point's six neighbours, as lattice steps.
var latticeSteps = [...]LatticeID{{1, 0}, {1, -1}, {0, -1}, {-1, 0}, {-1, 1}, {0, 1}}

func (l *lattice) At(id LatticeID) Hex {
	if h, ok := l.cache[id]; ok {
		return h
	}
	h := Hex{Q: id.I*l.spacing + l.offset.Q, R: id.J*l.spacing + l.offset.R}
	switch {
	case l.jitter > 0 && l.prefer != nil:
		disc := DiscAt(h, l.jitter)
		order := l.g.d.Shuffle(len(disc), draw.Purpose(l.purpose+".jitter"), draw.Int(id.I), draw.Int(id.J))
		h = disc[order[0]]
		for _, k := range order {
			if l.prefer(disc[k]) {
				h = disc[k]
				break
			}
		}
	case l.jitter > 0:
		n := DiscSize(l.jitter)
		k := int64(l.g.d.Below(uint64(n), draw.Purpose(l.purpose+".jitter"), draw.Int(id.I), draw.Int(id.J)))
		h = h.Add(discOffset(l.jitter, k))
	}
	l.cache[id] = h
	return h
}

// Near lists the lattice points within reach of h, in lattice order.
func (l *lattice) Near(h Hex, reach int64) []LatticeID {
	r := reach + l.jitter
	i0, i1 := floorDiv(h.Q-l.offset.Q-r, l.spacing), floorDiv(h.Q-l.offset.Q+r, l.spacing)+1
	j0, j1 := floorDiv(h.R-l.offset.R-r, l.spacing), floorDiv(h.R-l.offset.R+r, l.spacing)+1
	var out []LatticeID
	for i := i0; i <= i1; i++ {
		for j := j0; j <= j1; j++ {
			id := LatticeID{i, j}
			if Distance(l.At(id), h) <= reach {
				out = append(out, id)
			}
		}
	}
	return out
}

// Nearest is the lattice point nearest h; ties go to the lower id.
func (l *lattice) Nearest(h Hex) LatticeID {
	for reach := l.spacing; ; reach += l.spacing {
		ids := l.Near(h, reach)
		if len(ids) == 0 {
			continue
		}
		best := ids[0]
		for _, id := range ids[1:] {
			if Distance(l.At(id), h) < Distance(l.At(best), h) {
				best = id
			}
		}
		// Anything nearer than best would be within this reach already.
		return best
	}
}

// discOffset is the kth tile of the disc of radius r, as an offset.
func discOffset(r, k int64) Hex {
	for ring := int64(0); ring <= r; ring++ {
		n := max(1, int64(nDirs)*ring)
		if k < n {
			return Ring(Hex{}, ring)[k]
		}
		k -= n
	}
	return Hex{}
}
