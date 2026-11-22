package game

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/market"
	"jams.team/mmo-world/sim/settle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// beginFound begins what an occasion's predicate finds at place n.
func beginFound(t *testing.T, g *Game, id string, n int) {
	t.Helper()
	tpl, c := predicateCast(t, g, id, n)
	if err := g.beginOccasion(tpl, c, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if o := g.storyAt(n).Occasion; o == nil || o.Kind != id {
		t.Fatalf("no %s began at place %d", id, n)
	}
	if f := lastFact(t, g, "occasion.began"); datumS(f, "occasion") != id {
		t.Fatalf("occasion.began names %q", datumS(f, "occasion"))
	}
}

// TestOccasionCaravanBidsInsideItsShare: a caravan at a prosperous city
// bids for the next tier's materials at caravan-premium of their value,
// out of caravan-share of the place's budget, for its one day; then it
// ends and the place rests.
func TestOccasionCaravanBidsInsideItsShare(t *testing.T) {
	g := guardGame(t)
	g.Places[0].City = &settle.City{Raised: g.Tick()}
	lineOn(t, g, homeRegion(g), "prosperity-caravans", 650)
	now := g.Tick()
	beginFound(t, g, occasionCaravan, 0)
	budgets := g.Budgets()
	budget := max(budgets[0]-g.bountyHeld(0)-g.sideHelds(budgets)[0], 0)
	wants := g.r.Values.Wants(g.buyers())
	bids := g.caravanBids(0, budget, wants, now)
	if len(bids) == 0 {
		t.Fatalf("a caravan with %d to spend bids for nothing", budget)
	}
	tier := g.caravanTier(0)
	if r := homeRegion(g); tier != min(max(g.World.Regions[r].Tier, 1)+1, 3) {
		t.Fatalf("a caravan buys tier %d", tier)
	}
	if cost := caravanCost(bids); cost <= 0 || cost > fixed.PercentFloor(budget, g.r.Story.CaravanShare) {
		t.Fatalf("a caravan spends %d of %d", cost, budget)
	}
	for _, b := range bids {
		i := slices.IndexFunc(g.r.Book.Materials, func(m sheets.Material) bool { return m.ID == b.want.Material })
		if i < 0 || g.r.Book.Materials[i].Tier != tier || b.want.Price != max(fixed.PercentOf(g.r.Values.Material(b.want.Material), g.r.Story.CaravanPremium), 1) {
			t.Fatalf("a caravan bid %+v", b)
		}
	}
	if err := g.postFactionOrders(now); err != nil {
		t.Fatal(err)
	}
	for _, b := range bids {
		book := g.BookOf(0, b.want.Material)
		if book == nil || !slices.ContainsFunc(book.Bids, func(o market.Order) bool { return o.Faction != nil && o.Price == b.want.Price && o.Placed == now }) {
			t.Fatalf("no caravan bid for %s stands at %d", b.want.Material, b.want.Price)
		}
	}
	end := now + sheets.TicksPerDay
	if g.caravanBids(0, budget, wants, end) != nil {
		t.Fatal("the caravan outstays its day")
	}
	if err := g.occasionsDue(end); err != nil {
		t.Fatal(err)
	}
	if g.storyAt(0).Occasion != nil || datumS(lastFact(t, g, "occasion.ended"), "occasion") != occasionCaravan {
		t.Fatal("the caravan did not end")
	}
	if !slices.ContainsFunc(g.Story.Rests, func(r ScopeRest) bool {
		return r.Scope == arc.Settlement && r.Ref == arc.SettlementRef(0) && r.Until > end
	}) {
		t.Fatal("a place rests after its occasion")
	}
	audit(t, g)
}

// TestOccasionCaravanNeedsARoad: prosperity alone brings no caravan to a
// place that is not a city and has no busy road.
func TestOccasionCaravanNeedsARoad(t *testing.T) {
	g := guardGame(t)
	lineOn(t, g, homeRegion(g), "prosperity-caravans", 650)
	tpl, _ := g.template(occasionCaravan)
	if slices.ContainsFunc(tpl.When(g.storyView(), tpl.Row, g.r.Story), func(c arc.Candidate) bool { return c.Place == 0 }) {
		t.Fatal("a caravan came with no road")
	}
}

// TestOccasionMigrationAtTheSeasonsTurn: the day a season begins, the
// migration's hunt opens through OpenHunt where its runners are thickest,
// naming the season's start.
func TestOccasionMigrationAtTheSeasonsTurn(t *testing.T) {
	g := guardGame(t)
	herds, v := int64(0), g.storyView()
	thick := -1
	for r := range g.World.Regions {
		if n := v.Herd(r, "dust-runner-migration"); n > herds {
			herds, thick = n, r
		}
	}
	if thick < 0 {
		t.Fatal("no dust-runners anywhere")
	}
	gd, _ := troubleGuild(t, g, 1, "", "")
	n := placeIn(t, g, gd, thick)
	// A trouble lost there would rest the place through the turn.
	for i := range g.r.Templates {
		if g.r.Templates[i].Row.Trouble != nil {
			g.r.Templates[i].Row.Chance = 0
		}
	}
	g.Story.Clock.Days = 4
	for g.Tick() < 4*sheets.TicksPerDay {
		dirTick(t, g)
	}
	if err := g.troubleDay(g.Tick() / sheets.TicksPerDay); err != nil {
		t.Fatal(err)
	}
	began := lastFact(t, g, "season.began")
	if ps := g.storyAt(n); ps == nil || ps.Occasion == nil || ps.Occasion.Kind != "migration" {
		t.Fatalf("no migration began with the season at the place among the runners: %+v", g.Story.At)
	}
	f := lastFact(t, g, "occasion.began")
	if !slices.Contains(f.Causes, began.ID) || f.Tick != began.Tick {
		t.Fatalf("the migration names %v, not the season's start %d", f.Causes, began.ID)
	}
	id := datumS(f, "hunt")
	if !slices.ContainsFunc(g.Hunts, func(x *Hunt) bool {
		return x.H.ID == id && x.H.Row == "dust-runner-migration" && x.Why == WhyOccasion
	}) {
		t.Fatalf("the migration opened no hunt (%q)", id)
	}
	if err := g.troubleDay(g.Tick() / sheets.TicksPerDay); err != nil || len(factsOf(g, "occasion.began")) != 1 {
		t.Fatalf("a second look the same day began another: %v", err)
	}
}

// TestOccasionSeamOpensANode: scarcity crossing under seam-below opens a
// seam: seam-stock more on the most worked material of the nearest free
// tile within seam-radius.
func TestOccasionSeamOpensANode(t *testing.T) {
	g := guardGame(t)
	g.growStreak(homeRegion(g)).Low = 1
	before := len(g.Pending)
	beginFound(t, g, occasionSeam, 0)
	var seams []world.Action
	for _, a := range g.Pending[before:] {
		if a.Kind == world.ActSeam {
			seams = append(seams, a)
		}
	}
	if len(seams) != 1 {
		t.Fatalf("a seam queues %d seams", len(seams))
	}
	s := seams[0]
	h := g.SettlementHex(0)
	if s.Units != g.r.Story.SeamStock || hex.Distance(s.Hex, h) > g.r.Story.SeamRadius || !g.freeGround(s.Hex) || !slices.Contains(g.Materials(s.Hex), s.Material) {
		t.Fatalf("a seam at %v of %d %s", s.Hex, s.Units, s.Material)
	}
	if s.Cause != lastFact(t, g, "occasion.began").ID {
		t.Fatal("the seam does not name its occasion")
	}
	for _, o := range hex.DiscAt(h, g.r.Story.SeamRadius) {
		if hex.Distance(o, h) < hex.Distance(s.Hex, h) && g.freeGround(o) && len(g.Materials(o)) > 0 {
			t.Fatalf("a nearer node at %v", o)
		}
	}
	left := g.StockLeft(s.Hex, s.Material)
	from := fact.ID(g.Log.Len())
	dirTick(t, g)
	if got := g.StockLeft(s.Hex, s.Material); got != left+s.Units {
		t.Fatalf("the seam left %d of %s, %d before", got, s.Material, left)
	}
	if !slices.ContainsFunc(g.Log.Since(from), func(f fact.Fact) bool { return f.Kind == world.FactSeam }) {
		t.Fatal("no seam fact")
	}
	audit(t, g)
}
