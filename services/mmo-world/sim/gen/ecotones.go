package gen

import (
	"slices"

	"jams.team/mmo-world/sim/draw"
)

// What an ecotone adds to a region and its sites (GDD 4.12).
const (
	SiteEdge = "edge-site"
	TagEdge  = "edge"
)

func (g *Gen) secondTerrain(r raw) string {
	if r.second < 0 {
		return ""
	}
	return g.b.Biomes[r.second].Terrain
}

// edgeRow is the map.ecotones row for a tile's two biomes, or -1.
func (g *Gen) edgeRow(r raw) int {
	if r.second < 0 {
		return -1
	}
	a, b := g.b.Biomes[r.biome].ID, g.b.Biomes[r.second].ID
	for i, e := range g.b.Ecotones {
		if (e.BiomeA == a && e.BiomeB == b) || (e.BiomeA == b && e.BiomeB == a) {
			return i
		}
	}
	return -1
}

func (g *Gen) edgeOf(r raw) string {
	if i := g.edgeRow(r); i >= 0 {
		return g.b.Ecotones[i].ID
	}
	return ""
}

// regionEdge is the ecotone a region holds: the pair with the most of its
// tiles, if it has at least edge-region-tiles of them; ties go to the
// earlier row.
func (g *Gen) regionEdge(id LatticeID) int {
	count := make([]int64, len(g.b.Ecotones))
	for _, h := range g.regionTiles(id) {
		if i := g.edgeRow(g.raw(h)); i >= 0 {
			count[i]++
		}
	}
	best := -1
	for i, c := range count {
		if c >= g.p.edgeTiles && (best < 0 || c > count[best]) {
			best = i
		}
	}
	return best
}

// edges fills in what a region's ecotone holds: an edge material for the
// pair in its lattice cell, and in some regions a creature that lives
// only on that edge.
func (g *Gen) edges(r *RegionBaseline) {
	e := g.regionEdge(r.ID)
	if e < 0 {
		return
	}
	row := g.b.Ecotones[e]
	r.Edge = row.ID
	r.EdgeMaterial = g.farAt("edge", row.ID, r.Centre, "edge.share", []draw.Part{draw.Str("edge")}, func() []string {
		return append([]string{TagEdge, row.Tag}, row.MaterialTags...)
	})
	who := []draw.Part{draw.Int(r.ID.I), draw.Int(r.ID.J)}
	if !g.d.Percent(g.p.edgeCreatures, "region.edge-creature", who...) {
		return
	}
	var ta, tb string
	for _, b := range g.b.Biomes {
		switch b.ID {
		case row.BiomeA:
			ta = b.Terrain
		case row.BiomeB:
			tb = b.Terrain
		}
	}
	var kinds []string
	for _, cr := range g.b.Creatures {
		if slices.Contains(cr.Biomes, ta) || slices.Contains(cr.Biomes, tb) {
			kinds = append(kinds, cr.ID)
		}
	}
	if len(kinds) > 0 {
		r.EdgeCreature = kinds[g.d.Below(uint64(len(kinds)), "region.edge-kind", who...)]
	}
}
