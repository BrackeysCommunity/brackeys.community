package game_test

import (
	"fmt"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// society is a world whose first server has installed: n characters in
// its own guild, which runs the first starting settlement. The first is
// its leader and only officer.
func society(t *testing.T, n int) (*game.Game, []*trader) {
	t.Helper()
	g, err := game.New(rules(t))
	if err != nil {
		t.Fatal(err)
	}
	mat = g.Rules().Book.Materials[0].ID
	var out []*trader
	for i := range n {
		res, err := g.Act(game.Command{Key: fmt.Sprintf("new%d", i), Kind: game.Create, Option: "hook", Server: "s1", Note: "The Reedwardens"})
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, &trader{t: t, g: g, c: res.Char})
	}
	return g, out
}

// materialWith is the first material carrying a tag.
func materialWith(t *testing.T, g *game.Game, tag string) string {
	for _, m := range g.Rules().Book.Materials {
		if slices.Contains(m.Tags, tag) {
			return m.ID
		}
	}
	t.Fatalf("no material tagged %s", tag)
	return ""
}

func here(g *game.Game, tr *trader) string {
	n, _ := g.SettlementAt(tr.c.C.At)
	return fmt.Sprintf("settlement:%d", n)
}

func lastGoal(g *game.Game) *game.Goal { return g.Goals[len(g.Goals)-1] }

// away names a tile far from a character, where nobody in a test goes.
func away(tr *trader) string {
	at := tr.c.C.At
	return goal.TileRef(hex.Hex{Q: at.Q + 40, R: at.R})
}

func post(tr *trader, s game.GoalSpec) *game.Goal {
	tr.t.Helper()
	tr.must(game.Command{Kind: game.PostGoal, Goal: &s})
	return lastGoal(tr.g)
}

func (tr *trader) step(to hex.Hex) {
	tr.t.Helper()
	tr.must(game.Command{Kind: game.Step, Dir: tr.c.C.At.DirectionTo(to)})
	for tr.c.Long != nil {
		if _, err := tr.g.Advance(); err != nil {
			tr.t.Fatal(err)
		}
	}
	if tr.c.Fight != nil {
		tr.must(game.Command{Kind: game.Press, Option: "back-out"})
	}
}

func (tr *trader) walk(to hex.Hex) {
	tr.t.Helper()
	path, _, ok := tr.g.World.Path(tr.c.C.At, to)
	if !ok {
		tr.t.Fatalf("no path to %v", to)
	}
	for _, h := range path[1:] {
		tr.step(h)
	}
}

// toSeasonEnd runs the world through the current season's close.
func toSeasonEnd(t *testing.T, g *game.Game) {
	days := sheets.IntParam(g.Rules().Book.WorldParams, "season-days")
	advanceDays(t, g, days-g.World.Day%days)
}

func met(t *testing.T, x *game.Goal) {
	t.Helper()
	if x.State != goal.Done {
		t.Fatalf("%s %q is %s (%s), progress %v", x.ID, x.Title, x.State, x.Why, x.Progress)
	}
}

// TestFortyFibreByTomorrow: a character's ephemeral Deliver, met by
// another, the goods going to the poster (GDD 11.8).
func TestFortyFibreByTomorrow(t *testing.T) {
	g, ts := society(t, 2)
	poster, runner := ts[0], ts[1]
	fibre := materialWith(t, g, "fibre")
	poster.grant(ledger.Coin, 100)
	runner.grant(ledger.Material(fibre), 40)
	x := post(poster, game.GoalSpec{Title: "Forty fibre by tomorrow", Issuer: goal.ByCharacter, Reward: 50, Mode: goal.First,
		Lifetime: goal.Ephemeral, Turnover: goal.Expire, Ticks: sheets.TicksPerDay, Cond: goal.Condition{Verb: goal.Deliver, Tag: "fibre", Count: 40, At: here(g, poster)}})
	if fee := x.Fee; poster.c.C.Coin != 100-50-fee || fee < 1 {
		t.Fatalf("poster holds %d after a fee of %d", poster.c.C.Coin, fee)
	}
	runner.must(game.Command{Kind: game.DeliverGoal, Target: x.ID, Material: fibre, Units: 40})
	met(t, x)
	if runner.c.C.Coin != 50 || g.Ledger.Of(ledger.Char(poster.c.C.ID), ledger.Material(fibre)) != 40 {
		t.Fatalf("runner %d coin, poster %d fibre", runner.c.C.Coin, g.Ledger.Of(ledger.Char(poster.c.C.ID), ledger.Material(fibre)))
	}
	// A second one nobody meets expires: the escrow back, the fee kept.
	y := post(poster, game.GoalSpec{Title: "More fibre", Issuer: goal.ByCharacter, Reward: 10, Mode: goal.First,
		Lifetime: goal.Ephemeral, Turnover: goal.Expire, Ticks: sheets.TicksPerDay, Cond: goal.Condition{Verb: goal.Deliver, Tag: "fibre", Count: 1, At: here(g, poster)}})
	before := poster.c.C.Coin
	advanceDays(t, g, 2)
	if y.State != goal.Ended || poster.c.C.Coin != before+10 {
		t.Fatalf("expired goal %s, poster %d → %d", y.State, before, poster.c.C.Coin)
	}
	audit(t, g)
}

