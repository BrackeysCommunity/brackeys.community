package game

import (
	"slices"

	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

// Trade routes (GDD 13.2): a pair of settlements hauled between enough
// becomes a named route, with the walk between them fixed at that moment
// so nothing searches for it again. A route short enough runs caravans
// (caravans.go), and both are what raids and the lost caravan aim at.

func init() {
	registerEmerge(emergeHook{
		Name:    "routes",
		Order:   routesOrder,
		Kinds:   []string{factRaided},
		Fact:    caravansRobbed,
		Instead: map[emerge.Type]func(*Game, *Promoting) (bool, error){emerge.Route: routeEnds},
		Promote: map[emerge.Type]func(*Game, *emerge.Promotion) error{emerge.Route: routeStart},
		Day:     caravansDay,
		Holds:   caravanHolds,
	})
}

// structural: caravans read the day's roads, so they run after them; a
// route joins two places, and a walk needs both its ends.
const (
	routesOrder = roadsOrder + 1
	routePair   = 2
)

// routeEnds puts a route's two places on its promotion fact; it never
// takes the line over.
func routeEnds(_ *Game, p *Promoting) (bool, error) {
	if len(p.Places) >= routePair {
		p.Data = append(p.Data, fact.N("a", int64(p.Places[0])), fact.N("b", int64(p.Places[1])))
	}
	return false, nil
}

// routeStart records a new route: the quickest walk between its places
// now and the regions it crosses. A path over route-path-most tiles is
// not kept, and that route runs no caravans. The first caravan leaves from
// its first place at the next day turn.
func routeStart(g *Game, p *emerge.Promotion) error {
	if len(p.Places) < routePair || !g.placeIndex(p.Places[0]) || !g.placeIndex(p.Places[1]) {
		return nil
	}
	a, b := p.Places[0], p.Places[1]
	rec := &emerge.RouteRec{ID: p.ID, A: a, B: b, FromA: true, Next: p.Tick/sheets.TicksPerDay + 1}
	path, _, ok := g.World.Path(g.SettlementHex(a), g.SettlementHex(b))
	if !ok {
		path = []hex.Hex{g.SettlementHex(a), g.SettlementHex(b)}
	} else if int64(len(path)) <= g.r.Emerge.P.RoutePathMost {
		rec.Path = path
	}
	rec.Regions = g.pathRegions(path)
	g.Emergence.Routes = append(g.Emergence.Routes, rec)
	return nil
}

// placeIndex reports whether n names a settlement.
func (g *Game) placeIndex(n int) bool { return n >= 0 && n < len(g.Places) }

// placeStands reports whether settlement n stands open, not ruined.
func (g *Game) placeStands(n int) bool { return g.placeIndex(n) && g.Places[n].Ruined == 0 }

// pathRegions are the regions a walk crosses, each once, in order.
func (g *Game) pathRegions(path []hex.Hex) []int {
	var out []int
	for _, h := range path {
		if r := g.World.RegionAt(h); r >= 0 && !slices.Contains(out, r) {
			out = append(out, r)
		}
	}
	return out
}

// routeRec is a route by its promotion id.
func (g *Game) routeRec(id string) *emerge.RouteRec {
	if g.Emergence == nil {
		return nil
	}
	i := slices.IndexFunc(g.Emergence.Routes, func(r *emerge.RouteRec) bool { return r.ID == id })
	if i < 0 {
		return nil
	}
	return g.Emergence.Routes[i]
}

// routeCause is the promotion fact a route's caravans name as their cause.
func (g *Game) routeCause(id string) []fact.ID {
	if p := g.Emergence.Promotion(id); p != nil && p.Fact != 0 {
		return []fact.ID{p.Fact}
	}
	return nil
}
