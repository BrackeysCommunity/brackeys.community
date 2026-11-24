package game

import (
	"errors"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/econ"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/market"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
)

func hotDay(g *Game) int64 { return g.Tick() / sheets.TicksPerDay }

// pastReach is a tile past hot-reach from h.
func pastReach(g *Game, h hex.Hex) hex.Hex {
	return hex.Hex{Q: h.Q + g.hotCell("hot-reach") + 1, R: h.R}
}

// drain sends units of a material from a character to the faction sink,
// by a path that takes no lots itself.
func drain(t *testing.T, g *Game, c *Char, material string, units int64) {
	t.Helper()
	if err := g.postAll(ledger.Move("out-"+i64(g.Ledger.Posted), "test", g.Tick(), ledger.Char(c.C.ID), ledger.ToFaction, ledger.Material(material), units)); err != nil {
		t.Fatal(err)
	}
}

func hotRefused(t *testing.T, g *Game, code string, what string, do func() error) {
	t.Helper()
	before := digestOf(t, g)
	err := do()
	var r *Refused
	if !errors.As(err, &r) || r.Code != code {
		t.Fatalf("%s gave %v, not %s", what, err, code)
	}
	if digestOf(t, g) != before {
		t.Fatalf("%s was refused and changed the game", what)
	}
}

func TestConsumeHotCleanFirst(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	m := g.r.Book.Materials[0].ID
	day := hotDay(g)
	grantFor(t, g, c, ledger.Material(m), 10)
	mark := g.hotMark("npc:x", factionOwner(0), c.C.At, g.Tick())
	g.markHot(c, []item.Spoil{{Material: m, Qty: 4}}, mark)
	if got := g.HotUnits(c, m, day); got != 4 {
		t.Fatalf("4 of 10 are hot, got %d", got)
	}
	here, far := c.C.At, pastReach(g, c.C.At)
	if got := g.hotBarred(c, m, day, g.barredBy("", &here)); got != 4 {
		t.Fatalf("all 4 are barred at the theft's tile, got %d", got)
	}
	if got := g.hotBarred(c, m, day, g.barredBy("", &far)); got != 0 {
		t.Fatalf("none are barred past hot-reach, got %d", got)
	}
	if got := g.hotBarred(c, m, day, g.barredBy(factionOwner(0), &far)); got != 4 {
		t.Fatalf("all 4 are barred from the victim's faction, got %d", got)
	}
	if left := g.consumeHot(c, m, 3, day); len(left) != 0 {
		t.Fatalf("3 of 6 clean units take no lot: %+v", left)
	}
	drain(t, g, c, m, 3)
	if got := g.HotUnits(c, m, day); got != 4 {
		t.Fatalf("the clean units went first, got %d hot", got)
	}
	left := g.consumeHot(c, m, 5, day)
	if len(left) != 1 || left[0].Units != 2 || left[0].Mark != mark {
		t.Fatalf("5 of 3 clean and 4 hot take 2 hot: %+v", left)
	}
	drain(t, g, c, m, 5)
	if got := g.HotUnits(c, m, day); got != 2 {
		t.Fatalf("2 hot of 2 held, got %d", got)
	}
	// A path that takes no lots still took clean units first: only hot
	// units were left, so it took hot ones, and what comes in after is clean.
	drain(t, g, c, m, 1)
	grantFor(t, g, c, ledger.Material(m), 3)
	if got, held := g.HotUnits(c, m, day), g.hotHeld(c, m); got != 1 || held != 4 {
		t.Fatalf("1 hot of 4 held, got %d of %d", got, held)
	}
	// The mark runs out at its end.
	if got := g.HotUnits(c, m, mark.Ends); got != 0 {
		t.Fatalf("a mark past its end is clean, got %d", got)
	}
	// Given units pass the hot part on.
	to := mustCreate(t, g, "b", "knife")
	after := g.passHot(c, to, m, 4, day)
	if err := g.postAll(ledger.Move("give", "give", g.Tick(), ledger.Char(c.C.ID), ledger.Char(to.C.ID), ledger.Material(m), 4)); err != nil {
		t.Fatal(err)
	}
	after()
	if got := g.HotUnits(c, m, day); got != 0 {
		t.Fatalf("the giver kept %d hot", got)
	}
	if l := char.HotLotsOf(to.C); len(l) != 1 || l[0].Units != 1 || l[0].Mark != mark || g.HotUnits(to, m, day) != 1 {
		t.Fatalf("the receiver holds the hot unit as a lot: %+v", l)
	}
	audit(t, g)
}

