package puzzle

import "jams.team/mmo-world/sim/draw"

// Tile kinds in a circuit, and the sides each opens at rotation 0, as a
// bitmask over east, south, west, north.
const (
	empty = iota
	straight
	corner
	tee
	end
)

// structural: side bits; east, south, west, north.
const (
	east  = 1
	south = 2
	west  = 4
	north = 8
	all   = east | south | west | north
)

var opens = [...]int64{empty: 0, straight: east | west, corner: east | south, tee: east | south | west, end: east}

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

var sideList = [...]int64{east, south, west, north}

// maze carves a perfect maze by a keyed depth-first walk, then knocks
// out extra walls, which make loops and false leads. Walls[cell] has a
// bit set for each closed side.
func maze(n, extra int64, s *draw.Stream) []int64 {
	walls := make([]int64, n*n)
	for i := range walls {
		walls[i] = all
	}
	seen := make([]bool, n*n)
	stack := []int64{0}
	seen[0] = true
	for len(stack) > 0 {
		c := stack[len(stack)-1]
		var open []int64
		for _, sd := range sideList {
			if nb, ok := step(c, sd, n); ok && !seen[nb] {
				open = append(open, sd)
			}
		}
		if len(open) == 0 {
			stack = stack[:len(stack)-1]
			continue
		}
		sd := open[s.Below(uint64(len(open)))]
		nb, _ := step(c, sd, n)
		walls[c] &^= sd
		walls[nb] &^= opposite(sd)
		seen[nb] = true
		stack = append(stack, nb)
	}
	for range extra {
		c := int64(s.Below(uint64(n * n)))
		sd := sideList[s.Below(uint64(sides))]
		if nb, ok := step(c, sd, n); ok {
			walls[c] &^= sd
			walls[nb] &^= opposite(sd)
		}
	}
	return walls
}

// circuit lays a keyed path of tiles from the source to the load, fills
// the rest with decoys, marks traps off the path, and turns every tile.
func circuit(n, traps int64, s *draw.Stream) (tiles, turn, trap []int64) {
	cells := n * n
	tiles = make([]int64, cells)
	turn = make([]int64, cells)
	path := walk(n, s)
	onPath := make([]bool, cells)
	for i, c := range path {
		onPath[c] = true
		var need int64
		if i > 0 {
			need |= sideTo(c, path[i-1], n)
		}
		if i < len(path)-1 {
			need |= sideTo(c, path[i+1], n)
		}
		tiles[c], turn[c] = fit(need)
	}
	for c := range cells {
		if !onPath[c] {
			tiles[c] = int64(s.Below(uint64(tee + 1)))
		}
	}
	for range traps {
		c := int64(s.Below(uint64(cells)))
		if !onPath[c] {
			trap = append(trap, c)
		}
	}
	for c := range cells {
		// The solved turn is hidden behind a keyed scramble.
		turn[c] = (turn[c] + int64(s.Below(uint64(sides)))) % sides
	}
	return tiles, turn, trap
}

// walk finds a keyed self-avoiding path from the first cell to the last.
func walk(n int64, s *draw.Stream) []int64 {
	goal := n*n - 1
	seen := make([]bool, n*n)
	path := []int64{0}
	seen[0] = true
	for path[len(path)-1] != goal {
		c := path[len(path)-1]
		var open []int64
		for _, sd := range sideList {
			if nb, ok := step(c, sd, n); ok && !seen[nb] {
				open = append(open, nb)
			}
		}
		if len(open) == 0 {
			path = path[:len(path)-1]
			continue
		}
		nb := open[s.Below(uint64(len(open)))]
		seen[nb] = true
		path = append(path, nb)
	}
	return path
}

func sideTo(from, to, n int64) int64 {
	for _, sd := range sideList {
		if nb, ok := step(from, sd, n); ok && nb == to {
			return sd
		}
	}
	return 0
}

