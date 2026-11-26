package render

import (
	"crypto/sha256"
	"encoding/hex"
	"image/color"
	"math"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/gen"
	simhex "jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

// Pictures for the chat cards (GDD 16). Each is a pure function of its
// input: the same state gives the same picture, so a picture is stored by
// the digest of its input and never drawn per press.

var (
	tar     = Hex("#1d1c1a")
	ash     = Hex("#c9c4b8")
	hazard  = Hex("#e0b424")
	rust    = Hex("#a4482a")
	corrupt = Hex("#b8358c")
)

var weatherTint = map[string]color.RGBA{
	"storm": {0x6a, 0x4f, 0xc8, 0xff}, "frost": {0xe8, 0xf0, 0xff, 0xff}, "drought": {0xe0, 0x9a, 0x3a, 0xff},
	"fog": {0x9a, 0x9a, 0x9a, 0xff}, "clear": {0xff, 0xff, 0xff, 0xff},
}

// MapTile is one tile of a map crop as its viewer may see it. An unknown
// tile carries only its hex and fog; a discovered one its base; the live
// values only in sight, or as last seen.
type MapTile struct {
	Hex        simhex.Hex `json:"hex"`
	Fog        string     `json:"fog"`           // unknown, sight, seen or discovered
	Age        int64      `json:"age,omitempty"` // seen: world days since it left sight
	Terrain    string     `json:"terrain,omitempty"`
	River      bool       `json:"river,omitempty"`
	Road       int64      `json:"road,omitempty"`
	Site       string     `json:"site,omitempty"`
	Region     string     `json:"region,omitempty"`
	Weather    string     `json:"weather,omitempty"`
	Threat     int64      `json:"threat,omitempty"`
	Corruption int64      `json:"corruption,omitempty"`
	Danger     bool       `json:"danger,omitempty"`
	Corrupted  bool       `json:"corrupted,omitempty"`
	Busy       string     `json:"busy,omitempty"`
	Trouble    bool       `json:"trouble,omitempty"`
	Fire       bool       `json:"fire,omitempty"`
	Cut        bool       `json:"cut,omitempty"`
	Toll       int64      `json:"toll,omitempty"`
}

// MapCrop is a map picture's input: everything one viewer may see of the
// disc, so its key changes whenever what they may see does, and the rev of
// the map style it is drawn in, so a restyled pack draws anew.
type MapCrop struct {
	Centre simhex.Hex   `json:"centre"`
	Radius int64        `json:"radius"`
	Tiles  []MapTile    `json:"tiles"`
	At     simhex.Hex   `json:"at"`
	Route  []simhex.Hex `json:"route,omitempty"`
	Style  string       `json:"style,omitempty"`
}

// structural: map tile size and picture margin, in pixels.
const (
	hexSize   = 26.0
	mapMargin = 14.0
)

// structural: the picture's marks, in pixels.
const (
	settlementInk  = 11.0
	settlementMark = 8.0
	dungeonMark    = 7.0
	siteMark       = 5.0
	roadBase       = 3.0
	riverWidth     = 4.0
	routeWidth     = 3.0
	selfInk        = 9.0
	selfMark       = 6.0
	liveMark       = 4.0
	busyPip        = 2.5
	busyPipGap     = 0.22 // of a hex
	busyPipRow     = 0.5  // of a hex, below the centre
	rimWidth       = 3.0
	dotGap         = 6.0
	dotRadius      = 1.4
	dash           = 2.0
	labelRise      = 0.55 // of a hex, above the centre
	labelInset     = 4.0  // a label's least gap from the picture's side
	fogHatchLift   = 0x10 // the hatch is the fog this much lighter
)

// markSlots are where live marks sit round a tile's centre, as fractions of
// a hex, in the order the live map places them.
var markSlots = [...]Pt{{-0.42, -0.38}, {0.42, -0.38}, {-0.5, 0.12}, {0.5, 0.12}, {0, -0.62}, {0, 0.62}}

var busyPips = map[string]int{api.BusyLight: 1, api.BusyBusy: 2, api.BusyCrowded: 3}

func (m MapCrop) centreOf(h simhex.Hex, origin Pt) Pt {
	return HexCentre(h.Sub(m.Centre), hexSize, origin)
}

// HexCentre is where a pointy-top hex, as an offset from the one drawn at
// origin, is drawn.
func HexCentre(d simhex.Hex, size float64, origin Pt) Pt {
	return Pt{origin.X + size*math.Sqrt(3)*(float64(d.Q)+float64(d.R)/2), origin.Y + size*1.5*float64(d.R)}
}

func hexPoly(c Pt, size float64) []Pt {
	p := make([]Pt, simhex.Directions)
	for i := range p {
		a := math.Pi/180*(60*float64(i)) - math.Pi/6
		p[i] = Pt{c.X + size*math.Cos(a), c.Y + size*math.Sin(a)}
	}
	return p
}

// Map draws a crop of the hex map in the pack's map style (GDD 4.11,
// 16.4): unknown tiles as hatched fog; discovered tiles never seen as
// their base alone; last-seen tiles dimmed, their live marks in the seen
// pattern and their age on the label line; tiles in sight in full, inside
// the rim of the viewer's sight. Then the route and the character.
func Map(m MapCrop, s MapStyle) *Canvas {
	r := float64(m.Radius)
	w := int(math.Ceil(hexSize*math.Sqrt(3)*(2*r+1) + 2*mapMargin))
	h := int(math.Ceil(hexSize*(3*r+2) + 2*mapMargin))
	c := NewCanvas(w, h, tar)
	origin := Pt{float64(w) / 2, float64(h) / 2}
	fog := s.Colour("fog:unknown")
	hatch := color.NRGBA{lift(fog.R), lift(fog.G), lift(fog.B), fog.A}
	veil := color.NRGBA{A: uint8(min(max(s.SeenDim, 0), 100) * 0xff / 100)}
	seenPattern := s.Pattern("fog:seen")
	sight := map[simhex.Hex]bool{}
	gauged, aged := map[string]bool{}, map[string]bool{}
	for _, t := range m.Tiles {
		at := m.centreOf(t.Hex, origin)
		poly := hexPoly(at, hexSize-1)
		switch t.Fog {
		case api.FogSight, api.FogSeen, api.FogDiscovered:
		default:
			c.Fill([][]Pt{poly}, fog)
			patterned(c, at, poly, s.Pattern("fog:unknown"), hatch)
			continue
		}
		mapBase(c, s, t, at, poly)
		if t.Fog == api.FogDiscovered {
			continue
		}
		pattern := ""
		if t.Fog == api.FogSeen {
			c.Fill([][]Pt{poly}, veil)
			pattern = seenPattern
		} else {
			sight[t.Hex] = true
		}
		mapLive(c, s, t, at, poly, pattern)
		var label []string
		if (t.Danger || t.Corrupted) && t.Region != "" && !gauged[t.Region] {
			gauged[t.Region] = true
			v := strconv.FormatInt(t.Threat, 10) + " threat"
			if t.Corrupted {
				v = strconv.FormatInt(t.Corruption, 10) + " corruption"
			}
			label = append(label, v)
		}
		if key := t.Region + "|" + strconv.FormatInt(t.Age, 10); t.Fog == api.FogSeen && !aged[key] {
			aged[key] = true
			label = append(label, ageWords(t.Age))
		}
		if len(label) > 0 {
			text := strings.Join(label, ", ")
			tw := float64(TextWidth(text))
			x := min(max(at.X-tw/2, labelInset), float64(w)-tw-labelInset)
			c.Label(Pt{x, at.Y - hexSize*labelRise}, text)
		}
	}
	rim := opaqueOf(s.Colour("fog:sight"))
	for x := range sight {
		at := m.centreOf(x, origin)
		poly := hexPoly(at, hexSize-1)
		for _, n := range x.Neighbours() {
			if sight[n] {
				continue
			}
			d := m.centreOf(n, origin)
			side := (int(math.Round(math.Atan2(d.Y-at.Y, d.X-at.X)/(math.Pi/3))) + simhex.Directions) % simhex.Directions
			c.Line([]Pt{poly[side], poly[(side+1)%simhex.Directions]}, rimWidth, rim)
		}
	}
	if len(m.Route) > 0 {
		pts := []Pt{m.centreOf(m.At, origin)}
		for _, x := range m.Route {
			pts = append(pts, m.centreOf(x, origin))
		}
		c.Line(pts, routeWidth, opaqueOf(s.Colour("layer:route")))
	}
	me := m.centreOf(m.At, origin)
	c.Circle(me, selfInk, opaqueOf(s.Colour("ink")))
	c.Circle(me, selfMark, s.Colour("layer:self"))
	return c
}

// ageWords is how long ago a last-seen tile left sight, in whole world
// days: mmo-words' seenAgo without its leading "seen ".
func ageWords(days int64) string {
	switch {
	case days <= 0:
		return "less than a world day ago"
	case days == 1:
		return "1 world day ago"
	}
	return strconv.FormatInt(days, 10) + " world days ago"
}

func lift(v uint8) uint8 { return uint8(min(int(v)+fogHatchLift, 0xff)) }

func opaqueOf(c color.NRGBA) color.NRGBA { return color.NRGBA{c.R, c.G, c.B, 0xff} }

// mapBase draws a tile's base layers: its terrain, river, road and site.
func mapBase(c *Canvas, s MapStyle, t MapTile, at Pt, poly []Pt) {
	c.Fill([][]Pt{poly}, opaqueOf(s.Colour("terrain:"+t.Terrain)))
	if t.River {
		c.Line([]Pt{{at.X - hexSize*0.7, at.Y + 3}, {at.X, at.Y - 2}, {at.X + hexSize*0.7, at.Y + 3}}, riverWidth, s.Colour("water:river"))
	}
	if t.Road > 0 {
		c.Circle(at, roadBase+float64(t.Road), s.Colour("road"))
	}
	switch t.Site {
	case gen.PlaceSettlement:
		g := s.Glyph("place:settlement")
		glyph(c, g, at, settlementInk, opaqueOf(s.Colour("ink")), false)
		glyph(c, g, at, settlementMark, s.Colour("place:settlement"), false)
	case gen.PlaceDungeon:
		glyph(c, s.Glyph("site:dungeon"), at, dungeonMark, s.Colour("site:dungeon"), false)
	case "":
	default:
		glyph(c, s.Glyph("site:other"), at, siteMark, s.Colour("site:other"), false)
	}
}

// mapLive draws a tile's live layers; pattern, when set, replaces each
// tint's own and dots each mark, for a tile last seen.
func mapLive(c *Canvas, s MapStyle, t MapTile, at Pt, poly []Pt, pattern string) {
	tint := func(id string) {
		p := s.Pattern(id)
		if pattern != "" {
			p = pattern
		}
		patterned(c, at, poly, p, s.Colour(id))
	}
	if t.Corrupted {
		tint("layer:corruption")
	}
	if t.Danger {
		tint("layer:danger")
	}
	if id := "weather:" + t.Weather; t.Weather != "" && s.Colour(id).A > 0 {
		tint(id)
	}
	dotted := pattern != ""
	slot := 0
	for _, mk := range []struct {
		on    bool
		glyph string
		col   color.NRGBA
	}{
		{t.Trouble, s.Glyph("layer:trouble"), s.Colour("layer:trouble")},
		{t.Fire, s.Glyph("layer:fire"), s.Colour("layer:fire")},
		{t.Cut, "cross", opaqueOf(s.Colour("layer:danger"))},
		{t.Toll > 0, "circle", opaqueOf(s.Colour("layer:trouble"))},
	} {
		if !mk.on {
			continue
		}
		o := markSlots[slot%len(markSlots)]
		slot++
		glyph(c, mk.glyph, Pt{at.X + o.X*hexSize, at.Y + o.Y*hexSize}, liveMark, mk.col, dotted)
	}
	n := busyPips[t.Busy]
	for i := range n {
		x := at.X + (float64(i)-float64(n-1)/2)*busyPipGap*hexSize
		glyph(c, s.Glyph("layer:busy"), Pt{x, at.Y + busyPipRow*hexSize}, busyPip, s.Colour("layer:busy"), dotted)
	}
}

// patterned fills a hex in a pattern: solid, hatch, stripes, dots or rim.
func patterned(c *Canvas, at Pt, poly []Pt, pattern string, col color.Color) {
	switch pattern {
	case "":
		c.Fill([][]Pt{poly}, col)
	case "hatch":
		c.Line([]Pt{{at.X - hexSize/2, at.Y + hexSize/3}, {at.X + hexSize/2, at.Y - hexSize/3}}, 1, col)
	case "stripes":
		for k := -2; k <= 2; k++ {
			o := float64(k) * hexSize / 3
			c.Line([]Pt{{at.X + o - 6, at.Y + 8}, {at.X + o + 6, at.Y - 8}}, 2, col)
		}
	case "dots":
		inner := hexSize * math.Sqrt(3) / 2 * 0.85
		for y := -hexSize; y <= hexSize; y += dotGap {
			for x := -hexSize; x <= hexSize; x += dotGap {
				if math.Hypot(x, y) <= inner {
					c.Circle(Pt{at.X + x, at.Y + y}, dotRadius, col)
				}
			}
		}
	case "rim":
		c.Line(append(slices.Clone(poly), poly[0]), rimWidth, col)
	}
}

// glyph draws a mark: filled, or as a dotted outline for a tile last seen.
func glyph(c *Canvas, kind string, at Pt, r float64, col color.Color, dotted bool) {
	var outline []Pt
	switch kind {
	case "diamond":
		outline = []Pt{{at.X, at.Y - r}, {at.X + r, at.Y}, {at.X, at.Y + r}, {at.X - r, at.Y}}
	case "square":
		outline = []Pt{{at.X - r, at.Y - r}, {at.X + r, at.Y - r}, {at.X + r, at.Y + r}, {at.X - r, at.Y + r}}
	case "triangle":
		outline = []Pt{{at.X, at.Y - r}, {at.X + r, at.Y + r*0.8}, {at.X - r, at.Y + r*0.8}}
	case "circle", "pip", "ring":
		const sides = 16
		for i := range sides {
			a := 2 * math.Pi * float64(i) / sides
			outline = append(outline, Pt{at.X + r*math.Cos(a), at.Y + r*math.Sin(a)})
		}
	case "cross":
		for _, l := range [][]Pt{{{at.X - r, at.Y - r}, {at.X + r, at.Y + r}}, {{at.X + r, at.Y - r}, {at.X - r, at.Y + r}}} {
			if dotted {
				dashed(c, l, r*0.35+1, col)
			} else {
				c.Line(l, r*0.35+1, col)
			}
		}
		return
	default:
		return
	}
	closed := append(outline, outline[0])
	switch {
	case dotted:
		dashed(c, closed, max(r*0.35, 1), col)
	case kind == "ring":
		c.Line(closed, max(r*0.35, 1), col)
	default:
		c.Fill([][]Pt{outline}, col)
	}
}

// dashed strokes a polyline in dashes.
func dashed(c *Canvas, pts []Pt, width float64, col color.Color) {
	var polys [][]Pt
	for i := 1; i < len(pts); i++ {
		a, b := pts[i-1], pts[i]
		l := math.Hypot(b.X-a.X, b.Y-a.Y)
		for o := 0.0; o < l; o += 2 * dash {
			e := min(o+dash, l)
			p, q := Pt{a.X + (b.X-a.X)*o/l, a.Y + (b.Y-a.Y)*o/l}, Pt{a.X + (b.X-a.X)*e/l, a.Y + (b.Y-a.Y)*e/l}
			polys = append(polys, segment(p, q, width)...)
		}
	}
	c.Fill(polys, col)
}

func segment(a, b Pt, width float64) [][]Pt {
	dx, dy := b.X-a.X, b.Y-a.Y
	l := math.Hypot(dx, dy)
	if l == 0 {
		return nil
	}
	nx, ny := -dy/l*width/2, dx/l*width/2
	return [][]Pt{{{a.X + nx, a.Y + ny}, {b.X + nx, b.Y + ny}, {b.X - nx, b.Y - ny}, {a.X - nx, a.Y - ny}}}
}

// BannerInput is a banner's input: a region's biome, the weather over it,
// the hour, and its gauges (GDD 16.4, 16.5).
type BannerInput struct {
	Seed       string   `json:"seed"` // the region's ref: its mark
	Terrain    string   `json:"terrain"`
	Weather    string   `json:"weather,omitempty"`
	Hour       int64    `json:"hour"` // 0 to 23
	Threat     int64    `json:"threat"`
	Corruption int64    `json:"corruption"`
	Settlement bool     `json:"settlement"`
	Danger     bool     `json:"danger"`  // threat at the ambush line or above
	Overrun    bool     `json:"overrun"` // the raid or overrun line holds
	Tags       []string `json:"tags,omitempty"`
	Corrupted  bool     `json:"corrupted"`
	// A settlement's state: its wall's tier (0 is none) and whether the
	// wall is down, the open trouble's template, a ruin, a city.
	Wall     int64  `json:"wall,omitempty"`
	WallDown bool   `json:"wallDown,omitempty"`
	Trouble  string `json:"trouble,omitempty"`
	Ruined   bool   `json:"ruined,omitempty"`
	City     bool   `json:"city,omitempty"`
}

// structural: banner size in pixels, and the mark's scale on the pack's
// 100 by 120 layers.
const (
	bannerW    = 640
	bannerH    = 200
	markScale  = 1.4
	groundLine = 0.62
)

// Banner draws a region banner: sky by the hour, ground by the biome, the
// weather, a stencilled region mark from the pack's layers, hazard
// stripes under threat, fire when overrun, and a corruption tint. A
// settlement shows its state (GDD 16.4): a skyline, taller for a city and
// broken for a ruin; fire behind its wall under a raid and flames in its
// streets under a fire; a pennant for any other trouble; and a palisade
// only when a wall stands, broken when it is down.
func Banner(in BannerInput, layers []sheets.BannerLayer, palette []sheets.Palette) (*Canvas, error) {
	c := NewCanvas(bannerW, bannerH, sky(in.Hour))
	ground := terrainOf(in.Terrain)
	gy := bannerH * groundLine
	c.Fill([][]Pt{{{0, gy}, {bannerW, gy - 12}, {bannerW, bannerH}, {0, bannerH}}}, ground)
	seed := digest(in.Seed)
	for i := range 40 {
		x := float64(seed[i%len(seed)]) / 255 * bannerW
		y := gy + 8 + float64(seed[(i*7)%len(seed)])/255*(bannerH-gy-12)
		c.Fill([][]Pt{{{x, y}, {x + 18, y - 2}, {x + 16, y + 3}, {x - 1, y + 4}}}, Alpha(tar, 0x40))
	}
	if in.Settlement {
		town(c, in, seed, gy)
	} else if in.Overrun {
		for i := 0; i < 9; i++ {
			x := 320 + float64(i)*30
			c.Fill([][]Pt{{{x, gy}, {x + 12, gy - 40 - float64(seed[i]%30)}, {x + 24, gy}}}, Alpha(rust, 0xd0))
			c.Fill([][]Pt{{{x + 6, gy}, {x + 12, gy - 22}, {x + 18, gy}}}, Alpha(hazard, 0xd0))
		}
	}
	if col, ok := weatherTint[in.Weather]; ok && in.Weather != "clear" {
		for i := 0; i < 30; i++ {
			x := float64(seed[i%len(seed)]) / 255 * bannerW
			y := float64(seed[(i*5+3)%len(seed)]) / 255 * gy
			c.Line([]Pt{{x, y}, {x - 14, y + 26}}, 2, Alpha(col, 0x90))
		}
		c.Fill([][]Pt{{{0, 0}, {bannerW, 0}, {bannerW, bannerH}, {0, bannerH}}}, Alpha(col, 0x28))
	}
	if err := mark(c, in, seed, layers, palette); err != nil {
		return nil, err
	}
	if in.Danger {
		for x := -40.0; x < bannerW; x += 28 {
			c.Fill([][]Pt{{{x, bannerH - 14}, {x + 14, bannerH - 14}, {x + 28, bannerH}, {x + 14, bannerH}}}, hazard)
			c.Fill([][]Pt{{{x + 14, bannerH - 14}, {x + 28, bannerH - 14}, {x + 42, bannerH}, {x + 28, bannerH}}}, ink)
		}
	}
	if in.Corrupted {
		c.Fill([][]Pt{{{0, 0}, {bannerW, 0}, {bannerW, bannerH}, {0, bannerH}}}, Alpha(corrupt, 0x30))
	}
	return c, nil
}

// Trouble templates a banner draws in flames.
const (
	TroubleRaid = "raid"
	TroubleFire = "fire"
)

// structural: where a settlement stands on its banner, its houses' and
// wall's sizes, and how much of a broken wall is gone.
const (
	townLeft, townRight = 296.0, 612.0
	houseStep           = 26.0
	houseLow, houseHigh = 22.0, 40.0
	cityLow, cityHigh   = 52.0, 96.0
	stakeStep           = 14.0
	wallBase, wallRise  = 24.0, 6.0
	brokenEvery         = 3
)

var (
	timber = Hex("#5d4a37")
	house  = Hex("#3a3631")
	window = Alpha(hazard, 0xb0)
)

// town draws a settlement's skyline, its fires and its wall, back to
// front.
func town(c *Canvas, in BannerInput, seed []byte, gy float64) {
	base := gy - 8
	low, high := houseLow, houseHigh
	if in.City {
		low, high = cityLow, cityHigh
	}
	k := 0
	for x := townLeft; x+houseStep <= townRight; x += houseStep {
		k++
		h := low + float64(seed[k%len(seed)])/255*(high-low)
		top := base - h
		if in.Ruined {
			c.Fill([][]Pt{{{x + 2, base}, {x + 2, top + h/3}, {x + 8, top + h/2}, {x + 13, top}, {x + 18, top + h/2.5}, {x + houseStep - 4, top + h/3}, {x + houseStep - 4, base}}}, Alpha(house, 0xd0))
			continue
		}
		c.Fill([][]Pt{{{x + 2, base}, {x + 2, top}, {x + houseStep/2, top - 10}, {x + houseStep - 4, top}, {x + houseStep - 4, base}}}, house)
		if in.City {
			c.Fill([][]Pt{{{x + 9, top - 10}, {x + 9, top - 24}, {x + 13, top - 28}, {x + 17, top - 24}, {x + 17, top - 10}}}, house)
		}
		if in.Trouble == TroubleFire || seed[(k+5)%len(seed)]%3 == 0 {
			c.Fill([][]Pt{{{x + 8, top + 8}, {x + 14, top + 8}, {x + 14, top + 15}, {x + 8, top + 15}}}, window)
		}
	}
	if in.Trouble == TroubleRaid || in.Overrun {
		for i := 0; i < 11; i++ {
			x := townLeft + float64(i)*28
			rise := 56 + float64(seed[i]%40)
			c.Fill([][]Pt{{{x, gy}, {x + 8, gy - rise*0.7}, {x + 14, gy - rise}, {x + 20, gy - rise*0.6}, {x + 28, gy}}}, Alpha(rust, 0xd8))
			c.Fill([][]Pt{{{x + 7, gy}, {x + 14, gy - rise*0.55}, {x + 21, gy}}}, Alpha(hazard, 0xd8))
			c.Circle(Pt{x + 14, gy - rise - 14}, 9+float64(seed[i+11]%8), Alpha(tar, 0x70))
		}
	}
	if in.Trouble == TroubleFire {
		for i := 0; i < 6; i++ {
			x := townLeft + 18 + float64(i)*50 + float64(seed[i+3]%14)
			rise := high + 12 + float64(seed[i+21]%16)
			c.Fill([][]Pt{{{x, base}, {x + 7, base - rise*0.7}, {x + 12, base - rise*0.5}, {x + 17, base - rise}, {x + 26, base}}}, Alpha(rust, 0xe8))
			c.Fill([][]Pt{{{x + 7, base}, {x + 14, base - rise*0.6}, {x + 20, base}}}, Alpha(hazard, 0xe8))
		}
	}
	if in.Trouble != "" && in.Trouble != TroubleRaid && in.Trouble != TroubleFire {
		c.Line([]Pt{{townLeft + 4, base}, {townLeft + 4, base - high - 30}}, 2, ink)
		c.Fill([][]Pt{{{townLeft + 5, base - high - 30}, {townLeft + 29, base - high - 23}, {townLeft + 5, base - high - 16}}}, hazard)
	}
	if in.Wall <= 0 {
		return
	}
	tall := wallBase + wallRise*float64(in.Wall)
	broken := in.WallDown || in.Ruined
	k = 0
	for x := townLeft - 6; x+10 <= townRight+6; x += stakeStep {
		k++
		if broken && seed[k%len(seed)]%brokenEvery == 0 {
			c.Fill([][]Pt{{{x, gy + 6}, {x + 14, gy + 2}, {x + 16, gy + 6}}}, timber)
			continue
		}
		top := gy + 6 - tall
		lean := 0.0
		if broken {
			top += float64(seed[(k+9)%len(seed)] % 14)
			lean = float64(int(seed[(k+17)%len(seed)]%9) - 4)
		}
		c.Fill([][]Pt{{{x + lean, top}, {x + 5 + lean, top - 8}, {x + 10 + lean, top}, {x + 10, gy + 6}, {x, gy + 6}}}, timber)
	}
	if !broken {
		c.Line([]Pt{{townLeft - 6, gy - tall/2}, {townRight + 4, gy - tall/2}}, 3, Alpha(ink, 0xc0))
	}
}

func sky(hour int64) color.RGBA {
	switch {
	case hour < 5 || hour >= 21:
		return color.RGBA{0x1b, 0x1f, 0x2e, 0xff}
	case hour < 8:
		return color.RGBA{0xc9, 0x8a, 0x6a, 0xff}
	case hour < 18:
		return color.RGBA{0xa9, 0xa4, 0x96, 0xff}
	default:
		return color.RGBA{0x8a, 0x55, 0x4a, 0xff}
	}
}

// mark stencils the region's mark: one layer of each kind, picked by the
// seed and favouring layers whose tags the region holds, in palette
// colours its tags favour.
func mark(c *Canvas, in BannerInput, seed []byte, layers []sheets.BannerLayer, palette []sheets.Palette) error {
	off := Pt{24, (bannerH - 120*markScale) / 2}
	colours := favoured(palette, in.Tags, seed)
	for k, kind := range []string{"field", "division", "ordinary", "charge"} {
		var pick []sheets.BannerLayer
		for _, l := range layers {
			if l.Layer == kind {
				pick = append(pick, l)
			}
		}
		if len(pick) == 0 {
			continue
		}
		slices.SortStableFunc(pick, func(a, b sheets.BannerLayer) int { return overlap(b.Tags, in.Tags) - overlap(a.Tags, in.Tags) })
		n := len(pick)
		if overlap(pick[0].Tags, in.Tags) > 0 {
			n = 1
		}
		l := pick[int(seed[k])%n]
		polys, err := SVGPath(l.Path, markScale, off)
		if err != nil {
			return err
		}
		c.Fill(polys, colours[k%len(colours)])
	}
	return nil
}

func overlap(a, b []string) int {
	n := 0
	for _, x := range a {
		if slices.Contains(b, x) {
			n++
		}
	}
	return n
}

func favoured(palette []sheets.Palette, ts []string, seed []byte) []color.RGBA {
	var pref, rest []color.RGBA
	for _, p := range palette {
		if overlap(p.Tags, ts) > 0 {
			pref = append(pref, Hex(p.Hex))
		} else {
			rest = append(rest, Hex(p.Hex))
		}
	}
	out := []color.RGBA{Hex("#3a3631")}
	all := append(pref, rest...)
	for i := 0; len(out) < 4 && len(all) > 0; i++ {
		out = append(out, all[(int(seed[8+i])+i)%len(all)])
	}
	return out
}

func digest(s string) []byte {
	h := sha256.Sum256([]byte(s))
	return h[:]
}

// SigilInput is an item's hash made visible (GDD 16.3).
type SigilInput struct {
	Process string   `json:"process"` // the last process in the recipe
	Slot    string   `json:"slot"`
	Axes    [2]int   `json:"axes"` // the two strongest, by index
	Level   int64    `json:"level"`
	Picks   int      `json:"picks"`
	Maker   string   `json:"maker"`
	Dormant bool     `json:"dormant"`
	Tags    []string `json:"tags,omitempty"`
}

var axisColour = []color.RGBA{
	Hex("#c8463c"), Hex("#8d8a82"), Hex("#4fbf6a"), Hex("#d08a3a"),
	Hex("#e86a2a"), Hex("#3a78c8"), Hex("#e0c43a"), Hex("#8a5ac8"),
}

// structural: sigil size and its grid of traces.
const (
	sigilSize  = 256
	notchEvery = 5
)

// Sigil draws a circuit-mark sigil: the outline from the last process,
// the inner shape from the slot, colours from the two strongest axes,
// notches by level, a dot at a corner per milestone pick, and the maker's
// stamp (GDD 16.3, 16.5).
func Sigil(in SigilInput) *Canvas {
	c := NewCanvas(sigilSize, sigilSize, tar)
	const mid = sigilSize / 2
	a, b := axisColour[in.Axes[0]%len(axisColour)], axisColour[in.Axes[1]%len(axisColour)]
	outline := outlineOf(in.Process, mid, 96)
	c.Fill([][]Pt{outline}, a)
	c.Fill([][]Pt{outlineOf(in.Process, mid, 86)}, tar)
	for i := range 6 {
		y := 70 + float64(i)*22
		c.Line([]Pt{{40, y}, {60, y}, {70, y + 10}}, 2, Alpha(a, 0x90))
		c.Circle(Pt{40, y}, 3, a)
		c.Line([]Pt{{sigilSize - 40, y + 6}, {sigilSize - 62, y + 6}}, 2, Alpha(b, 0x90))
		c.Circle(Pt{sigilSize - 40, y + 6}, 3, b)
	}
	c.Fill(innerOf(in.Slot, mid), b)
	notches := 1 + in.Level/notchEvery
	for i := range notches {
		x := mid - float64(notches-1)*9 + float64(i)*18
		c.Fill([][]Pt{{{x - 5, 222}, {x + 5, 222}, {x + 5, 238}, {x - 5, 238}}}, ash)
	}
	corners := []Pt{{28, 28}, {sigilSize - 28, 28}, {28, sigilSize - 28}}
	for i := 0; i < in.Picks && i < len(corners); i++ {
		c.Circle(corners[i], 9, hazard)
		c.Circle(corners[i], 4, tar)
	}
	stamp := digest("maker:" + in.Maker)
	for i := range 9 {
		if stamp[i]&1 == 1 {
			x, y := float64(sigilSize-52+(i%3)*12), float64(sigilSize-52+(i/3)*12)
			c.Fill([][]Pt{{{x, y}, {x + 8, y}, {x + 8, y + 8}, {x, y + 8}}}, ash)
		}
	}
	if in.Dormant {
		c.Fill([][]Pt{{{0, 0}, {sigilSize, 0}, {sigilSize, sigilSize}, {0, sigilSize}}}, color.NRGBA{0x30, 0x30, 0x30, 0xa0})
	}
	return c
}

func outlineOf(process string, mid, r float64) []Pt {
	sides, rot := 4, math.Pi/4
	switch process {
	case "alloy":
		sides, rot = 8, math.Pi/8
	case "infuse":
		sides, rot = 24, 0
	case "bind":
		sides, rot = 6, 0
	case "inscribe":
		sides, rot = 4, 0
	case "compose":
		sides, rot = 3, -math.Pi/2
	}
	p := make([]Pt, sides)
	for i := range p {
		t := rot + 2*math.Pi*float64(i)/float64(sides)
		p[i] = Pt{mid + r*math.Cos(t), mid + r*math.Sin(t)}
	}
	return p
}

func innerOf(slot string, m float64) [][]Pt {
	switch slot {
	case "blade":
		return [][]Pt{{{m - 8, m + 46}, {m - 8, m - 26}, {m, m - 50}, {m + 8, m - 26}, {m + 8, m + 46}}}
	case "plate":
		return [][]Pt{{{m - 34, m - 40}, {m + 34, m - 40}, {m + 34, m + 20}, {m, m + 44}, {m - 34, m + 20}}}
	case "tool":
		return [][]Pt{{{m - 36, m - 40}, {m + 36, m - 40}, {m + 36, m - 24}, {m + 8, m - 24}, {m + 8, m + 46}, {m - 8, m + 46}, {m - 8, m - 24}, {m - 36, m - 24}}}
	case "hook":
		return [][]Pt{{{m - 6, m + 46}, {m - 6, m - 30}, {m + 30, m - 30}, {m + 30, m}, {m + 16, m}, {m + 16, m - 16}, {m + 8, m - 16}, {m + 8, m + 46}}}
	case "focus":
		return [][]Pt{hexPoly(Pt{m, m}, 40), reverse(hexPoly(Pt{m, m}, 24))}
	case "charm":
		return [][]Pt{{{m, m - 34}, {m + 26, m}, {m, m + 34}, {m - 26, m}}}
	}
	return [][]Pt{{{m - 30, m - 10}, {m + 30, m - 10}, {m + 30, m + 10}, {m - 30, m + 10}}}
}

func reverse(p []Pt) []Pt {
	out := slices.Clone(p)
	slices.Reverse(out)
	return out
}

// Key is the media key of a picture's input: its kind and the digest of
// the drawing version and its JSON, so the same state gives the same key.
func Key(kind string, body []byte) string {
	h := sha256.Sum256(append([]byte(Version+":"+kind+":"), body...))
	return kind + "-" + hex.EncodeToString(h[:12])
}

// KindOf is the kind a Key was made for; "" for a string Key did not make.
func KindOf(key string) string {
	i := strings.LastIndexByte(key, '-')
	if i < 0 || len(key)-i-1 != keyHex {
		return ""
	}
	for _, r := range key[i+1:] {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return ""
		}
	}
	return key[:i]
}

// structural: the hex digits of a Key's 12-byte digest.
const keyHex = 24
