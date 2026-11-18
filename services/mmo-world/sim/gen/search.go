package gen

import "jams.team/mmo-world/sim/hex"

// corridorSearch is the corridor A* on a dense box round its start,
// reused from one corridor to the next so a sweep allocates nothing per
// search. Stamps mark which entries belong to the current search.
type corridorSearch struct {
	cost  []int64
	prev  []int32
	stamp []uint32
	now   uint32
	q     hex.Queue
}

// run is the cheapest walk from `from` to `to` among tiles whose two
// distances to the ends add up to at most limit, listed from `to` back to
// `from`. A passable tile costs its terrain's ticks; one that must yield
// costs the wall. Every step costs at least one tick, so the hex distance
// left bounds the cost left. Ties pop in hex order.
func (s *corridorSearch) run(g *Gen, from, to Hex, limit int64) []Hex {
	side := halves*limit + 1
	if n := int(side * side); len(s.cost) < n {
		s.cost, s.prev, s.stamp = make([]int64, n), make([]int32, n), make([]uint32, n)
		s.now = 0
	}
	s.now++
	at := func(h Hex) int32 { return int32((h.Q-from.Q+limit)*side + h.R - from.R + limit) }
	hexAt := func(i int32) Hex {
		return Hex{Q: int64(i)/side - limit + from.Q, R: int64(i)%side - limit + from.R}
	}
	seen := func(i int32) bool { return s.stamp[i] == s.now }
	start := at(from)
	s.stamp[start], s.cost[start] = s.now, 0
	s.q.Reset()
	s.q.Push(from, Distance(from, to))
	for s.q.Len() > 0 {
		h, c := s.q.Pop()
		if h == to {
			break
		}
		hi := at(h)
		if c-Distance(h, to) > s.cost[hi] {
			continue
		}
		for d := range nDirs {
			n := h.Neighbour(d)
			if Distance(n, from)+Distance(n, to) > limit {
				continue
			}
			step := g.p.wall
			if r := g.raw(n); r.ter.Passable {
				step = r.ter.EnterTicks
			}
			ni := at(n)
			nc := s.cost[hi] + step
			if !seen(ni) || nc < s.cost[ni] {
				s.stamp[ni], s.cost[ni], s.prev[ni] = s.now, nc, hi
				s.q.Push(n, nc+Distance(n, to))
			}
		}
	}
	out := []Hex{to}
	for i := at(to); i != start; {
		i = s.prev[i]
		out = append(out, hexAt(i))
	}
	return out
}
