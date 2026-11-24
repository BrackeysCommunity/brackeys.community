package game

import (
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
)

// shapeRecipe is a two-unit tool of the first material appraise takes
// where c stands, in the back room or out of it.
func shapeRecipe(t *testing.T, g *Game, c *Char, backRoom bool) (item.Recipe, Appraisal) {
	t.Helper()
	for _, m := range g.r.Book.Materials {
		r := item.Recipe{Process: "shape", Method: "narrow-grind", Slot: "tool", Inputs: []item.Input{{Kind: m.ID, Qty: 2}}}
		if ap, err := g.appraisal(c, r, backRoom); err == nil {
			return r, ap
		}
	}
	t.Fatal("no material shapes into a tool here")
	return item.Recipe{}, Appraisal{}
}

// craftOutcome is what a craft left: whether it failed, and what it made.
func craftOutcome(t *testing.T, g *Game, c *Char, key string, r item.Recipe, backRoom bool) (failed bool, made *item.Instance) {
	t.Helper()
	failedBefore, pack := len(factsOf(g, "craft.failed")), len(c.C.Pack)
	if _, err := g.Act(Command{Key: key, Char: c.C.ID, Kind: Craft, Recipe: &r, BackRoom: backRoom}); err != nil {
		t.Fatalf("crafting: %v", err)
	}
	if len(c.C.Pack) > pack {
		made = c.C.Pack[len(c.C.Pack)-1]
	}
	return len(factsOf(g, "craft.failed")) > failedBefore, made
}

// The back room charges its station's fee and launder-percent of every
// input's worth into the fees sink, takes the hot units first, makes a
// clean product, and gives a standing point per launder-standing-coin of
// hot worth made clean.
func TestBackRoomLaunders(t *testing.T) {
	g := guardGame(t)
	c, _ := atDen(t, g, "a")
	makeMade(c)
	r, ap := shapeRecipe(t, g, c, true)
	m := r.Inputs[0].Kind
	tier := g.tierAt(c.C.At)
	worth := g.WorthAt(c.C.At, ledger.Material(m), r.Inputs[0].Qty)
	if want := tier*g.r.Values.Param("station-fee") + fixed.PercentFloor(worth, g.syp("launder-percent")); ap.Fee != want || ap.Station.Tier != tier {
		t.Fatalf("the back room asks %d at tier %d, not %d at tier %d", ap.Fee, ap.Station.Tier, want, tier)
	}
	hotGoods(t, g, c, m, r.Inputs[0].Qty, r.Inputs[0].Qty)
	grantFor(t, g, c, ledger.Coin, ap.Fee)
	per := g.syp("launder-standing-coin")
	c.C.Align().Laundered = per - 1
	coin, fees := c.C.Coin, g.Ledger.Of(ledger.ToFees, ledger.Coin)
	failed, made := craftOutcome(t, g, c, "launder", r, true)
	if c.C.Coin != coin-ap.Fee || g.Ledger.Of(ledger.ToFees, ledger.Coin) != fees+ap.Fee {
		t.Fatalf("paid %d and the fees sink took %d, not %d", coin-c.C.Coin, g.Ledger.Of(ledger.ToFees, ledger.Coin)-fees, ap.Fee)
	}
	day := hotDay(g)
	held := g.hotHeld(c, m)
	consumed := r.Inputs[0].Qty - held
	switch {
	case failed:
		consumed = r.Inputs[0].Qty
		for _, s := range c.C.Goods {
			if g.HotUnits(c, s.Material, day) != 0 {
				t.Fatalf("a failed back-room craft's salvage of %s is hot", s.Material)
			}
		}
	case made == nil:
		t.Fatal("the craft made nothing and did not fail")
	case made.Hot != nil:
		t.Fatalf("the back room made a hot %s", made.ID)
	default:
		if got := g.HotUnits(c, m, day); got != held {
			t.Fatalf("the units kept back stay hot: %d of %d", got, held)
		}
	}
	fs := factsOf(g, factLaundered)
	if len(fs) != 1 {
		t.Fatalf("%d craft.laundered facts", len(fs))
	}
	hot := g.WorthAt(c.C.At, ledger.Material(m), consumed)
	if w, _ := fs[0].Get("worth"); w.N != hot {
		t.Fatalf("laundered %d of hot worth, not %d", w.N, hot)
	}
	if f, _ := fs[0].Get("fee"); f.N != ap.Fee {
		t.Fatalf("craft.laundered says fee %d", f.N)
	}
	sum := per - 1 + hot
	if got := c.C.Standing.Get(syndicateKey); got != sum/per || c.C.Alignment.Laundered != sum%per {
		t.Fatalf("%d hot worth on %d carried gave %d standing and carried %d", hot, per-1, got, c.C.Alignment.Laundered)
	}
	audit(t, g)
}

