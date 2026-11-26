package game

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
)

// stagedGame is houseGame with one live stage of server a's at its
// settlement.
func stagedGame(t *testing.T) (*Game, *Char, *Stage) {
	t.Helper()
	g, c, home := houseGame(t)
	st := &Stage{ID: "st-1", Template: "drop-small", Kind: "drop", Server: "a", Role: RoleAdmin, By: c.C.ID, Settlement: home,
		At: g.SettlementHex(home), Open: true, Crates: 4}
	g.Live = &LiveOps{Stages: []*Stage{st}, Next: 1}
	return g, c, st
}

// mustRefuse posts t, expects staged-local and the ledger as it was.
func mustRefuse(t *testing.T, g *Game, name string, txn ledger.Txn) {
	t.Helper()
	before := slices.Clone(g.Ledger.Balances())
	posted := g.Ledger.Posted
	refusedWith(t, g.post(txn), StagedLocal)
	if !slices.Equal(before, g.Ledger.Balances()) || g.Ledger.Posted != posted {
		t.Fatalf("%s: a refused post moved the ledger", name)
	}
}

// TestStagedGuard holds the guard's three rules on hand-built
// transactions: staged goods credit only staged homes, nothing clean is
// minted while a stage is applied, and src:staged mints only staged
// goods and items.
func TestStagedGuard(t *testing.T) {
	g, c, st := stagedGame(t)
	m := g.r.Book.Materials[0].ID
	stg := ledger.Staged(st.Settlement, m)
	acc := ledger.Char(c.C.ID)
	tick := g.Tick()
	if err := g.receive(c, ledger.Move("crate", "crate", tick, ledger.FromStaged, acc, stg, 9)); err != nil {
		t.Fatal(err)
	}
	audit(t, g)

	// Rule 1: staged goods rest only where they cannot leave the settlement.
	for _, to := range []string{ledger.StorePool(0), ledger.GuildPool(g.ServerGuild("a").G.ID), ledger.TreasuryPool(st.Settlement),
		ledger.NPCPool("n-1"), ledger.CaravanPool("v-1"), ledger.CachePool("b-1"), ledger.EscrowPool("o-1"), ledger.HuntPool("h-9"),
		ledger.ToFaction, ledger.ToMarket, ledger.ToSyndicate, ledger.ToBuild, ledger.ToTolls} {
		mustRefuse(t, g, to, ledger.Move("leak", "leak", tick, acc, to, stg, 1))
	}
	for i, to := range []string{ledger.TilePool("1,1"), ledger.WaitPool("1,1", "c-9"), ledger.FloorPool("1,1", 2), ledger.ToStaged,
		ledger.ToCraft, ledger.ToLost, ledger.ToOperator} {
		if err := g.receive(c, ledger.Move("rest-"+to, "rest", tick, acc, to, stg, 1)); err != nil {
			t.Fatalf("%d %s: %v", i, to, err)
		}
	}
	// A staged hunt's pool and a registered escrow are homes; another
	// hunt's pool and another escrow are not.
	g.Hunts = append(g.Hunts, &Hunt{H: &fight.Hunt{ID: "h-1"}, Stage: st.ID}, &Hunt{H: &fight.Hunt{ID: "h-2"}})
	if err := g.receive(c, ledger.Move("hunt", "hunt", tick, acc, ledger.HuntPool("h-1"), stg, 1)); err != nil {
		t.Fatal(err)
	}
	mustRefuse(t, g, "an unstaged hunt", ledger.Move("hunt2", "hunt", tick, acc, ledger.HuntPool("h-2"), stg, 1))
	escrows := stagedEscrows
	defer func() { stagedEscrows = escrows }()
	stagedEscrows = append(slices.Clone(escrows), func(g *Game, a string) bool { return a == ledger.EscrowPool("o-staged") })
	if err := g.receive(c, ledger.Move("ask", "escrow", tick, acc, ledger.EscrowPool("o-staged"), stg, 1)); err != nil {
		t.Fatal(err)
	}
	mustRefuse(t, g, "an unstaged escrow", ledger.Move("ask2", "escrow", tick, acc, ledger.EscrowPool("o-1"), stg, 1))
	audit(t, g)

	// Rule 3: src:staged mints staged goods only.
	for _, asset := range []string{ledger.Coin, ledger.Provisions, ledger.Material(m)} {
		mustRefuse(t, g, "src:staged "+asset, ledger.Move("mint-"+asset, "crate", tick, ledger.FromStaged, acc, asset, 1))
	}

	// Rule 2: while a stage is applied, no source mints coin or clean goods.
	restore := g.withStage(st)
	if g.goodsAsset(m) != stg || g.goodsAsset(ledger.Provisions) != ledger.Provisions || g.mintSource(ledger.FromHaul) != ledger.FromStaged {
		t.Fatalf("staged mint: %s %s", g.goodsAsset(m), g.mintSource(ledger.FromHaul))
	}
	if g.stagedBy == nil || *g.stagedBy != (fact.Ref{Kind: stampServer, ID: "a"}) {
		t.Fatalf("staged stamp %+v", g.stagedBy)
	}
	for _, x := range []struct{ from, asset string }{
		{ledger.FromHaul, ledger.Material(m)}, {ledger.FromSalvage, ledger.Material(m)}, {ledger.FromFaction, ledger.Coin},
		{ledger.FromOperator, ledger.Coin}, {ledger.FromGather, ledger.Provisions}, {ledger.FromCache, ledger.Material(m)},
	} {
		mustRefuse(t, g, "staged mint from "+x.from, ledger.Move("clean-"+x.from, "haul", tick, x.from, acc, x.asset, 1))
	}
	if err := g.receive(c, ledger.Move("staged-haul", "haul", tick, g.mintSource(ledger.FromHaul), acc, g.goodsAsset(m), 2)); err != nil {
		t.Fatal(err)
	}
	restore()
	if g.staging != nil || g.stagedBy != nil || g.goodsAsset(m) != ledger.Material(m) || g.mintSource(ledger.FromHaul) != ledger.FromHaul {
		t.Fatal("withStage did not put back what was")
	}
	if err := g.receive(c, ledger.Move("clean-haul", "haul", tick, ledger.FromHaul, acc, ledger.Material(m), 1)); err != nil {
		t.Fatal(err)
	}
	audit(t, g)
}

