package game

import (
	"fmt"
	"slices"

	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// Caravans (GDD 13.2): a route runs one every caravan-days, from each end
// in turn, while both its places stand. Its manifest is minted into its
// own pool as it leaves and handed to the destination's faction on
// arrival, where the caravan occasion bids for a day. Its tile follows
// from its path, legs and clock, so nothing moves it tick by tick; a
// raid's share lands on the tile it is crossing.

const (
	factCaravanDeparted = "caravan.departed"
	factCaravanArrived  = "caravan.arrived"
	factCaravanRobbed   = "caravan.robbed"
)

// structural: a caravan's id is its route's and the day it left, and its
// ledger moves are of one kind.
const (
	caravanSep = "@"
	caravanTxn = "caravan"
)

// endCaravan drops a caravan from the live list; whoever ends it empties
// its pool first, and a pool left holding goods is an error.
func (g *Game) endCaravan(cv *emerge.Caravan) error {
	if left := g.caravanGoods(cv); len(left) > 0 {
		return fmt.Errorf("caravan %s ends holding %v", cv.ID, left)
	}
	g.Emergence.Caravans = slices.DeleteFunc(g.Emergence.Caravans, func(x *emerge.Caravan) bool { return x.ID == cv.ID })
	return nil
}

// caravanGoods is what a caravan's pool holds.
func (g *Game) caravanGoods(cv *emerge.Caravan) []ledger.Balance {
	return g.Ledger.Held(ledger.CaravanPool(cv.ID))
}

// manifestOf is the material a caravan carries: the first its origin's
// region holds.
func (g *Game) manifestOf(from int) (string, bool) {
	if !g.placeIndex(from) {
		return "", false
	}
	mats := g.Materials(g.SettlementHex(from))
	if len(mats) == 0 {
		return "", false
	}
	return mats[0], true
}

// caravanHolds is each live caravan's pool as the state has it, held to
// its manifest's material and units; one saved without a manifest is held
// to its origin's material and caravan-load.
func caravanHolds(g *Game) []ledger.Balance {
	var out []ledger.Balance
	for _, cv := range g.Emergence.Caravans {
		mat, load := cv.Material, cv.Units
		if mat == "" {
			var ok bool
			if mat, ok = g.manifestOf(cv.From); !ok {
				continue
			}
			load = g.r.Emerge.P.CaravanLoad
		}
		pool, asset := ledger.CaravanPool(cv.ID), ledger.Goods(mat)
		if n := min(g.Ledger.Of(pool, asset), load); n > 0 {
			out = append(out, ledger.Balance{Account: pool, Asset: asset, Units: n})
		}
	}
	return out
}

// caravansDay brings in the caravans whose journeys have run, then sends
// out each route's next one that is due.
func caravansDay(g *Game, day, t int64) error {
	e := g.Emergence
	for _, cv := range slices.Clone(e.Caravans) {
		if cv.Halted == 0 && cv.Arrive <= t {
			if err := g.caravanArrive(cv, t); err != nil {
				return err
			}
		}
	}
	for _, rt := range e.Routes {
		if day < rt.Next || len(rt.Path) < routePair || !g.placeStands(rt.A) || !g.placeStands(rt.B) {
			continue
		}
		if err := g.caravanDepart(rt, day, t); err != nil {
			return err
		}
	}
	return nil
}

// caravanData is what a caravan's facts carry.
func (g *Game) caravanData(cv *emerge.Caravan, units int64) []fact.Datum {
	return []fact.Datum{fact.S("id", cv.ID), fact.S("route", cv.Route), fact.S("name", g.promotionShown(cv.Route)), fact.N("units", units)}
}

// caravanDepart sends a route's caravan from the end whose turn it is:
// caravan-load of its region's first material, minted into its pool, due
// at the other end once the path's entry costs have run.
func (g *Game) caravanDepart(rt *emerge.RouteRec, day, t int64) error {
	p := g.r.Emerge.P
	from, to := rt.A, rt.B
	if !rt.FromA {
		from, to = to, from
	}
	rt.Next, rt.FromA = day+p.CaravanDays, !rt.FromA
	mat, ok := g.manifestOf(from)
	if !ok || p.CaravanLoad <= 0 {
		return nil
	}
	cv := &emerge.Caravan{ID: rt.ID + caravanSep + i64(day), Route: rt.ID, From: from, To: to, Depart: t}
	path := orient(rt, from)
	legs := g.legs(path, day)
	cv.Arrive = t + legs[len(legs)-1]
	cv.Legs, cv.Material, cv.Units = legs, mat, p.CaravanLoad
	data := append(g.caravanData(cv, p.CaravanLoad), fact.S("material", mat), fact.N("from", int64(from)), fact.N("to", int64(to)))
	fid, err := g.worldFact(g.SettlementHex(from), factCaravanDeparted, []fact.Ref{promotionRef(rt.ID)}, g.routeCause(rt.ID), data...)
	if err != nil {
		return err
	}
	if err := g.post(ledger.Txn{Key: ledger.SubKey(caravanTxn, cv.ID, "departed"), Kind: caravanTxn, Tick: t, Fact: fid,
		Legs: ledger.Pair(ledger.FromCaravan, ledger.CaravanPool(cv.ID), ledger.Goods(mat), p.CaravanLoad)}); err != nil {
		return err
	}
	g.Emergence.Caravans = append(g.Emergence.Caravans, cv)
	return nil
}

// caravanArrive hands a caravan's goods to the destination's faction, its
// store first, and opens the caravan occasion there, then ends it.
func (g *Game) caravanArrive(cv *emerge.Caravan, t int64) error {
	if !g.placeIndex(cv.To) {
		return fmt.Errorf("caravan %s bound for no settlement %d", cv.ID, cv.To)
	}
	pool := ledger.CaravanPool(cv.ID)
	h := g.SettlementHex(cv.To)
	var legs []ledger.Leg
	units := int64(0)
	for _, b := range g.caravanGoods(cv) {
		legs = append(legs, g.storeLegs(pool, g.holderAt(h), b.Asset, b.Units)...)
		units += b.Units
	}
	data := append(g.caravanData(cv, units), fact.N("from", int64(cv.From)), fact.N("to", int64(cv.To)))
	fid, err := g.worldFact(h, factCaravanArrived, []fact.Ref{promotionRef(cv.Route)}, g.routeCause(cv.Route), data...)
	if err != nil {
		return err
	}
	if len(legs) > 0 {
		if err := g.post(ledger.Txn{Key: ledger.SubKey(caravanTxn, cv.ID, "arrived"), Kind: caravanTxn, Tick: t, Fact: fid, Legs: legs}); err != nil {
			return err
		}
	}
	if err := g.endCaravan(cv); err != nil {
		return err
	}
	if !g.placeStands(cv.To) {
		return nil
	}
	return g.caravanCame(cv.To, fid, t)
}

// orient is a route's path walked from settlement from.
func orient(rt *emerge.RouteRec, from int) []hex.Hex {
	if from == rt.A {
		return rt.Path
	}
	out := slices.Clone(rt.Path)
	slices.Reverse(out)
	return out
}

// legs are the ticks from a path's first tile to each of its tiles on a
// world day, each step at its ground cost as travel reads it
// (road-enter-ticks where groundTicks finds none).
func (g *Game) legs(path []hex.Hex, day int64) []int64 {
	p := g.r.Emerge.P
	out := make([]int64, len(path))
	for i := 1; i < len(path); i++ {
		cost := p.RoadEnterTicks
		if s, ok := g.groundTicks(path[i-1], path[i], day); ok {
			cost = s.cost
		}
		out[i] = out[i-1] + cost
	}
	return out
}

// caravanStep is a caravan's path in the order it walks it and the index
// of the tile it is on at t. Its clock stops while it is halted. Its legs
// are the ones read the day it left and kept on it, scaled to its journey,
// so a cut or a road laid on the way never moves it.
func (g *Game) caravanStep(cv *emerge.Caravan, t int64) ([]hex.Hex, int) {
	rt := g.routeRec(cv.Route)
	if rt == nil || len(rt.Path) == 0 {
		return nil, 0
	}
	path := orient(rt, cv.From)
	now := t
	if cv.Halted != 0 {
		now = min(now, cv.Halted)
	}
	span, gone := cv.Arrive-cv.Depart, now-cv.Depart
	last := len(path) - 1
	switch {
	case gone <= 0:
		return path, 0
	case gone >= span:
		return path, last
	}
	legs := cv.Legs
	if len(legs) != len(path) {
		legs = g.legs(path, cv.Depart/sheets.TicksPerDay)
	}
	total := legs[last]
	i := last
	for i > 0 && legs[i]*span > gone*total {
		i--
	}
	return path, i
}

// caravanAt is the tile a caravan is on at t.
func (g *Game) caravanAt(cv *emerge.Caravan, t int64) hex.Hex {
	path, i := g.caravanStep(cv, t)
	if len(path) == 0 {
		return g.SettlementHex(cv.From)
	}
	return path[i]
}

// caravanAhead are the regions a caravan on tile at has still to cross,
// the one it is in first.
func (g *Game) caravanAhead(cv *emerge.Caravan, at hex.Hex) []int {
	rt := g.routeRec(cv.Route)
	if rt == nil {
		return nil
	}
	path := orient(rt, cv.From)
	return g.pathRegions(path[max(slices.Index(path, at), 0):])
}

// resumeCaravan sets a halted caravan going again: its departure and its
// arrival both move on by the halt, so the journey it has left is the one
// it had and caravanAt reads on from where it stopped.
func (g *Game) resumeCaravan(cv *emerge.Caravan, t int64) {
	if cv.Halted == 0 {
		return
	}
	d := max(t-cv.Halted, 0)
	cv.Depart += d
	cv.Arrive += d
	cv.Halted, cv.Arc = 0, ""
}

// caravanSpill moves percent of every good a caravan holds into the spoils
// pool of the tile it is on at t, and reports the tile and the units.
func (g *Game) caravanSpill(cv *emerge.Caravan, percent int64, key string, cause fact.ID, t int64) (hex.Hex, int64, error) {
	h := g.caravanAt(cv, t)
	pool := ledger.CaravanPool(cv.ID)
	var legs []ledger.Leg
	units := int64(0)
	for _, b := range g.caravanGoods(cv) {
		if n := fixed.PercentFloor(b.Units, percent); n > 0 {
			legs = append(legs, ledger.Pair(pool, poolOf(h), b.Asset, n)...)
			units += n
		}
	}
	if len(legs) == 0 {
		return h, 0, nil
	}
	return h, units, g.post(ledger.Txn{Key: key, Kind: caravanTxn, Tick: t, Fact: cause, Legs: legs})
}

// caravansRobbed is a raid on a region (GDD 4.10): every live caravan
// crossing it loses raid-caravan-share of its goods to the tile it is on.
func caravansRobbed(g *Game, f fact.Fact) error {
	region, ok := world.ParseRegionRef(f.Region)
	if !ok {
		return nil
	}
	share := g.r.Emerge.P.RaidCaravanShare
	for _, cv := range slices.Clone(g.Emergence.Caravans) {
		if g.World.RegionAt(g.caravanAt(cv, f.Tick)) != region {
			continue
		}
		h, units, err := g.caravanSpill(cv, share, ledger.SubKey(caravanTxn, cv.ID, "robbed", i64(int64(f.ID))), f.ID, f.Tick)
		if err != nil {
			return err
		}
		if units == 0 {
			continue
		}
		data := append(g.caravanData(cv, units), fact.At(h)...)
		if _, err := g.worldFact(h, factCaravanRobbed, []fact.Ref{promotionRef(cv.Route)}, []fact.ID{f.ID}, data...); err != nil {
			return err
		}
	}
	return nil
}
