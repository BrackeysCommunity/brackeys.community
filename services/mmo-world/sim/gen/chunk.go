package gen

import "jams.team/mmo-world/sim/hex"

// ChunkCoord names a chunk: a hex of tiles of the chunk radius. Chunks tile
// the plane; chunk (A, B) is centred at A·(2n+1, −n) + B·(n, n+1).
type ChunkCoord struct{ A, B int64 }

// structural: the hex-of-hexes lattice's basis, in multiples of the chunk
// radius n: (2n+1, −n) and (n, n+1).
const basisTwice = 2

type chunker struct{ n int64 }

func (c chunker) det() int64 { return hex.DiscSize(c.n) }

func (c chunker) Centre(cc ChunkCoord) Hex {
	n := c.n
	return Hex{Q: cc.A*(basisTwice*n+1) + cc.B*n, R: -cc.A*n + cc.B*(n+1)}
}

// Of finds the chunk holding h: invert the basis, then take the corner of
// the cell whose hex holds it.
func (c chunker) Of(h Hex) ChunkCoord {
	n, det := c.n, c.det()
	a := hex.FloorDiv((n+1)*h.Q-n*h.R, det)
	b := hex.FloorDiv(n*h.Q+(basisTwice*n+1)*h.R, det)
	for da := int64(-1); da <= basisTwice; da++ {
		for db := int64(-1); db <= basisTwice; db++ {
			cc := ChunkCoord{a + da, b + db}
			if hex.Distance(c.Centre(cc), h) <= n {
				return cc
			}
		}
	}
	panic("gen: no chunk holds a tile")
}

// Near is every chunk whose hex comes within reach of h, in a fixed order.
func (c chunker) Near(h Hex, reach int64) []ChunkCoord {
	n := c.n
	span := (reach+n)/n + 1
	home := c.Of(h)
	var out []ChunkCoord
	for da := -span; da <= span; da++ {
		for db := -span; db <= span; db++ {
			cc := ChunkCoord{home.A + da, home.B + db}
			if hex.Distance(c.Centre(cc), h) <= reach+n {
				out = append(out, cc)
			}
		}
	}
	return out
}
