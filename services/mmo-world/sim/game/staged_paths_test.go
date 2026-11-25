package game

import (
	"errors"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/market"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
)

// pathsGame is stagedGame with a second player of server a beside the
// first, both with coin, and the first holding staged goods from a crate.
func pathsGame(t *testing.T) (g *Game, a, b *Char, st *Stage, m string) {
	t.Helper()
	g, a, st = stagedGame(t)
	res, err := g.Act(Command{Key: "a2", Kind: Create, Server: "a"})
	if err != nil {
		t.Fatal(err)
	}
	b = res.Char
	if a.C.At != b.C.At || a.C.At != g.SettlementHex(st.Settlement) {
		t.Fatalf("a at %v and b at %v, not both at the stage's settlement", a.C.At, b.C.At)
	}
	if _, ok := g.MarketAt(a.C.At); !ok {
		t.Fatal("server a's settlement has no market")
	}
	if g.Market == nil {
		if err := g.dayTurn(g.Tick()); err != nil {
			t.Fatal(err)
		}
	}
	m = g.r.Book.Materials[0].ID
	for _, c := range []*Char{a, b} {
		if err := g.receive(c, ledger.Move("coin-"+c.C.ID, "grant", g.Tick(), ledger.FromOperator, ledger.Char(c.C.ID), ledger.Coin, 500)); err != nil {
			t.Fatal(err)
		}
	}
	mintStaged(t, g, a, st.Settlement, m, 20)
	return g, a, b, st, m
}

// mintStaged opens a crate's worth of staged goods for a character.
func mintStaged(t *testing.T, g *Game, c *Char, n int, m string, units int64) {
	t.Helper()
	key := "crate-" + c.C.ID + "-" + i64(g.Ledger.Posted)
	if err := g.receive(c, ledger.Move(key, "crate", g.Tick(), ledger.FromStaged, ledger.Char(c.C.ID), ledger.Staged(n, m), units)); err != nil {
		t.Fatal(err)
	}
}

// refusedStill acts a command, wants a refusal with code, and the digest
// unchanged.
func refusedStill(t *testing.T, g *Game, what, code string, cmd Command) {
	t.Helper()
	before, err := g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	_, err = g.Act(cmd)
	if code == "" {
		var r *Refused
		if !errors.As(err, &r) {
			t.Fatalf("%s: want a refusal, got %v", what, err)
		}
	} else {
		refusedWith(t, err, code)
	}
	if after, _ := g.Digest(); after != before {
		t.Fatalf("%s was refused but changed the game", what)
	}
}

// stagedEscrowOnBooks reports a Market.Books order whose escrow holds a
// staged asset.
func stagedEscrowOnBooks(g *Game) string {
	for _, bk := range g.Market.Books {
		for o := range bk.Orders() {
			for _, h := range g.Ledger.Held(ledger.EscrowPool(o.ID)) {
				if ledger.IsStaged(h.Asset) {
					return o.ID
				}
			}
		}
	}
	return ""
}

// reconciles fails unless every server's staged line has Minted equal to
// Held plus Spent.
func reconciles(t *testing.T, g *Game) []StagedLine {
	t.Helper()
	lines := g.StagedLines()
	for _, l := range lines {
		if l.Minted != l.Held+l.Spent {
			t.Fatalf("staged line %+v does not reconcile", l)
		}
	}
	return lines
}

