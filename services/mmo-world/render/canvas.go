package render

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"strconv"
	"strings"

	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
	"golang.org/x/image/vector"
)

// Canvas is an image with a path rasterizer: shapes are filled from
// polygons, which is all a stencilled look needs.
type Canvas struct {
	Img *image.RGBA
}

func NewCanvas(w, h int, bg color.Color) *Canvas {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(img, img.Bounds(), &image.Uniform{bg}, image.Point{}, draw.Src)
	return &Canvas{Img: img}
}

// Pt is a point in pixels.
type Pt struct{ X, Y float64 }

// Fill fills polygons (subpaths, non-zero) with a colour.
func (c *Canvas) Fill(polys [][]Pt, col color.Color) {
	b := c.Img.Bounds()
	r := vector.NewRasterizer(b.Dx(), b.Dy())
	for _, p := range polys {
		if len(p) < 3 {
			continue
		}
		r.MoveTo(float32(p[0].X), float32(p[0].Y))
		for _, q := range p[1:] {
			r.LineTo(float32(q.X), float32(q.Y))
		}
		r.ClosePath()
	}
	r.Draw(c.Img, b, &image.Uniform{col}, image.Point{})
}

// Line strokes a polyline as quads of the given width.
func (c *Canvas) Line(pts []Pt, width float64, col color.Color) {
	var polys [][]Pt
	for i := 1; i < len(pts); i++ {
		a, b := pts[i-1], pts[i]
		dx, dy := b.X-a.X, b.Y-a.Y
		l := math.Hypot(dx, dy)
		if l == 0 {
			continue
		}
		nx, ny := -dy/l*width/2, dx/l*width/2
		polys = append(polys, []Pt{{a.X + nx, a.Y + ny}, {b.X + nx, b.Y + ny}, {b.X - nx, b.Y - ny}, {a.X - nx, a.Y - ny}})
	}
	c.Fill(polys, col)
}

// Circle fills a circle.
func (c *Canvas) Circle(at Pt, radius float64, col color.Color) {
	const sides = 24
	p := make([]Pt, sides)
	for i := range p {
		a := 2 * math.Pi * float64(i) / sides
		p[i] = Pt{at.X + radius*math.Cos(a), at.Y + radius*math.Sin(a)}
	}
	c.Fill([][]Pt{p}, col)
}

// Text writes a line in the basic face; labels on pictures are short and
// always carry their unit.
func (c *Canvas) Text(at Pt, s string, col color.Color) {
	d := font.Drawer{Dst: c.Img, Src: &image.Uniform{col}, Face: basicfont.Face7x13,
		Dot: fixed.Point26_6{X: fixed.I(int(at.X)), Y: fixed.I(int(at.Y))}}
	d.DrawString(s)
}

// TextWidth is a label's width in pixels.
func TextWidth(s string) int { return len(s) * basicfont.Face7x13.Advance }

// Label writes text on a dark plate so it reads over any ground.
func (c *Canvas) Label(at Pt, s string) {
	w := float64(TextWidth(s))
	c.Fill([][]Pt{{{at.X - 3, at.Y - 11}, {at.X + w + 3, at.Y - 11}, {at.X + w + 3, at.Y + 4}, {at.X - 3, at.Y + 4}}}, color.RGBA{0x10, 0x10, 0x10, 0xc0})
	c.Text(at, s, color.RGBA{0xf2, 0xee, 0xe4, 0xff})
}

// PNG encodes the canvas.
func (c *Canvas) PNG() ([]byte, error) {
	var buf bytes.Buffer
	err := (&png.Encoder{CompressionLevel: png.BestSpeed}).Encode(&buf, c.Img)
	return buf.Bytes(), err
}

// Hex parses "#rrggbb".
func Hex(s string) color.RGBA {
	v, err := strconv.ParseUint(strings.TrimPrefix(s, "#"), 16, 32)
	if err != nil {
		return unknownTerrain
	}
	return color.RGBA{uint8(v >> 16), uint8(v >> 8), uint8(v), 0xff}
}

// Alpha is a colour at an opacity out of 255.
func Alpha(c color.RGBA, a uint8) color.NRGBA { return color.NRGBA{c.R, c.G, c.B, a} }

