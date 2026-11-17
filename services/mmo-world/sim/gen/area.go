package gen

import "slices"

// Area is a bounded piece of the world gathered from chunks: a disc of
// tiles, or the regions a horizon has discovered. Walking is confined to
// it, so anything it finds reachable is reachable in the whole world.
type Area struct {
	Centre     Hex
	Radius     int64
	Tiles      []TileBaseline
	TileRegion []int // per tile, its index in Regions
	Regions    []Region
	Points     []PatternPoint
	Homes      []Settlement

	g     *Gen
	index map[Hex]int
}

// Region is one region of an area: its baseline and its tiles there.
type Region struct {
	ID         int
	Base       *RegionBaseline
	Tiles      []int
	Neighbours []int
}

// DiscArea is every tile within radius of centre.
func (g *Gen) DiscArea(centre Hex, radius int64) *Area {
	return g.area(centre, radius, DiscAt(centre, radius))
}

// Discovered is every tile of every region whose centre lies within radius
// of centre: the regions a horizon of that size would hold.
func (g *Gen) Discovered(centre Hex, radius int64) *Area {
	ids := g.regions.Near(centre, radius)
	var tiles []Hex
	for _, id := range ids {
		tiles = append(tiles, g.regionTiles(id)...)
	}
	return g.area(centre, radius, tiles)
}

func (g *Gen) area(centre Hex, radius int64, tiles []Hex) *Area {
	a := &Area{Centre: centre, Radius: radius, g: g, index: make(map[Hex]int, len(tiles))}
	byID := map[LatticeID]int{}
	var seenChunks []ChunkCoord
	seen := map[ChunkCoord]bool{}
	for i, h := range tiles {
		t := g.Baseline(h)
		a.index[h] = i
		a.Tiles = append(a.Tiles, t)
		r, ok := byID[t.Region]
		if !ok {
			r = len(a.Regions)
			byID[t.Region] = r
			a.Regions = append(a.Regions, Region{ID: r, Base: g.Region(t.Region)})
		}
		a.TileRegion = append(a.TileRegion, r)
		a.Regions[r].Tiles = append(a.Regions[r].Tiles, i)
		if cc := g.ch.Of(h); !seen[cc] {
			seen[cc] = true
			seenChunks = append(seenChunks, cc)
		}
	}
	for _, cc := range seenChunks {
		c := g.Chunk(cc)
		for _, p := range c.Points {
			if _, ok := a.index[p.Hex]; ok {
				a.Points = append(a.Points, p)
			}
		}
		for _, s := range c.Settlements {
			if _, ok := a.index[s.Hex]; ok {
				a.Homes = append(a.Homes, s)
			}
		}
	}
	slices.SortFunc(a.Homes, func(x, y Settlement) int { return x.N - y.N })
	for id := range a.Regions {
		r := &a.Regions[id]
		for _, t := range r.Tiles {
			for _, n := range a.Neighbours(t) {
				if nr := a.TileRegion[n]; nr != id && !slices.Contains(r.Neighbours, nr) {
					r.Neighbours = append(r.Neighbours, nr)
				}
			}
		}
		slices.Sort(r.Neighbours)
	}
	return a
}

// RegionTier is region r's tier with the first opened settlements open:
// its centre's tier.
func (a *Area) RegionTier(r, opened int) int64 { return a.g.TierAt(a.Regions[r].Base.Centre, opened) }

// TileTier is tile i's tier with the first opened settlements open.
func (a *Area) TileTier(i, opened int) int64 { return a.g.TierAt(a.Tiles[i].Hex, opened) }

// Settlement is the nth starting settlement of the world the area is from.
func (a *Area) Settlement(n int) Settlement { return a.g.Settlement(n) }

// Index returns the tile index of h, or -1 outside the area.
func (a *Area) Index(h Hex) int {
	if i, ok := a.index[h]; ok {
		return i
	}
	return -1
}

func (a *Area) Passable(i int) bool { return a.g.passable(a.Tiles[i].Terrain) }

// EnterTicks is the cost of stepping from tile i onto tile j.
func (a *Area) EnterTicks(i, j int) int64 {
	tj := a.Tiles[j]
	enter := a.g.terrain[tj.Terrain].EnterTicks
	if tj.River {
		if a.Tiles[i].River {
			return a.g.p.along
		}
		return max(a.g.p.across, enter)
	}
	return enter
}

// Neighbours returns the in-area neighbours of tile i, in direction order.
func (a *Area) Neighbours(i int) []int {
	out := make([]int, 0, len(directions))
	for d := range directions {
		if j := a.Index(a.Tiles[i].Hex.Neighbour(d)); j >= 0 {
			out = append(out, j)
		}
	}
	return out
}

// Settlements returns the starting settlements' tile indices, in opening
// order.
func (a *Area) Settlements() []int {
	out := make([]int, 0, len(a.Homes))
	for _, s := range a.Homes {
		out = append(out, a.Index(s.Hex))
	}
	return out
}

// Walk returns the ticks from the nearest source to every tile, -1 where
// no source can reach on foot inside the area.
func (a *Area) Walk(sources []int) []int64 {
	dist := make([]int64, len(a.Tiles))
	for i := range dist {
		dist[i] = -1
	}
	pq := &queue{}
	for _, s := range sources {
		dist[s] = 0
		pq.push(item{a.Tiles[s].Hex, 0})
	}
	for pq.Len() > 0 {
		it := pq.pop()
		i := a.index[it.at]
		if it.cost > dist[i] {
			continue
		}
		for _, n := range a.Neighbours(i) {
			if !a.Passable(n) {
				continue
			}
			c := it.cost + a.EnterTicks(i, n)
			if dist[n] < 0 || c < dist[n] {
				dist[n] = c
				pq.push(item{a.Tiles[n].Hex, c})
			}
		}
	}
	return dist
}
