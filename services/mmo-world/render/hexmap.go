// Package render draws pictures from state. It runs after a state change,
// never inside a reply window, and stores by state digest.
package render

import (
	"image"
	"image/color"
	"image/draw"
	"math"

	"jams.team/mmo-world/sim/gen"
)

var terrainColour = map[string]color.RGBA{
	"plain":      {0xb9, 0xc9, 0x7a, 0xff},
	"forest":     {0x4f, 0x7a, 0x45, 0xff},
	"marsh":      {0x6f, 0x8a, 0x6a, 0xff},
	"hills":      {0xa8, 0x93, 0x63, 0xff},
	"mountain":   {0x8a, 0x80, 0x78, 0xff},
	"flats":      {0xe0, 0xd2, 0x9e, 0xff},
	"coast":      {0xd8, 0xcf, 0xa8, 0xff},
	"deep-water": {0x2f, 0x5d, 0x8c, 0xff},
	"peak":       {0xee, 0xee, 0xf2, 0xff},
}

var (
	river      = color.RGBA{0x3d, 0x7f, 0xc4, 0xff}
	border     = color.RGBA{0x30, 0x2a, 0x22, 0x60}
	dungeon    = color.RGBA{0x7a, 0x14, 0x1e, 0xff}
	settlement = color.RGBA{0xff, 0xff, 0xff, 0xff}
	ink        = color.RGBA{0x10, 0x10, 0x10, 0xff}
	variant    = color.RGBA{0x5a, 0x1d, 0x6e, 0xff}
	site       = color.RGBA{0x30, 0x2a, 0x22, 0xff}
	paper      = color.RGBA{0xf6, 0xf3, 0xea, 0xff}
)

// HexMap draws an area with pointy-top hexes of the given size in pixels,
// centred on the area's centre.
func HexMap(w *gen.Area, size float64) *image.RGBA {
	r := float64(w.Radius) + 1
	width := int(math.Ceil(size * math.Sqrt(3) * (2*r + 1)))
	height := int(math.Ceil(size * 1.5 * (2*r + 1)))
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.Draw(img, img.Bounds(), &image.Uniform{paper}, image.Point{}, draw.Src)
	cx, cy := float64(width)/2, float64(height)/2
	at := func(px, py float64) int {
		x, y := (px-cx)/size, (py-cy)/size
		q := (math.Sqrt(3)/3*x - y/3)
		rr := 2.0 / 3 * y
		return w.Index(cubeRound(q, rr).Add(w.Centre))
	}
	for py := range height {
		for px := range width {
			i := at(float64(px)+0.5, float64(py)+0.5)
			if i < 0 {
				continue
			}
			t := w.Tiles[i]
			c := terrainColour[t.Terrain]
			if t.Secondary != "" {
				c = blend(c, terrainColour[t.Secondary], float64(t.Blend)/100)
			}
			if t.River {
				c = blend(c, river, 0.65)
			}
			if t.Ford {
				c = blend(terrainColour["deep-water"], terrainColour["coast"], 0.55)
			}
			if t.Variant != "" {
				c = blend(c, variant, 0.45)
			}
			if j := at(float64(px)+1.5, float64(py)+0.5); j >= 0 && w.Tiles[j].Region != t.Region {
				c = blend(c, border, 0.5)
			} else if j := at(float64(px)+0.5, float64(py)+1.5); j >= 0 && w.Tiles[j].Region != t.Region {
				c = blend(c, border, 0.5)
			}
			img.SetRGBA(px, py, c)
		}
	}
	centre := func(h gen.Hex) (float64, float64) {
		h = gen.Hex{Q: h.Q - w.Centre.Q, R: h.R - w.Centre.R}
		return cx + size*math.Sqrt(3)*(float64(h.Q)+float64(h.R)/2), cy + size*1.5*float64(h.R)
	}
	mark := math.Max(size, 2.5)
	for _, t := range w.Tiles {
		if t.Site == gen.SiteOrdinary || t.Site == gen.PlaceDungeon {
			x, y := centre(t.Hex)
			disc(img, x, y, size*0.22, site)
		}
	}
	for _, p := range w.Points {
		x, y := centre(p.Hex)
		c, ok := placeColour[p.Place]
		if !ok {
			c = dungeon
		}
		disc(img, x, y, mark*0.8, ink)
		disc(img, x, y, mark*0.6, c)
	}
	for _, s := range w.Homes {
		x, y := centre(s.Hex)
		disc(img, x, y, mark*1.1, ink)
		disc(img, x, y, mark*0.8, settlement)
	}
	return img
}

var placeColour = map[string]color.RGBA{
	"relay":    {0x7a, 0x14, 0x1e, 0xff},
	"pylon":    {0xe0, 0x8a, 0x10, 0xff},
	"vault":    {0x8a, 0x2b, 0xe2, 0xff},
	"landmark": {0x20, 0x20, 0x20, 0xff},
	"beacon":   {0xf2, 0xd0, 0x20, 0xff},
	"dungeon":  {0x7a, 0x14, 0x1e, 0xff},
}

func cubeRound(q, r float64) gen.Hex {
	s := -q - r
	rq, rr, rs := math.Round(q), math.Round(r), math.Round(s)
	dq, dr, ds := math.Abs(rq-q), math.Abs(rr-r), math.Abs(rs-s)
	switch {
	case dq > dr && dq > ds:
		rq = -rr - rs
	case dr > ds:
		rr = -rq - rs
	}
	return gen.Hex{Q: int64(rq), R: int64(rr)}
}

func blend(a, b color.RGBA, t float64) color.RGBA {
	t *= float64(b.A) / 255
	mix := func(x, y uint8) uint8 { return uint8(float64(x)*(1-t) + float64(y)*t) }
	return color.RGBA{mix(a.R, b.R), mix(a.G, b.G), mix(a.B, b.B), 0xff}
}

func disc(img *image.RGBA, x, y, r float64, c color.RGBA) {
	for py := int(y - r); py <= int(y+r); py++ {
		for px := int(x - r); px <= int(x+r); px++ {
			if dx, dy := float64(px)+0.5-x, float64(py)+0.5-y; dx*dx+dy*dy <= r*r {
				if image.Pt(px, py).In(img.Bounds()) {
					img.SetRGBA(px, py, c)
				}
			}
		}
	}
}

// Sheet lays images out in a grid, scaled down to cell pixels wide.
func Sheet(imgs []*image.RGBA, cols, cell int) *image.RGBA {
	if len(imgs) == 0 {
		return image.NewRGBA(image.Rect(0, 0, 1, 1))
	}
	b := imgs[0].Bounds()
	cellH := cell * b.Dy() / b.Dx()
	rows := (len(imgs) + cols - 1) / cols
	out := image.NewRGBA(image.Rect(0, 0, cols*cell, rows*cellH))
	draw.Draw(out, out.Bounds(), &image.Uniform{paper}, image.Point{}, draw.Src)
	for k, im := range imgs {
		ox, oy := (k%cols)*cell, (k/cols)*cellH
		sb := im.Bounds()
		for y := range cellH {
			for x := range cell {
				out.SetRGBA(ox+x, oy+y, im.RGBAAt(x*sb.Dx()/cell, y*sb.Dy()/cellH))
			}
		}
	}
	return out
}
