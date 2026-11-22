package gen

import (
	"maps"
	"slices"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fixed"
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

// structural: lcm(1..36), so a floor creature's raw pick splits evenly
// over any pool of up to 36; under 2^53 so JSON readers keep it.
const pickRange = 144403552893600

// The map.content-weights tables.
const (
	TableSite    = "site"
	TableDungeon = "dungeon"
	TableLead    = "lead"
	TableStock   = "stock"
	TableTrait   = "trait"
	TableRole    = "role"
)

// The map.content-weights faction flags.
const (
	FactionWar      = "war"
	FactionStarving = "starving"
)

// Content draws a reached tile's content from its digest, under labels of
// its own. site is the slot as it stands, a pin's over the scaffold's.
func (g *Gen) Content(h Hex, site string, d history.Digest, key string) Drawn {
	var out Drawn
	out.SiteKind = g.SiteKind(h, site, d, key)
	region := g.Region(g.Baseline(h).Region)
	if rows := g.Archetypes(h); len(rows) > 0 {
		base := make([]int64, len(rows))
		for i, id := range rows {
			base[i] = g.mp("lead-other-weight")
			if id == region.Creature {
				base[i] = g.mp("lead-region-weight")
			}
		}
		out.Lead = rows[g.d.Pick(g.Weights(TableLead, rows, base, d, region.Creature), "content.lead", contentParts(h, key)...)]
	}
	if len(region.Materials) > 0 {
		out.Stock = map[string]int64{}
		ids, base := g.stockRows()
		weights := g.Weights(TableStock, ids, base, d, "")
		for _, m := range region.Materials {
			units := g.nodeStock()
			if len(ids) > 0 {
				units, _ = g.StockUnits(ids[g.d.Pick(weights, "content.stock", contentParts(h, key, draw.Str(m))...)])
			}
			out.Stock[m] = units
		}
	}
	if p, ok := g.DrawPlan(h, site, "", d, key); ok {
		out.Dungeon = &p
	}
	return out
}

// SiteKind is the kind Content draws for the slot.
func (g *Gen) SiteKind(h Hex, site string, d history.Digest, key string) string {
	return g.siteKind(site, d, contentParts(h, key))
}

// UniformStock gives every material of h's region the same units; nil when
// the region has none.
func (g *Gen) UniformStock(h Hex, units int64) map[string]int64 {
	var out map[string]int64
	for _, m := range g.Region(g.Baseline(h).Region).Materials {
		if out == nil {
			out = map[string]int64{}
		}
		out[m] = units
	}
	return out
}

// siteKind draws what the slot holds among the site kinds that list it; a
// slot none lists holds no kind.
func (g *Gen) siteKind(site string, d history.Digest, at []draw.Part) string {
	var ids []string
	var base []int64
	for _, k := range g.b.SiteKinds {
		if slices.Contains(k.Places, site) {
			ids, base = append(ids, k.ID), append(base, k.Weight)
		}
	}
	if len(ids) == 0 {
		return ""
	}
	return ids[g.d.Pick(g.Weights(TableSite, ids, base, d, ""), "content.site-kind", at...)]
}

func (g *Gen) stockRows() ([]string, []int64) {
	ids := make([]string, len(g.b.StockBands))
	base := make([]int64, len(g.b.StockBands))
	for i, s := range g.b.StockBands {
		ids[i], base[i] = s.ID, s.Weight
	}
	return ids, base
}

func (g *Gen) nodeStock() int64 { return sheets.IntParam(g.b.TileParams, "node-stock") }

// DrawPlan draws the plan of a dungeon on the slot; kind "" draws the
// kind too, and a kind the slot cannot stand is refused.
func (g *Gen) DrawPlan(h Hex, site, kind string, d history.Digest, key string) (Plan, bool) {
	kinds, shares := g.kindsAt(site)
	if len(kinds) == 0 {
		return Plan{}, false
	}
	at := contentParts(h, key)
	var k *sheets.DungeonKind
	if kind == "" {
		ids := make([]string, len(kinds))
		for i, x := range kinds {
			ids[i] = x.ID
		}
		k = kinds[g.d.Pick(g.Weights(TableDungeon, ids, shares, d, ""), "content.dungeon.kind", at...)]
	} else {
		i := slices.IndexFunc(kinds, func(x *sheets.DungeonKind) bool { return x.ID == kind })
		if i < 0 {
			return Plan{}, false
		}
		k = kinds[i]
	}
	return g.planOf(h, k, g.Baseline(h).HomeDist, "content.dungeon.floors", at...), true
}

// Native is the content the seed alone gives a tile: what every tile held
// before content came from history.
func (g *Gen) Native(h Hex) Drawn {
	var out Drawn
	if c := g.Creatures(h); len(c) > 0 {
		out.Lead = c[0]
	}
	out.Stock = g.UniformStock(h, g.nodeStock())
	if p, ok := g.Dungeon(h); ok {
		out.Dungeon = &p
	}
	return out
}

// Archetypes are the tile's terrain archetypes by tier, then id.
func (g *Gen) Archetypes(h Hex) []string {
	rows := g.archetypes(g.Baseline(h).Terrain)
	out := make([]string, len(rows))
	for i, c := range rows {
		out[i] = c.ID
	}
	return out
}

// Weights are a table's rows' weights shifted by the digest through
// map.content-weights: base × max(0, 100 + Σ shift × min(count, most)),
// where a band, flag or archetype counts once. In the lead table the row
// "region" stands for regionCreature. Weights that all come to 0 give the
// base back, so a draw always has something to pick.
func (g *Gen) Weights(table string, rows []string, base []int64, d history.Digest, regionCreature string) []int64 {
	out := make([]int64, len(base))
	most := history.BoundsOf(g.b.MapParams).KindMost
	some := false
	applies := func(w sheets.ContentWeight, row string) bool {
		if w.Table != table {
			return false
		}
		return w.Row == row || (table == TableLead && w.Row == sheets.LeadRegion && row != "" && row == regionCreature)
	}
	for i, row := range rows {
		shift := int64(0)
		for _, w := range g.b.ContentWeights {
			if !applies(w, row) {
				continue
			}
			upTo := w.Most
			if upTo == 0 {
				upTo = most
			}
			shift += w.Shift * min(g.condition(w, d), upTo)
		}
		out[i] = base[i] * max(0, fixed.Hundredths+shift)
		some = some || out[i] > 0
	}
	if !some {
		return slices.Clone(base)
	}
	return out
}

// condition is how many times a weight row's condition holds in the digest.
func (g *Gen) condition(w sheets.ContentWeight, d history.Digest) int64 {
	one := func(ok bool) int64 {
		if ok {
			return 1
		}
		return 0
	}
	switch {
	case w.Fact != "":
		for _, f := range g.b.FactWeights {
			if f.ID == w.Fact {
				return d.Count(f.Kind)
			}
		}
	case w.Gauge != "":
		i := slices.IndexFunc(g.b.Gauges, func(x sheets.Gauge) bool { return x.ID == w.Gauge })
		return one(i >= 0 && d.Band(i) >= w.Band)
	case w.Faction == FactionWar:
		return one(d.Faction.War)
	case w.Faction == FactionStarving:
		return one(d.Faction.Starving)
	case w.Archetype != "":
		return one(slices.Contains(d.Faction.Archetypes, w.Archetype))
	case w.Find != "":
		return d.Found(w.Find)
	case w.Pins:
		return int64(len(d.Pins))
	}
	return 0
}

// DrawWays draws floor n's three ways down at its first reach; the bottom
// floor has none. key is the plan's content key; at is the digest key at
// the floor's first reach.
func (g *Gen) DrawWays(p Plan, key, at string, n int64) [forkWays]Way {
	if n >= p.Floors {
		return [forkWays]Way{}
	}
	return g.waysFrom(p.Kind, g.d.Stream("content.floor.fork", contentParts(p.Hex, key, draw.Str(at), draw.Int(n))...))
}

// DrawFloor draws floor n by way at its first reach; the bottom floor has
// no fork machine.
func (g *Gen) DrawFloor(p Plan, key, at string, n, way int64) FloorDraw {
	return g.drawFloor(contentFloor, p, n, way, contentParts(p.Hex, key, draw.Str(at), draw.Int(n), draw.Int(way))...)
}

// floorLabels are the purposes a floor's draws take.
type floorLabels struct{ beats, creature, machine, family draw.Purpose }

var (
	nativeFloor  = floorLabels{"dungeon.beats", "dungeon.creature", "dungeon.fork-machine", "dungeon.fork-family"}
	contentFloor = floorLabels{"content.floor.beats", "content.floor.creature", "content.floor.fork-machine", "content.floor.fork-family"}
)

func (g *Gen) drawFloor(l floorLabels, p Plan, n, way int64, parts ...draw.Part) FloorDraw {
	f := FloorDraw{
		N: n, Way: way,
		Beats: g.d.Between(g.mp("floor-beats-min"), g.mp("floor-beats-max"), l.beats, parts...),
		Pick:  int64(g.d.Below(pickRange, l.creature, parts...)),
	}
	if n >= p.Floors {
		return f
	}
	k := g.kind(p.Kind)
	if f.Machine = g.d.Percent(g.mp("fork-machine-share"), l.machine, parts...); f.Machine && len(k.Families) > 0 {
		f.Family = k.Families[g.d.Below(uint64(len(k.Families)), l.family, parts...)]
	}
	return f
}

// contentParts keys a draw on the tile and the content key, then more.
func contentParts(h Hex, key string, more ...draw.Part) []draw.Part {
	return append([]draw.Part{draw.Str(h.Ref()), draw.Str(key)}, more...)
}

// FloorFrom builds a floor from its stored draw, the way in (nil for floor
// 1) and its ways, choosing the creature from the pool at the live tier.
func (g *Gen) FloorFrom(p Plan, f FloorDraw, in *Way, ways *[forkWays]Way, tier int64) FloorPlan {
	k := g.kind(p.Kind)
	if f.N <= 1 {
		in = nil
	}
	out := g.floorBase(p, k, g.tileTags(p.Hex), f.N, f.Way, tier, in, f.Beats)
	if pool := g.creaturePool(k, out.Step.Tier); len(pool) > 0 {
		out.Creature = pool[f.Pick*int64(len(pool))/pickRange]
	}
	if out.Bottom {
		return out
	}
	if ways != nil {
		out.Ways = *ways
	}
	out.Machine, out.Family = f.Machine, f.Family
	return out
}

// StockPercent is a map.stock-bands row's share of node-stock.
func (g *Gen) StockPercent(band string) (int64, bool) {
	s, ok := sheets.Lookup(g.b.StockBands)[band]
	if !ok {
		return 0, false
	}
	return s.Percent, true
}

// StockUnits are the node units a material starts with in a stock band:
// node-stock at the band's percent, rounded down.
func (g *Gen) StockUnits(band string) (int64, bool) {
	pct, ok := g.StockPercent(band)
	if !ok {
		return 0, false
	}
	return fixed.PercentFloor(g.nodeStock(), pct), true
}

// RegionSites are the region's scaffold sites by tile, as a copy.
func (g *Gen) RegionSites(id LatticeID) map[Hex]string { return maps.Clone(g.sitesOf(id)) }

// RegionLandmark is the region's own landmark and its tile, if it has one.
func (g *Gen) RegionLandmark(id LatticeID) (string, Hex, bool) {
	m := g.landmarkOf(id)
	return m.id, m.at, m.id != ""
}
