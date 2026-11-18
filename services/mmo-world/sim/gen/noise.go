package gen

import (
	"fmt"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/sheets"
)

// structural: smoothstep is 3t² − 2t³; percentages are hundredths.
const (
	smoothThree = 3
	smoothTwo   = 2
	percent     = 100
)

// raw is what noise alone makes of a tile, before anything yields. Where
// two land biomes fade into each other the tile is an ecotone: it keeps
// its primary biome, which sets its terrain, and carries the secondary
// biome and how much of it shows.
type raw struct {
	elevation, moisture, ore, fertility int64
	terrain                             string
	biome                               int // row in map.biomes
	second                              int // row in map.biomes, or -1
	blend                               int64
}

type noiseLayers struct {
	elevation, moisture, ore, fertility, warp, fade, continent *sheets.NoiseLayer
}

func (g *Gen) layers() (noiseLayers, error) {
	l := sheets.Lookup(g.b.Noise)
	var out noiseLayers
	for _, x := range []struct {
		id  string
		dst **sheets.NoiseLayer
	}{
		{"elevation", &out.elevation}, {"moisture", &out.moisture}, {"ore", &out.ore},
		{"fertility", &out.fertility}, {"warp", &out.warp}, {"fade", &out.fade},
		{"continent", &out.continent},
	} {
		v, ok := l[x.id]
		if !ok {
			return out, fmt.Errorf("gen: no noise layer %s", x.id)
		}
		*x.dst = v
	}
	return out, nil
}

func (g *Gen) raw(h Hex) raw {
	if r, ok := g.raws[h]; ok {
		return r
	}
	// Elevation and moisture are read through a domain warp, so biome
	// edges meander instead of following the noise lattice.
	x, y := gridXY(h)
	amp := g.p.warp * xPerTile
	mid := g.noise.warp.Max / halves
	wx := (g.layerXY(g.noise.warp, "noise.warp.x", x, y) - mid) * amp / max(mid, 1)
	wy := (g.layerXY(g.noise.warp, "noise.warp.y", x, y) - mid) * amp / max(mid, 1)
	// The continent layer sinks whole stretches of land below the sea:
	// where it falls under sea-level, elevation drops with its depth, so
	// seas are seas and not only lakes. It never raises land.
	sea := g.p.seaLevel
	lift := -max(0, sea-g.layerXY(g.noise.continent, "noise.continent", x+wx, y+wy)) * g.p.continent / max(sea, 1)
	r := raw{
		elevation: min(max(g.layerXY(g.noise.elevation, "noise.elevation", x+wx, y+wy)+lift, 0), g.noise.elevation.Max),
		moisture:  g.layerXY(g.noise.moisture, "noise.moisture", x+wx, y+wy),
		ore:       g.layer(g.noise.ore, h),
		fertility: g.layer(g.noise.fertility, h),
		second:    -1,
	}
	r.biome = g.biome(r.elevation, r.moisture)
	r.terrain = g.b.Biomes[r.biome].Terrain
	g.ecotone(&r, h)
	g.raws[h] = r
	return r
}

// ecotone looks for another land biome within the tile's fade margin of
// its elevation and moisture, nearest first. The margin varies with its
// own noise, so some edges are sharp and some fade over several tiles.
func (g *Gen) ecotone(r *raw, h Hex) {
	if !g.passable(r.terrain) {
		return
	}
	margin := g.p.fadeMin + g.layer(g.noise.fade, h)*(g.p.fadeMax-g.p.fadeMin)/max(g.noise.fade.Max, 1)
	for step := int64(1); step <= margin; step++ {
		for _, d := range fadeSteps {
			e := min(max(r.elevation+d.de*step, 0), g.noise.elevation.Max)
			m := min(max(r.moisture+d.dm*step, 0), g.noise.moisture.Max)
			b := g.biome(e, m)
			if b != r.biome && g.passable(g.b.Biomes[b].Terrain) {
				r.second = b
				r.blend = maxBlend * (margin - step + 1) / (margin + 1)
				return
			}
		}
	}
}