// TestStagedPaths walks every Isolation row this rule set owns: each
// carries the staged tag, and each forbidden path is refused with
// staged-local and the game unchanged.
func TestStagedPaths(t *testing.T) {
	g, a, b, st, m := pathsGame(t)
	n := st.Settlement
	stg := ledger.Staged(n, m)
	accA, accB := ledger.Char(a.C.ID), ledger.Char(b.C.ID)
	if g.Emergence == nil {
		t.Fatal("no emergence: facts would go unstamped")
	}
	if g.Ledger.Of(ledger.FromStaged, stg) != -20 || g.Ledger.Of(accA, stg) != 20 || g.StagedHeld(a, n, m) != 20 {
		t.Fatalf("the crate: src %d, a %d", g.Ledger.Of(ledger.FromStaged, stg), g.Ledger.Of(accA, stg))
	}

	// Give: char to char, still staged.
	if _, err := g.Act(Command{Key: "give", Char: a.C.ID, Kind: Give, Target: b.C.ID, Asset: stg, Units: 5}); err != nil {
		t.Fatal(err)
	}
	if g.Ledger.Of(accB, stg) != 5 || g.StagedHeld(b, n, m) != 5 || g.Ledger.Of(accB, ledger.Material(m)) != 0 {
		t.Fatalf("give: b holds %d staged, %d clean", g.Ledger.Of(accB, stg), g.Ledger.Of(accB, ledger.Material(m)))
	}
	audit(t, g)

	// Staged ask, bid, fill: no fee, nothing on the books, the week's
	// trading and notable trades unmoved, the faucet's reading unmoved.
	week, notable := g.Market.Week, len(g.Market.Notable)
	supply, held, active := g.coinHeld()
	budgets := g.Budgets()
	if _, err := g.Act(Command{Key: "ask", Char: a.C.ID, Kind: Ask, Material: m, Units: 6, Price: 3, Staged: true}); err != nil {
		t.Fatal(err)
	}
	bk := g.StagedBookOf(n, m)
	if bk == nil || len(bk.Asks) != 1 || !strings.HasPrefix(bk.Asks[0].ID, stagedOrderPrefix) || g.Ledger.Of(ledger.EscrowPool(bk.Asks[0].ID), stg) != 6 {
		t.Fatalf("the staged ask did not rest in escrow on the staged book: %+v", bk)
	}
	if bo := g.BookOf(n, m); bo != nil && slices.ContainsFunc(bo.Asks, func(o market.Order) bool { return o.Owner == accA }) {
		t.Fatal("a staged ask rested on the settlement's book")
	}
	coinA := g.Ledger.Of(accA, ledger.Coin)
	bid, err := g.Act(Command{Key: "bid", Char: b.C.ID, Kind: Bid, Material: m, Units: 4, Price: 5, Staged: true})
	if err != nil {
		t.Fatal(err)
	}
	if got := g.Ledger.Of(accA, ledger.Coin) - coinA; got != 12 {
		t.Fatalf("the seller got %d coin for 4 at 3, want 12 and no fee", got)
	}
	if g.Ledger.Of(accB, stg) != 9 || g.Ledger.Of(accB, ledger.Coin) != 500-12 {
		t.Fatalf("the buyer: %d staged, %d coin", g.Ledger.Of(accB, stg), g.Ledger.Of(accB, ledger.Coin))
	}
	if w := g.Market.Week; w.Between != week.Between || w.Fees != week.Fees || w.Faucet != week.Faucet || !slices.Equal(w.Traded, week.Traded) ||
		w.Staged.Get("a") != 12 || len(g.Market.Notable) != notable {
		t.Fatalf("the staged fill reached the week or the notable trades: %+v", w)
	}
	if s, h, ac := g.coinHeld(); s != supply || h != held || ac != active || !slices.Equal(g.Budgets(), budgets) {
		t.Fatalf("a staged trade moved the faucet's reading: %d/%d/%d, was %d/%d/%d", s, h, ac, supply, held, active)
	}
	if id := stagedEscrowOnBooks(g); id != "" {
		t.Fatalf("order %s on the books escrows staged goods", id)
	}
	filled, ok := ended(bid.Facts, "market.filled")
	if !ok || filled.StagedBy == nil || filled.StagedBy.ID != "a" || datum(filled, "fee").N != 0 || datum(filled, "staged").N != 1 {
		t.Fatalf("the staged fill wrote %+v", filled)
	}
	audit(t, g)

	// Take and sell fill now against the staged book.
	if _, err := g.Act(Command{Key: "take", Char: b.C.ID, Kind: Take, Material: m, Units: 1, Staged: true}); err != nil {
		t.Fatal(err)
	}
	if g.Ledger.Of(accB, stg) != 10 {
		t.Fatalf("take: b holds %d staged", g.Ledger.Of(accB, stg))
	}
	refusedStill(t, g, "a staged sell with no bid", NotHere, Command{Key: "sell", Char: b.C.ID, Kind: Sell, Material: m, Units: 1, Staged: true})

	// Withdraw gives the rest back.
	ask := bk.Asks[0].ID
	if _, err := g.Act(Command{Key: "withdraw", Char: a.C.ID, Kind: Withdraw, Item: ask}); err != nil {
		t.Fatal(err)
	}
	if len(bk.Asks) != 0 || g.Ledger.Of(accA, stg) != 15-6+1 || g.Ledger.Of(ledger.EscrowPool(ask), stg) != 0 {
		t.Fatalf("withdraw: a holds %d staged, asks %+v", g.Ledger.Of(accA, stg), bk.Asks)
	}
	audit(t, g)

	// Forbidden: staged goods on the settlement's own book (a faction's or
	// anyone's), and goods staged elsewhere on this staged book.
	refusedStill(t, g, "staged goods on the book", StagedLocal, Command{Key: "f1", Char: a.C.ID, Kind: Ask, Material: m, Units: 3, Price: 2})
	other := n + 1
	mintStaged(t, g, b, other, m, 2)
	refusedStill(t, g, "goods staged elsewhere", StagedLocal, Command{Key: "f2", Char: b.C.ID, Kind: Ask, Material: m, Units: 11, Price: 2, Staged: true})

	// Craft: clean units first, then one origin's staged ones; the output
	// is staged; its facts are the server's; it discovers nothing.
	m2 := g.r.Book.Materials[1].ID
	if err := g.receive(a, ledger.Move("clean", "grant", g.Tick(), ledger.FromOperator, accA, ledger.Material(m), 1)); err != nil {
		t.Fatal(err)
	}
	staged0 := g.Ledger.Of(accA, stg)
	rec := item.Recipe{Process: "shape", Method: "narrow-grind", Slot: "tool", Inputs: []item.Input{{Kind: m, Qty: 3}}}
	kindID := item.KindID(g.r.Fight.D.At(rec, 1))
	_, known := g.Kinds.Kind(kindID)
	res, err := g.Act(Command{Key: "craft", Char: a.C.ID, Kind: Craft, Recipe: &rec})
	if err != nil {
		t.Fatal(err)
	}
	made := a.C.Item("craft")
	if made == nil || made.Staged == nil || made.Staged.At != n || made.Staged.Server != "a" {
		t.Fatalf("the craft's output is %+v", made)
	}
	if g.Ledger.Of(accA, ledger.Material(m)) != 0 {
		t.Fatal("the craft did not take the clean unit first")
	}
	spent := staged0 - g.Ledger.Of(accA, stg)
	if spent < 1 || g.Ledger.Of(ledger.ToCraft, stg) != spent {
		t.Fatalf("the craft took %d staged units; sink:craft holds %d", spent, g.Ledger.Of(ledger.ToCraft, stg))
	}
	for _, f := range res.Facts {
		if f.Kind == factKindDiscovered {
			t.Fatal("a staged craft discovered a kind")
		}
		if f.StagedBy == nil || f.StagedBy.ID != "a" {
			t.Fatalf("staged craft fact %s is not the server's", f.Kind)
		}
	}
	if k, _ := g.Kinds.Kind(made.Kind); !known && (k.FirstMaker != "" || slices.Contains(a.C.Discovered, k.ID)) {
		t.Fatal("a kind first made from staged goods has a first maker")
	}
	audit(t, g)

	// A craft that would need two origins is refused.
	mintStaged(t, g, a, other, m2, 2)
	two := item.Recipe{Process: item.Alloy, Method: "quench", Inputs: []item.Input{{Kind: m, Qty: 1}, {Kind: m2, Qty: 1}}}
	refusedStill(t, g, "a craft of two origins", StagedLocal, Command{Key: "f3", Char: a.C.ID, Kind: Craft, Recipe: &two})

	// A staged item: listed only at its origin, sold to no trader, bought
	// by a player with no fee.
	refusedStill(t, g, "a staged item to the trader", StagedLocal, Command{Key: "f4", Char: a.C.ID, Kind: SellItem, Item: made.ID})
	made.Staged.At = other
	refusedStill(t, g, "a staged item listed away", StagedLocal, Command{Key: "f5", Char: a.C.ID, Kind: List, Item: made.ID, Price: 7})
	made.Staged.At = n
	if _, err := g.Act(Command{Key: "list", Char: a.C.ID, Kind: List, Item: made.ID, Price: 7}); err != nil {
		t.Fatal(err)
	}
	li := slices.IndexFunc(g.Market.Listings, func(l market.Listing) bool { return l.Item.ID == made.ID })
	if li < 0 || !g.Market.Listings[li].Staged || !strings.HasPrefix(g.Market.Listings[li].ID, stagedListingPrefix) {
		t.Fatal("the staged item is not on a staged listing")
	}
	coinA = g.Ledger.Of(accA, ledger.Coin)
	if _, err := g.Act(Command{Key: "buy", Char: b.C.ID, Kind: Purchase, Item: g.Market.Listings[li].ID}); err != nil {
		t.Fatal(err)
	}
	if got := g.Ledger.Of(accA, ledger.Coin) - coinA; got != 7 || b.C.Item(made.ID) == nil || b.C.Item(made.ID).Staged == nil {
		t.Fatalf("the staged listing paid %d coin and the buyer holds %+v", got, b.C.Item(made.ID))
	}
	if g.Market.Week.Staged.Get("a") != 12+3+7 {
		t.Fatalf("the week's staged trading is %d", g.Market.Week.Staged.Get("a"))
	}
	audit(t, g)

	// Salvage of a staged thing comes out staged.
	if g.salvageAsset(made.Staged, m) != stg || g.salvageAsset(nil, m) != ledger.Material(m) {
		t.Fatal("salvage of a staged item is not staged")
	}

	// Forbidden paths that name only clean goods: whatever a slip would
	// credit there is refused by the guard, and the commands refuse.
	tick := g.Tick()
	gd := g.ServerGuild("a")
	for _, to := range []string{ledger.StorePool(0), ledger.GuildPool(gd.G.ID), goalPool("goal-1"), ledger.CaravanPool("v-1"), ledger.ToFaction,
		ledger.ToTolls, ledger.ToBuild, ledger.NPCPool("fence"), ledger.EscrowPool("o-1"), ledger.EscrowPool("l-1")} {
		mustRefuse(t, g, to, ledger.Move("leak", "leak", tick, accB, to, stg, 1))
	}
	refusedStill(t, g, "staged goods to the guild bank", "", Command{Key: "f6", Char: b.C.ID, Kind: Deposit, Material: m, Units: 1})

	// Every staged unit is accounted for on server a's line.
	lines := reconciles(t, g)
	i := slices.IndexFunc(lines, func(l StagedLine) bool { return l.Server == "a" })
	if i < 0 || lines[i].Minted != 20 || lines[i].Spent != spent || lines[i].Traded != 22 {
		t.Fatalf("staged lines %+v", lines)
	}

	// A failed craft of staged goods salvages staged goods.
	stn, ok := g.StationFor(a.C.At, "shape")
	if !ok {
		t.Fatal("no shaping station here")
	}
	var fail *item.Recipe
	for _, x := range g.r.Book.Materials {
		r := item.Recipe{Process: "shape", Method: "narrow-grind", Slot: "tool", Inputs: []item.Input{{Kind: x.ID, Qty: 3}}}
		if k, err := g.r.Fight.D.Props(r, stn.Tier); err == nil && k.Failed {
			fail = &r
			break
		}
	}
	if fail == nil {
		t.Fatal("no shaping recipe here fails")
	}
	mf := fail.Inputs[0].Kind
	mintStaged(t, g, a, n, mf, 3)
	clean := g.Ledger.Of(accA, ledger.Material(mf))
	failed, err := g.Act(Command{Key: "craft-fail", Char: a.C.ID, Kind: Craft, Recipe: fail})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := ended(failed.Facts, "craft.failed"); !ok {
		t.Fatal("the craft did not fail")
	}
	if got := -g.Ledger.Of(ledger.FromSalvage, ledger.Staged(n, mf)); got <= 0 || g.Ledger.Of(accA, ledger.Material(mf)) != clean ||
		g.Ledger.Of(ledger.FromSalvage, ledger.Material(mf)) != 0 {
		t.Fatalf("a failed staged craft salvaged %d staged units and %d clean", got, g.Ledger.Of(accA, ledger.Material(mf))-clean)
	}
	reconciles(t, g)
	audit(t, g)
}

