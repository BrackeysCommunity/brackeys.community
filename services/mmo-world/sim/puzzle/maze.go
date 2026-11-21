package puzzle

// Tumbler maze: tilt the bit from Start to Goal. Walls[cell] has a bit
// set for each closed side. Shape 1 is a hex maze on an n by n axial
// rhombus, six sides a cell.
const Maze = "lock-maze"

func init() { register(Maze, mazes{}) }

type mazes struct{}

func (mazes) Lay(l *Layout, k Kit) {
	l.Walls = maze(boardOf(l.Shape), l.Size, l.Decoys, k)
	l.Start, l.Goal = 0, l.Size*l.Size-1
}

// maze carves a perfect maze by a keyed depth-first walk, then knocks
// out extra walls, which make loops and false leads.
func maze(b board, n, extra int64, k Kit) []int64 {
	walls := make([]int64, n*n)
	for i := range walls {
		walls[i] = b.all()
	}
	seen := make([]bool, n*n)
	stack := []int64{0}
	seen[0] = true
	for len(stack) > 0 {
		c := stack[len(stack)-1]
		var open []int64
		for _, sd := range b.list {
			if nb, ok := b.step(c, sd, n); ok && !seen[nb] {
				open = append(open, sd)
			}
		}
		if len(open) == 0 {
			stack = stack[:len(stack)-1]
			continue
		}
		sd := open[k.below(int64(len(open)))]
		nb, _ := b.step(c, sd, n)
		walls[c] &^= sd
		walls[nb] &^= b.opposite(sd)
		seen[nb] = true
		stack = append(stack, nb)
	}
	for range extra {
		c := k.below(n * n)
		sd := b.list[k.below(b.sides)]
		if nb, ok := b.step(c, sd, n); ok {
			walls[c] &^= sd
			walls[nb] &^= b.opposite(sd)
		}
	}
	return walls
}

type mazePlay struct {
	untimed
	l    *Layout
	b    board
	cell int64 // where the bit is
}

func (mazes) Start(l *Layout) Play { return &mazePlay{l: l, b: boardOf(l.Shape), cell: l.Start} }

// Apply tilts toward side A (east, then clockwise round the board's
// sides): the bit rolls one cell unless a wall stops it.
func (p *mazePlay) Apply(m Move) Status {
	if !in(m.A, p.b.sides) {
		return Broke
	}
	sd := int64(1) << m.A
	if p.l.Walls[p.cell]&sd == 0 {
		p.cell, _ = p.b.step(p.cell, sd, p.l.Size)
	}
	return until(p.cell == p.l.Goal)
}

func (p *mazePlay) Snapshot() []int64 { return []int64{p.cell} }

func (mazes) Solve(l *Layout) Log {
	var ms presses
	for _, d := range mazePath(l) {
		ms.add(d, 0, 0)
	}
	return Log{Moves: ms}
}

func (f mazes) Hints(l *Layout) []Move { return f.Solve(l).Moves }

// mazePath is the shortest run of tilts from start to goal.
func mazePath(l *Layout) []int64 {
	n, b := l.Size, boardOf(l.Shape)
	prev := make([]int64, n*n)
	how := make([]int64, n*n)
	for i := range prev {
		prev[i] = -1
	}
	prev[l.Start] = l.Start
	queue := []int64{l.Start}
	for len(queue) > 0 && prev[l.Goal] < 0 {
		c := queue[0]
		queue = queue[1:]
		for d := range b.sides {
			sd := int64(1) << d
			if l.Walls[c]&sd != 0 {
				continue
			}
			nb, ok := b.step(c, sd, n)
			if ok && prev[nb] < 0 {
				prev[nb], how[nb] = c, d
				queue = append(queue, nb)
			}
		}
	}
	var out []int64
	for c := l.Goal; c != l.Start; c = prev[c] {
		out = append([]int64{how[c]}, out...)
	}
	return out
}
