package game

import (
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

// riskBand is the route-risk band of entering a tile for a character (GDD
// 10.7): by its region's threat or a gauge line it is past, raised one
// band by cover, or lowered one for a character its abilities hide there,
// and moved on a road by its road-risk. Where nothing lives there is no
// band. It returns the band's index too, safest first.
func (g *Game) riskBand(c *Char, h hex.Hex) (sheets.RouteRisk, int, bool) {
	bands := g.r.Book.RouteRisks
	if len(bands) == 0 || len(g.r.Gen.Creatures(h)) == 0 {
		return sheets.RouteRisk{}, 0, false
	}
	threat, ok := g.World.GaugeAt(h, gaugeThreat)
	if !ok {
		return sheets.RouteRisk{}, 0, false
	}
	i := 0
	for j, b := range bands {
		if threat >= b.Threat || (b.Line != "" && g.World.Past(h, b.Line)) {
			i = j
		}
	}
	cover := g.r.Gen.Baseline(h).Cover
	quiet := g.charScale(c, "cover", 0)
	switch {
	case i > 0 && quiet > 0 && cover+quiet >= g.mp("cover-raise"):
		i--
	case i > 0 && cover >= g.mp("cover-raise"):
		i = min(i+1, len(bands)-1)
	}
	if t := g.World.Tile(h); t != nil && t.Road > 0 {
		i = max(0, i+int(g.charScale(c, "road-risk", 0)))
	}
	return bands[i], i, true
}

// structural: route risk reads the threat gauge.
const gaugeThreat = "threat"

// Risk is a route's danger: each tile's band, the ambushes to expect,
// and what the haul carried is worth.
type Risk struct {
	Tiles    []TileRisk `json:"tiles"`
	Expected fixed.F    `json:"expected"` // ambushes, summed over the tiles
	Worst    string     `json:"worst"`
	Haul     int64      `json:"haul"` // coin, at reference value
}

// TileRisk is one tile of a route and its band.
type TileRisk struct {
	Hex    hex.Hex `json:"hex"`
	Band   string  `json:"band"`
	Chance fixed.F `json:"chance"`
}

// RouteRisk is the danger of walking a route with what a character
// carries.
func (g *Game) RouteRisk(c *Char, route []hex.Hex) Risk {
	var r Risk
	worst := -1
	for _, h := range route {
		b, i, ok := g.riskBand(c, h)
		if !ok || b.Chance == 0 {
			continue
		}
		r.Tiles = append(r.Tiles, TileRisk{Hex: h, Band: b.Name, Chance: b.Chance})
		r.Expected = r.Expected.Add(b.Chance)
		if i > worst {
			worst, r.Worst = i, b.Name
		}
	}
	r.Haul = g.HaulValue(c)
	return r
}

// HaulValue is what a character's carried goods are worth at reference
// value: what an ambush lost may cost.
func (g *Game) HaulValue(c *Char) int64 {
	var v int64
	for _, s := range c.C.Goods {
		v += s.Qty * g.r.Values.Material(s.Material)
	}
	return v
}
