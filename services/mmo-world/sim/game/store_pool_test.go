package game

import (
	"testing"

	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/market"
)

// grantFor gives a character units of a material as an operator's correction.
func grantFor(t *testing.T, g *Game, c *Char, asset string, units int64) {
	t.Helper()
	if _, err := g.Act(Command{Key: "grant-" + c.C.ID + "-" + i64(int64(g.Log.Len())), Char: c.C.ID, Kind: Correct, Asset: asset, Units: units, Note: "test"}); err != nil {
		t.Fatal(err)
	}
}

// factionBidHere is a faction's bid for a material at the character's
// market, at least units deep.
func factionBidHere(t *testing.T, g *Game, c *Char, units int64) (int, *market.Book, market.Order) {
	t.Helper()
	n, ok := g.MarketAt(c.C.At)
	if !ok {
		t.Fatal("the character starts at no market")
	}
	for _, b := range g.BooksAt(n) {
		if _, isMat := ledger.MaterialOf(ledger.Goods(b.Material)); !isMat {
			continue
		}
		for _, o := range b.Bids {
			if o.Faction != nil && *o.Faction >= 0 && o.Qty >= units {
				return n, b, o
			}
		}
	}
	t.Skip("no faction bids for a material here")
	return 0, nil, market.Order{}
}

func TestFactionFillKeepsThenSinks(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	_, b, o := factionBidHere(t, g, c, 3)
	fi, asset := *o.Faction, ledger.Material(b.Material)
	store := ledger.StorePool(fi)
	kept := g.hotCell("store-kept")
	// The store already keeps all but one unit of the material.
	if err := g.post(ledger.Txn{Key: "stock", Kind: "test", Tick: g.Tick(), Legs: ledger.Pair(ledger.FromCaravan, store, asset, kept-1)}); err != nil {
		t.Fatal(err)
	}
	sunk := g.Ledger.Of(ledger.ToFaction, asset)
	grantFor(t, g, c, asset, 3)
	if _, err := g.Act(Command{Key: "sell", Char: c.C.ID, Kind: Sell, Material: b.Material, Units: 2}); err != nil {
		t.Fatal(err)
	}
	if got := g.Ledger.Of(store, asset); got != kept {
		t.Fatalf("the store keeps %d, want store-kept %d", got, kept)
	}
	if got := g.Ledger.Of(ledger.ToFaction, asset) - sunk; got != 1 {
		t.Fatalf("the faction sink took %d, want the 1 past store-kept", got)
	}
	audit(t, g)
	// A full store sinks the whole of the next fill.
	if _, err := g.Act(Command{Key: "sell-2", Char: c.C.ID, Kind: Sell, Material: b.Material, Units: 1}); err != nil {
		t.Fatal(err)
	}
	if got := g.Ledger.Of(store, asset); got != kept {
		t.Fatalf("a full store took more: %d", got)
	}
	audit(t, g)
}

func TestStoreLegsSplit(t *testing.T) {
	g := guardGame(t)
	m := ledger.Material(g.r.Book.Materials[0].ID)
	kept := g.hotCell("store-kept")
	legs := g.storeLegs(ledger.CaravanPool("x"), 0, m, kept+4)
	if len(legs) != 4 || legs[1].Account != ledger.StorePool(0) || legs[1].Units != kept || legs[3].Account != ledger.ToFaction || legs[3].Units != 4 {
		t.Fatalf("store-kept to the store and the rest to the sink: %+v", legs)
	}
	for _, x := range []struct {
		name  string
		fi    int
		asset string
	}{{"the keepers", -1, m}, {"provisions", 0, ledger.Provisions}, {"no such faction", len(g.World.Factions), m}} {
		legs := g.storeLegs(ledger.CaravanPool("x"), x.fi, x.asset, 3)
		if len(legs) != 2 || legs[1].Account != ledger.ToFaction {
			t.Fatalf("%s keep no store: %+v", x.name, legs)
		}
	}
}

func TestCaravanArrivalFillsTheStore(t *testing.T) {
	g := guardGame(t)
	to := 0
	if g.holderAt(g.SettlementHex(to)) < 0 {
		g.World.Regions[g.World.RegionAt(g.SettlementHex(to))].Holder = 0
	}
	if g.Emergence == nil {
		g.Emergence = &emerge.State{}
	}
	fi := g.holderAt(g.SettlementHex(to))
	mat := g.r.Book.Materials[0].ID
	kept := g.hotCell("store-kept")
	cv := &emerge.Caravan{ID: "r-test@1", Route: "r-test", From: to, To: to, Depart: g.Tick(), Arrive: g.Tick(), Material: mat, Units: kept + 6}
	if err := g.post(ledger.Txn{Key: "load", Kind: caravanTxn, Tick: g.Tick(), Legs: ledger.Pair(ledger.FromCaravan, ledger.CaravanPool(cv.ID), ledger.Material(mat), cv.Units)}); err != nil {
		t.Fatal(err)
	}
	g.Emergence.Caravans = append(g.Emergence.Caravans, cv)
	sunk := g.Ledger.Of(ledger.ToFaction, ledger.Material(mat))
	if err := g.caravanArrive(cv, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if got := g.Ledger.Of(ledger.StorePool(fi), ledger.Material(mat)); got != kept {
		t.Fatalf("the destination's store keeps %d, want %d", got, kept)
	}
	if got := g.Ledger.Of(ledger.ToFaction, ledger.Material(mat)) - sunk; got != 6 {
		t.Fatalf("the sink took %d, want 6", got)
	}
	if len(g.caravanGoods(cv)) != 0 {
		t.Fatal("the caravan's pool still holds goods")
	}
	audit(t, g)
}
