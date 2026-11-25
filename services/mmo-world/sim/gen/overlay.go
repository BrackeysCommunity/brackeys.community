package gen

import (
	"cmp"
	"fmt"
	"maps"
	"slices"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/history"
	"jams.team/mmo-world/sim/sheets"
)

// Ground is a terrain pin's override of a tile's raw ground: a map.terrain
// row and an elevation, 0 for the tile's own.
type Ground struct {
	Terrain   string
	Elevation int64
}

// Routes are every corridor path, island link, place link and river course
// a Gen has laid so far, sorted, for comparing two Gens asked the same.
type Routes struct {
	Paths  [][]Hex
	Rivers [][]Hex
}

// Equal reports whether two Gens laid the same routes.
func (r Routes) Equal(o Routes) bool {
	return slices.EqualFunc(r.Paths, o.Paths, slices.Equal[[]Hex]) && slices.EqualFunc(r.Rivers, o.Rivers, slices.Equal[[]Hex])
}

// Overlay is a fresh Gen of the sheets and key with over laid on its raw
// ground in place of the noise.
func Overlay(b *sheets.Book, key draw.Key, over map[Hex]Ground) (*Gen, error) {
	g, err := New(b, key)
	if err != nil {
		return nil, err
	}
	return g.Twin(over)
}

// Twin is Overlay for a caller holding a Gen but not its key: a fresh Gen
// of g's sheets and key, with over laid on its raw ground (nil for none).
// It shares only what New leaves fixed and the keyed noise lattice, whose
// values are the key's alone, so nothing it lays reaches g.
func (g *Gen) Twin(over map[Hex]Ground) (*Gen, error) {
	patch := slices.SortedFunc(maps.Keys(over), hex.Compare)
	for _, h := range patch {
		if err := g.checkGround(over[h]); err != nil {
			return nil, fmt.Errorf("gen: ground on %s: %w", h.Ref(), err)
		}
	}
	t := &Gen{
		b: g.b, d: g.d, p: g.p, ch: g.ch, noise: g.noise, terrain: g.terrain, shapes: g.shapes, rules: g.rules,
		discIndex: g.discIndex, purposes: g.purposes, lattices: g.lattices,
	}
	t.freshCaches()
	// The raws cache is never evicted, so a tile put here before anything
	// reads it is the only raw any reader of the package sees.
	for _, h := range patch {
		t.raws.put(h, t.overRaw(t.raw(h), over[h]))
	}
	t.newLattices()
	t.originAreas = t.areasAtOrigin()
	return t, nil
}

// checkGround refuses ground the sheets do not hold.
func (g *Gen) checkGround(gr Ground) error {
	if g.terrain[gr.Terrain] == nil {
		return fmt.Errorf("no terrain %q", gr.Terrain)
	}
	if gr.Elevation < 0 || gr.Elevation > g.noise.elevation.Max {
		return fmt.Errorf("elevation %d is outside 0 to %d", gr.Elevation, g.noise.elevation.Max)
	}
	return nil
}

// CheckGround is nil when ground names a map.terrain row and an elevation
// the noise can reach.
func (g *Gen) CheckGround(gr Ground) error { return g.checkGround(gr) }

// overRaw is a raw with ground laid over it: its terrain, no fade, and the
// ground's elevation unless that is 0.
func (g *Gen) overRaw(r raw, gr Ground) raw {
	r.terrain, r.ter = gr.Terrain, g.terrain[gr.Terrain]
	if gr.Elevation > 0 {
		r.elevation = gr.Elevation
	}
	r.second, r.blend = -1, 0
	return r
}

// GroundTile is h's baseline with ground laid over it: terrain, elevation,
// the water and cover they give, no yield, ford, river, ecotone or variant.
// A pure function of the sheets, key, tile and ground.
func (g *Gen) GroundTile(h Hex, gr Ground) TileBaseline {
	b := g.Baseline(h)
	r := g.overRaw(g.raw(h), gr)
	b.Terrain, b.Elevation = r.terrain, r.elevation
	b.Water = g.water(r, groundTile{terrain: r.terrain})
	b.Cover = g.cover(h, r.terrain)
	b.Variant, b.Secondary, b.Blend, b.Edge = "", "", 0, ""
	b.River, b.Ford, b.Yielded = false, false, false
	return b
}

// CompareChunks orders chunk coordinates by A, then B.
func CompareChunks(a, b ChunkCoord) int { return cmp.Or(cmp.Compare(a.A, b.A), cmp.Compare(a.B, b.B)) }

// Routes lists what g has laid: paths by their ends, rivers by their
// source chunk, leaving out sources that run no river.
func (g *Gen) Routes() Routes {
	var out Routes
	byEnds := func(a, b pathKey) int { return cmp.Or(hex.Compare(a.from, b.from), hex.Compare(a.to, b.to)) }
	for _, k := range slices.SortedFunc(maps.Keys(g.paths), byEnds) {
		out.Paths = append(out.Paths, slices.Clone(g.paths[k]))
	}
	for _, cc := range slices.SortedFunc(maps.Keys(g.rivers), CompareChunks) {
		if r := g.rivers[cc]; len(r) > 0 {
			out.Rivers = append(out.Rivers, slices.Clone(r))
		}
	}
	return out
}

// OnLattice reports whether a region, spine or settlement lattice point
// stands on h.
func (g *Gen) OnLattice(h Hex) bool {
	return len(g.regions.Near(h, 0)) > 0 || len(g.spine.Near(h, 0)) > 0 || len(g.homes.Near(h, 0)) > 0
}

// ElevationMax is the highest elevation the noise gives.
func (g *Gen) ElevationMax() int64 { return g.noise.elevation.Max }

// ArchetypesOf are a terrain's archetypes by tier, then id: what Archetypes
// gives a tile of that terrain.
func (g *Gen) ArchetypesOf(terrain string) []string {
	rows := g.archetypes(terrain)
	out := make([]string, len(rows))
	for i, c := range rows {
		out[i] = c.ID
	}
	return out
}

// CreaturesOn is CreaturesLed for a tile of terrain: its archetypes with
// lead first when it lives there.
func (g *Gen) CreaturesOn(terrain, lead string) []string {
	rows := g.ArchetypesOf(terrain)
	if i := slices.Index(rows, lead); i > 0 {
		rows = append(append([]string{lead}, rows[:i]...), rows[i+1:]...)
	}
	return rows
}

// ContentOn is Content for a tile whose ground a pin overlaid: the lead
// is drawn from base's terrain, under the same label and parts, and the
// rest as Content draws it.
func (g *Gen) ContentOn(h Hex, base TileBaseline, site string, d history.Digest, key string) Drawn {
	out := g.Content(h, site, d, key)
	out.Lead = ""
	region := g.Region(base.Region)
	if rows := g.ArchetypesOf(base.Terrain); len(rows) > 0 {
		weights := make([]int64, len(rows))
		for i, id := range rows {
			weights[i] = g.mp("lead-other-weight")
			if id == region.Creature {
				weights[i] = g.mp("lead-region-weight")
			}
		}
		out.Lead = rows[g.d.Pick(g.Weights(TableLead, rows, weights, d, region.Creature), "content.lead", contentParts(h, key)...)]
	}
	return out
}
