package gen

import (
	"slices"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/sheets"
)

// RegionBaseline is a region as generation leaves it. Its id is its
// centre's point on the region lattice, the same in every chunk.
type RegionBaseline struct {
	ID       LatticeID
	Centre   Hex
	Terrain  string // the biome at the centre, which its tiles share
	Distance int64  // of the centre from the origin
	// Novelty (GDD 4.17): what this region holds that a server may not
	// have seen. Each is "" or nil when it holds none.
	Far      *FarMaterial
	Creature string
	Variant  string // the creature's variant tag
	// Edge is the map.ecotones row the region's fade belongs to; an edge
	// region has its pair's edge material, and some an edge creature that
	// carries the pair's tag.
	Edge         string
	EdgeMaterial *FarMaterial
	EdgeCreature string
}

// FarMaterial is a material generated past far-material-min-tiles: a keyed
// axis profile at 60% to 75% of a tier's budget, tagged by its biome. Its
// id names its biome and lattice cell; the pack names it. Tier depends on
// which settlements are open, so the world freezes its vector at the tier
// it is first discovered at.
type FarMaterial struct {
	ID      string
	Biome   string
	Share   int64   // percent of the tier's budget
	Profile []int64 // per items.axes, in thousandths of the vector
	Tags    []string
}

// structural: a profile is in thousandths.
const perMille = 1000

// Vector is the material's axis vector at a tier.
func (m *FarMaterial) Vector(tiers []sheets.Tier, tier int64) []int64 {
	budget := int64(0)
	for _, t := range tiers {
		if t.Tier == tier {
			budget = t.Budget
		}
	}
	total := budget * m.Share / percent
	out := make([]int64, len(m.Profile))
	given, top := int64(0), 0
	for a, w := range m.Profile {
		out[a] = total * w / perMille
		given += out[a]
		if w > m.Profile[top] {
			top = a
		}
	}
	out[top] += total - given
	return out
}

// region is the region a tile belongs to: the nearest region centre
// within region-match-tiles whose biome is the tile's, and failing that
// the nearest centre. It reads raw biomes only, so it never depends on
// what yielded.
func (g *Gen) region(h Hex) LatticeID {
	if id, ok := g.regionOf[h]; ok {
		return id
	}
	id := g.pickAt(h, regionPasses)
	g.regionOf[h] = id
	return id
}

// structural: the floor is applied twice, so a region the first pass
// left under it after its neighbours took their share does not stay.
const regionPasses = 2

// pickAt is the centre a tile joins at a pass. Pass 0 is the plain rule:
// the nearest centre of the tile's biome by squared distance less weight,
// failing that the nearest. At each later pass, a centre that took fewer
// than region-floor-tiles at the pass before takes none, and no centre
// takes a tile beyond the largest disc that fits region-ceiling-tiles;
// those tiles go to their next choice.
func (g *Gen) pickAt(h Hex, pass int) LatticeID {
	if id, ok := g.picks[pickKey{h, pass}]; ok {
		return id
	}
	terrain := g.raw(h).terrain
	ok := func(id LatticeID, d int64) bool {
		return pass == 0 || (g.sizeAt(id, pass-1) >= g.p.regionFloor && DiscSize(d) <= g.p.regionCeiling)
	}
	best, bestD, match, found := LatticeID{}, int64(0), false, false
	for _, id := range g.regions.Near(h, g.p.regionMatch) {
		d := Distance(g.regions.At(id), h)
		if !ok(id, d) {
			continue
		}
		power := d*d - g.regionWeight(id)
		m := g.centreBiome(id) == terrain
		if !found || (m && !match) || (m == match && power < bestD) {
			best, bestD, match, found = id, power, m, true
		}
	}
	// Nothing within reach passes: the nearest centre that takes tiles.
	for reach := g.p.regionMatch; !found; reach += g.p.regionSpacing {
		for _, id := range g.regions.Near(h, reach) {
			d := Distance(g.regions.At(id), h)
			if (pass == 0 || g.sizeAt(id, pass-1) >= g.p.regionFloor) && (!found || d < bestD) {
				best, bestD, found = id, d, true
			}
		}
	}
	g.picks[pickKey{h, pass}] = best
	return best
}

type pickKey struct {
	h    Hex
	pass int
}

// sizeAt is how many tiles a centre takes at a pass.
func (g *Gen) sizeAt(id LatticeID, pass int) int64 {
	k := sizeKey{id, pass}
	if n, ok := g.sizes[k]; ok {
		return n
	}
	n := int64(0)
	for _, h := range DiscAt(g.regions.At(id), g.p.regionMatch) {
		if g.pickAt(h, pass) == id {
			n++
		}
	}
	g.sizes[k] = n
	return n
}

type sizeKey struct {
	id   LatticeID
	pass int
}

// regionWeight is a centre's keyed size weight from map.region-weights:
// a tile joins the centre with the least squared distance less weight, so
// heavy centres reach further and light ones less (a power diagram).
func (g *Gen) regionWeight(id LatticeID) int64 {
	if w, ok := g.weights[id]; ok {
		return w
	}
	shares := make([]int64, len(g.b.RegionWeights))
	for i, r := range g.b.RegionWeights {
		shares[i] = r.Share
	}
	w := int64(0)
	if len(shares) > 0 {
		w = g.b.RegionWeights[g.d.Pick(shares, "region.weight", draw.Int(id.I), draw.Int(id.J))].Weight
	}
	g.weights[id] = w
	return w
}