// structural: an ecotone looks along the eight compass steps of the
// elevation-moisture plane; the secondary biome shows at most half.
var fadeSteps = [...]planeStep{{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {1, -1}, {-1, 1}, {-1, -1}}

type planeStep struct{ de, dm int64 }

const maxBlend = percent / halves

func (g *Gen) biome(e, m int64) int {
	for i, b := range g.b.Biomes {
		if e >= b.ElevationMin && e <= b.ElevationMax && m >= b.MoistureMin && m <= b.MoistureMax {
			return i
		}
	}
	panic("gen: map.biomes leaves a gap; the Check run should have caught it")
}

// layer is value noise: a lattice of keyed values per octave, smoothly
// interpolated, octaves summed with falling weight.
func (g *Gen) layer(l *sheets.NoiseLayer, h Hex) int64 {
	x, y := gridXY(h)
	return g.layerXY(l, "noise."+l.ID, x, y)
}

func (g *Gen) layerXY(l *sheets.NoiseLayer, purpose string, x, y int64) int64 {
	var sum, wsum int64
	weight := int64(percent)
	cell := l.Cell
	for o := range l.Octaves {
		sum += g.latticeXY(purpose, o, cell, l.Max, x, y) * weight
		wsum += weight
		weight = weight * l.Falloff / percent
		cell = max(1, cell/halves)
	}
	return sum / max(wsum, 1)
}

type latticeKey struct {
	purpose string
	octave  int64
	i, j    int64
}

// structural: noise runs on a near-square grid laid over the hexes, so
// its cells are not skewed along the axial axes: x is twice q plus r in
// half-hex widths, y is r in rows of √3 ≈ 7/4 of those, and a cell of s
// tiles is s·xPerTile wide.
const (
	xPerTile = 8
	xPerR    = 4
	yPerR    = 7
)

func gridXY(h Hex) (int64, int64) { return xPerTile*h.Q + xPerR*h.R, yPerR * h.R }

func (g *Gen) lattice(purpose string, octave, cell, top int64, h Hex) int64 {
	x, y := gridXY(h)
	return g.latticeXY(purpose, octave, cell, top, x, y)
}

func (g *Gen) latticeXY(purpose string, octave, cell, top, x, y int64) int64 {
	s := cell * xPerTile
	i, j := floorDiv(x, s), floorDiv(y, s)
	ax, ay := smooth(x-i*s, s), smooth(y-j*s, s)
	v := func(di, dj int64) int64 {
		k := latticeKey{purpose, octave, i + di, j + dj}
		if x, ok := g.lattices[k]; ok {
			return x
		}
		x := int64(g.d.Below(uint64(top+1), draw.Purpose(purpose), draw.Int(octave), draw.Int(i+di), draw.Int(j+dj)))
		g.lattices[k] = x
		return x
	}
	return (v(0, 0)*(s-ax)*(s-ay) + v(1, 0)*ax*(s-ay) + v(0, 1)*(s-ax)*ay + v(1, 1)*ax*ay) / (s * s)
}

func smooth(t, s int64) int64 { return t * t * (smoothThree*s - smoothTwo*t) / (s * s) }

// passableNear is the passable terrain whose biome band sits nearest the
// elevation: a ford in shallow water, a pass below a peak.
func (g *Gen) passableNear(elevation int64) string {
	best, bestGap := "", int64(-1)
	for _, b := range g.b.Biomes {
		if !g.terrain[b.Terrain].Passable {
			continue
		}
		gap := max(b.ElevationMin-elevation, elevation-b.ElevationMax, 0)
		if bestGap < 0 || gap < bestGap {
			best, bestGap = b.Terrain, gap
		}
	}
	return best
}

func (g *Gen) passable(terrain string) bool { return g.terrain[terrain].Passable }

// variant is the biome variant a tile turns into, or "": its terrain's
// variant past the row's distance, where the variant's own noise is low.
func (g *Gen) variant(h Hex, terrain string) string {
	d := h.Len()
	for _, v := range g.b.BiomeVariants {
		if v.Terrain != terrain || d < v.MinDistance {
			continue
		}
		if g.lattice("variant."+v.ID, 0, v.Cell, percent-1, h) < v.Share {
			return v.ID
		}
	}
	return ""
}
