package gen

import (
	"fmt"
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/sheets"
)

// Anchors and shape kinds, as the sheets spell them.
const (
	anchorOrigin     = "origin"
	anchorSettlement = "starting-settlement"
	anchorTerrain    = "terrain"
	anchorPattern    = "pattern"
	anchorFrontier   = "frontier"
	anchorAtPoints   = "points"
)

// structural: a bearing is in degrees round a ring of six sides; a ring
// walk reaches due east after two of its six sides.
const (
	fullTurn = 360
	eastSide = 2
)

// instance is one placement of a pattern rule: its centre and points.
type instance struct {
	rule   int
	id     string
	centre Hex
	extent int64
	points []PatternPoint
}

func (g *Gen) checkPatterns() error {
	for i, r := range g.b.Patterns {
		g.rules[r.ID] = i
	}
	for _, r := range g.b.Patterns {
		if _, ok := g.shapes[r.Shape]; !ok {
			return fmt.Errorf("gen: pattern %s: no shape %s", r.ID, r.Shape)
		}
		switch r.Anchor {
		case anchorOrigin, anchorSettlement:
		case anchorTerrain:
			if r.AnchorTerrain == "" {
				return fmt.Errorf("gen: pattern %s: a terrain anchor names its terrain", r.ID)
			}
		case anchorFrontier:
			if r.PerRegions <= 0 {
				return fmt.Errorf("gen: pattern %s: a frontier anchor needs perRegions", r.ID)
			}
		case anchorPattern:
			seen := []string{r.ID}
			for at := r; at.Anchor == anchorPattern; {
				next, ok := g.rules[at.AnchorPattern]
				if !ok {
					return fmt.Errorf("gen: pattern %s: no pattern %s to anchor to", at.ID, at.AnchorPattern)
				}
				if slices.Contains(seen, at.AnchorPattern) {
					return fmt.Errorf("gen: pattern %s: anchors form a loop", r.ID)
				}
				seen = append(seen, at.AnchorPattern)
				at = g.b.Patterns[next]
			}
		default:
			return fmt.Errorf("gen: pattern %s: unknown anchor %s", r.ID, r.Anchor)
		}
	}
	return nil
}

// Patterns lists the pattern points in a chunk. Where two land on one
// tile the earlier rule wins, and a settlement beats both.
func (g *Gen) Patterns(cc ChunkCoord) []PatternPoint {
	if p, ok := g.points[cc]; ok {
		return p
	}
	centre := g.ch.Centre(cc)
	homes := g.homesNear(centre, g.p.chunk)
	var out []PatternPoint
	for ri := range g.b.Patterns {
		for _, in := range g.instancesNear(ri, centre, g.reach(ri)+g.p.chunk) {
			for _, p := range in.points {
				if Distance(p.Hex, centre) > g.p.chunk || g.ch.Of(p.Hex) != cc {
					continue
				}
				taken := slices.ContainsFunc(out, func(o PatternPoint) bool { return o.Hex == p.Hex }) ||
					slices.ContainsFunc(homes, func(s Settlement) bool { return s.Hex == p.Hex })
				if !taken {
					out = append(out, p)
				}
			}
		}
	}
	g.points[cc] = out
	return out
}

// reach bounds how far a rule's points lie from its instance's centre.
func (g *Gen) reach(ri int) int64 {
	r := g.b.Patterns[ri]
	return g.shapeExtent(g.shapes[r.Shape], r.Size) + g.jitterOf(r)
}

func (g *Gen) jitterOf(r sheets.PatternRule) int64 {
	if slices.Contains(r.SeedFree, "jitter") {
		return g.p.regionJitter
	}
	return 0
}

