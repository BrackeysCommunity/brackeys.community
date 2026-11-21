package puzzle

// structural: square side bits; east, south, west, north.
const (
	east  = 1
	south = 2
	west  = 4
	north = 8
)

// structural: hex side bits on an axial rhombus, clockwise from east.
const (
	hexE  = 1
	hexSE = 2
	hexSW = 4
	hexW  = 8
	hexNW = 16
	hexNE = 32
)

// structural: the shape whose boards are hex, and a hex cell's sides.
const (
	hexShape = 1
	hexSides = 6
)

// board is a grid's sides: a side is a bit, and side d (counted from
// east) is bit d, so a mask turns by shifting.
type board struct {
	sides int64
	list  []int64
	hex   bool
}

var (
	square = board{sides: sides, list: []int64{east, south, west, north}}
	hexes  = board{sides: hexSides, list: []int64{hexE, hexSE, hexSW, hexW, hexNW, hexNE}, hex: true}
)

// boardOf is the board a shape's machine is laid on.
func boardOf(shape int64) board {
	if shape == hexShape {
		return hexes
	}
	return square
}

func (b board) all() int64 { return 1<<b.sides - 1 }

func (b board) rotate(mask, turns int64) int64 {
	for range turns % b.sides {
		mask = (mask<<1 | mask>>(b.sides-1)) & b.all()
	}
	return mask
}

func (b board) opposite(side int64) int64 { return b.rotate(side, b.sides/halfTurn) }

// step moves a cell one side over in an n by n board, or reports the
// edge. A hex board is a rhombus in axial coordinates, q across and r
// down.
func (b board) step(cell, side, n int64) (int64, bool) {
	x, y := cell%n, cell/n
	if b.hex {
		switch side {
		case hexE:
			x++
		case hexSE:
			y++
		case hexSW:
			x--
			y++
		case hexW:
			x--
		case hexNW:
			y--
		case hexNE:
			x++
			y--
		}
	} else {
		switch side {
		case east:
			x++
		case south:
			y++
		case west:
			x--
		case north:
			y--
		}
	}
	if x < 0 || y < 0 || x >= n || y >= n {
		return 0, false
	}
	return y*n + x, true
}
