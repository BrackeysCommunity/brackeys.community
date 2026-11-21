package puzzle

// Circuit: turn tiles until power runs from Start (the source) to Goal
// (the load) and lights no trap. Tiles are kinds, Turn each tile's turns
// at rest, False the traps. Shape 1 is a hex grid on an n by n axial
// rhombus, where a turn is a sixth.
const Circuit = "circuit"

func init() { register(Circuit, circuits{}) }

// Square tile kinds.
const (
	empty = iota
	straight
	corner
	tee
	end
)

// Hex tile kinds: a wide bend turns a third, a sharp one a sixth.
const (
	hexEmpty = iota
	hexStraight
	hexWide
	hexSharp
	hexY
	hexEnd
)

// tileSet is a board's tile kinds: the sides each opens at rotation 0,
// the kinds a path is laid from, and how many kinds a decoy draws from
// (the first so many).
type tileSet struct {
	b      board
	opens  []int64
	fits   []int64
	decoys int64
}

var (
	squareTiles = tileSet{b: square, opens: []int64{empty: 0, straight: east | west, corner: east | south, tee: east | south | west, end: east},
		fits: []int64{end, straight, corner, tee}, decoys: tee + 1}
	hexTiles = tileSet{b: hexes, opens: []int64{hexEmpty: 0, hexStraight: hexE | hexW, hexWide: hexE | hexSW, hexSharp: hexE | hexSE,
		hexY: hexE | hexSW | hexNW, hexEnd: hexE}, fits: []int64{hexEnd, hexStraight, hexWide, hexSharp}, decoys: hexY + 1}
)

func tilesOf(shape int64) tileSet {
	if boardOf(shape).hex {
		return hexTiles
	}
	return squareTiles
}

// mask is the sides a tile of a kind opens at a turn.
func (ts tileSet) mask(kind, turn int64) int64 { return ts.b.rotate(ts.opens[kind], turn) }

type circuits struct{}

func (circuits) Lay(l *Layout, k Kit) {
	l.Tiles, l.Turn, l.False = circuit(tilesOf(l.Shape), l.Size, l.Decoys, k)
	l.Start, l.Goal = 0, l.Size*l.Size-1
}

// circuit lays a keyed path of tiles from the source to the load, fills
// the rest with decoys, marks traps off the path, and turns every tile.
func circuit(ts tileSet, n, traps int64, k Kit) (tiles, turn, trap []int64) {
	b := ts.b
	cells := n * n
	tiles = make([]int64, cells)
	turn = make([]int64, cells)
	path := walk(b, n, k)
	onPath := make([]bool, cells)
	for i, c := range path {
		onPath[c] = true
		var need int64
		if i > 0 {
			need |= sideTo(b, c, path[i-1], n)
		}
		if i < len(path)-1 {
			need |= sideTo(b, c, path[i+1], n)
		}
		tiles[c], turn[c] = ts.fit(need)
	}
	for c := range cells {
		if !onPath[c] {
			tiles[c] = k.below(ts.decoys)
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
		turn[c] = (turn[c] + k.below(b.sides)) % b.sides
	}
	return tiles, turn, trap
}

// walk finds a keyed self-avoiding path from the first cell to the last.
func walk(b board, n int64, k Kit) []int64 {
	goal := n*n - 1
	seen := make([]bool, n*n)
	path := []int64{0}
	seen[0] = true
	for path[len(path)-1] != goal {
		c := path[len(path)-1]
		var open []int64
		for _, sd := range b.list {
			if nb, ok := b.step(c, sd, n); ok && !seen[nb] {
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

func sideTo(b board, from, to, n int64) int64 {
	for _, sd := range b.list {
		if nb, ok := b.step(from, sd, n); ok && nb == to {
			return sd
		}
	}
	return 0
}

// fit is the tile and turn that open exactly the needed sides: on a hex
// board the angle between the two sides picks the bend.
func (ts tileSet) fit(need int64) (int64, int64) {
	for _, kind := range ts.fits {
		for t := range ts.b.sides {
			if ts.mask(kind, t) == need {
				return kind, t
			}
		}
	}
	return empty, 0
}

type circuitPlay struct {
	untimed
	l  *Layout
	ts tileSet
	at []int64 // each tile's turn
}

func (circuits) Start(l *Layout) Play {
	return &circuitPlay{l: l, ts: tilesOf(l.Shape), at: append([]int64(nil), l.Turn...)}
}

// Apply gives tile A one turn: a quarter on a square board, a sixth on a
// hex one.
func (p *circuitPlay) Apply(m Move) Status {
	if !in(m.A, p.l.Size*p.l.Size) {
		return Broke
	}
	p.at[m.A] = (p.at[m.A] + 1) % p.ts.b.sides
	return until(powered(p.l, p.ts, p.at))
}

func (p *circuitPlay) Snapshot() []int64 { return append([]int64(nil), p.at...) }

// powered: power spreads from the source through sides open on both
// tiles; the load must be lit and no trap.
func powered(l *Layout, ts tileSet, turns []int64) bool {
	n, b := l.Size, ts.b
	lit := make([]bool, n*n)
	lit[l.Start] = true
	queue := []int64{l.Start}
	for len(queue) > 0 {
		c := queue[0]
		queue = queue[1:]
		mask := ts.mask(l.Tiles[c], turns[c])
		for _, sd := range b.list {
			if mask&sd == 0 {
				continue
			}
			nb, ok := b.step(c, sd, n)
			if !ok || lit[nb] || ts.mask(l.Tiles[nb], turns[nb])&b.opposite(sd) == 0 {
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
	sd := tilesOf(l.Shape).b.sides
	for c, t := range circuitTurns(l) {
		for range (t - l.Turn[c] + sd) % sd {
			ms.add(int64(c), 0, 0)
		}
	}
	return Log{Moves: ms}
}

func (f circuits) Hints(l *Layout) []Move { return f.Solve(l).Moves }

// circuitTurns finds turns that carry power from source to load by a
// depth-first search over the tiles; other tiles keep their turn.
func circuitTurns(l *Layout) []int64 {
	n, ts := l.Size, tilesOf(l.Shape)
	b := ts.b
	turns := append([]int64(nil), l.Turn...)
	seen := make([]bool, n*n)
	var dfs func(c, from int64) bool
	dfs = func(c, from int64) bool {
		seen[c] = true
		for t := range b.sides {
			mask := ts.mask(l.Tiles[c], t)
			if from != 0 && mask&from == 0 {
				continue
			}
			turns[c] = t
			if c == l.Goal {
				if powered(l, ts, turns) {
					return true
				}
				continue
			}
			for _, sd := range b.list {
				if mask&sd == 0 || sd == from {
					continue
				}
				nb, ok := b.step(c, sd, n)
				if ok && !seen[nb] && dfs(nb, b.opposite(sd)) {
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