func TestHotGoodsRefusedAndNothingChanges(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	n, b, o := factionBidHere(t, g, c, 1)
	m := b.Material
	day := hotDay(g)
	grantFor(t, g, c, ledger.Material(m), 2)
	near := g.hotMark("npc:x", "", c.C.At, g.Tick())
	g.markHot(c, []item.Spoil{{Material: m, Qty: 2}}, near)
	act := func(key string, cmd Command) func() error {
		return func() error {
			cmd.Key, cmd.Char = key, c.C.ID
			_, err := g.Act(cmd)
			return err
		}
	}
	hotRefused(t, g, HotGoods, "selling hot goods near the theft", act("sell", Command{Kind: Sell, Material: m, Units: 1}))
	hotRefused(t, g, HotGoods, "asking with hot goods near the theft", act("ask", Command{Kind: Ask, Material: m, Units: 1, Price: 1}))
	// Far from the theft, the victim's faction still will not buy them.
	c.C.Alignment.Hot[0].Mark = g.hotMark("faction:0", standingKey(*o.Faction, g.SettlementHex(n)), pastReach(g, c.C.At), g.Tick())
	hotRefused(t, g, HotGoods, "selling to the victim's faction", act("sell-2", Command{Kind: Sell, Material: m, Units: 1}))
	// Anyone else's goods sell far away, and lose the mark.
	c.C.Alignment.Hot[0].Mark = g.hotMark("faction:9", factionOwner(9), pastReach(g, c.C.At), g.Tick())
	if err := act("sell-3", Command{Kind: Sell, Material: m, Units: 1})(); err != nil {
		t.Fatalf("hot goods sell beyond hot-reach: %v", err)
	}
	if got := g.HotUnits(c, m, day); got != 1 {
		t.Fatalf("the unit sold took its mark with it: %d hot", got)
	}
	audit(t, g)
}

func TestHotItemRefusedNearTheTheft(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	stub, ok := g.traderStub(c.C.At)
	if !ok {
		t.Skip("no trader here")
	}
	in := craftTool(t, g, c)
	in.Hot = &item.Hot{Victim: "npc:x", Ends: hotDay(g) + g.hotCell("hot-days"), At: c.C.At.Ref()}
	list := Command{Key: "list", Char: c.C.ID, Kind: List, Item: in.ID, Price: 5}
	hotRefused(t, g, HotGoods, "listing a hot item near the theft", func() error { _, err := g.Act(list); return err })
	hotRefused(t, g, HotGoods, "selling a hot item to the trader near the theft", func() error {
		_, err := g.Act(Command{Key: "sell-item", Char: c.C.ID, Kind: SellItem, Item: in.ID})
		return err
	})
	// The trader buys for the faction holding its home: not the victim's goods.
	in.Hot.At = pastReach(g, c.C.At).Ref()
	in.Hot.Faction = g.standingKey(&npc.NPC{Stub: stub})
	hotRefused(t, g, HotGoods, "selling a faction's hot item to its trader", func() error {
		_, err := g.Act(Command{Key: "sell-item-2", Char: c.C.ID, Kind: SellItem, Item: in.ID})
		return err
	})
	in.Hot.Faction = factionOwner(9)
	if _, err := g.Act(list); err != nil {
		t.Fatalf("a hot item lists beyond hot-reach: %v", err)
	}
	audit(t, g)
}