// TestABladeWithATrait: Make any blade carrying a trait (GDD 11.8, "A
// blade that bites the Plated").
func TestABladeWithATrait(t *testing.T) {
	g, ts := society(t, 2)
	r := g.Rules()
	recipe, trait := bladeWithTrait(t, r)
	for _, tr := range ts {
		tr.grant(ledger.Material(recipe.Inputs[0].Kind), recipe.Inputs[0].Qty*2)
		tr.grant(ledger.Coin, 100)
	}
	ts[0].must(game.Command{Kind: game.Craft, Recipe: &recipe})
	x := post(ts[0], game.GoalSpec{Title: "A blade that bites", Issuer: goal.ByCharacter, Reward: 30, Mode: goal.First, Lifetime: goal.Season,
		Turnover: goal.Expire, Cond: goal.Condition{Verb: goal.Make, Tag: "blade", Trait: trait, Count: 1}})
	ts[1].must(game.Command{Kind: game.Craft, Recipe: &recipe})
	met(t, x)
	if c := x.Claims[0]; c.Who != ts[1].c.C.ID || len(c.Facts) != 1 {
		t.Fatalf("claim %+v", c)
	}
	audit(t, g)
}

// bladeWithTrait finds a one-material blade recipe whose kind carries a
// trait.
func bladeWithTrait(t *testing.T, r *game.Rules) (item.Recipe, string) {
	for _, m := range r.Book.Materials {
		for _, me := range r.Book.Methods {
			if me.Process != "shape" || m.Tier != 1 {
				continue
			}
			rc := item.Recipe{Process: "shape", Method: me.ID, Slot: "blade", Inputs: []item.Input{{Kind: m.ID, Qty: 2}}}
			p, err := r.Fight.D.Props(rc, 1)
			if err == nil && len(p.Traits) > 0 && !p.Failed {
				return rc, p.Traits[0]
			}
		}
	}
	t.Fatal("no tier-1 blade with a trait in these sheets: the goals' example proofs need one")
	return item.Recipe{}, ""
}

// TestCarryMeHome: calling for help posts the Carry goal; a rescuer
// carries the downed character home (GDD 11.6, 11.8).
func TestCarryMeHome(t *testing.T) {
	g, ts := society(t, 2)
	downed, rescuer := ts[0], ts[1]
	home := downed.c.C.At
	out := home.Neighbour(0)
	for d := range hex.Directions {
		if _, _, ok := g.World.Path(home, home.Neighbour(d)); ok {
			out = home.Neighbour(d)
			break
		}
	}
	downed.grant(ledger.Coin, 40)
	downed.c.C.At = out
	downed.c.C.Set(char.Down, 0)
	downed.must(game.Command{Kind: game.CallHelp})
	x := lastGoal(g)
	if x.Cond.Verb != goal.Carry || x.Reward != sheets.IntParam(g.Rules().Book.GoalParams, "rescue-reward") || x.Expires == 0 {
		t.Fatalf("rescue goal %+v", x)
	}
	rescuer.step(out)
	rescuer.must(game.Command{Kind: game.CarryHome, Target: downed.c.C.ID})
	rescuer.step(home)
	met(t, x)
	if downed.c.C.At != home || downed.c.C.Has(char.Down, g.Tick()) || rescuer.c.C.Coin != 30 {
		t.Fatalf("downed at %v (home %v), rescuer %d coin", downed.c.C.At, home, rescuer.c.C.Coin)
	}
	audit(t, g)
}