// TestStagedItemGuard: a staged item, once anything is staged, credits
// only a staged home; a clean one goes where it always went.
func TestStagedItemGuard(t *testing.T) {
	g, c, st := stagedGame(t)
	acc := ledger.Char(c.C.ID)
	tick := g.Tick()
	staged := &item.Instance{ID: "i-staged", Kind: "knife", Staged: &item.Stage{At: st.Settlement, Server: st.Server}}
	clean := &item.Instance{ID: "i-clean", Kind: "knife"}
	for _, in := range []*item.Instance{staged, clean} {
		c.C.Pack = append(c.C.Pack, in)
		if err := g.post(ledger.Move("make-"+in.ID, "craft", tick, ledger.FromCraft, acc, ledger.Item(in.ID), 1)); err != nil {
			t.Fatal(err)
		}
	}
	for _, to := range []string{ledger.NPCPool("n-1"), ledger.EscrowPool("l-1"), ledger.ToMarket, ledger.ToSyndicate} {
		mustRefuse(t, g, "staged item to "+to, ledger.Txn{Key: "sell", Kind: "sell", Tick: tick, Legs: itemLegs(staged, acc, to)})
	}
	if err := g.post(ledger.Txn{Key: "sell-clean", Kind: "sell", Tick: tick, Legs: itemLegs(clean, acc, ledger.NPCPool("n-1"))}); err != nil {
		t.Fatal(err)
	}
	if err := g.post(ledger.Txn{Key: "salvage", Kind: "salvage", Tick: tick, Legs: itemLegs(staged, acc, ledger.ToCraft)}); err != nil {
		t.Fatal(err)
	}
	// src:staged mints an item only when it is staged in its receiver's pack.
	minted := &item.Instance{ID: "i-minted", Kind: "knife", Staged: &item.Stage{At: st.Settlement, Server: st.Server}}
	mustRefuse(t, g, "a staged item not yet in the pack", ledger.Move("mint-1", "cache", tick, ledger.FromStaged, acc, ledger.Item(minted.ID), 1))
	c.C.Pack = append(c.C.Pack, minted, &item.Instance{ID: "i-plain", Kind: "knife"})
	if err := g.post(ledger.Move("mint-2", "cache", tick, ledger.FromStaged, acc, ledger.Item(minted.ID), 1)); err != nil {
		t.Fatal(err)
	}
	mustRefuse(t, g, "a clean item from src:staged", ledger.Move("mint-3", "cache", tick, ledger.FromStaged, acc, ledger.Item("i-plain"), 1))
}

