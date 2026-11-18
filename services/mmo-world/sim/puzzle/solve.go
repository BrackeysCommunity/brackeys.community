package puzzle

// Solve finds a move log that solves a layout, one move a second apart:
// what a hint draws from, and what the harness's bench player presses.
func Solve(l Layout) []Move {
	var ms []Move
	add := func(a, b, c int64) { ms = append(ms, Move{At: int64(len(ms)) * msPerSecond, A: a, B: b, C: c}) }
	switch l.Family {
	case Rewire:
		for w, p := range l.Target {
			add(int64(w), p, 0)
		}
	case Pins:
		for _, p := range l.Order {
			add(p, l.Target[p], 0)
		}
	case Dial:
		for i, t := range l.Target {
			add(int64(i), t, l.Turn[i])
		}
	case Maze:
		for _, d := range mazePath(l) {
			add(d, 0, 0)
		}
	case Circuit:
		turns := circuitTurns(l)
		for c, t := range turns {
			for range (t - l.Turn[c] + sides) % sides {
				add(int64(c), 0, 0)
			}
		}
	case Signal:
		for i, t := range l.Target {
			add(int64(i), t, 0)
		}
	case Fuse:
		for _, f := range l.Order {
			add(f, 0, 0)
		}
	case Override:
		for r := range l.Size {
			for _, x := range l.Order[:r+1] {
				add(x, 0, 0)
			}
		}
	}
	return ms
}

// mazePath is the shortest run of tilts from start to goal.
func mazePath(l Layout) []int64 {
	n := l.Size
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
		for d := range int64(sides) {
			sd := int64(east) << d
			if l.Walls[c]&sd != 0 {
				continue
			}
			nb, ok := step(c, sd, n)
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

// circuitTurns finds turns that carry power from source to load by a
// depth-first search over the tiles; other tiles keep their turn.
func circuitTurns(l Layout) []int64 {
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