// craftTool crafts an unworn tool for a character.
func craftTool(t *testing.T, g *Game, c *Char) *item.Instance {
	t.Helper()
	m := g.r.Book.Materials[0].ID
	grantFor(t, g, c, ledger.Coin, 50)
	grantFor(t, g, c, ledger.Material(m), 2)
	rec := item.Recipe{Process: "shape", Method: "narrow-grind", Slot: "tool", Inputs: []item.Input{{Kind: m, Qty: 2}}}
	if _, err := g.Act(Command{Key: "craft-" + c.C.ID, Char: c.C.ID, Kind: Craft, Recipe: &rec}); err != nil {
		t.Fatal(err)
	}
	for _, in := range c.C.Pack {
		if !c.C.Worn(in.ID) {
			return in
		}
	}
	t.Fatal("the craft left nothing unworn")
	return nil
}

func TestHotGoodsNeverBanked(t *testing.T) {
	g := guardGame(t)
	res, err := g.Act(Command{Key: "a", Kind: Create, Option: "hook", Server: "s1", Note: "The Reedwardens"})
	if err != nil {
		t.Fatal(err)
	}
	c := res.Char
	m := g.r.Book.Materials[0].ID
	grantFor(t, g, c, ledger.Material(m), 3)
	g.markHot(c, []item.Spoil{{Material: m, Qty: 2}}, g.hotMark("npc:x", "", pastReach(g, c.C.At), g.Tick()))
	deposit := func(key string, units int64) func() error {
		return func() error {
			_, err := g.Act(Command{Key: key, Char: c.C.ID, Kind: Deposit, Asset: ledger.Material(m), Units: units})
			return err
		}
	}
	hotRefused(t, g, HotGoods, "banking hot goods", deposit("d-1", 2))
	if err := deposit("d-2", 1)(); err != nil {
		t.Fatalf("the clean unit banks: %v", err)
	}
	if got := g.HotUnits(c, m, hotDay(g)); got != 2 {
		t.Fatalf("banking the clean unit left %d hot", got)
	}
	audit(t, g)
}

// robbedOf sets up a character that lifted coin and an item from an NPC
// and burgled a faction's store, with a Wanted entry for each, at the
// character's settlement.
func robbedOf(t *testing.T, g *Game, c *Char) (n, fi int, victim, m string, in *item.Instance) {
	t.Helper()
	n, ok := g.MarketAt(c.C.At)
	if !ok {
		t.Fatal("the character starts at no market")
	}
	fi, m, victim = 0, g.r.Book.Materials[0].ID, "npc:r-test-0"
	purse, store := ledger.NPCPool("r-test-0"), ledger.StorePool(fi)
	in = craftTool(t, g, c)
	grantFor(t, g, c, ledger.Coin, 10)
	if err := g.post(ledger.Txn{Key: "stock", Kind: "test", Tick: g.Tick(), Legs: ledger.Pair(ledger.FromCaravan, store, ledger.Material(m), 8)}); err != nil {
		t.Fatal(err)
	}
	if err := g.postAll(ledger.Move("purse", "test", g.Tick(), ledger.Char(c.C.ID), purse, ledger.Coin, 10)); err != nil {
		t.Fatal(err)
	}
	legs := append(ledger.Pair(purse, ledger.Char(c.C.ID), ledger.Coin, 10), ledger.Pair(store, ledger.Char(c.C.ID), ledger.Material(m), 5)...)
	if err := g.postAll(ledger.Txn{Key: "theft", Kind: "theft", Tick: g.Tick(), Legs: legs}); err != nil {
		t.Fatal(err)
	}
	in.Hot = &item.Hot{Victim: victim, Ends: hotDay(g) + g.hotCell("hot-days"), At: c.C.At.Ref()}
	g.markHot(c, []item.Spoil{{Material: m, Qty: 5}}, g.hotMark(factionOwner(fi), factionOwner(fi), c.C.At, g.Tick()))
	ends := g.Tick() + g.hotCell("wanted-days")*sheets.TicksPerDay
	a := c.C.Align()
	a.Wanted = []char.Wanted{
		{Victim: victim, Place: n, Worth: 30, Coin: 10, Items: []string{in.ID}, Source: purse, Ends: ends},
		{Victim: factionOwner(fi), Faction: factionOwner(fi), Place: n, Worth: 50, Goods: []item.Spoil{{Material: m, Qty: 5}}, Source: store, Ends: ends},
	}
	return n, fi, victim, m, in
}