// The back room is the made's, at a den, for a forge's or a bench's
// process; anything else is refused and changes nothing.
func TestBackRoomRefusals(t *testing.T) {
	g := guardGame(t)
	c, _ := atDen(t, g, "a")
	r := item.Recipe{Process: "shape", Method: "narrow-grind", Slot: "tool", Inputs: []item.Input{{Kind: g.r.Book.Materials[0].ID, Qty: 2}}}
	grantFor(t, g, c, ledger.Material(r.Inputs[0].Kind), 2)
	grantFor(t, g, c, ledger.Coin, 500)
	craft := func(key string) func() error {
		return func() error {
			_, err := g.Act(Command{Key: key, Char: c.C.ID, Kind: Craft, Recipe: &r, BackRoom: true})
			return err
		}
	}
	hotRefused(t, g, NotMade, "a back room for one not made", craft("a"))
	makeMade(c)
	home := c.C.At
	c.C.At = plainPlace(t, g, home, 6).Hex
	hotRefused(t, g, NoDen, "a back room where no den stands", craft("b"))
	c.C.At = home
	r.Process = "infuse"
	hotRefused(t, g, NotHere, "a back room for a still's process", craft("c"))
}

// Elsewhere a craft that uses hot units makes a hot product, under the
// mark of the lot that stays hot longest.
func TestHotInputMakesAHotProduct(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	c.C.At = g.SettlementHex(0)
	r, ap := shapeRecipe(t, g, c, false)
	m := r.Inputs[0].Kind
	grantFor(t, g, c, ledger.Material(m), 2)
	grantFor(t, g, c, ledger.Coin, ap.Fee)
	early := g.hotMark("npc:x", factionOwner(0), c.C.At, g.Tick())
	late := early
	late.Victim, late.Ends = "npc:y", early.Ends+2
	g.markHot(c, []item.Spoil{{Material: m, Qty: 1}}, late)
	g.markHot(c, []item.Spoil{{Material: m, Qty: 1}}, early)
	failed, made := craftOutcome(t, g, c, "hot-craft", r, false)
	day := hotDay(g)
	switch {
	case failed:
		var lots []char.HotLot
		for _, l := range char.HotLotsOf(c.C) {
			if l.Mark == late {
				lots = append(lots, l)
			}
		}
		if len(c.C.Goods) > 0 && len(lots) == 0 {
			t.Fatalf("a failed craft's salvage is clean: %+v", char.HotLotsOf(c.C))
		}
	case made == nil:
		t.Fatal("the craft made nothing and did not fail")
	case made.Hot == nil || *made.Hot != late:
		t.Fatalf("the product's mark is %+v, not %+v", made.Hot, late)
	}
	if !failed && len(g.HotGoods(c)) == 0 {
		t.Fatal("the hot product is not among the character's hot goods")
	}
	if got := g.HotUnits(c, m, day); got > g.hotHeld(c, m) {
		t.Fatalf("%d hot of %d held", got, g.hotHeld(c, m))
	}
	audit(t, g)
}

// Clean units go into a craft first, so enough of them make a clean product.
func TestCleanInputsMakeACleanProduct(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	c.C.At = g.SettlementHex(0)
	r, ap := shapeRecipe(t, g, c, false)
	m := r.Inputs[0].Kind
	hotGoods(t, g, c, m, 4, 2)
	grantFor(t, g, c, ledger.Coin, ap.Fee)
	failed, made := craftOutcome(t, g, c, "clean-craft", r, false)
	if !failed && (made == nil || made.Hot != nil) {
		t.Fatalf("clean units made %+v", made)
	}
	if got := g.HotUnits(c, m, hotDay(g)); got != 2 {
		t.Fatalf("the hot units stayed out of the craft: %d left hot", got)
	}
	for _, s := range c.C.Goods {
		if s.Material != m && g.HotUnits(c, s.Material, hotDay(g)) != 0 {
			t.Fatalf("salvage of %s is hot", s.Material)
		}
	}
	audit(t, g)
}