// SVGPath reads SVG path data (M, L, H, V, C, A and Z, absolute or
// relative) into polygons, scaled by s and moved by off. Curves and arcs
// are flattened.
func SVGPath(d string, s float64, off Pt) ([][]Pt, error) {
	toks := tokens(d)
	var out [][]Pt
	var cur []Pt
	var at, start Pt
	cmd := byte(0)
	i := 0
	num := func() (float64, error) {
		if i >= len(toks) {
			return 0, fmt.Errorf("render: path ends early")
		}
		v, err := strconv.ParseFloat(toks[i], 64)
		i++
		return v, err
	}
	nums := func(n int) ([]float64, error) {
		out := make([]float64, n)
		for k := range out {
			v, err := num()
			if err != nil {
				return nil, err
			}
			out[k] = v
		}
		return out, nil
	}
	put := func(p Pt) { cur = append(cur, Pt{p.X*s + off.X, p.Y*s + off.Y}) }
	for i < len(toks) {
		t := toks[i]
		if len(t) == 1 && strings.ContainsAny(t, "MLHVCAZmlhvcaz") {
			cmd = t[0]
			i++
			if cmd == 'Z' || cmd == 'z' {
				if len(cur) > 0 {
					out = append(out, cur)
				}
				cur, at = nil, start
				continue
			}
		}
		rel := cmd >= 'a'
		base := Pt{}
		if rel {
			base = at
		}
		switch cmd | 0x20 {
		case 'm':
			v, err := nums(2)
			if err != nil {
				return nil, err
			}
			if len(cur) > 0 {
				out = append(out, cur)
			}
			cur = nil
			at = Pt{base.X + v[0], base.Y + v[1]}
			start = at
			put(at)
			cmd = map[bool]byte{true: 'l', false: 'L'}[rel]
		case 'l':
			v, err := nums(2)
			if err != nil {
				return nil, err
			}
			at = Pt{base.X + v[0], base.Y + v[1]}
			put(at)
		case 'h':
			v, err := num()
			if err != nil {
				return nil, err
			}
			at = Pt{base.X + v, at.Y}
			if !rel {
				at.X = v
			}
			put(at)
		case 'v':
			v, err := num()
			if err != nil {
				return nil, err
			}
			at = Pt{at.X, base.Y + v}
			if !rel {
				at.Y = v
			}
			put(at)
		case 'c':
			v, err := nums(6)
			if err != nil {
				return nil, err
			}
			p0, p1, p2, p3 := at, Pt{base.X + v[0], base.Y + v[1]}, Pt{base.X + v[2], base.Y + v[3]}, Pt{base.X + v[4], base.Y + v[5]}
			for k := 1; k <= curveSteps; k++ {
				u := float64(k) / curveSteps
				w := 1 - u
				put(Pt{w*w*w*p0.X + 3*w*w*u*p1.X + 3*w*u*u*p2.X + u*u*u*p3.X, w*w*w*p0.Y + 3*w*w*u*p1.Y + 3*w*u*u*p2.Y + u*u*u*p3.Y})
			}
			at = p3
		case 'a':
			v, err := nums(7)
			if err != nil {
				return nil, err
			}
			end := Pt{base.X + v[5], base.Y + v[6]}
			for _, p := range arc(at, end, v[0], v[1], v[2], v[3] != 0, v[4] != 0) {
				put(p)
			}
			at = end
		default:
			return nil, fmt.Errorf("render: unknown path command %q", cmd)
		}
	}
	if len(cur) > 0 {
		out = append(out, cur)
	}
	return out, nil
}

const curveSteps = 12

func tokens(d string) []string {
	var out []string
	var b strings.Builder
	flush := func() {
		if b.Len() > 0 {
			out = append(out, b.String())
			b.Reset()
		}
	}
	for k := 0; k < len(d); k++ {
		ch := d[k]
		switch {
		case strings.IndexByte("MLHVCAZmlhvcaz", ch) >= 0:
			flush()
			out = append(out, string(ch))
		case ch == ' ' || ch == ',' || ch == '\n' || ch == '\t':
			flush()
		case ch == '-' && b.Len() > 0 && !strings.HasSuffix(b.String(), "e"):
			flush()
			b.WriteByte(ch)
		case ch == '.' && strings.Contains(b.String(), "."):
			flush()
			b.WriteByte(ch)
		default:
			b.WriteByte(ch)
		}
	}
	flush()
	return out
}

// arc flattens an SVG elliptical arc (endpoint form) to points after p0.
func arc(p0, p1 Pt, rx, ry, rot float64, large, sweep bool) []Pt {
	if rx == 0 || ry == 0 {
		return []Pt{p1}
	}
	phi := rot * math.Pi / 180
	cos, sin := math.Cos(phi), math.Sin(phi)
	dx, dy := (p0.X-p1.X)/2, (p0.Y-p1.Y)/2
	x1 := cos*dx + sin*dy
	y1 := -sin*dx + cos*dy
	rx, ry = math.Abs(rx), math.Abs(ry)
	if l := x1*x1/(rx*rx) + y1*y1/(ry*ry); l > 1 {
		rx, ry = rx*math.Sqrt(l), ry*math.Sqrt(l)
	}
	num := rx*rx*ry*ry - rx*rx*y1*y1 - ry*ry*x1*x1
	den := rx*rx*y1*y1 + ry*ry*x1*x1
	k := math.Sqrt(math.Max(0, num/den))
	if large == sweep {
		k = -k
	}
	cx1, cy1 := k*rx*y1/ry, -k*ry*x1/rx
	cx := cos*cx1 - sin*cy1 + (p0.X+p1.X)/2
	cy := sin*cx1 + cos*cy1 + (p0.Y+p1.Y)/2
	ang := func(ux, uy, vx, vy float64) float64 {
		a := math.Atan2(ux*vy-uy*vx, ux*vx+uy*vy)
		return a
	}
	t1 := ang(1, 0, (x1-cx1)/rx, (y1-cy1)/ry)
	dt := ang((x1-cx1)/rx, (y1-cy1)/ry, (-x1-cx1)/rx, (-y1-cy1)/ry)
	if !sweep && dt > 0 {
		dt -= 2 * math.Pi
	} else if sweep && dt < 0 {
		dt += 2 * math.Pi
	}
	n := int(math.Ceil(math.Abs(dt) / (math.Pi / curveSteps)))
	out := make([]Pt, 0, n)
	for i := 1; i <= n; i++ {
		t := t1 + dt*float64(i)/float64(n)
		out = append(out, Pt{cx + rx*math.Cos(t)*cos - ry*math.Sin(t)*sin, cy + rx*math.Cos(t)*sin + ry*math.Sin(t)*cos})
	}
	return out
}