// treasury fills a settlement's treasury with its half of market fees:
// two members trade coin's worth of goods back and forth.
func treasury(t *testing.T, g *game.Game, a, b *trader, coin int64) {
	t.Helper()
	price := g.Rules().Values.Asset(mat)
	for g.Ledger.Of(game.TreasuryPool(0), ledger.Coin) < coin {
		b.grant(ledger.Material(mat), 20)
		a.grant(ledger.Coin, price*20)
		b.must(game.Command{Kind: game.Ask, Material: mat, Price: price, Units: 20})
		a.must(game.Command{Kind: game.Bid, Material: mat, Price: price, Units: 20})
		advanceDays(t, g, 1)
	}
}

// TestFindTheNextSeam: an officer's muster from the treasury, a Discover
// of a rich tile within 12 tiles, standing (GDD 11.8).
func TestFindTheNextSeam(t *testing.T) {
	g, ts := society(t, 2)
	officer, finder := ts[0], ts[1]
	treasury(t, g, officer, finder, 20)
	home := officer.c.C.At
	target, ore := richest(g, home, 6)
	x := post(officer, game.GoalSpec{Title: "Find the next seam", Issuer: goal.ByAdmin, Reward: 10, Mode: goal.First, Lifetime: goal.Standing,
		Turnover: goal.Keep, Cond: goal.Condition{Verb: goal.Discover, Field: "ore", AtLeast: ore, Hex: &home, Within: 12, Count: 1}})
	finder.walk(target)
	met(t, x)
	audit(t, g)
}

// richest is the undiscovered reachable tile with the most ore within
// reach of a tile, and its ore.
func richest(g *game.Game, from hex.Hex, reach int64) (hex.Hex, int64) {
	var best hex.Hex
	ore := int64(-1)
	for _, h := range hex.DiscAt(from, reach) {
		b := g.Rules().Gen.Baseline(h)
		if tile := g.World.Tile(h); h == from || b.Site != "" || (tile != nil && tile.Discovered != nil) {
			continue
		}
		if _, _, ok := g.World.Path(from, h); ok && b.Ore > ore {
			best, ore = h, b.Ore
		}
	}
	return best, ore
}

// TestRaiseTheEastPalisade: a pooled settlement Deliver of timber that
// raises the wall when met (GDD 4.16, 11.8).
func TestRaiseTheEastPalisade(t *testing.T) {
	g, ts := society(t, 3)
	timber := materialWith(t, g, "timber")
	ts[0].must(game.Command{Kind: game.Raise, Slot: "wall"})
	x := lastGoal(g)
	if x.Build == nil || x.Mode != goal.Pooled || x.Cond.Count != 400 {
		t.Fatalf("palisade goal %+v", x)
	}
	for _, tr := range ts[1:] {
		tr.grant(ledger.Material(timber), 200)
		tr.must(game.Command{Kind: game.DeliverGoal, Target: x.ID, Material: timber, Units: 200})
	}
	met(t, x)
	if p := g.Places[0]; !p.Open("wall") || p.Get("wall").Tier != 1 {
		t.Fatalf("no wall after the palisade: %+v", p.Structures)
	}
	audit(t, g)
}

// proposal posts a settlement goal and pledges it live.
func proposal(t *testing.T, g *game.Game, ts []*trader, s game.GoalSpec) *game.Goal {
	t.Helper()
	x := post(ts[0], s)
	if x.State != goal.Proposed {
		t.Fatalf("a settlement goal is %s", x.State)
	}
	need := x.Need
	for _, tr := range ts {
		tr.grant(ledger.Coin, need/int64(len(ts))+1)
		tr.must(game.Command{Kind: game.Pledge, Target: x.ID, Units: need/int64(len(ts)) + 1})
		if x.State == goal.Live {
			break
		}
	}
	if x.State != goal.Live || x.Reward <= 0 {
		t.Fatalf("pledged %v of %d: %s", x.Pledges, need, x.State)
	}
	return x
}

