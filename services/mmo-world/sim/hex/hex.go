// Package hex is the world's grid: axial coordinates, neighbours, rings,
// discs, distance, straight lines, and paths over the tiles a caller
// knows about.
package hex

// Hex is an axial coordinate.
type Hex struct{ Q, R int64 }

// structural: a hex has six neighbours, in this order, starting east and
// turning anticlockwise.
var directions = [...]Hex{{1, 0}, {1, -1}, {0, -1}, {-1, 0}, {-1, 1}, {0, 1}}

// structural: ring walks start this many directions round from east; a
// disc of radius r has 3r² + 3r + 1 tiles; rounding halves the divisor.
const (
	ringStartDir = 4
	discSides    = 3
	halves       = 2
)

// Directions is how many neighbours a tile has.
const Directions = len(directions)

// Direction is the offset to neighbour d, 0 east, turning anticlockwise.
func Direction(d int) Hex { return directions[d] }

func (h Hex) Add(o Hex) Hex       { return Hex{h.Q + o.Q, h.R + o.R} }
func (h Hex) Sub(o Hex) Hex       { return Hex{h.Q - o.Q, h.R - o.R} }
func (h Hex) Scale(k int64) Hex   { return Hex{h.Q * k, h.R * k} }
func (h Hex) Neighbour(d int) Hex { return h.Add(directions[d]) }
func (h Hex) S() int64            { return -h.Q - h.R }
func (h Hex) Len() int64          { return Distance(h, Hex{}) }

// Distance is the number of steps between two tiles.
func Distance(a, b Hex) int64 { return max(abs(a.Q-b.Q), abs(a.R-b.R), abs(a.S()-b.S())) }

func abs(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}

// Neighbours returns the six tiles round h, in direction order.
func (h Hex) Neighbours() [Directions]Hex {
	var out [Directions]Hex
	for d := range directions {
		out[d] = h.Neighbour(d)
	}
	return out
}

// DirectionTo is the neighbour direction of n from h, or -1 when n is not
// a neighbour.
func (h Hex) DirectionTo(n Hex) int {
	for d := range directions {
		if h.Neighbour(d) == n {
			return d
		}
	}
	return -1
}

// Ring is every tile exactly radius steps from centre, walked in order.
func Ring(centre Hex, radius int64) []Hex {
	if radius == 0 {
		return []Hex{centre}
	}
	out := make([]Hex, 0, int64(Directions)*radius)
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

// DiscSize is the number of tiles within radius of a tile.
func DiscSize(radius int64) int64 { return discSides*radius*radius + discSides*radius + 1 }

// Rotate turns an offset by k sixths of a turn, anticlockwise.
func (h Hex) Rotate(k int64) Hex {
	n := int64(Directions)
	k = ((k % n) + n) % n
	for range k {
		h = Hex{-h.R, -h.S()}
	}
	return h
}

// Mirror reflects an offset across the east-west axis.
func (h Hex) Mirror() Hex { return Hex{h.Q, h.S()} }

// Less orders hexes by q, then r: the tie-break everywhere order matters.
func (h Hex) Less(o Hex) bool { return h.Q < o.Q || (h.Q == o.Q && h.R < o.R) }

// Compare is Less as a three-way comparison, for slices.SortFunc.
func Compare(a, b Hex) int {
	switch {
	case a.Less(b):
		return -1
	case b.Less(a):
		return 1
	}
	return 0
}

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
	q := a.Q*(n-i) + b.Q*i
	r := a.R*(n-i) + b.R*i
	s := a.S()*(n-i) + b.S()*i
	rq, rr, rs := DivRound(q, n), DivRound(r, n), DivRound(s, n)
	dq, dr, ds := abs(rq*n-q), abs(rr*n-r), abs(rs*n-s)
	switch {
	case dq > dr && dq > ds:
		rq = -rr - rs
	case dr > ds:
		rr = -rq - rs
	}
	return Hex{rq, rr}
}

// DivRound divides, rounding halves away from zero.
func DivRound(x, n int64) int64 {
	if x >= 0 {
		return (x + n/halves) / n
	}
	return -((-x + n/halves) / n)
}

// FloorDiv divides, rounding toward minus infinity.
func FloorDiv(a, b int64) int64 {
	q := a / b
	if (a%b != 0) && ((a < 0) != (b < 0)) {
		q--
	}
	return q
}
