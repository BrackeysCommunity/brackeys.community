package game_test

import (
	"encoding/json"
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

// tool crafts an unworn tool for a character.
func (tr *trader) tool() *item.Instance {
	tr.t.Helper()
	tr.grant(ledger.Coin, 50)
	tr.grant(ledger.Material(mat), 2)
	rec := item.Recipe{Process: "shape", Method: "narrow-grind", Slot: "tool", Inputs: []item.Input{{Kind: mat, Qty: 2}}}
	tr.must(game.Command{Kind: game.Craft, Recipe: &rec})
	for _, in := range tr.c.C.Pack {
		if !tr.c.C.Worn(in.ID) {
			return in
		}
	}
	tr.t.Fatal("the craft left nothing unworn")
	return nil
}

func marketJSON(t *testing.T, g *game.Game) string {
	t.Helper()
	b, err := json.Marshal(g.Market)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestTakeEscrowsOnlyWhatItNeeds(t *testing.T) {
	g, ts := newTraders(t, 3)
	cheap, dear, buyer := ts[0], ts[1], ts[2]
	cheap.grant(ledger.Material(mat), 4)
	dear.grant(ledger.Material(mat), 1)
	cheap.must(game.Command{Kind: game.Ask, Material: mat, Units: 2, Price: 10})
	cheap.must(game.Command{Kind: game.Ask, Material: mat, Units: 2, Price: 12})
	dear.must(game.Command{Kind: game.Ask, Material: mat, Units: 1, Price: 1_000_000})
	buyer.grant(ledger.Coin, 100)
	// A far-out ask behind cheap ones does not set the take's escrow, and
	// the price improvement on the cheaper fills comes back.
	buyer.must(game.Command{Kind: game.Take, Material: mat, Units: 3})
	if want := int64(100 - 2*10 - 12); buyer.c.C.Coin != want {
		t.Fatalf("buyer has %d coin, want %d", buyer.c.C.Coin, want)
	}
	if n := g.Ledger.Of(ledger.Char(buyer.c.C.ID), ledger.Material(mat)); n != 3 {
		t.Fatalf("buyer holds %d %s, want 3", n, mat)
	}
	audit(t, g)
}

func TestRefusedOrderChangesNothing(t *testing.T) {
	g, ts := newTraders(t, 1)
	tr := ts[0]
	other := g.Rules().Book.Materials[len(g.Rules().Book.Materials)-1].ID
	before := marketJSON(t, g)
	for _, cmd := range []game.Command{
		{Kind: game.Bid, Material: mat, Units: 1, Price: 5},
		{Kind: game.Ask, Material: other, Units: 1, Price: 5},
		{Kind: game.Take, Material: other, Units: 1},
		{Kind: game.Want, Material: "anything", Price: 5},
	} {
		if err := tr.do(cmd); err == nil {
			t.Fatalf("%s with nothing to pay or sell was taken", cmd.Kind)
		}
		if after := marketJSON(t, g); after != before {
			t.Fatalf("a refused %s changed the market", cmd.Kind)
		}
	}
}

func TestWithdrawAndExpiryGiveEscrowBack(t *testing.T) {
	g, ts := newTraders(t, 1)
	tr := ts[0]
	in := tr.tool()
	acc := ledger.Char(tr.c.C.ID)
	coin := tr.c.C.Coin
	tr.grant(ledger.Coin, 100)
	tr.must(game.Command{Kind: game.Bid, Material: mat, Units: 2, Price: 5})
	tr.must(game.Command{Kind: game.List, Item: in.ID, Price: 1_000})
	tr.must(game.Command{Kind: game.Want, Material: in.Kind, Price: 20, Floor: &market.Floor{Level: in.Level + 1}})
	var ids []string
	for o := range g.Open(acc) {
		ids = append(ids, o.ID)
	}
	if len(ids) != 3 {
		t.Fatalf("%d open orders, want 3", len(ids))
	}
	for _, id := range ids {
		tr.must(game.Command{Kind: game.Withdraw, Item: id})
	}
	if tr.c.C.Coin != coin+100 || tr.c.C.Item(in.ID) == nil || g.OpenOrders(tr.c) != 0 {
		t.Fatalf("withdrawn: %d coin, want %d; tool back %v", tr.c.C.Coin, coin+100, tr.c.C.Item(in.ID) != nil)
	}
	audit(t, g)
	tr.must(game.Command{Kind: game.List, Item: in.ID, Price: 1_000})
	tr.must(game.Command{Kind: game.Want, Material: in.Kind, Price: 20, Floor: &market.Floor{Level: in.Level + 1}})
	advanceDays(t, g, g.Rules().Values.Param("order-days")+1)
	if tr.c.C.Coin < coin+100 || tr.c.C.Item(in.ID) == nil || g.OpenOrders(tr.c) != 0 {
		t.Fatalf("expired: %d coin, want at least %d; tool back %v", tr.c.C.Coin, coin+100, tr.c.C.Item(in.ID) != nil)
	}
	audit(t, g)
}

func TestWithdrawOnlyWhereTheOrderStands(t *testing.T) {
	g, ts := newTraders(t, 1)
	tr := ts[0]
	g.World.OpenSettlement()
	advanceDays(t, g, 1)
	tr.grant(ledger.Material(mat), 5)
	tr.must(game.Command{Kind: game.Ask, Material: mat, Units: 5, Price: 1_000})
	var id string
	for o := range g.Open(ledger.Char(tr.c.C.ID)) {
		id = o.ID
	}
	home := tr.c.C.At
	tr.c.C.At = g.SettlementHex(1)
	if _, ok := g.MarketAt(tr.c.C.At); !ok {
		t.Skip("the second settlement has no market")
	}
	var r *game.Refused
	if err := tr.do(game.Command{Kind: game.Withdraw, Item: id}); !errors.As(err, &r) || r.Code != game.NotHere {
		t.Fatalf("withdraw from another settlement: %v", err)
	}
	if n := g.Ledger.Of(ledger.Char(tr.c.C.ID), ledger.Material(mat)); n != 0 {
		t.Fatalf("%d %s came back away from the market", n, mat)
	}
	tr.c.C.At = home
	tr.must(game.Command{Kind: game.Withdraw, Item: id})
	audit(t, g)
}

func TestTraderListingExpires(t *testing.T) {
	g, ts := newTraders(t, 1)
	tr := ts[0]
	in := tr.tool()
	tr.must(game.Command{Kind: game.SellItem, Item: in.ID})
	if len(g.Market.Held) != 1 {
		t.Fatalf("the trader holds %d items", len(g.Market.Held))
	}
	advanceDays(t, g, g.Rules().Values.Param("order-days")+1)
	if len(g.Market.Listings) != 0 || len(g.Market.Held) != 0 {
		t.Fatalf("an unsold trader's listing stays: %d listings, %d held", len(g.Market.Listings), len(g.Market.Held))
	}
	audit(t, g)
}

func TestSellItemOnTheDayASettlementOpens(t *testing.T) {
	g, ts := newTraders(t, 1)
	tr := ts[0]
	in := tr.tool()
	g.World.OpenSettlement()
	advanceDays(t, g, 1)
	at := g.Settlements()
	if _, ok := g.MarketAt(at[len(at)-1]); len(at) != 2 || !ok {
		t.Fatal("the second settlement did not open with a market")
	}
	tr.c.C.At = at[1]
	before := marketJSON(t, g)
	if err := tr.do(game.Command{Kind: game.SellItem, Item: in.ID}); err == nil {
		t.Fatal("a trader with no coin today bought an item")
	}
	if marketJSON(t, g) != before {
		t.Fatal("a refused sale changed the market")
	}
}

func TestYoungGearCap(t *testing.T) {
	g, ts := newTraders(t, 3)
	seller, buyer, other := ts[0], ts[1], ts[2]
	limit := g.Rules().Values.Param("young-cap")
	in := seller.tool()
	value := g.ItemValue(in)
	// A young seller past its cap may not sell under value.
	seller.grant(ledger.Coin, limit)
	seller.must(game.Command{Kind: game.Give, Target: other.c.C.ID, Asset: ledger.Coin, Units: limit})
	seller.must(game.Command{Kind: game.List, Item: in.ID, Price: 1})
	l := g.Market.Listings[0]
	buyer.grant(ledger.Coin, 2*value+limit)
	if err := buyer.do(game.Command{Kind: game.Purchase, Item: l.ID}); err == nil {
		t.Fatal("a young seller past its cap sold under value")
	}
	seller.must(game.Command{Kind: game.Withdraw, Item: l.ID})
	// A young buyer past its cap may not pay over value.
	advanceDays(t, g, 1)
	buyer.must(game.Command{Kind: game.Give, Target: other.c.C.ID, Asset: ledger.Coin, Units: limit})
	seller.must(game.Command{Kind: game.List, Item: in.ID, Price: 2 * value})
	if err := buyer.do(game.Command{Kind: game.Purchase, Item: g.Market.Listings[0].ID}); err == nil {
		t.Fatal("a young buyer past its cap paid over value")
	}
	audit(t, g)
}

func TestGearOrderPaysFromEscrow(t *testing.T) {
	for _, wantFirst := range []bool{true, false} {
		g, ts := newTraders(t, 2)
		seller, buyer := ts[0], ts[1]
		in := seller.tool()
		sellerHad := seller.c.C.Coin
		buyer.grant(ledger.Coin, 100)
		var escrow string
		want := func() {
			buyer.must(game.Command{Kind: game.Want, Material: in.Kind, Price: 40})
			for o := range g.Open(ledger.Char(buyer.c.C.ID)) {
				escrow = ledger.EscrowPool(o.ID)
			}
		}
		if wantFirst {
			want()
			if escrow == "" {
				t.Fatal("the gear order did not rest")
			}
			seller.must(game.Command{Kind: game.List, Item: in.ID, Price: 30})
		} else {
			seller.must(game.Command{Kind: game.List, Item: in.ID, Price: 30})
			buyer.must(game.Command{Kind: game.Want, Material: in.Kind, Price: 40})
		}
		fee := g.Rules().Values.Fee(30)
		if buyer.c.C.Coin != 100-30 || seller.c.C.Coin != sellerHad+30-fee {
			t.Fatalf("want first %v: buyer %d coin, seller %d coin", wantFirst, buyer.c.C.Coin, seller.c.C.Coin)
		}
		if escrow != "" && g.Ledger.Of(escrow, ledger.Coin) != 0 {
			t.Fatalf("the gear order's escrow kept %d coin", g.Ledger.Of(escrow, ledger.Coin))
		}
		if buyer.c.C.Item(in.ID) == nil || seller.c.C.Item(in.ID) != nil {
			t.Fatalf("want first %v: the tool did not change hands", wantFirst)
		}
		if len(g.Market.Listings) != 0 || len(g.Market.Wants) != 0 {
			t.Fatalf("want first %v: listings %d, wants %d left", wantFirst, len(g.Market.Listings), len(g.Market.Wants))
		}
		audit(t, g)
	}
}

func TestYoungBookFillCap(t *testing.T) {
	g, ts := newTraders(t, 2)
	young, buyer := ts[0], ts[1]
	ref := g.Rules().Values.Asset(mat)
	limit := g.Rules().Values.Param("young-cap")
	if ref <= 1 || limit < ref-1 {
		t.Skip("the material is too cheap to sell under value")
	}
	under := ref - 1
	qty := limit / under
	// The faction's orders take their share of the ask first.
	var faction int64
	for _, o := range g.FactionOrders(young.c.C.At) {
		if o.Material == mat {
			faction += o.Qty
		}
	}
	young.grant(ledger.Material(mat), faction+qty+1)
	buyer.grant(ledger.Coin, 2*(qty+1))
	young.must(game.Command{Kind: game.Ask, Material: mat, Units: faction + qty, Price: 1})
	buyer.must(game.Command{Kind: game.Bid, Material: mat, Units: qty, Price: 1})
	if got := g.Ledger.Of(ledger.Char(buyer.c.C.ID), ledger.Material(mat)); got != qty {
		t.Fatalf("buyer holds %d %s, want %d", got, mat, qty)
	}
	if gave := g.GaveToday(young.c); gave != under*qty {
		t.Fatalf("young seller gave %d today, want %d", gave, under*qty)
	}
	// One more unit under value would pass the cap: it stays in the book.
	young.must(game.Command{Kind: game.Ask, Material: mat, Units: 1, Price: 1})
	buyer.must(game.Command{Kind: game.Bid, Material: mat, Units: 1, Price: 1})
	if got := g.Ledger.Of(ledger.Char(buyer.c.C.ID), ledger.Material(mat)); got != qty {
		t.Fatalf("a fill past the cap went through: buyer holds %d %s", got, mat)
	}
	asks := 0
	for o := range g.Open(ledger.Char(young.c.C.ID)) {
		if o.Kind == string(market.Ask) {
			asks++
		}
	}
	if asks != 1 || g.GaveToday(young.c) != under*qty {
		t.Fatalf("%d asks rest, %d given", asks, g.GaveToday(young.c))
	}
	audit(t, g)
}
