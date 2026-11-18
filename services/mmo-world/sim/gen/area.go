package gen

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/hex"
)

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
	return g.area(centre, radius, hex.DiscAt(centre, radius))
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
	return a.g.StepTicks(tj.Terrain, a.Tiles[i].River, tj.River)
}

// Neighbours returns the in-area neighbours of tile i, in direction order.
func (a *Area) Neighbours(i int) []int {
	out := make([]int, 0, nDirs)
	for d := range nDirs {
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

// step is a move on foot between neighbouring tiles of the area.
func (a *Area) step(from, to Hex) (int64, bool) {
	n := a.Index(to)
	if n < 0 || !a.Passable(n) {
		return 0, false
	}
	return a.EnterTicks(a.index[from], n), true
}

// Path is the cheapest walk on foot from tile i to tile j inside the area,
// as tile indices, and its ticks; ok is false when none exists. It knows
// only the area's tiles.
func (a *Area) Path(i, j int) ([]int, int64, bool) {
	hs, cost, ok := hex.Path(a.Tiles[i].Hex, a.Tiles[j].Hex, a.step, 1, 0)
	if !ok {
		return nil, 0, false
	}
	out := make([]int, len(hs))
	for k, h := range hs {
		out[k] = a.index[h]
	}
	return out, cost, true
}

// Walk returns the ticks from the nearest source to every tile, -1 where
// no source can reach on foot inside the area.
func (a *Area) Walk(sources []int) []int64 {
	from := make([]Hex, len(sources))
	for k, s := range sources {
		from[k] = a.Tiles[s].Hex
	}
	reach := hex.Reach(from, a.step, 0)
	dist := make([]int64, len(a.Tiles))
	for i, t := range a.Tiles {
		dist[i] = -1
		if c, ok := reach[t.Hex]; ok {
			dist[i] = c
		}
	}
	return dist
}

// RegionTiles lists a region's tiles, in ring order from its centre.
func (g *Gen) RegionTiles(id LatticeID) []Hex {
	if t, ok := g.tilesOf[id]; ok {
		return t
	}
	t := g.regionTiles(id)
	g.tilesOf[id] = t
	return t
}

// RegionNeighbours lists the regions that share an edge with a region,
// in lattice order.
func (g *Gen) RegionNeighbours(id LatticeID) []LatticeID {
	if n, ok := g.nextTo[id]; ok {
		return n
	}
	var out []LatticeID
	for _, h := range g.RegionTiles(id) {
		for d := range nDirs {
			if r := g.region(h.Neighbour(d)); r != id && !slices.Contains(out, r) {
				out = append(out, r)
			}
		}
	}
	slices.SortFunc(out, CompareIDs)
	g.nextTo[id] = out
	return out
}

// CompareIDs orders lattice ids by I, then J.
func CompareIDs(a, b LatticeID) int {
	if c := cmp.Compare(a.I, b.I); c != 0 {
		return c
	}
	return cmp.Compare(a.J, b.J)
}

// RegionOf is the region a tile belongs to.
func (g *Gen) RegionOf(h Hex) LatticeID { return g.region(h) }

// RawTerrain is a tile's terrain from noise alone, before anything
// yields: cheap, and enough for weather to steer by.
func (g *Gen) RawTerrain(h Hex) string { return g.raw(h).terrain }

// RawElevation is a tile's elevation from noise.
func (g *Gen) RawElevation(h Hex) int64 { return g.raw(h).elevation }

// SpineCell is the spine node nearest h: the cell weather forms in.
func (g *Gen) SpineCell(h Hex) (LatticeID, Hex) {
	id := g.spine.Nearest(h)
	return id, g.spine.At(id)
}

// Passable reports whether a terrain can be walked.
func (g *Gen) Passable(terrain string) bool { return g.passable(terrain) }