func TestPayOffConservesEveryAsset(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	n, fi, _, m, in := robbedOf(t, g, c)
	// Two of the five units are gone, by a path that takes the clean first.
	drain(t, g, c, m, 2)
	// The fine: both hauls' worth, plus the gone units' share of the store's.
	fine := int64(30+50) + 50*2/5
	need := 10 + fine
	if have := c.C.Coin; have >= need {
		if err := g.postAll(ledger.Move("spend", "test", g.Tick(), ledger.Char(c.C.ID), ledger.ToFees, ledger.Coin, have-need+1)); err != nil {
			t.Fatal(err)
		}
	}
	hotRefused(t, g, ShortCode, "paying off short of coin", func() error { return g.payOff(c, n, "pay-0", g.Tick()) })
	grantFor(t, g, c, ledger.Coin, need-c.C.Coin)
	before := map[string]int64{}
	for _, b := range g.Ledger.Balances {
		before[b.Account+"|"+b.Asset] = b.Units
	}
	if err := g.payOff(c, n, "pay", g.Tick()); err != nil {
		t.Fatal(err)
	}
	delta := func(acc, asset string) int64 { return g.Ledger.Of(acc, asset) - before[acc+"|"+asset] }
	acc := ledger.Char(c.C.ID)
	if got := delta(acc, ledger.Coin); got != -need {
		t.Fatalf("the character paid %d coin, want %d", -got, need)
	}
	if got := delta(ledger.NPCPool("r-test-0"), ledger.Coin); got != 10 {
		t.Fatalf("the purse got back %d coin, want 10", got)
	}
	if got := delta(ledger.ToFees, ledger.Coin); got != fine {
		t.Fatalf("the fees sink took %d, want %d", got, fine)
	}
	if got := delta(ledger.StorePool(fi), ledger.Material(m)); got != 3 {
		t.Fatalf("the store got back %d units, want the 3 still held", got)
	}
	if got := delta(acc, ledger.Material(m)); got != -3 {
		t.Fatalf("the character gave back %d units, want 3", -got)
	}
	sums := map[string]int64{}
	for _, b := range g.Ledger.Balances {
		sums[b.Asset] += b.Units - before[b.Account+"|"+b.Asset]
		delete(before, b.Account+"|"+b.Asset)
	}
	for k, v := range before {
		for i := range k {
			if k[i] == '|' {
				sums[k[i+1:]] -= v
				break
			}
		}
	}
	for asset, s := range sums {
		if s != 0 {
			t.Fatalf("%s is not conserved: %+d", asset, s)
		}
	}
	// The item went back up on its owner's listing, clean.
	if c.C.Item(in.ID) != nil || in.Hot != nil {
		t.Fatal("the lifted item stayed with the thief or kept its mark")
	}
	listed := false
	for _, l := range g.ListingsAt(n) {
		listed = listed || (l.Item.ID == in.ID && l.Seller == ledger.NPCPool("r-test-0"))
	}
	if !listed {
		t.Fatal("the item is not back on its owner's listing")
	}
	if len(char.WantedOf(c.C)) != 0 || len(char.HotLotsOf(c.C)) != 0 || c.C.Has(char.WantedCondition, g.Tick()) {
		t.Fatalf("paying off left %+v wanted, %+v hot", char.WantedOf(c.C), char.HotLotsOf(c.C))
	}
	audit(t, g)
}

