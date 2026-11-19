package game_test

import (
	"errors"
	"fmt"
	"testing"

	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/market"
	"jams.team/mmo-world/sim/sheets"
)

// trader is a character in the first settlement's market.
type trader struct {
	t *testing.T
	g *game.Game
	c *game.Char
	n int
}

// mat is a material every test trades.
var mat string

func newTraders(t *testing.T, n int) (*game.Game, []*trader) {
	g, err := game.New(rules(t))
	if err != nil {
		t.Fatal(err)
	}
	mat = g.Rules().Book.Materials[0].ID
	var out []*trader
	for i := range n {
		res, err := g.Act(game.Command{Key: fmt.Sprintf("new%d", i), Kind: game.Create, Option: "hook"})
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, &trader{t: t, g: g, c: res.Char})
	}
	return g, out
}

func (tr *trader) do(cmd game.Command) error {
	tr.n++
	cmd.Key = fmt.Sprintf("%s-%d", tr.c.C.ID, tr.n)
	cmd.Char = tr.c.C.ID
	_, err := tr.g.Act(cmd)
	var r *game.Refused
	if err != nil && !errors.As(err, &r) {
		tr.t.Fatal(err)
	}
	return err
}

func (tr *trader) must(cmd game.Command) {
	tr.t.Helper()
	if err := tr.do(cmd); err != nil {
		tr.t.Fatalf("%s: %v", cmd.Kind, err)
	}
}

// grant gives a character an asset through the operator's correction.
func (tr *trader) grant(asset string, units int64) {
	tr.must(game.Command{Kind: game.Correct, Asset: asset, Units: units, Note: "test stock"})
}

func audit(t *testing.T, g *game.Game) {
	t.Helper()
	if bad := ledger.Audit(g.Ledger.Balances, g.Holdings()); len(bad) > 0 {
		t.Fatalf("audit: %v", bad)
	}
}