// TestStagedPathsReport: the weekly report carries each server's staged
// line, and it reconciles; a world that staged nothing has none.
func TestStagedPathsReport(t *testing.T) {
	plain := guardGame(t)
	mustCreate(t, plain, "p", "knife")
	if lines := plain.StagedLines(); lines != nil {
		t.Fatalf("a world with nothing staged has staged lines %+v", lines)
	}
	g, a, b, st, m := pathsGame(t)
	g.Live.Stages = append(g.Live.Stages, &Stage{ID: "st-2", Server: "b", Settlement: st.Settlement + 1})
	mintStaged(t, g, b, st.Settlement+1, m, 3)
	if err := g.receive(a, ledger.Move("burn", "expiry", g.Tick(), ledger.Char(a.C.ID), ledger.ToStaged, ledger.Staged(st.Settlement, m), 4)); err != nil {
		t.Fatal(err)
	}
	if err := g.dayTurn(g.Tick()); err != nil {
		t.Fatal(err)
	}
	supply, _, active := g.coinHeld()
	if err := g.report(g.Tick()/sheets.TicksPerDay, supply, active, 0); err != nil {
		t.Fatal(err)
	}
	r := g.Market.Reports[len(g.Market.Reports)-1]
	want := []StagedLine{{Server: "a", Minted: 20, Held: 16, Spent: 4}, {Server: "b", Minted: 3, Held: 3}}
	if !slices.Equal(r.Staged, want) {
		t.Fatalf("report staged lines %+v, want %+v", r.Staged, want)
	}
	reconciles(t, g)
	if r.Audit != 0 {
		t.Fatalf("the report's audit found %d", r.Audit)
	}
}