// instancesNear lists the rule's instances whose centre lies within reach
// of h, in a fixed order.
func (g *Gen) instancesNear(ri int, h Hex, reach int64) []*instance {
	r := g.b.Patterns[ri]
	off := r.OffsetDistance
	var out []*instance
	add := func(id string, anchor Hex) {
		in := g.instance(ri, id, anchor)
		if Distance(in.centre, h) <= reach {
			out = append(out, in)
		}
	}
	switch r.Anchor {
	case anchorOrigin:
		add(anchorOrigin, Hex{})
	case anchorSettlement:
		for _, s := range g.homesNear(h, reach+off) {
			add("home:"+itoa(s.ID.I)+":"+itoa(s.ID.J), s.Hex)
		}
	case anchorTerrain, anchorFrontier:
		for _, cc := range g.ch.Near(h, reach+off) {
			if a, ok := g.chunkAnchor(r, cc); ok {
				add("chunk:"+itoa(cc.A)+":"+itoa(cc.B), a)
			}
		}
	case anchorPattern:
		parent := g.rules[r.AnchorPattern]
		for _, p := range g.instancesNear(parent, h, reach+off+g.reach(parent)) {
			if r.AnchorAt == anchorAtPoints {
				for _, pt := range p.points {
					add(p.id+"/"+itoa(int64(pt.Index)), pt.Hex)
				}
				continue
			}
			add(p.id, p.centre)
		}
	}
	return out
}

func itoa(n int64) string { return strconv.FormatInt(n, decimal) }

// structural: ids are written in decimal.
const decimal = 10

// chunkAnchor is where a terrain or frontier rule anchors in a chunk, if
// it fires there.
func (g *Gen) chunkAnchor(r sheets.PatternRule, cc ChunkCoord) (Hex, bool) {
	centre := g.ch.Centre(cc)
	inBand := func(h Hex) bool {
		d := h.Len()
		return d >= r.MinDistance && (r.MaxDistance == 0 || d < r.MaxDistance)
	}
	switch r.Anchor {
	case anchorFrontier:
		// About one instance per perRegions regions: a chunk holds the
		// chunk's tiles over the region lattice's tiles per region.
		chunkTiles := uint64(DiscSize(g.p.chunk))
		if !inBand(centre) || g.d.Below(uint64(r.PerRegions*g.p.regionSpacing*g.p.regionSpacing), draw.Purpose("pattern.fire."+r.ID), draw.Int(cc.A), draw.Int(cc.B)) >= chunkTiles {
			return Hex{}, false
		}
		// It stands on dry land: the first dry tile in a keyed order, if any.
		disc := Disc(g.p.chunk)
		for _, k := range g.d.Shuffle(len(disc), draw.Purpose("pattern.where."+r.ID), draw.Int(cc.A), draw.Int(cc.B)) {
			if h := centre.Add(disc[k]); g.passable(g.raw(h).terrain) {
				return h, true
			}
		}
		return Hex{}, false
	case anchorTerrain:
		if int64(g.d.Below(percent, draw.Purpose("pattern.fire."+r.ID), draw.Int(cc.A), draw.Int(cc.B))) >= r.ChunkShare {
			return Hex{}, false
		}
		best, found := Hex{}, false
		for _, off := range Disc(g.p.chunk) {
			h := centre.Add(off)
			rh := g.raw(h)
			if rh.terrain != r.AnchorTerrain || !inBand(h) {
				continue
			}
			if !found || rh.elevation > g.raw(best).elevation || (rh.elevation == g.raw(best).elevation && h.Less(best)) {
				best, found = h, true
			}
		}
		return best, found
	}
	return Hex{}, false
}

