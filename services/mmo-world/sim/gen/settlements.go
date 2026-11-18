package gen

import "slices"

// Starting settlements sit on a jittered lattice, skipping points inside
// (or within the clearance of) the areas of origin-anchored patterns, so
// none starts inside the Eye. They open nearest the origin first (GDD 4.17).

type originArea struct {
	centre Hex
	extent int64
}

func (g *Gen) areasAtOrigin() []originArea {
	var out []originArea
	for ri, r := range g.b.Patterns {
		if r.Anchor != anchorOrigin || r.Area == "" {
			continue
		}
		in := g.instance(ri, anchorOrigin, Hex{})
		out = append(out, originArea{in.centre, in.extent})
	}
	return out
}

func (g *Gen) isHome(id LatticeID) bool {
	if v, ok := g.homeValid[id]; ok {
		return v
	}
	h := g.homes.At(id)
	// A lattice point whose jitter found no dry land holds no settlement.
	ok := g.passable(g.raw(h).terrain)
	for _, a := range g.originAreas {
		if Distance(h, a.centre) <= a.extent+g.p.homeClear {
			ok = false
		}
	}
	g.homeValid[id] = ok
	return ok
}

// homesNear lists the starting settlements within reach of h. N is filled
// in from the opening order.
func (g *Gen) homesNear(h Hex, reach int64) []Settlement {
	var out []Settlement
	for _, id := range g.homes.Near(h, reach) {
		if g.isHome(id) {
			out = append(out, Settlement{N: g.rank(id), ID: id, Hex: g.homes.At(id)})
		}
	}
	return out
}

// Settlement is the nth starting settlement in opening order: nearest the
// origin first, ties to the lower lattice id. A server opens them one at
// a time.
func (g *Gen) Settlement(n int) Settlement {
	for len(g.homeOrder) <= n {
		g.extendHomes()
	}
	id := g.homeOrder[n]
	return Settlement{N: n, ID: id, Hex: g.homes.At(id)}
}

func (g *Gen) rank(id LatticeID) int {
	for {
		if n, ok := g.homeRank[id]; ok {
			return n
		}
		g.extendHomes()
	}
}

// extendHomes orders one more lattice ring. A point on lattice ring k lies
// within the jitter of k·spacing from the origin, and the jitter is under
// half the spacing, so once ring k+1 is in the sort every point of rings
// up to k has its final place.
func (g *Gen) extendHomes() {
	k := int64(0)
	if len(g.homeOrder) > 0 {
		last := g.homeOrder[len(g.homeOrder)-1]
		k = Hex{last.I, last.J}.Len() + 1
	}
	for {
		var ids []LatticeID
		for ring := int64(0); ring <= k+1; ring++ {
			for _, h := range Ring(Hex{}, ring) {
				if id := (LatticeID{h.Q, h.R}); g.isHome(id) {
					ids = append(ids, id)
				}
			}
		}
		slices.SortFunc(ids, func(a, b LatticeID) int {
			da, db := g.homes.At(a).Len(), g.homes.At(b).Len()
			switch {
			case da != db:
				return int(da - db)
			case a.I != b.I:
				return int(a.I - b.I)
			}
			return int(a.J - b.J)
		})
		exact := 0
		for _, id := range ids {
			if (Hex{id.I, id.J}).Len() <= k {
				exact++
			}
		}
		if exact > len(g.homeOrder) {
			g.homeOrder = ids[:exact]
			for n, id := range g.homeOrder {
				g.homeRank[id] = n
			}
			return
		}
		k++
	}
}

// nearestHome is the distance from h to the nearest starting settlement.
func (g *Gen) nearestHome(h Hex) int64 {
	for reach := g.p.homeSpacing; ; reach += g.p.homeSpacing {
		best := int64(-1)
		for _, id := range g.homes.Near(h, reach) {
			if !g.isHome(id) {
				continue
			}
			if d := Distance(g.homes.At(id), h); best < 0 || d < best {
				best = d
			}
		}
		if best >= 0 {
			return best
		}
	}
}

// TierAt is a tile's tier when the first opened starting settlements are
// open: 1 at an open settlement, one more per tier step, to the tier
// ceiling. Only settlements within the ceiling's reach can lower it, so it
// reads a bounded neighbourhood.
func (g *Gen) TierAt(h Hex, opened int) int64 {
	reach := g.p.tierStep * (g.p.tierCeiling - 1)
	best := int64(-1)
	for _, s := range g.homesNear(h, reach) {
		if s.N >= opened {
			continue
		}
		if d := Distance(s.Hex, h); best < 0 || d < best {
			best = d
		}
	}
	if best < 0 {
		return g.p.tierCeiling
	}
	return min(g.p.tierCeiling, 1+best/g.p.tierStep)
}