// TestStagedPathsWaitPool: a pool that moves everything a character's
// goods left behind hands staged goods back still staged.
func TestStagedPathsWaitPool(t *testing.T) {
	g, a, _, st, m := pathsGame(t)
	stg := ledger.Staged(st.Settlement, m)
	pool := ledger.WaitPool(a.C.At.Ref(), a.C.ID)
	if err := g.receive(a, ledger.Move("leave", "goal-back", g.Tick(), ledger.Char(a.C.ID), pool, stg, 7)); err != nil {
		t.Fatal(err)
	}
	g.awaits(a.C.ID, a.C.At)
	if err := g.collect(a, "collect"); err != nil {
		t.Fatal(err)
	}
	if g.Ledger.Of(ledger.Char(a.C.ID), stg) != 20 || g.StagedHeld(a, st.Settlement, m) != 20 || g.Ledger.Of(ledger.Char(a.C.ID), ledger.Material(m)) != 0 {
		t.Fatalf("the wait pool gave back %d staged", g.Ledger.Of(ledger.Char(a.C.ID), stg))
	}
	audit(t, g)
}

// TestStagedPathsTheft: a theft takes clean goods only, and a staged item
// lifted gains Hot and keeps Staged.
func TestStagedPathsTheft(t *testing.T) {
	g, c, tr := thiefWorld(t, 0)
	n, _ := g.SettlementAt(c.C.At)
	g.Market.Trader[n] = 1000
	knife := craftTool(t, g, c)
	if _, err := g.Act(Command{Key: "sell", Char: c.C.ID, Kind: SellItem, Item: knife.ID}); err != nil {
		t.Fatal(err)
	}
	purse := ledger.NPCPool(tr.ID)
	li := slices.IndexFunc(g.Market.Listings, func(l market.Listing) bool { return l.Seller == purse && l.Item.ID == knife.ID })
	if li < 0 {
		t.Fatal("the trader listed nothing")
	}
	if have := g.Ledger.Of(purse, ledger.Coin); have > 0 {
		if err := g.post(ledger.Move("empty", "test", g.Tick(), purse, ledger.ToFees, ledger.Coin, have)); err != nil {
			t.Fatal(err)
		}
	}
	// No path lists a staged item for a trader; mark this one staged where
	// it lies, as a slip would leave it, and lift it.
	g.Live = &LiveOps{}
	g.Market.Listings[li].Item.Staged = &item.Stage{At: n, Server: "a"}
	k, _ := g.TheftKind(KindLift)
	setLevel(c, practiceSleight, g.ItemValue(knife)/max(k.CoinPerSleight, 1)+1)
	g2, c2, f := pressTo(t, g, c.C.ID, liftCmd(tr.ID), 0, theftWon, nil)
	in := c2.C.Item(knife.ID)
	switch {
	case in == nil || !in.Hot.HotOn(g2.Tick()/sheets.TicksPerDay) || in.Hot.Victim != refKey(npc.Ref(tr.ID)):
		t.Fatalf("the lifted item is %+v", in)
	case in.Staged == nil || in.Staged.At != n:
		t.Fatalf("the lifted item lost its staged mark: %+v", in.Staged)
	case datum(f, "item").S != knife.ID:
		t.Fatalf("the lift wrote %+v", f.Data)
	}
	audit(t, g2)

	// Burglary and waylay plans name only clean goods.
	bg, bc, _ := burgleWorld(t)
	bk, _ := bg.TheftKind(KindBurgle)
	if _, haul, ok := bg.burglePlan(bc, bk, bc.C.At, "e-1"); ok {
		for _, s := range haul.Goods {
			if _, isMat := ledger.MaterialOf(ledger.Material(s.Material)); !isMat || ledger.IsStaged(s.Material) {
				t.Fatalf("a burglary plans %q", s.Material)
			}
		}
	}
}
