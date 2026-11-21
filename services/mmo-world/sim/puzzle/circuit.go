package puzzle

// Circuit: turn tiles until power runs from Start (the source) to Goal
// (the load) and lights no trap. Tiles are kinds, Turn each tile's
// quarter turns at rest, False the traps.
const Circuit = "circuit"

func init() { register(Circuit, circuits{}) }

// Tile kinds, and the sides each opens at rotation 0.
const (
	empty = iota
	straight
	corner
	tee
	end
)

var opens = [...]int64{empty: 0, straight: east | west, corner: east | south, tee: east | south | west, end: east}

type circuits struct{}

func (circuits) Lay(l *Layout, k Kit) {
	l.Tiles, l.Turn, l.False = circuit(l.Size, l.Decoys, k)
	l.Start, l.Goal = 0, l.Size*l.Size-1
}

// circuit lays a keyed path of tiles from the source to the load, fills
// the rest with decoys, marks traps off the path, and turns every tile.
func circuit(n, traps int64, k Kit) (tiles, turn, trap []int64) {
	cells := n * n
	tiles = make([]int64, cells)
	turn = make([]int64, cells)
	path := walk(n, k)
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
			tiles[c] = k.below(tee + 1)
		}
	}
	for range traps {
		c := k.below(cells)
		if !onPath[c] {
			trap = append(trap, c)
		}
	}
	for c := range cells {
		// The solved turn is hidden behind a keyed scramble.
		turn[c] = (turn[c] + k.below(sides)) % sides
	}
	return tiles, turn, trap
}

// walk finds a keyed self-avoiding path from the first cell to the last.
func walk(n int64, k Kit) []int64 {
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
		nb := open[k.below(int64(len(open)))]
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
	for _, kind := range []int64{end, straight, corner, tee} {
		for t := range int64(sides) {
			if rotate(opens[kind], t) == need {
				return kind, t
			}
		}
	}
	return empty, 0
}

type circuitPlay struct {
	untimed
	l  *Layout
	at []int64 // each tile's turn
}

func (circuits) Start(l *Layout) Play {
	return &circuitPlay{l: l, at: append([]int64(nil), l.Turn...)}
}

// Apply gives tile A a quarter turn.
func (p *circuitPlay) Apply(m Move) Status {
	if !in(m.A, p.l.Size*p.l.Size) {
		return Broke
	}
	p.at[m.A] = (p.at[m.A] + 1) % sides
	return until(powered(p.l, p.at))
}

func (p *circuitPlay) Snapshot() []int64 { return append([]int64(nil), p.at...) }

// powered: power spreads from the source through sides open on both
// tiles; the load must be lit and no trap.
func powered(l *Layout, turns []int64) bool {
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

func (circuits) Solve(l *Layout) Log {
	var ms presses
	for c, t := range circuitTurns(l) {
		for range (t - l.Turn[c] + sides) % sides {
			ms.add(int64(c), 0, 0)
		}
	}
	return Log{Moves: ms}
}

func (f circuits) Hints(l *Layout) []Move { return f.Solve(l).Moves }

// circuitTurns finds turns that carry power from source to load by a
// depth-first search over the tiles; other tiles keep their turn.
func circuitTurns(l *Layout) []int64 {
	n := l.Size
	turns := append([]int64(nil), l.Turn...)
	seen := make([]bool, n*n)
	var dfs func(c, from int64) bool
	dfs = func(c, from int64) bool {
		seen[c] = true
		for t := range int64(sides) {
			mask := rotate(opens[l.Tiles[c]], t)
			if from != 0 && mask&from == 0 {
				continue
			}
			turns[c] = t
			if c == l.Goal {
				if powered(l, turns) {
					return true
				}
				continue
			}
			for _, sd := range sideList {
				if mask&sd == 0 || sd == from {
					continue
				}
				nb, ok := step(c, sd, n)
				if ok && !seen[nb] && dfs(nb, opposite(sd)) {
					return true
				}
			}
		}
		seen[c] = false
		turns[c] = l.Turn[c]
		return false
	}
	dfs(l.Start, 0)
	return turns
}
