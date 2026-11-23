package game_test

import (
	"testing"

	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

// prosperityAfterDay is the first settlement's region's prosperity once
// the first world day closes, with units of mat sold there at its
// reference value, and the coin its region's books traded that day.
func prosperityAfterDay(t *testing.T, units int64) (v, coin int64, g *game.Game) {
	t.Helper()
	g, ts := newTraders(t, 2)
	if units > 0 {
		price := g.Rules().Values.Asset(mat)
		seller, buyer := ts[0], ts[1]
		seller.grant(ledger.Material(mat), units)
		buyer.grant(ledger.Coin, units*price)
		seller.must(game.Command{Kind: game.Ask, Material: mat, Units: units, Price: price})
		buyer.must(game.Command{Kind: game.Take, Material: mat, Units: units, Price: price})
	}
	advanceDays(t, g, 1)
	audit(t, g)
	r := g.World.RegionAt(g.SettlementHex(0))
	for _, b := range g.Market.Books {
		if g.World.RegionAt(g.SettlementHex(b.Settlement)) == r && len(b.Days) > 0 && b.Days[len(b.Days)-1].Day == 0 {
			coin += b.Days[len(b.Days)-1].Coin
		}
	}
	v, ok := g.World.GaugeAt(g.SettlementHex(0), "prosperity")
	if !ok {
		t.Fatal("no prosperity gauge")
	}
	return v, coin, g
}

// A day's trade on a region's books raises its prosperity, a point for
// each prosperity-coin traded and no more than the day's cap; the world's
// pull back toward the baseline then takes its share.
func TestTradeRaisesProsperity(t *testing.T) {
	quiet, none, g := prosperityAfterDay(t, 0)
	if none != 0 {
		t.Fatalf("%d coin traded with nobody trading", none)
	}
	params := g.Rules().Book.SettlementParams
	per, most := sheets.IntParam(params, "prosperity-coin"), sheets.IntParam(params, "prosperity-trade-cap")
	ref := g.Rules().Values.Asset(mat)
	for _, tc := range []struct {
		name string
		coin int64
	}{
		{"under a point", per - 1},
		{"three points", 3 * per},
		{"past the cap", (most + 5) * per},
	} {
		t.Run(tc.name, func(t *testing.T) {
			v, coin, _ := prosperityAfterDay(t, tc.coin/ref)
			if coin == 0 {
				t.Fatal("nothing traded")
			}
			want, rose := min(coin/per, most), v-quiet
			// The pull takes its 5% of the rise, rounded either way.
			if rose > want || rose < want-want/10-1 {
				t.Fatalf("%d coin traded: prosperity rose %d, want about %d", coin, rose, want)
			}
		})
	}
}
