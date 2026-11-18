package hex

import "slices"

// Step is the cost of entering to from from, in ticks, and whether the
// step can be taken at all. A caller answers only for tiles it knows:
// pathfinding never steps onto a tile the step function refuses.
type Step func(from, to Hex) (int64, bool)

// Path is the cheapest walk from a to b, both included, and its cost in
// ticks; ok is false when no walk exists. Every allowed step must cost at
// least minStep (one tick for terrain), so the hex distance times minStep
// bounds the cost left (A*). Ties break by Less, so the path is the same
// every time. limit, when positive, bounds how far the search spreads:
// tiles whose two distances to the ends add to more are not entered.
func Path(a, b Hex, step Step, minStep, limit int64) ([]Hex, int64, bool) {
	if a == b {
		return []Hex{a}, 0, true
	}
	cost := map[Hex]int64{a: 0}
	prev := map[Hex]Hex{}
	q := &Queue{}
	q.Push(a, Distance(a, b)*minStep)
	found := false
	for q.Len() > 0 {
		at, c := q.Pop()
		if at == b {
			found = true
			break
		}
		if c-Distance(at, b)*minStep > cost[at] {
			continue
		}
		for d := range directions {
			n := at.Neighbour(d)
			if limit > 0 && Distance(n, a)+Distance(n, b) > limit {
				continue
			}
			s, ok := step(at, n)
			if !ok {
				continue
			}
			nc := cost[at] + s
			if old, seen := cost[n]; !seen || nc < old {
				cost[n], prev[n] = nc, at
				q.Push(n, nc+Distance(n, b)*minStep)
			}
		}
	}
	if !found {
		return nil, 0, false
	}
	out := []Hex{b}
	for h := b; h != a; {
		h = prev[h]
		out = append(out, h)
	}
	slices.Reverse(out)
	return out, cost[b], true
}

// Reach is the cheapest cost from the nearest source to every tile within
// budget ticks (no bound when budget is 0), by Dijkstra.
func Reach(sources []Hex, step Step, budget int64) map[Hex]int64 {
	cost := make(map[Hex]int64, len(sources))
	q := &Queue{}
	for _, s := range sources {
		cost[s] = 0
		q.Push(s, 0)
	}
	for q.Len() > 0 {
		at, c := q.Pop()
		if c > cost[at] {
			continue
		}
		for d := range directions {
			n := at.Neighbour(d)
			s, ok := step(at, n)
			if !ok {
				continue
			}
			nc := c + s
			if budget > 0 && nc > budget {
				continue
			}
			if old, seen := cost[n]; !seen || nc < old {
				cost[n] = nc
				q.Push(n, nc)
			}
		}
	}
	return cost
}

// Queue is a min-heap of tiles by cost; ties pop in Less order.
type Queue struct{ items []queued }

type queued struct {
	at   Hex
	cost int64
}

func (q *Queue) Len() int { return len(q.items) }

func (q *Queue) less(i, j int) bool {
	a, b := q.items[i], q.items[j]
	if a.cost != b.cost {
		return a.cost < b.cost
	}
	return a.at.Less(b.at)
}

// Push adds a tile at a cost.
func (q *Queue) Push(h Hex, cost int64) {
	q.items = append(q.items, queued{h, cost})
	i := len(q.items) - 1
	for i > 0 {
		p := (i - 1) / halves
		if !q.less(i, p) {
			break
		}
		q.items[i], q.items[p] = q.items[p], q.items[i]
		i = p
	}
}

// Pop removes the cheapest tile.
func (q *Queue) Pop() (Hex, int64) {
	top := q.items[0]
	n := len(q.items) - 1
	q.items[0] = q.items[n]
	q.items = q.items[:n]
	i := 0
	for {
		l, r, m := halves*i+1, halves*i+halves, i
		if l < n && q.less(l, m) {
			m = l
		}
		if r < n && q.less(r, m) {
			m = r
		}
		if m == i {
			return top.at, top.cost
		}
		q.items[i], q.items[m] = q.items[m], q.items[i]
		i = m
	}
}

// Reset empties the queue and keeps its storage.
func (q *Queue) Reset() { q.items = q.items[:0] }
