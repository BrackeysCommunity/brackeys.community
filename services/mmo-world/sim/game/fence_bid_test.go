package game

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/market"
	"jams.team/mmo-world/sim/sheets"
)

// Hot units resting on an ask placed while no bid of the victim faction
// was on the book stay unsold when the next day turn posts that bid.
func TestHotAskSkipsTheVictimsNextBid(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	n, b, o := factionBidHere(t, g, c, 1)
	fi, m := *o.Faction, b.Material
	b.Bids = slices.DeleteFunc(b.Bids, func(x market.Order) bool {
		if x.Faction != nil {
			g.Market.opened(x.Owner, -1)
		}
		return x.Faction != nil
	})
	key := standingKey(fi, g.SettlementHex(n))
	grantFor(t, g, c, ledger.Material(m), 3)
	g.markHot(c, []item.Spoil{{Material: m, Qty: 3}}, g.hotMark(factionOwner(fi), key, pastReach(g, c.C.At), g.Tick()))
	if _, err := g.Act(Command{Key: "ask", Char: c.C.ID, Kind: Ask, Material: m, Units: 3, Price: 1}); err != nil {
		t.Fatal(err)
	}
	listed := slices.Clone(c.C.Alignment.Listed)
	if len(listed) != 1 || listed[0].Units != 3 || listed[0].Mark.Faction != key {
		t.Fatalf("the ask does not rest the hot lot: %+v", listed)
	}
	id := listed[0].Order
	for range sheets.TicksPerDay {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	if !slices.ContainsFunc(b.Asks, func(x market.Order) bool { return x.ID == id && x.Qty == 3 }) {
		t.Fatalf("the hot ask filled against its victim's bid: asks %+v", b.Asks)
	}
	if !slices.ContainsFunc(b.Bids, func(x market.Order) bool { return x.Faction != nil && *x.Faction == fi }) {
		t.Skip("the day turn posted no bid of the faction for the material")
	}
	if got := g.Ledger.Of(ledger.EscrowPool(id), ledger.Material(m)); got != 3 {
		t.Fatalf("the ask's escrow holds %d of 3", got)
	}
	if !slices.Equal(c.C.Alignment.Listed, listed) {
		t.Fatalf("the listed lots moved: %+v", c.C.Alignment.Listed)
	}
	audit(t, g)
}

// A fence buys hot provisions into its purse like any hot goods.
func TestFenceBuysHotProvisions(t *testing.T) {
	g := guardGame(t)
	c, d := atDen(t, g, "a")
	p := ledger.Provisions
	var units int64
	for u := int64(1); ; u++ {
		if g.FencePays(c, g.WorthAt(c.C.At, p, u)) >= 1 {
			units = u
			break
		}
	}
	grantFor(t, g, c, p, units)
	g.markHot(c, []item.Spoil{{Material: p, Qty: units}}, g.hotMark("npc:x", "", c.C.At, g.Tick()))
	g.Market.Trader[d.Place] = 1 << 30
	if _, err := g.Act(Command{Key: "fence", Char: c.C.ID, Kind: Fence, Material: p, Units: units}); err != nil {
		t.Fatal(err)
	}
	if got := g.Ledger.Of(ledger.NPCPool(d.Fence), p); got != units {
		t.Fatalf("the fence's purse holds %d of %d provisions", got, units)
	}
	if got := g.HotUnits(c, p, hotDay(g)); got != 0 || len(char.HotLotsOf(c.C)) != 0 {
		t.Fatalf("%d hot provisions left, lots %+v", got, char.HotLotsOf(c.C))
	}
	audit(t, g)
}