func TestCaughtTakesBackWithoutCoin(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	n, fi, _, m, in := robbedOf(t, g, c)
	coin := c.C.Coin
	if err := g.takeBack(c, n, "caught", 0, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if c.C.Coin != coin {
		t.Fatalf("being caught cost %d coin", coin-c.C.Coin)
	}
	if got := g.Ledger.Of(ledger.StorePool(fi), ledger.Material(m)); got != 8 {
		t.Fatalf("the store holds %d, want all 8 back", got)
	}
	if c.C.Item(in.ID) != nil || len(char.WantedOf(c.C)) != 0 || len(char.HotLotsOf(c.C)) != 0 {
		t.Fatal("being caught left goods, Wanted entries or lots")
	}
	audit(t, g)
}

func TestReturnToTheVictim(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	_, _, victim, m, in := robbedOf(t, g, c)
	// A unit lifted from the NPC as well.
	grantFor(t, g, c, ledger.Material(m), 1)
	g.markHot(c, []item.Spoil{{Material: m, Qty: 1}}, g.hotMark(victim, "", c.C.At, g.Tick()))
	hotRefused(t, g, BadArgs, "giving back to someone robbed of nothing", func() error { return g.returnTo(c, "npc:nobody", "ret-0", g.Tick()) })
	purse := ledger.NPCPool("r-test-0")
	coin, units := g.Ledger.Of(purse, ledger.Coin), g.Ledger.Of(purse, ledger.Material(m))
	if err := g.returnTo(c, victim, "ret", g.Tick()); err != nil {
		t.Fatal(err)
	}
	if got := g.Ledger.Of(purse, ledger.Coin) - coin; got != 10 {
		t.Fatalf("the purse got back %d coin, want 10", got)
	}
	if got := g.Ledger.Of(purse, ledger.Material(m)) - units; got != 1 {
		t.Fatalf("the purse got back %d units, want the 1 lifted", got)
	}
	if got := g.HotUnits(c, m, hotDay(g)); got != 5 {
		t.Fatalf("the store's 5 units stay hot, got %d", got)
	}
	if c.C.Item(in.ID) != nil {
		t.Fatal("the item stayed with the thief")
	}
	ws := char.WantedOf(c.C)
	if len(ws) != 2 || ws[0].Coin != 0 || len(ws[0].Items) != 0 || ws[0].Worth != 30 {
		t.Fatalf("the NPC's entry stays, holding nothing given back: %+v", ws)
	}
	audit(t, g)
}

func TestWantedAtAndBurglaries(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	t0 := g.Tick()
	ends := t0 + sheets.TicksPerDay
	held := g.holderAt(g.SettlementHex(0))
	if held == econ.Keepers {
		held = 0
		g.World.Regions[g.World.RegionAt(g.SettlementHex(0))].Holder = held
	}
	c.C.Align().Wanted = []char.Wanted{
		{Victim: "npc:x", Place: 0, Ends: ends},
		{Victim: "faction:x", Faction: factionOwner(held), Place: -1, Ends: ends},
		{Victim: "faction:y", Faction: factionOwner(held + 1), Place: -1, Ends: ends},
		{Victim: "npc:y", Place: 0, Ends: t0},
	}
	if got := g.wantedAt(c, 0, t0); len(got) != 2 || got[0] != 0 || got[1] != 1 {
		t.Fatalf("the theft's own settlement and the victim faction's apply: %v", got)
	}
	if got := g.wantedAt(c, 0, ends); len(got) != 0 {
		t.Fatalf("entries past their end apply: %v", got)
	}
	days := g.hotCell("walls-days")
	g.noteBurglary(0, t0)
	g.noteBurglary(0, t0+days*sheets.TicksPerDay)
	if got := g.placeStory(0).Burgled; len(got) != 1 || got[0] != t0+days*sheets.TicksPerDay {
		t.Fatalf("only burglaries within walls-days are kept: %v", got)
	}
}

func TestGivePassesHotGoods(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	to := mustCreate(t, g, "b", "knife")
	to.C.At = c.C.At
	c.Born = g.Tick() - g.mp("young-days")*sheets.TicksPerDay
	m := g.r.Book.Materials[0].ID
	day := hotDay(g)
	grantFor(t, g, c, ledger.Material(m), 10)
	mark := g.hotMark("npc:x", factionOwner(0), c.C.At, g.Tick())
	g.markHot(c, []item.Spoil{{Material: m, Qty: 4}}, mark)
	alDo(t, g, c, Command{Kind: Give, Target: to.C.ID, Asset: ledger.Material(m), Units: 8})
	if got := g.HotUnits(c, m, day); got != 2 {
		t.Fatalf("the giver kept 2 hot of the 2 left, got %d", got)
	}
	if l := char.HotLotsOf(to.C); len(l) != 1 || l[0].Units != 2 || l[0].Mark != mark {
		t.Fatalf("the clean 6 went first and the receiver holds 2 hot: %+v", l)
	}
	audit(t, g)
}

// hotAtMarket gives a character units of a material with a faction bid at
// its market, all hot under a mark from past hot-reach.
func hotAtMarket(t *testing.T, g *Game, c *Char, units int64) (string, market.Order) {
	t.Helper()
	_, b, o := factionBidHere(t, g, c, 1)
	grantFor(t, g, c, ledger.Material(b.Material), units)
	g.markHot(c, []item.Spoil{{Material: b.Material, Qty: units}}, g.hotMark("faction:9", factionOwner(9), pastReach(g, c.C.At), g.Tick()))
	return b.Material, o
}

func TestUnsoldAskComesBackHot(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	m, _ := hotAtMarket(t, g, c, 3)
	lots := slices.Clone(char.HotLotsOf(c.C))
	high := int64(1) << 40
	unchanged := func(what string) {
		t.Helper()
		if got := g.HotUnits(c, m, hotDay(g)); got != 3 || !slices.Equal(char.HotLotsOf(c.C), lots) || len(c.C.Alignment.Listed) != 0 {
			t.Fatalf("%s left %d hot, lots %+v, listed %+v", what, got, char.HotLotsOf(c.C), c.C.Alignment.Listed)
		}
	}
	if _, err := g.Act(Command{Key: "ask", Char: c.C.ID, Kind: Ask, Material: m, Units: 3, Price: high}); err != nil {
		t.Fatal(err)
	}
	listed := c.C.Alignment.Listed
	if len(listed) != 1 || listed[0].Units != 3 || listed[0].Order == "" {
		t.Fatalf("the resting ask holds the lots: %+v", listed)
	}
	if _, err := g.Act(Command{Key: "withdraw", Char: c.C.ID, Kind: Withdraw, Item: listed[0].Order}); err != nil {
		t.Fatal(err)
	}
	unchanged("an ask withdrawn")
	if _, err := g.Act(Command{Key: "sell", Char: c.C.ID, Kind: Sell, Material: m, Units: 3, Price: high}); err != nil {
		t.Fatal(err)
	}
	unchanged("a sale that did not fill")
	audit(t, g)
}

func TestPartlySoldAskKeepsTheRestHot(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	_, _, o := factionBidHere(t, g, c, 1)
	units := o.Qty + 2
	m, _ := hotAtMarket(t, g, c, units)
	if _, err := g.Act(Command{Key: "sell", Char: c.C.ID, Kind: Sell, Material: m, Units: units, Price: o.Price}); err != nil {
		t.Fatal(err)
	}
	held := g.hotHeld(c, m)
	if held == 0 || held == units {
		t.Fatalf("the sale filled %d of %d, not a part", units-held, units)
	}
	if got := g.HotUnits(c, m, hotDay(g)); got != held {
		t.Fatalf("the %d unsold units come back hot, got %d", held, got)
	}
	if len(c.C.Alignment.Listed) != 0 {
		t.Fatalf("listed lots outlive the order: %+v", c.C.Alignment.Listed)
	}
	audit(t, g)
}

func TestReturnShortOfCoinAndAwayFromTheMarket(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	_, _, victim, _, in := robbedOf(t, g, c)
	purse := ledger.NPCPool("r-test-0")
	in.Hot.At = pastReach(g, c.C.At).Ref()
	spend := func(left int64) {
		t.Helper()
		if c.C.Coin <= left {
			return
		}
		if err := g.postAll(ledger.Move("spend-"+i64(g.Ledger.Posted), "test", g.Tick(), ledger.Char(c.C.ID), ledger.ToFees, ledger.Coin, c.C.Coin-left)); err != nil {
			t.Fatal(err)
		}
	}
	spend(4)
	// An entry past its end is not charged.
	a := c.C.Alignment
	a.Wanted = append(a.Wanted, char.Wanted{Victim: victim, Place: -1, Coin: 5, Ends: g.Tick()})
	coin := g.Ledger.Of(purse, ledger.Coin)
	if err := g.returnTo(c, victim, "ret", g.Tick()); err != nil {
		t.Fatal(err)
	}
	if got := g.Ledger.Of(purse, ledger.Coin) - coin; got != 4 {
		t.Fatalf("the purse got back %d coin, want the 4 there were", got)
	}
	if g.Ledger.Of(purse, ledger.Item(in.ID)) != 1 || c.C.Item(in.ID) != nil {
		t.Fatal("an item given back away from the theft's market is not in the purse")
	}
	if ws := char.WantedOf(c.C); ws[0].Coin != 6 || ws[2].Coin != 5 {
		t.Fatalf("the live entry holds the 6 not given back, the dead one is untouched: %+v", ws)
	}
	spend(0)
	hotRefused(t, g, ShortCode, "giving back coin with none", func() error { return g.returnTo(c, victim, "ret-2", g.Tick()) })
	// The next entry prunes the dead one.
	g.wantedFor(c, &Theft{Victim: "npc:z", Place: -1}, taking{}, 0, g.Tick())
	for _, w := range char.WantedOf(c.C) {
		if w.Ends <= g.Tick() {
			t.Fatalf("an entry past its end stays: %+v", char.WantedOf(c.C))
		}
	}
	audit(t, g)
}

// An item given back away from the theft's market still goes back on its
// owner's listing there.
func TestReturnAwayRelistsAtTheTheftsMarket(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	n, _, victim, _, in := robbedOf(t, g, c)
	away := pastReach(g, c.C.At)
	if g.IsSettlement(away) {
		t.Fatal("the tile away is a settlement")
	}
	c.C.At = away
	purse := ledger.NPCPool("r-test-0")
	if err := g.returnTo(c, victim, "ret", g.Tick()); err != nil {
		t.Fatal(err)
	}
	i := slices.IndexFunc(g.Market.Listings, func(l market.Listing) bool { return l.Item != nil && l.Item.ID == in.ID })
	switch {
	case i < 0:
		t.Fatal("the item is on no listing")
	case g.Market.Listings[i].Settlement != n || g.Market.Listings[i].Seller != purse:
		t.Fatalf("the item is listed %+v, want the purse's at %d", g.Market.Listings[i], n)
	case g.Ledger.Of(ledger.EscrowPool(g.Market.Listings[i].ID), ledger.Item(in.ID)) != 1:
		t.Fatal("the listed item is not in escrow")
	case g.Ledger.Of(purse, ledger.Item(in.ID)) != 0 || c.C.Item(in.ID) != nil || in.Hot != nil:
		t.Fatal("the item stayed with the thief, went to the purse or kept its mark")
	}
	audit(t, g)
}

func TestBurgledGoodsBackRestoreStock(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	n, fi, _, _, _ := robbedOf(t, g, c)
	k, ok := g.TheftKind(KindBurgle)
	if !ok || fi >= len(g.World.Factions) {
		t.Skip("no burglary kind or faction")
	}
	stock := g.World.Factions[fi].Stock
	if err := g.takeBack(c, n, "caught", 0, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if got := g.World.Factions[fi].Stock - stock; got != k.GoodsPerUnit*5 {
		t.Fatalf("the store's Stock rose %d, want %d", got, k.GoodsPerUnit*5)
	}
}