// fit is the tile and turn that open exactly the needed sides.
func fit(need int64) (int64, int64) {
	for _, k := range []int64{end, straight, corner, tee} {
		for t := range int64(sides) {
			if rotate(opens[k], t) == need {
				return k, t
			}
		}
	}
	return empty, 0
}

// state is a machine mid-solve.
type state struct {
	at    []int64 // rewire: each wire's port; circuit: each tile's turn
	k     int64   // progress through an ordered solve
	cell  int64   // maze: where the bit is
	knobs []int64
	seq   []int64 // override: the presses expected
}

func newState(l Layout) *state {
	st := &state{}
	switch l.Family {
	case Rewire:
		st.at = make([]int64, l.Size)
		for i := range st.at {
			st.at[i] = int64(i)
		}
	case Circuit:
		st.at = append([]int64(nil), l.Turn...)
	case Maze:
		st.cell = l.Start
	case Signal:
		st.knobs = make([]int64, l.Size)
	case Override:
		for r := range l.Size {
			st.seq = append(st.seq, l.Order[:r+1]...)
		}
	}
	return st
}

func in(x, n int64) bool { return x >= 0 && x < n }

// apply plays one move. ok is false when the move breaks the machine.
func (st *state) apply(l Layout, m Move) (ok, done bool) {
	n := l.Size
	switch l.Family {
	case Rewire:
		if !in(m.A, n) || !in(m.B, n) {
			return false, false
		}
		for w, p := range st.at {
			if p == m.B {
				st.at[w] = st.at[m.A]
			}
		}
		st.at[m.A] = m.B
		for w, p := range st.at {
			if p != l.Target[w] {
				return true, false
			}
		}
		return true, true
	case Pins:
		switch {
		case !in(m.A, n+int64(len(l.False))):
			return false, false
		case m.A == l.Order[st.k] && m.B == l.Target[m.A]:
			st.k++
		default:
			st.k = 0
		}
		return true, st.k == n
	case Dial:
		switch {
		case !in(m.A, n):
			return false, false
		case m.A != st.k:
			st.k = 0
		case m.B == l.Target[m.A] && m.C == l.Turn[m.A]:
			st.k++
		}
		return true, st.k == n
	case Maze:
		if !in(m.A, sides) {
			return false, false
		}
		sd := int64(east) << m.A
		if l.Walls[st.cell]&sd == 0 {
			st.cell, _ = step(st.cell, sd, n)
		}
		return true, st.cell == l.Goal
	case Circuit:
		if !in(m.A, n*n) {
			return false, false
		}
		st.at[m.A] = (st.at[m.A] + 1) % sides
		return true, powered(l, st.at)
	case Signal:
		if !in(m.A, n) || !in(m.B, l.Range) {
			return false, false
		}
		st.knobs[m.A] = m.B
		for i, v := range st.knobs {
			if v != l.Target[i] {
				return true, false
			}
		}
		return true, true
	case Fuse:
		if m.A != l.Order[st.k] {
			return false, false
		}
		st.k++
		return true, st.k == n
	case Override:
		if m.A != st.seq[st.k] {
			return false, false
		}
		st.k++
		return true, st.k == int64(len(st.seq))
	}
	return false, false
}

// powered: power spreads from the source through sides open on both
// tiles; the load must be lit and no trap.
func powered(l Layout, turns []int64) bool {
	n := l.Size
	lit := make([]bool, n*n)
	lit[l.Start] = true
	queue := []int64{l.Start}
	for len(queue) > 0 {
		c := queue[0]
		queue = queue[1:]
		mask := rotate(opens[l.Tiles[c]], turns[c])
		for _, sd := range sideList {
			if mask&sd == 0 {
				continue
			}
			nb, ok := step(c, sd, n)
			if !ok || lit[nb] || rotate(opens[l.Tiles[nb]], turns[nb])&opposite(sd) == 0 {
				continue
			}
			lit[nb] = true
			queue = append(queue, nb)
		}
	}
	for _, t := range l.False {
		if lit[t] {
			return false
		}
	}
	return lit[l.Goal]
}
