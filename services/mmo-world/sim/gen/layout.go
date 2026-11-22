package gen

import (
	"slices"

	"jams.team/mmo-world/sim/draw"
)

// Layout lays a map.shapes row of a size round a centre, turned rot
// sixths, as a rule's instance is laid: the tiles a part standing on its
// corners, edges, every point, the centre, or spaced (as many as the shape
// has corners, evenly round the outline) takes. who keys a shape that
// draws, such as a scatter. It reads the sheets alone and stores nothing,
// so a pattern the world places later is laid like the scaffold's without
// moving them.
func (g *Gen) Layout(shape string, size int64, at string, centre Hex, rot int64, who ...draw.Part) ([]Hex, bool) {
	sh, ok := g.shapes[shape]
	if !ok || size < 1 {
		return nil, false
	}
	outline, corners := g.shapeOffsets(sh, size, who)
	if len(outline) == 0 {
		return nil, false
	}
	var offs []Hex
	switch at {
	case "corners":
		offs = corners
	case "edges":
		for _, o := range outline {
			if !slices.Contains(corners, o) {
				offs = append(offs, o)
			}
		}
	case "every":
		offs = outline
	case "centre":
		offs = []Hex{{}}
	case "spaced":
		n := int64(len(outline))
		count := max(1, int64(len(corners)))
		step := max(1, n/count)
		for k := range count {
			offs = append(offs, outline[(k*step)%n])
		}
	default:
		return nil, false
	}
	var out []Hex
	for _, o := range offs {
		if h := centre.Add(o.Rotate(rot)); !slices.Contains(out, h) {
			out = append(out, h)
		}
	}
	return out, len(out) > 0
}
