package game

import (
	"slices"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/econ"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/faucet"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// What an occasion does while it runs (GDD 12.5): a caravan bids for the
// next tier's materials out of the place's own budget, the migration opens
// its hunt when a season begins, and a seam puts stock back in a node near
// the place. The director casts, stores and ends them.

// structural: the occasions read by their rows, and the predicate the
// migration is cast by.
const (
	occasionCaravan = "caravan"
	occasionSeam    = "seam"
	seasonTurnWhen  = "season-turn"
	factSeasonBegan = "season.began"
)

// occasionOpens runs what an occasion does at its start: a seam's stock.
func (g *Game) occasionOpens(row *sheets.OccasionRow, n int, cause fact.ID, _ int64) error {
	if row == nil || n < 0 || n >= len(g.Places) {
		return nil
	}
	if row.ID == occasionSeam {
		g.seamAt(g.SettlementHex(n), g.r.Story.SeamStock, arc.SettlementRef(n), cause)
	}
	return nil
}

// caravanCame opens the caravan occasion at place n for its row's days
// when a route's caravan comes in (GDD 13.2): the same bids, cast by the
// arrival rather than drawn. A caravan occasion already there runs on to
// the new one's end; another occasion or a trouble keeps the place.
func (g *Game) caravanCame(n int, cause fact.ID, t int64) error {
	tpl, ok := g.template(occasionCaravan)
	ps := g.placeStory(n)
	if !ok || tpl.Row.Occasion == nil || ps == nil {
		return nil
	}
	if ps.Occasion != nil {
		if ps.Occasion.Kind == occasionCaravan {
			ps.Occasion.Ends = max(ps.Occasion.Ends, t+tpl.Row.Occasion.Days*sheets.TicksPerDay)
		}
		return nil
	}
	if g.placeTaken(n) {
		return nil
	}
	return g.beginOccasion(tpl, arc.Candidate{Place: n, Causes: []fact.ID{cause}}, t)
}

// seamAt queues units of stock on the node nearest h within seam-radius:
// the first free, passable tile out from h, on the material its region
// yields that is most worked there. False when none lies in reach.
func (g *Game) seamAt(h hex.Hex, units int64, by fact.Ref, cause fact.ID) bool {
	if units <= 0 {
		return false
	}
	for _, at := range hex.DiscAt(h, max(g.r.Story.SeamRadius, 0)) {
		if !g.freeGround(at) {
			continue
		}
		mats := g.Materials(at)
		if len(mats) == 0 {
			continue
		}
		best := mats[0]
		for _, m := range mats[1:] {
			if g.StockLeft(at, m) < g.StockLeft(at, best) {
				best = m
			}
		}
		g.Pending = append(g.Pending, world.Action{Kind: world.ActSeam, Hex: at, By: by, Material: best, Units: units, Cause: cause})
		return true
	}
	return false
}

// migrationDay casts the migration on the day a season begins. The memory
// ring takes the day turn's facts in only when the tick ends, so the
// predicate reads today's season.began from a fresh view; the chance is
// the director's own occasion.start draw.
func (g *Game) migrationDay(t int64) error {
	began := g.factsToday(t, factSeasonBegan)
	if len(began) == 0 {
		return nil
	}
	w := freshView{storyView: g.storyView()}
	for _, f := range began {
		w.fresh = append(w.fresh, g.memoryOf(f))
	}
	day := t / sheets.TicksPerDay
	for _, tpl := range g.r.Templates {
		if tpl.Row.Occasion == nil || tpl.Row.When != seasonTurnWhen {
			continue
		}
		for _, c := range tpl.When(w, tpl.Row, g.r.Story) {
			if _, err := g.tryOccasion(tpl, c, day, t); err != nil {
				return err
			}
		}
	}
	return nil
}

// tryOccasion begins an occasion at a standing place with room when its
// day's occasion.start draw passes, and reports whether it did.
func (g *Game) tryOccasion(tpl arc.Template, c arc.Candidate, day, t int64) (bool, error) {
	if c.Place < 0 || c.Place >= len(g.Places) || g.Places[c.Place].Ruined != 0 || g.placeTaken(c.Place) {
		return false, nil
	}
	if !g.r.draw.Percent(tpl.Row.Chance, occasionDraw, draw.Int(int64(c.Place)), draw.Str(tpl.Row.ID), draw.Int(day)) {
		return false, nil
	}
	return true, g.beginOccasion(tpl, c, t)
}

// factsToday are the facts of a kind written at tick t, read back from the
// log's end while its facts are t's.
func (g *Game) factsToday(t int64, kind string) []fact.Fact {
	var out []fact.Fact
	for id := fact.ID(g.Log.Len()) - 1; id >= 0; id-- {
		f, ok := g.Log.Get(id)
		if !ok || f.Tick < t {
			break
		}
		if f.Kind == kind {
			out = append(out, f)
		}
	}
	slices.Reverse(out)
	return out
}

// caravanBid is one of a caravan's bids: the want it buys and how many.
type caravanBid struct {
	want econ.Want
	qty  int64
}

// caravanBids are what a caravan running at place n buys today: the
// materials one tier past its region's, at caravan-premium of their
// reference value, spread by the day's wants over caravan-share of the
// budget.
func (g *Game) caravanBids(n int, budget int64, wants []econ.Want, t int64) []caravanBid {
	ps := g.storyAt(n)
	if ps == nil || ps.Occasion == nil || ps.Occasion.Kind != occasionCaravan || ps.Occasion.Began > t || ps.Occasion.Ends <= t {
		return nil
	}
	p := g.r.Story
	tier := g.caravanTier(n)
	tiers := make(map[string]int64, len(g.r.Book.Materials))
	for _, m := range g.r.Book.Materials {
		tiers[m.ID] = m.Tier
	}
	var picks []econ.Want
	var shares []faucet.Share
	for _, w := range wants {
		if mt, ok := tiers[w.Material]; !ok || mt != tier {
			continue
		}
		w.Price = max(fixed.PercentOf(g.r.Values.Material(w.Material), p.CaravanPremium), 1)
		picks = append(picks, w)
		shares = append(shares, faucet.Share{Urgency: w.Urgency, Price: w.Price})
	}
	qty := faucet.Plan(fixed.PercentFloor(budget, p.CaravanShare), shares)
	var out []caravanBid
	for i, w := range picks {
		if qty[i] > 0 {
			out = append(out, caravanBid{want: w, qty: qty[i]})
		}
	}
	return out
}

// caravanTier is the material tier a caravan at place n buys: one past
// its region's, held to the highest the sheets have.
func (g *Game) caravanTier(n int) int64 {
	tier := int64(1)
	if r := g.World.RegionAt(g.SettlementHex(n)); r >= 0 {
		tier = max(g.World.Regions[r].Tier, 1)
	}
	var top int64
	for _, m := range g.r.Book.Materials {
		top = max(top, m.Tier)
	}
	return min(tier+1, top)
}

// caravanCost is the coin a caravan's bids hold out of the day's budget.
func caravanCost(bids []caravanBid) int64 {
	var coin int64
	for _, b := range bids {
		coin += b.qty * b.want.Price
	}
	return coin
}

// structural: the ledger key part of a caravan's fills.
const caravanPart = occasionCaravan
