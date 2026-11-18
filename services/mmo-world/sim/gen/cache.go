package gen

// structural: caches keep tiles and noise points in square blocks, so a
// sweep's maps hold one entry per block instead of one per tile.
const (
	blockShift = 4
	blockSide  = 1 << blockShift
	blockMask  = blockSide - 1
	blockArea  = blockSide * blockSide
)

// tileCache remembers a pure answer per tile.
type tileCache[T any] struct {
	blocks map[Hex]*tileBlock[T]
	lastAt Hex
	last   *tileBlock[T]
}

type tileBlock[T any] struct {
	v   [blockArea]T
	set [blockArea]bool
}

func newTileCache[T any]() tileCache[T] { return tileCache[T]{blocks: map[Hex]*tileBlock[T]{}} }

func blockOf(h Hex) (Hex, int) {
	return Hex{Q: h.Q >> blockShift, R: h.R >> blockShift}, int(h.Q&blockMask)<<blockShift | int(h.R&blockMask)
}

func (c *tileCache[T]) block(at Hex, make bool) *tileBlock[T] {
	if c.last != nil && c.lastAt == at {
		return c.last
	}
	b, ok := c.blocks[at]
	if !ok {
		if !make {
			return nil
		}
		b = &tileBlock[T]{}
		c.blocks[at] = b
	}
	c.lastAt, c.last = at, b
	return b
}

func (c *tileCache[T]) get(h Hex) (T, bool) {
	at, i := blockOf(h)
	if b := c.block(at, false); b != nil && b.set[i] {
		return b.v[i], true
	}
	var zero T
	return zero, false
}

func (c *tileCache[T]) put(h Hex, v T) {
	at, i := blockOf(h)
	b := c.block(at, true)
	b.v[i], b.set[i] = v, true
}

// noiseCache remembers keyed lattice values per field and octave.
type noiseCache struct {
	blocks map[noiseKey]*[blockArea]int64
}

type noiseKey struct {
	field, octave int32
	bi, bj        int64
}

// unset marks a lattice value not drawn yet; drawn values are never
// negative.
const unset = -1

// blockFor is the block holding lattice point (i, j) of a field's
// octave, made on first use.
func (c *noiseCache) blockFor(field int, octave, i, j int64) *[blockArea]int64 {
	k := noiseKey{int32(field), int32(octave), i >> blockShift, j >> blockShift}
	b, ok := c.blocks[k]
	if !ok {
		b = new([blockArea]int64)
		for n := range b {
			b[n] = unset
		}
		c.blocks[k] = b
	}
	return b
}

func noiseSlot(i, j int64) int { return int(i&blockMask)<<blockShift | int(j&blockMask) }
