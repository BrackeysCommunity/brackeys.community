package game

import (
	"testing"

	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/ledger"
)

// TestRuinAuditClean: a ruin takes its market's orders down with their
// escrow back, ends its board's goals with their refunds, hands its
// treasury to the guild, closes every structure and leaves nobody running
// it, and the ledger still balances.
func TestRuinAuditClean(t *testing.T) {
	g, officer, p := cityGame(t)
	n := p.N
	g.Market = g.newMarket()
	g.Market.Trader = make([]int64, len(g.Places))
	gd := g.GuildOf(p.Guild)
	fundTreasury(t, g, n, 5000)
	buyer, seller, poster := cityMember(t, g, p.Hex), cityMember(t, g, p.Hex), cityMember(t, g, p.Hex)
	timber := materialTagged(t, g, tagTimber)
	dirGive(t, g, buyer, ledger.Coin, 500)
	dirGive(t, g, poster, ledger.Coin, 500)
	dirGive(t, g, seller, ledger.Material(timber), 40)
	act := func(c *Char, cmd Command) {
		t.Helper()
		cmd.Key, cmd.Char = "ruin-"+cmd.Kind+"-"+c.C.ID, c.C.ID
		if _, err := g.Act(cmd); err != nil {
			t.Fatalf("%s: %v", cmd.Kind, err)
		}
	}
	act(buyer, Command{Kind: Bid, Material: timber, Units: 10, Price: 9})
	act(seller, Command{Kind: Ask, Material: timber, Units: 40, Price: 90})
	act(poster, Command{Kind: PostGoal, Goal: &GoalSpec{Title: "Timber here", Issuer: goal.ByCharacter, Reward: 100, Mode: goal.First, Lifetime: goal.Standing,
		Turnover: goal.Keep, Cond: goal.Condition{Verb: goal.Deliver, Tag: tagTimber, Count: 20, At: goal.SettlementRef(n)}}})
	act(officer, Command{Kind: Raise, Slot: "loom", Price: g.gp("reward-least")})
	var open []*Goal
	for _, x := range g.Goals {
		if x.Board == n && x.Open() {
			open = append(open, x)
		}
	}
	if len(open) < 2 {
		t.Fatalf("%d goals open on the board", len(open))
	}
	held := g.Ledger.Of(TreasuryPool(n), ledger.Coin)
	pool := g.Ledger.Of(gd.Pool(), ledger.Coin)
	var raised, fee int64
	for _, x := range open {
		switch x.Issuer.Kind {
		case goal.ByAdmin:
			raised += g.Ledger.Of(goalPool(x.ID), ledger.Coin)
		case goal.ByCharacter:
			fee = x.Fee
		}
	}
	audit(t, g)
	if err := g.ruin(n, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if p.Ruined == 0 || p.Guild != "" || len(factsOf(g, "settlement.ruined")) != 1 {
		t.Fatalf("the place is not a ruin: %+v", p)
	}
	for _, st := range p.Structures {
		if !st.Closed() {
			t.Fatalf("the %s stands open in a ruin", st.Kind)
		}
	}
	for o := range g.Open("") {
		if o.Settlement == n {
			t.Fatalf("order %s stands at a ruin", o.ID)
		}
	}
	for _, x := range open {
		if x.State != goal.Ended || g.Ledger.Of(goalPool(x.ID), ledger.Coin) != 0 {
			t.Fatalf("goal %s is %s with escrow left", x.ID, x.State)
		}
	}
	if buyer.C.Coin != 500 || poster.C.Coin != 500-fee || g.Ledger.Of(ledger.Char(seller.C.ID), ledger.Material(timber)) != 40 {
		t.Fatalf("the escrow did not come back: buyer %d coin, poster %d coin, seller %d timber", buyer.C.Coin, poster.C.Coin,
			g.Ledger.Of(ledger.Char(seller.C.ID), ledger.Material(timber)))
	}
	if g.Ledger.Of(TreasuryPool(n), ledger.Coin) != 0 || g.Ledger.Of(gd.Pool(), ledger.Coin) != pool+held+raised {
		t.Fatalf("the treasury's %d coin and the raise's %d did not go to the guild", held, raised)
	}
	if err := g.ruin(n, g.Tick()); err != nil || len(factsOf(g, "settlement.ruined")) != 1 {
		t.Fatal("a ruin ruined twice")
	}
	refusedCity(t, g, officer, Ruined)
	if g.isCity(n) {
		t.Fatal("a ruin reads as a city")
	}
	audit(t, g)
}