// TestTheFirstColdSnapRace: a settlement's Each Reach, capped, that
// resets at the season's close (GDD 11.8).
func TestTheFirstColdSnapRace(t *testing.T) {
	g, ts := society(t, 3)
	home := ts[0].c.C.At
	far, _ := richest(g, home, 3)
	x := proposal(t, g, ts, game.GoalSpec{Title: "The first-cold-snap race", Issuer: goal.BySettlement, Mode: goal.Each, Cap: 10, Lifetime: goal.Season,
		Turnover: goal.Reset, Cond: goal.Condition{Verb: goal.Reach, Count: 1, At: "tile:" + far.Ref()}})
	for _, tr := range ts[1:] {
		tr.walk(far)
	}
	if len(x.Claims) != 2 || x.State != goal.Live || x.Claims[0].Coin != x.Reward {
		t.Fatalf("race claims %+v, state %s", x.Claims, x.State)
	}
	toSeasonEnd(t, g)
	if x.State != goal.Live || len(x.Claims) != 0 || x.Total() != 0 {
		t.Fatalf("the race did not reset: %s %d claims", x.State, len(x.Claims))
	}
	audit(t, g)
}

// TestKeepTheMarshQuiet: a pooled settlement Hold on a region's threat
// for days running, paying who fought there (GDD 11.8).
func TestKeepTheMarshQuiet(t *testing.T) {
	g, ts := society(t, 2)
	r := g.World.RegionAt(ts[0].c.C.At)
	threat := g.World.Regions[r].Gauge[g.World.GaugeIndex("threat")]
	x := proposal(t, g, ts, game.GoalSpec{Title: "Keep the marsh quiet", Issuer: goal.BySettlement, Mode: goal.Pooled, Lifetime: goal.Season,
		Turnover: goal.Evolve, Cond: goal.Condition{Verb: goal.Hold, Gauge: "threat", Line: threat + 300, Below: true, Count: 5, At: "region:" + world.RegionRef(r)}})
	advanceDays(t, g, 6)
	met(t, x)
	audit(t, g)
}

// TestOldPale: a character's standing Defeat of one creature kind (GDD
// 11.8).
func TestOldPale(t *testing.T) {
	g, ts := society(t, 2)
	hunter := &solo{t: t, g: g, c: ts[1].c, home: ts[1].c.C.At}
	site, ok := nearestSite(g, hunter.home)
	if !ok {
		t.Fatal("no site near the first settlement: the Old Pale proof needs one")
	}
	kinds := g.Rules().Gen.Creatures(site)
	recipe, _ := bladeWithTrait(t, g.Rules())
	for range 3 {
		ts[1].grant(ledger.Material(recipe.Inputs[0].Kind), recipe.Inputs[0].Qty)
		ts[1].grant(ledger.Coin, 20)
		ts[1].must(game.Command{Kind: game.Craft, Recipe: &recipe})
	}
	ts[0].grant(ledger.Coin, 50)
	x := post(ts[0], game.GoalSpec{Title: "Old Pale", Issuer: goal.ByCharacter, Reward: 20, Mode: goal.First, Lifetime: goal.Standing,
		Turnover: goal.Keep, Cond: goal.Condition{Verb: goal.Defeat, Kind: kinds[0], Count: 1}})
	// The same creature asked for in its own region, and in another.
	home := g.World.RegionAt(site)
	there, abroad := goal.RegionRef(world.RegionRef(home)), goal.RegionRef(world.RegionRef((home+1)%len(g.World.Regions)))
	local := post(ts[0], game.GoalSpec{Title: "Old Pale, at home", Issuer: goal.ByCharacter, Mode: goal.First, Lifetime: goal.Standing,
		Turnover: goal.Keep, Cond: goal.Condition{Verb: goal.Defeat, Kind: kinds[0], Count: 1, At: there}})
	elsewhere := post(ts[0], game.GoalSpec{Title: "Old Pale, abroad", Issuer: goal.ByCharacter, Mode: goal.First, Lifetime: goal.Standing,
		Turnover: goal.Keep, Cond: goal.Condition{Verb: goal.Defeat, Kind: kinds[0], Count: 1, At: abroad}})
	hunter.walk(site)
	for range 40 {
		if x.State == goal.Done {
			break
		}
		if hunter.c.C.Has(char.Down, g.Tick()) || hunter.c.C.Has(char.Wounded, g.Tick()) {
			hunter.c.C.Conditions = nil
		}
		if hunter.c.C.In(char.Hand, 0) == nil {
			for _, in := range hunter.c.C.Pack {
				if hunter.act(game.Command{Kind: game.Equip, Item: in.ID, Slot: char.Hand}) == nil {
					break
				}
			}
		}
		if err := hunter.act(game.Command{Kind: game.Explore}); err != nil {
			hunter.c.C.Conditions = nil
			continue
		}
		for hunter.c.Fight != nil {
			pick, band := "back-out", int64(-1)
			for _, o := range g.Choose(hunter.c).Fight.Options {
				if !o.Puzzle && o.Kind == "win" && o.Band > band {
					pick, band = o.ID, o.Band
				}
			}
			if err := hunter.act(game.Command{Kind: game.Press, Option: pick}); err != nil {
				t.Fatal(err)
			}
		}
	}
	met(t, x)
	met(t, local)
	if elsewhere.State != goal.Live {
		t.Fatalf("a Defeat asked for in another region is %s", elsewhere.State)
	}
	audit(t, g)
}