func advanceDays(t *testing.T, g *game.Game, days int64) {
	t.Helper()
	for range days * sheets.TicksPerDay {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
}

func TestOrderBookEscrowFillAndFee(t *testing.T) {
	g, ts := newTraders(t, 2)
	seller, buyer := ts[0], ts[1]
	seller.grant(ledger.Material(mat), 10)
	buyer.grant(ledger.Coin, 200)
	seller.must(game.Command{Kind: game.Ask, Material: mat, Units: 10, Price: 9})
	if seller.c.C.Coin != 0 || g.Ledger.Of(ledger.Char(seller.c.C.ID), ledger.Material(mat)) != 0 {
		t.Fatal("the ask's goods did not go into escrow")
	}
	buyer.must(game.Command{Kind: game.Bid, Material: mat, Units: 4, Price: 12})
	// The ask rested first, so the fill is at its price: 4 × 9 = 36 coin,
	// the fee rounded up from the seller, the bid's improvement back.
	fee := g.Rules().Values.Fee(36)
	if seller.c.C.Coin != 36-fee {
		t.Fatalf("seller has %d coin, want %d", seller.c.C.Coin, 36-fee)
	}
	if buyer.c.C.Coin != 200-36 {
		t.Fatalf("buyer has %d coin, want %d", buyer.c.C.Coin, 200-36)
	}
	if n := g.Ledger.Of(ledger.Char(buyer.c.C.ID), ledger.Material(mat)); n != 4 {
		t.Fatalf("buyer holds %d %s", n, mat)
	}
	audit(t, g)
	// What rests expires after its days and goes home.
	advanceDays(t, g, g.Rules().Values.Param("order-days")+1)
	if n := g.Ledger.Of(ledger.Char(seller.c.C.ID), ledger.Material(mat)); n != 6 {
		t.Fatalf("seller got back %d %s, want 6", n, mat)
	}
	audit(t, g)
}

func TestFactionOrdersFromBudgetAndStanding(t *testing.T) {
	g, ts := newTraders(t, 1)
	tr := ts[0]
	home := tr.c.C.At
	orders := g.FactionOrders(home)
	if len(orders) == 0 {
		t.Fatal("no faction orders at the first settlement")
	}
	var spent int64
	for _, o := range orders {
		spent += o.Price * o.Qty
	}
	if budget := g.Budgets()[0]; spent > budget {
		t.Fatalf("orders spend %d coin, over the settlement's budget %d", spent, budget)
	}
	o := orders[0]
	asset := ledger.Material(o.Material)
	if o.Material == ledger.Provisions {
		asset = ledger.Provisions
	}
	tr.grant(asset, o.Qty)
	tr.must(game.Command{Kind: game.Sell, Material: o.Material, Units: o.Qty})
	coin := o.Price * o.Qty
	if want := coin - g.Rules().Values.Fee(coin); tr.c.C.Coin != want {
		t.Fatalf("sold for %d coin, want %d", tr.c.C.Coin, want)
	}
	if left := g.FactionOrders(home); len(left) != len(orders)-1 {
		t.Fatalf("a filled order still stands: %d of %d", len(left), len(orders))
	}
	if err := tr.do(game.Command{Kind: game.Sell, Material: o.Material, Units: 1}); err == nil {
		t.Fatal("sold into an order already filled")
	}
	// Shunned sellers are passed over.
	if _, buys := g.Rules().Values.Standing(-60); buys {
		t.Fatal("a faction buys from someone at -60 standing")
	}
	if pct, _ := g.Rules().Values.Standing(60); pct <= 0 {
		t.Fatal("+60 standing earns nothing")
	}
	audit(t, g)
}

func TestOpenOrderLimit(t *testing.T) {
	g, ts := newTraders(t, 1)
	tr := ts[0]
	limit := g.Rules().Values.Param("open-orders")
	tr.grant(ledger.Coin, 2*limit)
	for i := range limit {
		tr.must(game.Command{Kind: game.Bid, Material: mat, Units: 1, Price: 1 + i%2})
	}
	if err := tr.do(game.Command{Kind: game.Bid, Material: mat, Units: 1, Price: 1}); err == nil {
		t.Fatalf("a %dth open order was taken", limit+1)
	}
	audit(t, g)
}

func TestGearListingAndFloor(t *testing.T) {
	g, ts := newTraders(t, 2)
	seller, buyer := ts[0], ts[1]
	seller.grant(ledger.Coin, 50)
	seller.grant(ledger.Material(mat), 2)
	rec := item.Recipe{Process: "shape", Method: "narrow-grind", Slot: "tool", Inputs: []item.Input{{Kind: mat, Qty: 2}}}
	seller.must(game.Command{Kind: game.Craft, Recipe: &rec})
	var tool *item.Instance
	for _, in := range seller.c.C.Pack {
		if !seller.c.C.Worn(in.ID) {
			tool = in
		}
	}
	if tool == nil {
		t.Fatal("the craft left nothing unworn to list")
	}
	buyer.grant(ledger.Coin, 100)
	// A gear order whose floor the tool cannot clear waits.
	buyer.must(game.Command{Kind: game.Want, Material: tool.Kind, Price: 40, Floor: &market.Floor{Level: tool.Level + 1}})
	seller.must(game.Command{Kind: game.List, Item: tool.ID, Price: 30})
	if len(g.Market.Listings) != 1 || len(g.Market.Wants) != 1 {
		t.Fatalf("listings %d, wants %d", len(g.Market.Listings), len(g.Market.Wants))
	}
	buyer.must(game.Command{Kind: game.Purchase, Item: g.Market.Listings[0].ID})
	if buyer.c.C.Item(tool.ID) == nil || seller.c.C.Item(tool.ID) != nil {
		t.Fatal("the tool did not change hands")
	}
	fee := g.Rules().Values.Fee(30)
	if buyer.c.C.Coin != 100-40-30 || seller.c.C.Coin < 30-fee {
		t.Fatalf("buyer %d coin, seller %d coin", buyer.c.C.Coin, seller.c.C.Coin)
	}
	audit(t, g)
}

func TestYoungTransferCap(t *testing.T) {
	g, ts := newTraders(t, 2)
	young, other := ts[0], ts[1]
	young.grant(ledger.Coin, 500)
	cap := g.Rules().Values.Param("young-cap")
	young.must(game.Command{Kind: game.Give, Target: other.c.C.ID, Asset: ledger.Coin, Units: cap})
	if err := young.do(game.Command{Kind: game.Give, Target: other.c.C.ID, Asset: ledger.Coin, Units: 1}); err == nil {
		t.Fatal("a young character gave past its cap")
	}
	advanceDays(t, g, 1)
	young.must(game.Command{Kind: game.Give, Target: other.c.C.ID, Asset: ledger.Coin, Units: 1})
	advanceDays(t, g, g.Rules().Values.Param("young-days"))
	young.must(game.Command{Kind: game.Give, Target: other.c.C.ID, Asset: ledger.Coin, Units: 500 - cap - 1})
	audit(t, g)
}

func TestWeeklyReportAndStabiliser(t *testing.T) {
	g, ts := newTraders(t, 1)
	tr := ts[0]
	rest := g.Market.Faucet.Rate
	g.Market.Faucet.Rate = rest.Mul(fixed.Ratio(1, 2))
	rate := g.Market.Faucet.Rate
	advanceDays(t, g, g.Rules().Values.Param("report-days"))
	tr.must(game.Command{Kind: game.Look})
	if len(g.Market.Reports) != 1 {
		t.Fatalf("%d reports after a week", len(g.Market.Reports))
	}
	r := g.Market.Reports[0]
	if r.Audit != 0 || r.Fact == 0 {
		t.Fatalf("report %+v", r)
	}
	// Nobody holds coin: the stabiliser has raised the faucet each day, and
	// never past its rest.
	if g.Market.Faucet.Rate.Cmp(rate) <= 0 || g.Market.Faucet.Rate.Cmp(rest) > 0 {
		t.Fatalf("the faucet went from %s to %s, rest %s", rate, g.Market.Faucet.Rate, rest)
	}
}

func TestElsewhereIsAsOldAsTheJourney(t *testing.T) {
	g, ts := newTraders(t, 1)
	tr := ts[0]
	g.World.OpenSettlement()
	advanceDays(t, g, 1)
	far := g.Elsewhere(tr.c, mat)
	if len(far) != 1 {
		t.Fatalf("elsewhere lists %d settlements", len(far))
	}
	if far[0].Known && far[0].Age <= 0 {
		t.Fatalf("news from %s is not aged: %+v", far[0].Name, far[0])
	}
}

func TestTraderResaleNamesTheFirstSale(t *testing.T) {
	g, ts := newTraders(t, 2)
	seller, buyer := ts[0], ts[1]
	seller.grant(ledger.Coin, 50)
	seller.grant(ledger.Material(mat), 2)
	rec := item.Recipe{Process: "shape", Method: "narrow-grind", Slot: "tool", Inputs: []item.Input{{Kind: mat, Qty: 2}}}
	seller.must(game.Command{Kind: game.Craft, Recipe: &rec})
	var tool *item.Instance
	for _, in := range seller.c.C.Pack {
		if !seller.c.C.Worn(in.ID) {
			tool = in
		}
	}
	before := seller.c.C.Coin
	seller.must(game.Command{Kind: game.SellItem, Item: tool.ID})
	if seller.c.C.Coin <= before {
		t.Fatal("the trader paid nothing")
	}
	if len(g.Market.Listings) != 1 || g.Market.Listings[0].Item.ID != tool.ID {
		t.Fatalf("the trader did not list what it bought: %+v", g.Market.Listings)
	}
	l := g.Market.Listings[0]
	buyer.grant(ledger.Coin, l.Price)
	buyer.must(game.Command{Kind: game.Purchase, Item: l.ID})
	found := false
	for _, f := range g.Log.Since(0) {
		if f.Kind == "npc.resold" && len(f.Causes) == 2 {
			found = true
		}
	}
	if !found {
		t.Fatal("no resale fact naming the first sale and the resale")
	}
	people := g.PeopleHere(seller.c, seller.c.C.At)
	var npcID string
	for _, p := range people {
		if p.Role == "settlement-trader" {
			npcID = p.ID
		}
	}
	seller.must(game.Command{Kind: game.Talk, NPC: npcID})
	conv, err := g.Converse(seller.c, npcID)
	if err != nil {
		t.Fatal(err)
	}
	soldOn := false
	for _, tp := range conv.Topics {
		soldOn = soldOn || tp.ID == "sold-on"
	}
	if !soldOn {
		t.Fatalf("the trader does not bring up that it sold the tool on: %+v", conv.Topics)
	}
	audit(t, g)
}
