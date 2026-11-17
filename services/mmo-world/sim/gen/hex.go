// Package gen answers what any tile of an endless world is before anyone
// touches it: patterns first, then layered noise around them, the spine
// and corridors that keep everything reachable, rivers, regions and
// sites. Every answer is a pure function of the generation key, the map
// sheets and a bounded neighbourhood of the tile, so chunks can be
// generated in any order and nothing is stored (GDD 4.2, 4.13, 4.17).
package gen

// Hex is an axial coordinate.
type Hex struct{ Q, R int64 }

// structural: a hex has six neighbours, in this order, starting east and
// turning anticlockwise.
var directions = [...]Hex{{1, 0}, {1, -1}, {0, -1}, {-1, 0}, {-1, 1}, {0, 1}}

// structural: ring walks start this many directions round from east.
const ringStartDir = 4

func (h Hex) Add(o Hex) Hex       { return Hex{h.Q + o.Q, h.R + o.R} }
func (h Hex) Scale(k int64) Hex   { return Hex{h.Q * k, h.R * k} }
func (h Hex) Neighbour(d int) Hex { return h.Add(directions[d]) }
func (h Hex) S() int64            { return -h.Q - h.R }
func Distance(a, b Hex) int64     { return max(abs(a.Q-b.Q), abs(a.R-b.R), abs(a.S()-b.S())) }
func (h Hex) Len() int64          { return Distance(h, Hex{}) }
func Directions() int             { return len(directions) }
func abs(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}

// Ring is every tile exactly radius steps from centre, walked in order.
func Ring(centre Hex, radius int64) []Hex {
	if radius == 0 {
		return []Hex{centre}
	}
	var out []Hex
	h := centre.Add(directions[ringStartDir].Scale(radius))
	for d := range directions {
		for range radius {
			out = append(out, h)
			h = h.Neighbour(d)
		}
	}
	return out
}

// Disc is every tile within radius of the origin, ring by ring.
func Disc(radius int64) []Hex { return DiscAt(Hex{}, radius) }

// DiscAt is every tile within radius of centre, ring by ring.
func DiscAt(centre Hex, radius int64) []Hex {
	out := make([]Hex, 0, DiscSize(radius))
	for r := int64(0); r <= radius; r++ {
		out = append(out, Ring(centre, r)...)
	}
	return out
}

// structural: a disc of radius r has 3r² + 3r + 1 tiles.
const discSides = 3

// DiscSize is the number of tiles within radius of a tile.
func DiscSize(radius int64) int64 { return discSides*radius*radius + discSides*radius + 1 }

// Rotate turns an offset by k sixths of a turn, anticlockwise.
func (h Hex) Rotate(k int64) Hex {
	k = ((k % int64(len(directions))) + int64(len(directions))) % int64(len(directions))
	for range k {
		h = Hex{-h.R, -h.S()}
	}
	return h
}

// Mirror reflects an offset across the east-west axis.
func (h Hex) Mirror() Hex { return Hex{h.Q, h.S()} }

// Less orders hexes by q, then r: the tie-break everywhere order matters.
func (h Hex) Less(o Hex) bool { return h.Q < o.Q || (h.Q == o.Q && h.R < o.R) }

// Line is the tiles on a straight walk from a to b, both included.
func Line(a, b Hex) []Hex {
	n := Distance(a, b)
	out := make([]Hex, 0, n+1)
	for i := int64(0); i <= n; i++ {
		out = append(out, lerpRound(a, b, i, n))
	}
	return out
}

// lerpRound picks the tile nearest a + (b-a)·i/n using cube rounding in
// whole numbers, scaled by n.
func lerpRound(a, b Hex, i, n int64) Hex {
	if n == 0 {
		return a
	}
	// Cube coordinates times n, nudged so ties break the same way every time.
	q := a.Q*(n-i) + b.Q*i
	r := a.R*(n-i) + b.R*i
	s := a.S()*(n-i) + b.S()*i
	rq, rr, rs := divRound(q, n), divRound(r, n), divRound(s, n)
	dq, dr, ds := abs(rq*n-q), abs(rr*n-r), abs(rs*n-s)
	switch {
	case dq > dr && dq > ds:
		rq = -rr - rs
	case dr > ds:
		rr = -rq - rs
	}
	return Hex{rq, rr}
}

// structural: rounding to the nearest whole halves the divisor.
const halves = 2

func divRound(x, n int64) int64 {
	if x >= 0 {
		return (x + n/halves) / n
	}
	return -((-x + n/halves) / n)
}
