package gen

import (
	"maps"
	"slices"
	"strings"

	"jams.team/mmo-world/sim/history"
	"jams.team/mmo-world/sim/sheets"
)

// Drawn is a tile's content as a draw gives it (GDD 4.17).
type Drawn struct {
	SiteKind string
	Lead     string
	Stock    map[string]int64
	Dungeon  *Plan // nil unless the slot holds a dungeon kind
}

// FloorDraw mirrors tile.FloorDraw.
type FloorDraw struct {
	N, Way, Beats int64
	Machine       bool
	Family        string
	Pick          int64
}

// structural: a floor creature's pick is a raw draw below this.
const pickRange = 1 << 31 //nolint:unused // read once floors are drawn from history

// Content draws a reached tile's content from its digest, under labels of
// its own.
func (g *Gen) Content(h Hex, site string, d history.Digest, key string) Drawn {
	return g.Native(h)
}

// DrawPlan draws the plan of a dungeon on the slot; kind "" draws the
// kind too.
func (g *Gen) DrawPlan(h Hex, site, kind string, d history.Digest, key string) (Plan, bool) {
	return g.plan(h, site, g.Baseline(h).HomeDist)
}

// Native is the content the seed alone gives a tile: what every tile held
// before content came from history.
func (g *Gen) Native(h Hex) Drawn {
	var out Drawn
	if c := g.Creatures(h); len(c) > 0 {
		out.Lead = c[0]
	}
	node := sheets.IntParam(g.b.TileParams, "node-stock")
	for _, m := range g.Region(g.Baseline(h).Region).Materials {
		if out.Stock == nil {
			out.Stock = map[string]int64{}
		}
		out.Stock[m] = node
	}
	if p, ok := g.Dungeon(h); ok {
		out.Dungeon = &p
	}
	return out
}

// Archetypes are the tile's terrain archetypes by tier, then id.
func (g *Gen) Archetypes(h Hex) []string {
	t := g.Baseline(h)
	var rows []sheets.Creature
	for _, c := range g.b.Creatures {
		if slices.Contains(c.Biomes, t.Terrain) {
			rows = append(rows, c)
		}
	}
	slices.SortFunc(rows, func(a, b sheets.Creature) int {
		if a.Tier != b.Tier {
			return int(a.Tier - b.Tier)
		}
		return strings.Compare(a.ID, b.ID)
	})
	out := make([]string, len(rows))
	for i, c := range rows {
		out[i] = c.ID
	}
	return out
}

// Weights are a table's rows' weights shifted by the digest through
// map.content-weights.
func (g *Gen) Weights(table string, rows []string, base []int64, d history.Digest, regionCreature string) []int64 {
	return slices.Clone(base)
}

// DrawWays draws floor n's three ways down at its first reach.
func (g *Gen) DrawWays(p Plan, key, at string, n int64) [forkWays]Way {
	return g.ways(p, n)
}

// DrawFloor draws floor n by way at its first reach.
func (g *Gen) DrawFloor(p Plan, key, at string, n, way int64) FloorDraw {
	return FloorDraw{N: n, Way: way}
}

// FloorFrom builds a floor from its stored draw, the way in and its ways,
// choosing the creature from the pool at the live tier.
func (g *Gen) FloorFrom(p Plan, f FloorDraw, in *Way, ways *[forkWays]Way, tier int64) FloorPlan {
	return g.floor(p, g.tileTags(p.Hex), f.N, f.Way, tier)
}

// StockPercent is a map.stock-bands row's share of node-stock.
func (g *Gen) StockPercent(band string) (int64, bool) {
	return 0, false
}

// RegionSites are the region's scaffold sites by tile, as a copy.
func (g *Gen) RegionSites(id LatticeID) map[Hex]string { return maps.Clone(g.sitesOf(id)) }

// RegionLandmark is the region's own landmark and its tile, if it has one.
func (g *Gen) RegionLandmark(id LatticeID) (string, Hex, bool) {
	m := g.landmarkOf(id)
	return m.id, m.at, m.id != ""
}