// centreBiome is the terrain most of the tiles round a region centre
// share, so a centre that lands in a sliver of one biome does not make a
// sliver of a region; ties go to the terrain first in map.terrain.
func (g *Gen) centreBiome(id LatticeID) string {
	if t, ok := g.centreTerrain[id]; ok {
		return t
	}
	count := make([]int, len(g.b.Terrain))
	for _, h := range DiscAt(g.regions.At(id), g.p.regionCore) {
		for k, t := range g.b.Terrain {
			if t.ID == g.raw(h).terrain {
				count[k]++
			}
		}
	}
	best := 0
	for k := range count {
		if count[k] > count[best] {
			best = k
		}
	}
	t := g.b.Terrain[best].ID
	g.centreTerrain[id] = t
	return t
}

// regionTiles lists a region's tiles in ring order from its centre. They
// all lie within region-match-tiles of it: a tile further off has nearer
// centres of its own.
func (g *Gen) regionTiles(id LatticeID) []Hex {
	var out []Hex
	for _, h := range DiscAt(g.regions.At(id), g.p.regionMatch) {
		if g.region(h) == id {
			out = append(out, h)
		}
	}
	return out
}

// Region is a region's baseline.
func (g *Gen) Region(id LatticeID) *RegionBaseline {
	if r, ok := g.regionInfo[id]; ok {
		return r
	}
	c := g.regions.At(id)
	r := &RegionBaseline{ID: id, Centre: c, Terrain: g.centreBiome(id), Distance: c.Len()}
	who := []draw.Part{draw.Int(id.I), draw.Int(id.J)}
	if g.passable(r.Terrain) {
		if r.Distance >= g.p.farMin {
			r.Far = g.farMaterial(g.raw(c).biome, c)
		}
		var kinds []string
		// Tier comes from which settlements are open, so the creature is any
		// archetype of the biome; the world scales it to the region's tier.
		for _, cr := range g.b.Creatures {
			if slices.Contains(cr.Biomes, r.Terrain) {
				kinds = append(kinds, cr.ID)
			}
		}
		if len(kinds) > 0 {
			r.Creature = kinds[g.d.Below(uint64(len(kinds)), "region.creature", who...)]
			var tags []string
			for _, v := range g.b.CreatureVariants {
				if v.MinDistance <= r.Distance {
					tags = append(tags, v.Tag)
				}
			}
			if len(tags) > 0 && int64(g.d.Below(percent, "region.variant", who...)) < g.p.variantShare {
				r.Variant = tags[g.d.Below(uint64(len(tags)), "region.variant-tag", who...)]
			}
		}
	}
	if g.passable(r.Terrain) {
		g.edges(r)
	}
	g.regionInfo[id] = r
	return r
}

// farMaterial is the far material of a biome in the cell holding h.
func (g *Gen) farMaterial(biome int, h Hex) *FarMaterial {
	b := g.b.Biomes[biome]
	ci, cj := floorDiv(h.Q, g.p.farCell), floorDiv(h.R, g.p.farCell)
	id := "far." + b.ID + "." + itoa(ci) + "." + itoa(cj)
	if m, ok := g.far[id]; ok {
		return m
	}
	who := []draw.Part{draw.Str(b.ID), draw.Int(ci), draw.Int(cj)}
	m := &FarMaterial{ID: id, Biome: b.ID}
	m.Share = g.p.farLo + int64(g.d.Below(uint64(g.p.farHi-g.p.farLo+1), "far.share", who...))
	m.Profile = g.profile(who)
	m.Tags = append(slices.Clone(g.terrain[b.Terrain].Tags), b.MaterialTags...)
	g.far[id] = m
	return m
}

// profile spreads a thousandths over far-material-axes keyed axes.
func (g *Gen) profile(who []draw.Part) []int64 {
	axes := g.d.Shuffle(len(g.b.Axes), "far.axes", who...)[:min(int(g.p.farAxes), len(g.b.Axes))]
	weights := make([]int64, len(axes))
	var wsum int64
	for k := range axes {
		weights[k] = 1 + int64(g.d.Below(percent, "far.weight", append(who, draw.Int(int64(k)))...))
		wsum += weights[k]
	}
	out := make([]int64, len(g.b.Axes))
	given := int64(0)
	for k, a := range axes {
		out[a] = perMille * weights[k] / wsum
		given += out[a]
	}
	out[axes[0]] += perMille - given
	return out
}

// sitesOf places 3 to 6 sites on a region's free passable tiles, one of
// them a dungeon in one region of every few.
func (g *Gen) sitesOf(id LatticeID) map[Hex]string {
	if s, ok := g.regionSites[id]; ok {
		return s
	}
	var free, edge []Hex
	for _, h := range g.regionTiles(id) {
		if t := g.groundAt(h); t.place == "" && g.passable(t.terrain) {
			free = append(free, h)
			if g.raw(h).second >= 0 {
				edge = append(edge, h)
			}
		}
	}
	out := map[Hex]string{}
	if len(free) > 0 {
		who := []draw.Part{draw.Int(id.I), draw.Int(id.J)}
		n := g.p.sitesMin + int64(g.d.Below(uint64(g.p.sitesMax-g.p.sitesMin+1), "sites.count", who...))
		order := g.d.Shuffle(len(free), "sites.where", who...)
		dungeon := g.d.Below(uint64(g.p.dungeonShare), "sites.dungeon", who...) == 0
		for k := int64(0); k < n && k < int64(len(free)); k++ {
			kind := SiteOrdinary
			if k == 0 && dungeon {
				kind = PlaceDungeon
			}
			out[free[order[k]]] = kind
		}
		// An edge region keeps one ordinary site on its fade.
		if len(edge) > 0 && g.Region(id).Edge != "" {
			h := edge[g.d.Below(uint64(len(edge)), "sites.edge", who...)]
			if out[h] != PlaceDungeon {
				out[h] = SiteEdge
			}
		}
	}
	g.regionSites[id] = out
	return out
}