func (g *Gen) instance(ri int, id string, anchor Hex) *instance {
	key := itoa(int64(ri)) + "|" + id
	if in, ok := g.instances[key]; ok {
		return in
	}
	r := g.b.Patterns[ri]
	who := []draw.Part{draw.Str(r.ID), draw.Str(id)}
	free := func(what string) bool { return slices.Contains(r.SeedFree, what) }
	centre := anchor
	if d := r.OffsetDistance; d > 0 {
		ring := Ring(anchor, d)
		n := int64(len(ring))
		k := (eastSide*d - r.OffsetBearing*n/fullTurn + n) % n
		if free("offset") {
			k = int64(g.d.Below(uint64(n), "pattern.offset", who...))
		}
		centre = ring[k]
	}
	rot := int64(0)
	if free("rotation") {
		rot = int64(g.d.Below(uint64(nDirs), "pattern.rotation", who...))
	}
	mirror := free("mirror") && g.d.Below(halves, "pattern.mirror", who...) == 1
	sh := g.shapes[r.Shape]
	outline, corners := g.shapeOffsets(sh, r.Size, who)
	place := func(o Hex) Hex {
		if mirror {
			o = o.Mirror()
		}
		return centre.Add(o.Rotate(rot))
	}
	in := &instance{rule: ri, id: id, centre: centre, extent: g.reach(ri)}
	var pts []Hex
	var places []string
	for _, part := range r.Parts {
		var at []Hex
		switch part.At {
		case "corners":
			at = corners
		case "edges":
			for _, o := range outline {
				if !slices.Contains(corners, o) {
					at = append(at, o)
				}
			}
		case "every":
			at = outline
		case "centre":
			at = []Hex{{}}
		case "spaced":
			n := int64(len(outline))
			step := max(1, n/max(1, part.Count))
			start := int64(0)
			if free("which") {
				start = int64(g.d.Below(uint64(step), "pattern.which", who...))
			}
			for k := range part.Count {
				at = append(at, outline[(start+k*step)%n])
			}
		case "indices":
			for _, k := range part.Indices {
				at = append(at, outline[((k%int64(len(outline)))+int64(len(outline)))%int64(len(outline))])
			}
		}
		for _, o := range at {
			h := place(o)
			if slices.Contains(pts, h) {
				continue
			}
			pts = append(pts, h)
			places = append(places, part.Place)
		}
	}
	jit := g.jitterOf(r)
	for k, h := range pts {
		if jit > 0 {
			n := DiscSize(jit)
			h = h.Add(discOffset(jit, int64(g.d.Below(uint64(n), "pattern.jitter", append(who, draw.Int(int64(k)))...))))
		}
		in.points = append(in.points, PatternPoint{Rule: r.ID, Instance: id, Place: places[k], Hex: h, Index: k, Centre: centre, Area: r.Area})
	}
	g.instances[key] = in
	return in
}

// shapeOffsets lays a shape around the origin: its outline in walk order
// and its corners.
func (g *Gen) shapeOffsets(sh *sheets.Shape, size int64, who []draw.Part) (outline, corners []Hex) {
	switch sh.Kind {
	case "ring":
		outline = Ring(Hex{}, size)
		for k := range nDirs {
			corners = append(corners, outline[int64(k)*size])
		}
	case "triangle":
		a, b, c := Hex{}, direction(0).Scale(size), direction(1).Scale(size)
		mid := Hex{Q: divRound(a.Q+b.Q+c.Q, discSides), R: divRound(a.R+b.R+c.R, discSides)}
		a, b, c = a.Add(mid.Scale(-1)), b.Add(mid.Scale(-1)), c.Add(mid.Scale(-1))
		corners = []Hex{a, b, c}
		outline = append(outline, Line(a, b)...)
		outline = append(outline, Line(b, c)[1:]...)
		ca := Line(c, a)
		outline = append(outline, ca[1:len(ca)-1]...)
	case "line":
		outline = Line(Hex{}, direction(0).Scale(size))
		corners = []Hex{outline[0], outline[len(outline)-1]}
	case "cross", "star":
		arms := max(1, sh.Arms)
		for k := range arms {
			d := direction(int(k * int64(nDirs) / arms))
			for s := int64(1); s <= size; s++ {
				outline = append(outline, d.Scale(s))
			}
			corners = append(corners, d.Scale(size))
		}
	case "spiral":
		step := max(1, sh.Step)
		var walk []Hex
		for r := int64(1); r <= size; r++ {
			walk = append(walk, Ring(Hex{}, r)...)
		}
		for k := step - 1; k < int64(len(walk)); k += step {
			outline = append(outline, walk[k])
		}
		corners = outline
	case "scatter":
		disc := Disc(size)
		order := g.d.Shuffle(len(disc), "pattern.scatter", who...)
		for _, k := range order {
			if int64(len(outline)) == sh.Count {
				break
			}
			o := disc[k]
			if !slices.ContainsFunc(outline, func(x Hex) bool { return Distance(x, o) < sh.Step }) {
				outline = append(outline, o)
			}
		}
		corners = outline
	case "glyph":
		for _, o := range sh.Offsets {
			outline = append(outline, Hex{Q: o.Q * size, R: o.R * size})
		}
		corners = outline
	}
	return outline, corners
}

// shapeExtent is how far a shape of this size reaches from its centre.
func (g *Gen) shapeExtent(sh *sheets.Shape, size int64) int64 {
	switch sh.Kind {
	case "triangle":
		// The corners sit two thirds of the side from the centroid.
		return (halves*size + halves) / discSides
	case "glyph":
		var e int64
		for _, o := range sh.Offsets {
			e = max(e, Hex{Q: o.Q * size, R: o.R * size}.Len())
		}
		return e
	}
	return size
}