// TestStagedHoldMirrors: what a character carries of a staged asset
// follows the ledger, apart from its clean goods, and the audit holds.
func TestStagedHoldMirrors(t *testing.T) {
	g, c, st := stagedGame(t)
	m := g.r.Book.Materials[0].ID
	m2 := g.r.Book.Materials[1].ID
	acc := ledger.Char(c.C.ID)
	tick := g.Tick()
	for i, x := range []struct {
		at    int
		m     string
		units int64
	}{{st.Settlement + 1, m, 2}, {st.Settlement, m2, 3}, {st.Settlement, m, 5}} {
		if err := g.receive(c, ledger.Move("in-"+string(rune('a'+i)), "crate", tick, ledger.FromStaged, acc, ledger.Staged(x.at, x.m), x.units)); err != nil {
			t.Fatal(err)
		}
	}
	if err := g.receive(c, ledger.Move("clean", "haul", tick, ledger.FromHaul, acc, ledger.Material(m), 4)); err != nil {
		t.Fatal(err)
	}
	want := []char.StagedGoods{{At: st.Settlement, Material: m, Units: 5}, {At: st.Settlement, Material: m2, Units: 3}, {At: st.Settlement + 1, Material: m, Units: 2}}
	for _, w := range want {
		if g.StagedHeld(c, w.At, w.Material) != w.Units {
			t.Errorf("held %+v: %d", w, g.StagedHeld(c, w.At, w.Material))
		}
	}
	if !slices.Equal(c.C.Staged, sortedStaged(want)) {
		t.Errorf("staged %+v, want %+v", c.C.Staged, sortedStaged(want))
	}
	if clean, staged := g.Usable(c, m); clean != 4 || len(staged) != 2 || staged[0].At != st.Settlement || staged[1].At != st.Settlement+1 {
		t.Errorf("usable %d %+v", clean, staged)
	}
	if g.Ledger.Of(acc, ledger.Material(m)) != 4 {
		t.Errorf("clean %s: %d", m, g.Ledger.Of(acc, ledger.Material(m)))
	}
	audit(t, g)
	if err := g.receive(c, ledger.Move("out", "craft", tick, acc, ledger.ToCraft, ledger.Staged(st.Settlement, m), 5)); err != nil {
		t.Fatal(err)
	}
	if g.StagedHeld(c, st.Settlement, m) != 0 || len(c.C.Staged) != 2 {
		t.Errorf("a spent origin stayed: %+v", c.C.Staged)
	}
	audit(t, g)
	if err := g.receive(c, ledger.Move("out2", "craft", tick, acc, ledger.ToCraft, ledger.Staged(st.Settlement, m2), 3)); err != nil {
		t.Fatal(err)
	}
	if err := g.receive(c, ledger.Move("out3", "craft", tick, acc, ledger.ToStaged, ledger.Staged(st.Settlement+1, m), 2)); err != nil {
		t.Fatal(err)
	}
	if c.C.Staged != nil {
		t.Errorf("an empty purse kept %+v", c.C.Staged)
	}
	audit(t, g)
}

func sortedStaged(in []char.StagedGoods) []char.StagedGoods {
	var out []char.StagedGoods
	for _, s := range in {
		out = char.AddStaged(out, s.At, s.Material, s.Units)
	}
	return out
}

// TestStagedAsset reads a staged asset back, and keeps it apart from the
// material's own.
func TestStagedAsset(t *testing.T) {
	a := ledger.Staged(12, "iron-ore")
	if a != "stg:12:iron-ore" || !ledger.IsStaged(a) {
		t.Fatalf("asset %q", a)
	}
	if n, m, ok := ledger.StagedOf(a); !ok || n != 12 || m != "iron-ore" {
		t.Fatalf("read back %d %q %v", n, m, ok)
	}
	if _, ok := ledger.MaterialOf(a); ok {
		t.Fatal("a staged asset read as a material")
	}
	if _, ok := ledger.GoodsOf(a); ok {
		t.Fatal("a staged asset read as goods")
	}
	for _, bad := range []string{"stg:", "stg:x:iron", "stg:3:", "stg:-1:iron", "mat:iron", "coin"} {
		if _, _, ok := ledger.StagedOf(bad); ok {
			t.Errorf("%q read as staged", bad)
		}
	}
}

// TestCmdStage: a command on a stage is applied in its context, and the
// context ends with the command.
func TestCmdStage(t *testing.T) {
	g, c, st := stagedGame(t)
	m := g.r.Book.Materials[0].ID
	was, had := houseCommands[CrateOpen]
	delete(houseCommands, CrateOpen)
	defer func() {
		delete(houseCommands, CrateOpen)
		if had {
			houseCommands[CrateOpen] = was
		}
	}()
	var in *Stage
	registerHouse(CrateOpen, func(g *Game, c *Char, cmd Command) error {
		in = g.staging
		return g.receive(c, ledger.Move(cmd.Key, "crate", g.Tick(), g.mintSource(ledger.FromHaul), ledger.Char(c.C.ID), g.goodsAsset(m), 1))
	})
	if _, err := g.Act(Command{Key: "open-1", Char: c.C.ID, Kind: CrateOpen, Target: st.ID}); err != nil {
		t.Fatal(err)
	}
	if in != st || g.staging != nil || g.StagedHeld(c, st.Settlement, m) != 1 {
		t.Fatalf("in %v, after %v, held %d", in, g.staging, g.StagedHeld(c, st.Settlement, m))
	}
	in = nil
	if _, err := g.Act(Command{Key: "open-2", Char: c.C.ID, Kind: CrateOpen, Target: "st-9"}); err != nil {
		t.Fatal(err)
	}
	if in != nil || g.Ledger.Of(ledger.Char(c.C.ID), ledger.Material(m)) != 1 {
		t.Fatal("a command on no stage was applied as staged")
	}
	audit(t, g)
}
