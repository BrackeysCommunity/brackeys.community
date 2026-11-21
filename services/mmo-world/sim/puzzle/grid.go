package puzzle

// structural: side bits; east, south, west, north.
const (
	east  = 1
	south = 2
	west  = 4
	north = 8
	all   = east | south | west | north
)

var sideList = [...]int64{east, south, west, north}

func rotate(mask, turns int64) int64 {
	for range turns % sides {
		mask = (mask<<1 | mask>>(sides-1)) & all
	}
	return mask
}

func opposite(side int64) int64 { return rotate(side, halfTurn) }

// step moves a cell one side over in an n by n grid, or reports the edge.
func step(cell, side, n int64) (int64, bool) {
	x, y := cell%n, cell/n
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
	if x < 0 || y < 0 || x >= n || y >= n {
		return 0, false
	}
	return y*n + x, true
}
