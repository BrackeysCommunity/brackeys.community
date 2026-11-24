package game

import (
	"errors"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

// atDen puts a new character on the first den's tile.
func atDen(t *testing.T, g *Game, key string) (*Char, Den) {
	t.Helper()
	dens := g.Dens()
	if len(dens) == 0 {
		t.Fatal("a new world has no den")
	}
	c := mustCreate(t, g, key, "knife")
	c.C.At = dens[0].At
	return c, dens[0]
}

// dearest is the material worth most a unit where c stands.
func dearest(g *Game, c *Char) string {
	best, worth := "", int64(0)
	for _, m := range g.r.Book.Materials {
		if w := g.WorthAt(c.C.At, ledger.Material(m.ID), 1); best == "" || w > worth {
			best, worth = m.ID, w
		}
	}
	return best
}

// hotGoods gives c units of a material, hot of them under a mark.
func hotGoods(t *testing.T, g *Game, c *Char, material string, units, hot int64) item.Hot {
	t.Helper()
	grantFor(t, g, c, ledger.Material(material), units)
	mark := g.hotMark(refKey(fact.Ref{Kind: "npc", ID: "x"}), factionOwner(0), c.C.At, g.Tick())
	g.markHot(c, []item.Spoil{{Material: material, Qty: hot}}, mark)
	return mark
}

// unitsFor is the fewest units of a material whose fenced pay to c is at
// least coin.
func unitsFor(g *Game, c *Char, material string, coin int64) int64 {
	for u := int64(1); ; u++ {
		if g.FencePays(c, g.WorthAt(c.C.At, ledger.Material(material), u)) >= coin {
			return u
		}
	}
}

func refusedCode(t *testing.T, err error, code, what string) {
	t.Helper()
	var r *Refused
	if !errors.As(err, &r) || r.Code != code {
		t.Fatalf("%s gave %v, not %s", what, err, code)
	}
}

// A fence pays fence-pays of the goods' worth out of the den settlement's
// trader coin for the day, counted in the faucet; it takes the hot units,
// not the clean ones, and refuses once that coin is spent.
func TestFencePaysFromTheTraderSlice(t *testing.T) {
	g := guardGame(t)
	c, d := atDen(t, g, "a")
	m := dearest(g, c)
	units := unitsFor(g, c, m, 1)
	hotGoods(t, g, c, m, units+3, units)
	day := hotDay(g)
	worth := g.WorthAt(c.C.At, ledger.Material(m), units)
	pay := fixed.PercentFloor(worth, g.syp("fence-pays"))
	if pay < 1 {
		t.Fatalf("%d %s fence for nothing", units, m)
	}
	g.Market.Trader[d.Place] = pay + 7
	coin, faucet, sink := c.C.Coin, g.Market.Week.Faucet, g.Ledger.Of(ledger.FromFaction, ledger.Coin)
	if _, err := g.Act(Command{Key: "fence-1", Char: c.C.ID, Kind: Fence, Material: m, Units: units}); err != nil {
		t.Fatal(err)
	}
	if c.C.Coin != coin+pay || g.Market.Trader[d.Place] != 7 || g.Market.Week.Faucet != faucet+pay {
		t.Fatalf("paid %d of %d, trader left %d, faucet +%d", c.C.Coin-coin, pay, g.Market.Trader[d.Place], g.Market.Week.Faucet-faucet)
	}
	if got := g.Ledger.Of(ledger.FromFaction, ledger.Coin); got != sink-pay {
		t.Fatalf("the faction source paid %d, not %d", sink-got, pay)
	}
	if got := g.HotUnits(c, m, day); got != 0 || g.hotHeld(c, m) != 3 {
		t.Fatalf("the fence took the hot units: %d hot of %d held", got, g.hotHeld(c, m))
	}
	if got := g.Ledger.Of(ledger.NPCPool(d.Fence), ledger.Material(m)); got != units {
		t.Fatalf("the fence's purse holds %d of %d", got, units)
	}
	if n := g.NPCs.Get(d.Fence); n == nil {
		t.Fatal("the fence was not saved")
	}
	fs := factsOf(g, factFenceBought)
	if len(fs) != 1 {
		t.Fatalf("%d fence.bought facts", len(fs))
	}
	if p, _ := fs[0].Get("pay"); p.N != pay {
		t.Fatalf("fence.bought says pay %d, not %d", p.N, pay)
	}
	audit(t, g)

	// Clean goods are not the fence's, even to one who can still find it;
	// neither is more than the coin left.
	makeMade(c)
	hotRefused(t, g, NotHot, "fencing clean goods", func() error {
		_, err := g.Act(Command{Key: "fence-2", Char: c.C.ID, Kind: Fence, Material: m, Units: 1})
		return err
	})
	g.markHot(c, []item.Spoil{{Material: m, Qty: 3}}, g.hotMark("npc:y", "", c.C.At, g.Tick()))
	hotRefused(t, g, FenceSpent, "fencing past the trader's coin", func() error {
		_, err := g.Act(Command{Key: "fence-3", Char: c.C.ID, Kind: Fence, Material: m, Units: 3})
		return err
	})
	g.Market.Trader[d.Place] = 0
	hotRefused(t, g, FenceSpent, "fencing on a spent day", func() error {
		_, err := g.Act(Command{Key: "fence-4", Char: c.C.ID, Kind: Fence, Material: m, Units: 1})
		return err
	})
}

// A fence is found only by one who can find it: a character with no hot
// goods and no crooked name is refused, and nothing changes.
func TestFenceHiddenFromTheClean(t *testing.T) {
	g := guardGame(t)
	c, d := atDen(t, g, "a")
	g.Market.Trader[d.Place] = 1000
	grantFor(t, g, c, ledger.Material(dearest(g, c)), 2)
	hotRefused(t, g, FenceHidden, "fencing with no fence to be seen", func() error {
		_, err := g.Act(Command{Key: "f", Char: c.C.ID, Kind: Fence, Material: dearest(g, c), Units: 1})
		return err
	})
	away := mustCreate(t, g, "b", "knife")
	hotGoods(t, g, away, dearest(g, away), 2, 2)
	away.C.At = plainPlace(t, g, g.SettlementHex(0), 6).Hex
	hotRefused(t, g, FenceHidden, "fencing where no den stands", func() error {
		_, err := g.Act(Command{Key: "g", Char: away.C.ID, Kind: Fence, Material: dearest(g, away), Units: 1})
		return err
	})
}

// A hot item goes into the fence's purse and the made are paid the back
// room's share for it.
func TestFenceBuysAHotItemAtTheMadeRate(t *testing.T) {
	g := guardGame(t)
	c, d := atDen(t, g, "a")
	c.C.Align().Made = true
	if len(c.C.Pack) == 0 {
		t.Fatal("a new character carries no item")
	}
	in := c.C.Pack[0]
	c.C.Equipped = slices.DeleteFunc(c.C.Equipped, func(e char.Equipped) bool { return e.Item == in.ID })
	mark := g.hotMark("npc:x", "", c.C.At, g.Tick())
	in.Hot = &mark
	pay := fixed.PercentFloor(g.ItemValue(in), g.syp("back-room-pays"))
	if pay < 1 {
		t.Skip("the start item is worth nothing to a fence")
	}
	g.Market.Trader[d.Place] = pay
	coin := c.C.Coin
	if _, err := g.Act(Command{Key: "fence-item", Char: c.C.ID, Kind: Fence, Item: in.ID}); err != nil {
		t.Fatal(err)
	}
	if c.C.Coin != coin+pay || c.C.Item(in.ID) != nil {
		t.Fatalf("paid %d of %d; still carried: %v", c.C.Coin-coin, pay, c.C.Item(in.ID) != nil)
	}
	if g.Ledger.Of(ledger.NPCPool(d.Fence), ledger.Item(in.ID)) != 1 {
		t.Fatal("the fence's purse does not hold the item")
	}
	audit(t, g)
}

// The world day empties every fence's purse into the syndicate's sink.
func TestFenceDaySweepsIntoTheSyndicate(t *testing.T) {
	g := guardGame(t)
	c, d := atDen(t, g, "a")
	m := dearest(g, c)
	units := unitsFor(g, c, m, 1)
	hotGoods(t, g, c, m, units, units)
	g.Market.Trader[d.Place] = 1000
	if _, err := g.Act(Command{Key: "fence", Char: c.C.ID, Kind: Fence, Material: m, Units: units}); err != nil {
		t.Fatal(err)
	}
	sunk := g.Ledger.Of(ledger.ToSyndicate, ledger.Material(m))
	if err := g.goalsTurn(g.Tick()); err != nil {
		t.Fatal(err)
	}
	if left := g.Ledger.Held(ledger.NPCPool(d.Fence)); len(left) != 0 {
		t.Fatalf("the fence's purse still holds %+v", left)
	}
	if got := g.Ledger.Of(ledger.ToSyndicate, ledger.Material(m)); got != sunk+units {
		t.Fatalf("the syndicate's sink took %d of %d", got-sunk, units)
	}
	audit(t, g)
}

// Fenced coin gives a syndicate standing point per fence-standing-coin,
// the rest carried to the next sale.
func TestFenceStandingPerCoin(t *testing.T) {
	g := guardGame(t)
	c, d := atDen(t, g, "a")
	per := g.syp("fence-standing-coin")
	m := dearest(g, c)
	units := unitsFor(g, c, m, per)
	hotGoods(t, g, c, m, units, units)
	g.Market.Trader[d.Place] = 1 << 20
	pay := g.FencePays(c, g.WorthAt(c.C.At, ledger.Material(m), units))
	c.C.Align().Fenced = per - 1
	if _, err := g.Act(Command{Key: "fence", Char: c.C.ID, Kind: Fence, Material: m, Units: units}); err != nil {
		t.Fatal(err)
	}
	sum := per - 1 + pay
	if got := c.C.Standing.Get(syndicateKey); got != sum/per {
		t.Fatalf("%d coin fenced on %d carried gave %d standing, not %d", pay, per-1, got, sum/per)
	}
	if got := c.C.Alignment.Fenced; got != sum%per {
		t.Fatalf("%d coin carried, not %d", got, sum%per)
	}
	if p, rest := earned(0, per-1, per); p != 0 || rest != per-1 {
		t.Fatalf("under a point gives %d, carries %d", p, rest)
	}
}

// makeMade makes a character made and keeps it playing.
func makeMade(c *Char) { c.C.Align().Made = true }

// nearTarget gives the first den a faction to rob: faction 0 holds the
// den's own region.
func nearTarget(t *testing.T, g *Game, d Den) {
	t.Helper()
	if len(g.World.Factions) == 0 {
		t.Skip("a world with no factions")
	}
	r := g.World.RegionAt(d.At)
	if r < 0 {
		t.Fatal("a den outside every region")
	}
	g.World.Regions[r].Holder = 0
	g.World.Factions[0].Fallen = false
}

func jobsOf(g *Game) []*Goal {
	var out []*Goal
	for _, x := range g.Goals {
		if x.Issuer.Kind == goal.BySyndicate {
			out = append(out, x)
		}
	}
	return out
}

// Jobs are posted only while a made character plays, each a Steal of the
// target faction's goods, its reward a share of the den settlement's day
// budget minted into escrow and held out of the day's orders.
func TestJobsOnlyWithTheMadeActive(t *testing.T) {
	g := guardGame(t)
	c, d := atDen(t, g, "a")
	nearTarget(t, g, d)
	if err := g.syndicateJobs(g.Tick(), "jobs-0"); err != nil {
		t.Fatal(err)
	}
	if jobs := jobsOf(g); len(jobs) != 0 {
		t.Fatalf("%d jobs with nobody made", len(jobs))
	}
	makeMade(c)
	reward := fixed.PercentFloor(g.Budgets()[d.Place], g.syp("job-share"))
	if reward < g.gp("reward-least") {
		t.Skipf("the den's job pays %d, under the least reward", reward)
	}
	held := g.bountyHeld(d.Place)
	faucet := g.Market.Week.Faucet
	if err := g.syndicateJobs(g.Tick(), "jobs-1"); err != nil {
		t.Fatal(err)
	}
	var x *Goal
	for _, j := range jobsOf(g) {
		if j.Board == d.Place {
			x = j
		}
	}
	if x == nil {
		t.Fatal("no job at the den with a made character playing")
	}
	if x.Cond.Verb != goal.Steal || x.Cond.Victim != factionOwner(0) || x.Cond.Kind != KindBurgle || x.Mode != goal.First ||
		x.Issuer != (goal.Ref{Kind: goal.BySyndicate, ID: syndicateIssuer}) {
		t.Fatalf("the job is %+v", x)
	}
	if x.Reward != reward || x.Cond.Count != g.syp("job-worth")*g.tierAt(d.At) {
		t.Fatalf("the job pays %d for %d worth", x.Reward, x.Cond.Count)
	}
	if x.Expires != g.Tick()+g.syp("job-days")*sheets.TicksPerDay {
		t.Fatalf("the job ends at %d", x.Expires)
	}
	if got := g.Ledger.Of(goalPool(x.ID), ledger.Coin); got != reward {
		t.Fatalf("the job's escrow holds %d", got)
	}
	if got := g.bountyHeld(d.Place); got != held+reward {
		t.Fatalf("bountyHeld %d, not %d", got, held+reward)
	}
	if g.Market.Week.Faucet != faucet {
		t.Fatal("posting a job counted in the faucet before anyone was paid")
	}
	if len(factsOf(g, factJobPosted)) == 0 {
		t.Fatal("no syndicate.posted fact")
	}
	// One job a den: a second pass the same day posts none.
	n := len(jobsOf(g))
	if err := g.syndicateJobs(g.Tick(), "jobs-2"); err != nil {
		t.Fatal(err)
	}
	if len(jobsOf(g)) != n {
		t.Fatal("a den posted a second job while its first stands")
	}
	audit(t, g)
}

// theftWonFact writes a won theft as theft writes it.
func theftWonFact(t *testing.T, g *Game, c *Char, kind, faction string, worth int64) {
	t.Helper()
	if _, err := g.factWith(c, []fact.Ref{{Kind: "faction", ID: "f-0"}}, factTheft, g.Tick(), fact.S("kind", kind), fact.S("outcome", theftWon),
		fact.N("witnessed", 0), fact.N("worth", worth), fact.S("faction", faction), fact.N("settlement", -1)); err != nil {
		t.Fatal(err)
	}
}

// A job counts nothing for a character who is not made, and takes no
// pledge from one; a made thief's won theft meets it, pays it out of the
// escrow, counts the minted coin in the faucet and adds job-standing.
func TestJobClaimedOnlyByTheMade(t *testing.T) {
	g := guardGame(t)
	c, d := atDen(t, g, "a")
	nearTarget(t, g, d)
	makeMade(c)
	if err := g.syndicateJobs(g.Tick(), "jobs"); err != nil {
		t.Fatal(err)
	}
	var x *Goal
	for _, j := range jobsOf(g) {
		if j.Board == d.Place {
			x = j
		}
	}
	if x == nil {
		t.Skip("the den posted no job")
	}
	b := mustCreate(t, g, "b", "knife")
	grantFor(t, g, b, ledger.Coin, 100)
	hotRefused(t, g, NotMade, "pledging to a job unmade", func() error {
		_, err := g.Act(Command{Key: "pledge", Char: b.C.ID, Kind: Pledge, Target: x.ID, Units: 20})
		return err
	})
	refusedCode(t, g.mayClaim(x, b.C.ID), NotMade, "an unmade claim")
	from := fact.ID(g.Log.Len())
	theftWonFact(t, g, b, x.Cond.Kind, x.Cond.Victim, x.Cond.Count)
	if err := g.creditGoals(from, "credit-b"); err != nil {
		t.Fatal(err)
	}
	if x.State != goal.Live || x.Total() != 0 {
		t.Fatalf("an unmade thief counted toward the job: %s, %d", x.State, x.Total())
	}
	// A theft of another faction's goods, or of another kind, is not the job.
	from = fact.ID(g.Log.Len())
	theftWonFact(t, g, c, x.Cond.Kind, factionOwner(1), x.Cond.Count)
	if err := g.creditGoals(from, "credit-other"); err != nil {
		t.Fatal(err)
	}
	if x.Total() != 0 {
		t.Fatal("a theft from another faction counted")
	}
	coin, standing, faucet := c.C.Coin, c.C.Standing.Get(syndicateKey), g.Market.Week.Faucet
	from = fact.ID(g.Log.Len())
	theftWonFact(t, g, c, x.Cond.Kind, x.Cond.Victim, x.Cond.Count)
	if err := g.creditGoals(from, "credit-c"); err != nil {
		t.Fatal(err)
	}
	if x.State != goal.Done || c.C.Coin != coin+x.Reward {
		t.Fatalf("the made thief's theft left the job %s and paid %d of %d", x.State, c.C.Coin-coin, x.Reward)
	}
	if got := c.C.Standing.Get(syndicateKey); got != standing+g.syp("job-standing") {
		t.Fatalf("a job met gave %d standing", got-standing)
	}
	if g.Market.Week.Faucet != faucet+x.Reward {
		t.Fatalf("the faucet counted %d of the minted %d", g.Market.Week.Faucet-faucet, x.Reward)
	}
	audit(t, g)
}

// An unclaimed job's escrow goes back to the faction sink it was minted
// against when it expires.
func TestJobExpiresIntoTheFactionSink(t *testing.T) {
	g := guardGame(t)
	c, d := atDen(t, g, "a")
	nearTarget(t, g, d)
	makeMade(c)
	if err := g.syndicateJobs(g.Tick(), "jobs"); err != nil {
		t.Fatal(err)
	}
	jobs := jobsOf(g)
	if len(jobs) == 0 {
		t.Skip("no job posted")
	}
	x := jobs[0]
	sink := g.Ledger.Of(ledger.ToFaction, ledger.Coin)
	if err := g.endGoal(x, "expired", "end"); err != nil {
		t.Fatal(err)
	}
	if got := g.Ledger.Of(ledger.ToFaction, ledger.Coin); got != sink+x.Reward {
		t.Fatalf("the faction sink took back %d of %d", got-sink, x.Reward)
	}
	audit(t, g)
}

// Only the syndicate posts a Steal, and it posts nothing else.
func TestStealIsTheSyndicates(t *testing.T) {
	l := goal.Limits{RewardLeast: 10, EachCap: 5, PartyMost: 6, TitleLen: 60, NoteLen: 200, EphemeralLeast: 1, EphemeralMost: 3 * sheets.TicksPerDay}
	job := func(issuer string, verb string) *goal.Goal {
		return &goal.Goal{Title: "a job", Issuer: goal.Ref{Kind: issuer}, Scope: goal.World, Reward: 20, Mode: goal.First,
			Lifetime: goal.Ephemeral, Turnover: goal.Expire, Expires: sheets.TicksPerDay, State: goal.Live,
			Cond: goal.Condition{Verb: verb, Kind: KindLift, Count: 40, Victim: "faction:0"}}
	}
	if err := goal.Valid(job(goal.BySyndicate, goal.Steal), 0, l); err != nil {
		t.Fatalf("a syndicate job is refused: %v", err)
	}
	if goal.Valid(job(goal.ByCharacter, goal.Steal), 0, l) == nil {
		t.Fatal("a character posted a Steal")
	}
	if goal.Valid(job(goal.BySyndicate, goal.Defeat), 0, l) == nil {
		t.Fatal("the syndicate posted a Defeat narrowed by a victim")
	}
	c := goal.Condition{Verb: goal.Steal, Kind: KindBurgle, Victim: "faction:0", Count: 1}
	if !c.Matches(goal.Event{Verb: goal.Steal, Kind: KindBurgle, Victim: "faction:0"}) ||
		c.Matches(goal.Event{Verb: goal.Steal, Kind: KindBurgle, Victim: "faction:1"}) ||
		c.Matches(goal.Event{Verb: goal.Steal, Kind: KindLift, Victim: "faction:0"}) {
		t.Fatal("a Steal matches by kind and victim")
	}
}

// A won theft reads as a Steal of its kind, worth and victim; a lost one
// reads as nothing.
func TestTheftReadsAsASteal(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	theftWonFact(t, g, c, KindLift, factionOwner(0), 33)
	f := g.Log.Since(fact.ID(g.Log.Len() - 1))[0]
	e, ok := g.event(f)
	if !ok || e.Verb != goal.Steal || e.Kind != KindLift || e.Units != 33 || e.Victim != factionOwner(0) || e.Who != c.C.ID {
		t.Fatalf("a won theft reads as %+v", e)
	}
	if _, err := g.factWith(c, nil, factTheft, g.Tick(), fact.S("kind", KindLift), fact.S("outcome", "lost"), fact.N("worth", 33)); err != nil {
		t.Fatal(err)
	}
	if _, ok := g.event(g.Log.Since(fact.ID(g.Log.Len() - 1))[0]); ok {
		t.Fatal("a lost theft reads as an event")
	}
}

// A made character falling under 0 syndicate standing is unmade.
func TestUnmadeUnderZero(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	makeMade(c)
	if err := g.addSyndicateStanding(c, 3, 0, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if err := g.addSyndicateStanding(c, -3, 0, g.Tick()); err != nil || !char.IsMade(c.C) {
		t.Fatalf("at 0 the character is still made: %v", err)
	}
	if err := g.addSyndicateStanding(c, -1, 0, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if char.IsMade(c.C) || len(factsOf(g, factUnmade)) != 1 {
		t.Fatalf("under 0: made %v, %d unmade facts", char.IsMade(c.C), len(factsOf(g, factUnmade)))
	}
}