// TestAVowKeptAndBroken: a vow pays nothing and is recorded at its close
// (GDD 11.7, 11.8).
func TestAVowKeptAndBroken(t *testing.T) {
	g, ts := society(t, 2)
	vow := game.GoalSpec{Title: "No blade this season", Issuer: goal.ByCharacter, Mode: goal.First, Lifetime: goal.Season, Turnover: goal.Expire,
		Cond: goal.Condition{Verb: goal.Hold, Tag: "blade"}}
	keeper := post(ts[0], vow)
	breaker := post(ts[1], vow)
	if keeper.Fee != 0 {
		t.Fatalf("a vow paid a fee of %d", keeper.Fee)
	}
	recipe, _ := bladeWithTrait(t, g.Rules())
	ts[1].grant(ledger.Material(recipe.Inputs[0].Kind), recipe.Inputs[0].Qty)
	ts[1].grant(ledger.Coin, 50)
	ts[1].must(game.Command{Kind: game.Craft, Recipe: &recipe})
	blade := ts[1].c.C.Pack[len(ts[1].c.C.Pack)-1]
	ts[1].must(game.Command{Kind: game.Equip, Item: blade.ID, Slot: char.Hand})
	toSeasonEnd(t, g)
	if keeper.Why != "kept" || breaker.Why != "broken" || ts[0].c.C.Goals.Get("vows-kept") != 1 {
		t.Fatalf("keeper %s, breaker %s", keeper.Why, breaker.Why)
	}
	unchanged(t, ts[1], "a vow to hold off what is already in hand", game.Command{Kind: game.PostGoal, Goal: &vow})

	// Withdrawing a vow already broken does not unsay it; one still kept is
	// only withdrawn.
	ts[1].c.C.Equipped = slices.DeleteFunc(ts[1].c.C.Equipped, func(e char.Equipped) bool { return e.Item == blade.ID })
	second, plain := post(ts[1], vow), post(ts[0], vow)
	ts[1].must(game.Command{Kind: game.Equip, Item: blade.ID, Slot: char.Hand})
	ts[1].must(game.Command{Kind: game.WithdrawGoal, Target: second.ID})
	ts[0].must(game.Command{Kind: game.WithdrawGoal, Target: plain.ID})
	if second.Why != "broken" || ts[1].c.C.Goals.Get("vows-broken") != 2 || plain.Why != "withdrawn" || ts[0].c.C.Goals.Get("vows-broken") != 0 {
		t.Fatalf("withdrawn: a broken vow ended %s (%d broken on its sheet), a kept one %s", second.Why, ts[1].c.C.Goals.Get("vows-broken"), plain.Why)
	}
}

// TestScreenedWordsAndHide: a title from the word list is refused, and an
// operator's hide takes a goal down with its escrow back.
func TestScreenedWordsAndHide(t *testing.T) {
	g, ts := society(t, 1)
	ts[0].grant(ledger.Coin, 50)
	bad := game.GoalSpec{Title: "shitty errand", Issuer: goal.ByCharacter, Reward: 10, Mode: goal.First, Lifetime: goal.Standing, Turnover: goal.Keep,
		Cond: goal.Condition{Verb: goal.Defeat, Count: 1}}
	if err := ts[0].do(game.Command{Kind: game.PostGoal, Goal: &bad}); err == nil {
		t.Fatal("a screened title was posted")
	}
	bad.Title = "An errand"
	x := post(ts[0], bad)
	before := ts[0].c.C.Coin
	ts[0].must(game.Command{Kind: game.HideGoal, Target: x.ID, Note: "spam"})
	if !x.Hidden || x.State != goal.Ended || ts[0].c.C.Coin != before+10 || len(g.Board(0)) != 0 {
		t.Fatalf("hidden %v state %s coin %d → %d", x.Hidden, x.State, before, ts[0].c.C.Coin)
	}
	audit(t, g)
}
