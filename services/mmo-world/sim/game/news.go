package game

import (
	"slices"

	"jams.team/mmo-world/sim/hex"
)

// Visit is the last time a character stood in a settlement: what it saw
// of the prices there is as of then.
type Visit struct {
	Settlement int   `json:"settlement"`
	Tick       int64 `json:"tick"`
}

// visitIndex is where a character's visit to a settlement is kept, or -1.
func (c *Char) visitIndex(n int) int {
	return slices.IndexFunc(c.Visits, func(v Visit) bool { return v.Settlement == n })
}

// visit is a character's last visit to a settlement, or false.
func (c *Char) visit(n int) (Visit, bool) {
	i := c.visitIndex(n)
	if i < 0 {
		return Visit{}, false
	}
	return c.Visits[i], true
}

// lastVisit is the settlement a character last stood in, or false.
func (c *Char) lastVisit() (Visit, bool) {
	last, ok := Visit{}, false
	for _, v := range c.Visits {
		if !ok || v.Tick > last.Tick {
			last, ok = v, true
		}
	}
	return last, ok
}

// visited notes a character standing in a settlement now.
func (g *Game) visited(c *Char, h hex.Hex, t int64) {
	n, ok := g.SettlementAt(h)
	if !ok {
		return
	}
	i := c.visitIndex(n)
	if i < 0 {
		c.Visits = append(c.Visits, Visit{Settlement: n})
		i = len(c.Visits) - 1
	}
	c.Visits[i].Tick = t
}

// Far is a material's price in another settlement, as a character can
// know it: as old as the journey from there, or as their own last visit,
// whichever is newer (GDD 10.6).
type Far struct {
	Settlement int    `json:"settlement"`
	Name       string `json:"name"`
	Price      int64  `json:"price"` // 0 when nothing had traded by then
	AsOf       int64  `json:"asOf"`  // the tick the price is from
	Age        int64  `json:"age"`   // ticks old
	Own        bool   `json:"own"`   // from the character's own visit
	Known      bool   `json:"known"` // false when no news has come
}

// Elsewhere is a material in every other open settlement, as news at
// walking pace brings it to where a character stands.
func (g *Game) Elsewhere(c *Char, material string) []Far {
	t := g.Tick()
	var out []Far
	for n, h := range g.Settlements() {
		if h == c.C.At {
			continue
		}
		f := Far{Settlement: n, Name: g.placeName(h)}
		if _, ticks, ok := g.Route(c, h); ok {
			f.AsOf, f.Known = max(0, t-g.charScale(c, "news-age", ticks)), true
		}
		if v, ok := c.visit(n); ok && (!f.Known || v.Tick > f.AsOf) {
			f.AsOf, f.Own, f.Known = v.Tick, true, true
		}
		if f.Known {
			if b := g.BookOf(n, material); b != nil {
				f.Price, _ = b.PriceAt(f.AsOf)
			}
			f.Age = t - f.AsOf
		}
		out = append(out, f)
	}
	return out
}
