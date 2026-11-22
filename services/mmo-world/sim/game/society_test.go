package game_test

import (
	"fmt"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/settle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// unchanged runs a command that must be refused and leave the game as it
// was.
func unchanged(t *testing.T, tr *trader, what string, cmd game.Command) {
	t.Helper()
	before, _ := tr.g.Digest()
	if err := tr.do(cmd); err == nil {
		t.Fatalf("%s was not refused", what)
	}
	if after, _ := tr.g.Digest(); after != before {
		t.Fatalf("%s was refused but changed the game", what)
	}
}

func TestRefusedPostsChangeNothing(t *testing.T) {
	g, ts := society(t, 2)
	officer, member := ts[0], ts[1]
	timber := materialWith(t, g, "timber")
	member.grant(ledger.Material(timber), 60)
	spec := func(reward int64, verb string) *game.GoalSpec {
		s := game.GoalSpec{Title: "Timber east", Issuer: goal.ByCharacter, Reward: reward, Mode: goal.First, Lifetime: goal.Standing,
			Turnover: goal.Keep, Cond: goal.Condition{Verb: verb, Tag: "timber", Count: 60, At: here(g, member)}}
		if verb == goal.Haul {
			s.Material, s.Units = timber, 60
			s.Cond = goal.Condition{Verb: goal.Haul, From: here(g, member), At: away(member), Count: 60}
		}
		return &s
	}
	unchanged(t, member, "a reward past the purse", game.Command{Kind: game.PostGoal, Goal: spec(500, goal.Deliver)})
	unchanged(t, member, "a haul whose reward is past the purse", game.Command{Kind: game.PostGoal, Goal: spec(500, goal.Haul)})
	unchanged(t, officer, "a raise the treasury cannot pay for", game.Command{Kind: game.Raise, Slot: "wall", Price: 5000})
	unchanged(t, member, "backing a side before arcs", game.Command{Kind: game.PostGoal, Goal: spec(0, goal.Back)})
	byTrait := spec(0, goal.Deliver)
	byTrait.Cond.Trait = "keen"
	unchanged(t, member, "a Deliver narrowed by a trait no delivery carries", game.Command{Kind: game.PostGoal, Goal: byTrait})
	carry := spec(0, goal.Deliver)
	carry.Cond = goal.Condition{Verb: goal.Carry, Who: officer.c.C.ID, Count: 1, At: here(g, member)}
	unchanged(t, member, "a call for help for someone else", game.Command{Kind: game.PostGoal, Goal: carry})
	hold := func(gauge, at string) *game.GoalSpec {
		return &game.GoalSpec{Title: "Keep it quiet", Issuer: goal.ByCharacter, Mode: goal.First, Lifetime: goal.Standing, Turnover: goal.Keep,
			Cond: goal.Condition{Verb: goal.Hold, Gauge: gauge, Line: 500, Below: true, Count: 1, At: at}}
	}
	region := "region:" + world.RegionRef(g.World.RegionAt(member.c.C.At))
	unchanged(t, member, "a Hold of a gauge the world lacks", game.Command{Kind: game.PostGoal, Goal: hold("no-such-gauge", region)})
	unchanged(t, member, "a Hold on a settlement", game.Command{Kind: game.PostGoal, Goal: hold("threat", here(g, member))})
	unchanged(t, member, "a Hold on a region the world lacks", game.Command{Kind: game.PostGoal, Goal: hold("threat", "region:nowhere")})
	// A place spelt as no event is ever placed could never be matched.
	unchanged(t, member, "a Hold on a region misspelt", game.Command{Kind: game.PostGoal, Goal: hold("threat", region+"x")})
	for _, at := range []string{"settlement:99", "settlement:00", "tile:1,2,3", "nowhere"} {
		reach := spec(0, goal.Deliver)
		reach.Cond = goal.Condition{Verb: goal.Reach, Count: 1, At: at}
		unchanged(t, member, "a Reach of "+at, game.Command{Kind: game.PostGoal, Goal: reach})
	}
	member.grant(ledger.Coin, 500)
	mistagged := spec(10, goal.Haul)
	mistagged.Cond.Tag = "stone"
	unchanged(t, member, "a haul of timber asked for as stone", game.Command{Kind: game.PostGoal, Goal: mistagged})
	post(member, *hold("threat", region))
	advanceDays(t, g, 1)
	if g.Ledger.Of(ledger.Char(member.c.C.ID), ledger.Material(timber)) != 60 {
		t.Fatal("the haul's stock left the purse")
	}
	audit(t, g)
}

// A settlement's own goals are not the officer's five.
func TestRaiseGoalsAreTheSettlements(t *testing.T) {
	g, ts := society(t, 1)
	officer := ts[0]
	limit := sheets.IntParam(g.Rules().Book.GoalParams, "live-goals")
	for _, slot := range []string{"wall", "granary", "forge", "bench", "still", "loom"} {
		officer.must(game.Command{Kind: game.Raise, Slot: slot})
	}
	if n := g.LiveGoals(officer.c); n != 0 {
		t.Fatalf("raising counted %d goals against the officer", n)
	}
	for range limit {
		post(officer, game.GoalSpec{Title: "A vow", Issuer: goal.ByCharacter, Mode: goal.First, Lifetime: goal.Standing, Turnover: goal.Keep,
			Cond: goal.Condition{Verb: goal.Reach, Count: 1, At: here(g, officer)}})
	}
	unchanged(t, officer, "a goal past the limit", game.Command{Kind: game.PostGoal, Goal: &game.GoalSpec{Title: "One more", Issuer: goal.ByCharacter,
		Mode: goal.First, Lifetime: goal.Standing, Turnover: goal.Keep, Cond: goal.Condition{Verb: goal.Reach, Count: 1, At: here(g, officer)}}})
}

// An Each goal that resets pays only the claimants its escrow still
// covers.
func TestEachResetKeepsWithinItsEscrow(t *testing.T) {
	g, ts := society(t, 4)
	home := ts[0].c.C.At
	far, _ := richest(g, home, 3)
	x := proposal(t, g, ts, game.GoalSpec{Title: "The race", Issuer: goal.BySettlement, Mode: goal.Each, Cap: 3, Lifetime: goal.Season,
		Turnover: goal.Reset, Cond: goal.Condition{Verb: goal.Reach, Count: 1, At: "tile:" + far.Ref()}})
	ts[1].walk(far)
	ts[2].walk(far)
	toSeasonEnd(t, g)
	if x.Cap != 1 || x.State != goal.Live {
		t.Fatalf("after two claims of three and a reset: cap %d, %s", x.Cap, x.State)
	}
	for _, tr := range ts[1:] {
		tr.walk(home)
		tr.walk(far)
	}
	met(t, x)
	if _, err := g.Advance(); err != nil {
		t.Fatal(err)
	}
	if left := g.Ledger.Of(ledger.Pool+"escrow:"+x.ID, ledger.Coin); left < 0 || len(x.Claims) != 1 {
		t.Fatalf("%d claims after the reset, %d coin left in escrow", len(x.Claims), left)
	}
	audit(t, g)
}

// A carried character is set down only at home, and crawling ends the
// carry.
func TestCarryEndsAtHomeOrByCrawling(t *testing.T) {
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
	downed.c.C.At = out
	downed.c.C.Set(char.Down, 0)
	downed.must(game.Command{Kind: game.CallHelp})
	rescuer.step(out)
	rescuer.must(game.Command{Kind: game.CarryHome, Target: downed.c.C.ID})
	if downed.c.CarriedBy != rescuer.c.C.ID {
		t.Fatal("not carried")
	}
	downed.must(game.Command{Kind: game.Crawl})
	if downed.c.CarriedBy != "" || rescuer.c.Carrying != "" {
		t.Fatalf("crawling left the carry: %q carried by %q", rescuer.c.Carrying, downed.c.CarriedBy)
	}
}

// Only a downed character who has called for help is lifted.
func TestOnlyACallIsLifted(t *testing.T) {
	g, ts := society(t, 2)
	downed, rescuer := ts[0], ts[1]
	rescuer.c.C.At = rescuer.c.C.At.Neighbour(0)
	downed.c.C.At = rescuer.c.C.At
	downed.c.C.Set(char.Down, 0)
	lift := game.Command{Kind: game.CarryHome, Target: downed.c.C.ID}
	unchanged(t, rescuer, "lifting someone who has not called for help", lift)
	downed.must(game.Command{Kind: game.CallHelp})
	rescuer.must(lift)
	if downed.c.CarriedBy != rescuer.c.C.ID || rescuer.c.Carrying != downed.c.C.ID {
		t.Fatalf("after its call %q is carried by %q", rescuer.c.Carrying, downed.c.CarriedBy)
	}
	audit(t, g)
}

// A call for help stands while its caller is carried, however long the
// way home, and runs out with the crawl once the caller crawls again.
func TestACallOutlastsTheCarry(t *testing.T) {
	g, ts := society(t, 2)
	downed, rescuer := ts[0], ts[1]
	rescuer.c.C.At = rescuer.c.C.At.Neighbour(0)
	downed.c.C.At = rescuer.c.C.At
	downed.grant(ledger.Coin, 40)
	downed.c.C.Set(char.Down, 0)
	downed.must(game.Command{Kind: game.CallHelp})
	x := lastGoal(g)
	rescuer.must(game.Command{Kind: game.CarryHome, Target: downed.c.C.ID})
	advanceDays(t, g, 1)
	if x.State != goal.Live || !g.Called(downed.c) {
		t.Fatalf("the call of a carried character is %s", x.State)
	}
	// The reward is not taken back on the way home.
	unchanged(t, downed, "withdrawing a call while carried on it", game.Command{Kind: game.WithdrawGoal, Target: x.ID})
	if g.CanWithdraw(x, downed.c) {
		t.Fatal("a carried character is offered to withdraw its call")
	}
	downed.must(game.Command{Kind: game.Crawl})
	if x.Expires != downed.c.Long.Due {
		t.Fatalf("crawling again, the call runs to %d and the crawl to %d", x.Expires, downed.c.Long.Due)
	}
	audit(t, g)
}

// Structures a guild's settlement uses stay open; what nobody uses wears
// shut; a settlement no guild runs is kept by its keepers.
func TestNeglect(t *testing.T) {
	g, ts := society(t, 2)
	a, b := ts[0], ts[1]
	price := g.Rules().Values.Asset(mat)
	p := sheets.IntParam(g.Rules().Book.SettlementParams, "condition-max") + sheets.IntParam(g.Rules().Book.SettlementParams, "neglect-days") + 1
	for day := int64(0); day < p; day++ {
		if day%5 == 0 {
			b.grant(ledger.Material(mat), 1)
			a.grant(ledger.Coin, price)
			b.must(game.Command{Kind: game.Ask, Material: mat, Price: price, Units: 1})
			a.must(game.Command{Kind: game.Bid, Material: mat, Price: price, Units: 1})
		}
		advanceDays(t, g, 1)
	}
	run := g.Places[0]
	if run.Guild == "" {
		t.Fatal("the server's guild does not run its settlement")
	}
	if !run.Open("market") || !run.Open("treasury") {
		t.Fatalf("a market traded at closed: %+v", run.Structures)
	}
	if run.Open("forge") {
		t.Fatalf("a forge nobody used stayed open: %+v", run.Get("forge"))
	}
	for _, other := range g.Places[1:] {
		if other.Guild == "" && !other.Open("market") {
			t.Fatalf("the keepers let settlement %d's market shut", other.N)
		}
	}
}

func coinOf(tr *trader) int64 { return tr.c.C.Coin }

// The bank: deposits rank members, a member draws at cost up to half of
// what it gave unless an officer allows more, a large payment waits for a
// second officer, and a season's close clears the season's ranks.
func TestGuildBankPaymentsAndRanks(t *testing.T) {
	g, ts := society(t, 10)
	leader, second, member := ts[0], ts[1], ts[2]
	gd := g.Guilds[0]
	leader.must(game.Command{Kind: game.Promote, Target: second.c.C.ID})
	if !gd.G.IsOfficer(second.c.C.ID) {
		t.Fatal("a guild of ten has room for a second officer")
	}
	unchanged(t, member, "a member naming an officer", game.Command{Kind: game.Promote, Target: member.c.C.ID})

	value := g.Rules().Values.Asset(ledger.Provisions)
	member.grant(ledger.Provisions, 40)
	member.grant(ledger.Coin, 1000)
	member.must(game.Command{Kind: game.Deposit, Asset: ledger.Provisions, Units: 40})
	member.must(game.Command{Kind: game.Deposit, Asset: ledger.Coin, Units: 700})
	if m := gd.G.Member(member.c.C.ID); m.Put != 700+40*value || m.Season != m.Put || gd.G.Rank(true)[0].Char != member.c.C.ID {
		t.Fatalf("after deposits: %+v", m)
	}

	other := ts[3]
	other.grant(ledger.Coin, 100)
	unchanged(t, other, "a draw by a member who gave nothing", game.Command{Kind: game.Draw, Asset: ledger.Provisions, Units: 1})
	unchanged(t, member, "a member setting who may draw", game.Command{Kind: game.Allow, Target: other.c.C.ID, Units: 1})
	second.must(game.Command{Kind: game.Allow, Target: other.c.C.ID, Units: 1})
	before := coinOf(other)
	other.must(game.Command{Kind: game.Draw, Asset: ledger.Provisions, Units: 10})
	if other.c.C.Provisions != 10 || coinOf(other) != before-10*value {
		t.Fatalf("a draw at cost left %d provisions and took %d coin", other.c.C.Provisions, before-coinOf(other))
	}

	spend := sheets.IntParam(g.Rules().Book.SettlementParams, "officer-spend")
	leader.must(game.Command{Kind: game.Pay, Target: other.c.C.ID, Asset: ledger.Coin, Units: spend + 100})
	if len(gd.G.Approvals) != 1 || coinOf(other) != before-10*value {
		t.Fatalf("a payment past the day's limit went out: %+v", gd.G.Approvals)
	}
	unchanged(t, leader, "an officer approving its own payment", game.Command{Kind: game.Approve, Option: gd.G.Approvals[0].ID})
	second.must(game.Command{Kind: game.Approve, Option: gd.G.Approvals[0].ID})
	if coinOf(other) != before-10*value+spend+100 {
		t.Fatalf("the approved payment did not arrive: %d coin", coinOf(other))
	}
	if got := gd.G.SpentToday(second.c.C.ID, g.World.Day); got != 0 {
		t.Fatalf("approving another officer's payment counted %d coin against the approver's day", got)
	}

	toSeasonEnd(t, g)
	if m := gd.G.Member(member.c.C.ID); m.Season != 0 || m.Put == 0 {
		t.Fatalf("a season's close left %+v", m)
	}
	audit(t, g)
}

// A work eats its stock from the bank each world day and lapses the day
// the bank runs short.
func TestGuildWorkStocksAndLapses(t *testing.T) {
	g, ts := society(t, 2)
	officer, member := ts[0], ts[1]
	gd := g.Guilds[0]
	var uses int64
	for _, w := range g.Rules().Book.GuildWorks {
		if w.ID == "road-patrol" {
			uses = w.Uses[0].Quantity
		}
	}
	unchanged(t, member, "a member switching a work on", game.Command{Kind: game.Work, Option: "road-patrol", Units: 1})
	unchanged(t, officer, "a work that needs a structure not built", game.Command{Kind: game.Work, Option: "full-granary", Units: 1})
	member.grant(ledger.Provisions, uses*2)
	member.must(game.Command{Kind: game.Deposit, Asset: ledger.Provisions, Units: uses * 2})
	officer.must(game.Command{Kind: game.Work, Option: "road-patrol", Units: 1})
	home, _ := g.SettlementAt(officer.c.C.At)
	if _, w := g.WorkRunning(home, "road-patrol"); w != nil {
		t.Fatal("a work runs before the bank has fed it")
	}
	advanceDays(t, g, 2)
	if left := g.Ledger.Of(gd.Pool(), ledger.Provisions); left != 0 || len(gd.G.Works) != 1 {
		t.Fatalf("after two stocked days the bank holds %d provisions and %d works run", left, len(gd.G.Works))
	}
	worth := uses * g.Rules().Values.Param("provisions-value")
	if _, w := g.WorkRunning(home, "road-patrol"); w == nil || w.Left != worth || w.Used != 2*worth {
		t.Fatalf("a stocked work may give back %+v, want the %d coin its day's stock was worth and two days consumed", w, worth)
	}
	advanceDays(t, g, 1)
	if len(gd.G.Works) != 0 {
		t.Fatal("a work with no stock still runs")
	}
	audit(t, g)
}

// Guilds across servers: founding under a name, inviting, joining and
// leaving; a name the board refuses is refused.
func TestFoundInviteJoinLeave(t *testing.T) {
	g, ts := society(t, 3)
	a, b, c := ts[0], ts[1], ts[2]
	bad := g.Rules().Book.Words[0].ID
	unchanged(t, b, "a guild under a screened name", game.Command{Kind: game.FoundGuild, Note: "The " + bad + " company"})
	unchanged(t, b, "a guild under a taken name", game.Command{Kind: game.FoundGuild, Note: g.Guilds[0].G.Name})
	b.must(game.Command{Kind: game.FoundGuild, Note: "The Free Company"})
	free := g.GuildOf(b.c.C.Guild)
	if free == nil || free.G.Server != "" || free.G.Leader != b.c.C.ID || g.Guilds[0].G.Member(b.c.C.ID) != nil {
		t.Fatalf("founding left %+v", free)
	}
	unchanged(t, c, "joining without an invitation", game.Command{Kind: game.Join, Target: free.G.ID})
	unchanged(t, a, "an outsider inviting", game.Command{Kind: game.Invite, Target: c.c.C.ID})
	b.must(game.Command{Kind: game.Invite, Target: c.c.C.ID})
	c.must(game.Command{Kind: game.Join, Target: free.G.ID})
	if c.c.C.Guild != free.G.ID || len(free.G.Members) != 2 {
		t.Fatalf("after joining: %q, %d members", c.c.C.Guild, len(free.G.Members))
	}
	c.must(game.Command{Kind: game.Leave})
	if c.c.C.Guild != "" || len(free.G.Members) != 1 {
		t.Fatalf("after leaving: %q, %d members", c.c.C.Guild, len(free.G.Members))
	}
}

// freeTile is a passable tile with nothing on it, the founding distance
// from every settlement.
func freeTile(t *testing.T, g *game.Game, from hex.Hex) hex.Hex {
	t.Helper()
	r := g.Rules()
	far := sheets.IntParam(r.Book.SettlementParams, "found-distance")
	for _, h := range hex.DiscAt(from, far*2) {
		b := r.Gen.Baseline(h)
		if b.Site != "" || !r.Gen.Passable(b.Terrain) || g.IsSettlement(h) {
			continue
		}
		ok := true
		for _, o := range hex.DiscAt(h, far-1) {
			ok = ok && !g.IsSettlement(o)
		}
		if ok {
			return h
		}
	}
	t.Fatal("no free tile to found on")
	return hex.Hex{}
}

// Founding a settlement takes a full guild, the charter from its treasury
// and its officer's timber and stone; the new settlement is one to rest,
// trade and repair in.
func TestFoundASettlement(t *testing.T) {
	g, ts := society(t, 5)
	officer, member := ts[0], ts[1]
	gd := g.Guilds[0]
	sp := func(id string) int64 { return sheets.IntParam(g.Rules().Book.SettlementParams, id) }
	timber, stone := materialWith(t, g, "timber"), materialWith(t, g, "stone")
	site := freeTile(t, g, officer.c.C.At)
	officer.c.C.At = site
	unchanged(t, officer, "founding without the charter's coin", game.Command{Kind: game.Found, Note: "Reedhold"})
	member.grant(ledger.Coin, sp("charter-coin"))
	member.must(game.Command{Kind: game.Deposit, Asset: ledger.Coin, Units: sp("charter-coin")})
	unchanged(t, officer, "founding without timber and stone", game.Command{Kind: game.Found, Note: "Reedhold"})
	officer.grant(ledger.Material(timber), sp("charter-timber"))
	officer.grant(ledger.Material(stone), sp("charter-stone"))
	bad := g.Rules().Book.Words[0].ID
	unchanged(t, officer, "founding under a screened name", game.Command{Kind: game.Found, Note: bad})
	member.c.C.At = site
	unchanged(t, member, "a member founding", game.Command{Kind: game.Found, Note: "Reedhold"})
	officer.must(game.Command{Kind: game.Found, Note: "Reedhold"})

	p := g.PlaceAt(site)
	if p == nil || p.Guild != gd.G.ID || p.Name != "Reedhold" || !p.Open("market") || !p.Open("forge") {
		t.Fatalf("founded %+v", p)
	}
	if _, ok := g.MarketAt(site); !ok || !g.CanRest(site) || !g.IsSettlement(site) {
		t.Fatal("a founded settlement is not one to trade and rest in")
	}
	if got := g.Ledger.Of(game.TreasuryPool(p.N), ledger.Coin); got != sp("charter-coin") {
		t.Fatalf("the charter's coin: %d in the new treasury", got)
	}
	if !gd.G.MaySpend(officer.c.C.ID, g.World.Day, sp("officer-spend"), g.Rules().Guild) {
		t.Fatal("the charter's coin counted against its officer's day")
	}
	unchanged(t, officer, "a second settlement beside the first", game.Command{Kind: game.Found, Note: "Too close"})

	// Repair costs a share of what a tier of the structure is worth.
	p.Get("forge").Condition = 60
	unchanged(t, member, "a repair with nothing to pay it", game.Command{Kind: game.Mend, Slot: "forge", Units: 40})
	for _, tag := range []string{"stone", "timber", "metal"} {
		member.grant(ledger.Material(materialWith(t, g, tag)), 200)
	}
	member.must(game.Command{Kind: game.Mend, Slot: "forge", Units: 40})
	if p.Get("forge").Condition != sp("condition-max") {
		t.Fatalf("the forge is at %d after repair", p.Get("forge").Condition)
	}
	if left := g.Ledger.Of(ledger.Char(member.c.C.ID), ledger.Material(stone)); left >= 200 {
		t.Fatal("the repair took no stone")
	}
	audit(t, g)
}

// A second server's guild waits for the next starting settlement the
// world opens, and its early arrivals call it home once it does.
func TestASecondServerTakesTheNextSettlement(t *testing.T) {
	g, _ := society(t, 1)
	res, err := g.Act(game.Command{Key: "other", Kind: game.Create, Option: "hook", Server: "s2", Note: "The Saltbinders"})
	if err != nil {
		t.Fatal(err)
	}
	early := res.Char
	second := g.ServerGuild("s2")
	if second == nil || second == g.Guilds[0] {
		t.Fatal("a second server did not get its own guild")
	}
	advanceDays(t, g, 2)
	n := -1
	for i, p := range g.Places {
		if p.Guild == second.G.ID {
			n = i
		}
	}
	if n <= 0 || second.Waiting {
		t.Fatalf("the second guild runs settlement %d of %d (waiting %v)", n, len(g.Places), second.Waiting)
	}
	if g.HomeOf(early) != n || early.C.Home != fmt.Sprintf("settlement:%d", n) {
		t.Fatalf("an early arrival's home is %q, its guild's settlement %d", early.C.Home, n)
	}
}

// A Hold counts its days on the region it names, whichever board it
// hangs on.
func TestHoldOnAnotherRegionCountsItsDays(t *testing.T) {
	g, ts := society(t, 2)
	home := g.World.RegionAt(ts[0].c.C.At)
	other := (home + 1) % len(g.World.Regions)
	if other == home {
		t.Fatal("the world has one region")
	}
	threat := g.World.Regions[other].Gauge[g.World.GaugeIndex("threat")]
	x := proposal(t, g, ts, game.GoalSpec{Title: "Keep the far marsh quiet", Issuer: goal.BySettlement, Mode: goal.Pooled, Lifetime: goal.Season,
		Turnover: goal.Evolve, Cond: goal.Condition{Verb: goal.Hold, Gauge: "threat", Line: threat + 300, Below: true, Count: 3, At: "region:" + world.RegionRef(other)}})
	advanceDays(t, g, 4)
	met(t, x)
	audit(t, g)
}

// A server's admins are whoever its own server says they are: a press
// from another server makes nobody one, and a permission lost is cleared.
func TestAdminsFollowTheirOwnServer(t *testing.T) {
	g, ts := society(t, 2)
	gd, member := g.Guilds[0], ts[1]
	member.must(game.Command{Kind: game.Look, Server: "s2", Admin: true})
	if gd.G.IsOfficer(member.c.C.ID) {
		t.Fatal("an admin of another server became an officer")
	}
	member.must(game.Command{Kind: game.Look, Admin: true})
	if gd.G.IsOfficer(member.c.C.ID) {
		t.Fatal("a command from no server made an admin")
	}
	member.must(game.Command{Kind: game.Look, Server: "s1", Admin: true})
	if m := gd.G.Member(member.c.C.ID); !m.Admin || !gd.G.IsOfficer(m.Char) || gd.G.Removable(m.Char, "officer") {
		t.Fatalf("the server's admin is %+v", m)
	}
	member.must(game.Command{Kind: game.Look, Server: "s2"})
	if !gd.G.Member(member.c.C.ID).Admin {
		t.Fatal("a press from another server cleared an admin")
	}
	// The mark governs the command that carries it.
	member.must(game.Command{Kind: game.Look, Server: "s1"})
	allow := game.Command{Kind: game.Allow, Target: ts[0].c.C.ID, Units: 1, Server: "s1", Admin: true}
	member.must(allow)
	allow.Admin = false
	unchanged(t, member, "an officer's command from an admin whose permission is gone", allow)
	member.must(game.Command{Kind: game.Look, Server: "s1"})
	if gd.G.IsOfficer(member.c.C.ID) {
		t.Fatal("an admin whose permission is gone is still an officer")
	}
}

// A muster's coin is an officer's spend: one over what is left of the
// day is refused, and one posted counts against it.
func TestMustersCountAgainstTheOfficersDay(t *testing.T) {
	g, ts := society(t, 2)
	officer, member := ts[0], ts[1]
	gd := g.Guilds[0]
	treasury(t, g, officer, member, 40)
	spend := sheets.IntParam(g.Rules().Book.SettlementParams, "officer-spend")
	muster := func(reward int64) *game.GoalSpec {
		return &game.GoalSpec{Title: "Find the next seam", Issuer: goal.ByAdmin, Reward: reward, Mode: goal.First, Lifetime: goal.Standing,
			Turnover: goal.Keep, Cond: goal.Condition{Verb: goal.Reach, Count: 1, At: away(officer)}}
	}
	x := post(officer, *muster(10))
	if got := gd.G.SpentToday(officer.c.C.ID, g.World.Day); got != 10+x.Fee {
		t.Fatalf("a muster of 10 coin and a %d coin fee counted %d against its officer", x.Fee, got)
	}
	member.grant(ledger.Coin, spend)
	member.must(game.Command{Kind: game.Deposit, Asset: ledger.Coin, Units: spend})
	officer.must(game.Command{Kind: game.Pay, Target: member.c.C.ID, Asset: ledger.Coin, Units: spend - 10 - x.Fee})
	unchanged(t, officer, "a muster past the officer's day", game.Command{Kind: game.PostGoal, Goal: muster(10)})
	unchanged(t, officer, "a rewarded raise past the officer's day", game.Command{Kind: game.Raise, Slot: "wall", Price: 10})
	if got := g.RaiseMost(officer.c, "wall"); got != 0 {
		t.Fatalf("its day spent, an officer is told a raise may carry %d coin a line", got)
	}
	audit(t, g)
}

// The most an officer is told a raise's lines may carry is what the raise
// takes: one coin more on each is refused, by the treasury or by its day.
func TestTheMostARaiseMayCarry(t *testing.T) {
	g, ts := society(t, 2)
	officer, member := ts[0], ts[1]
	if got := g.RaiseMost(officer.c, "wall"); got != 0 {
		t.Fatalf("an empty treasury covers %d coin a line", got)
	}
	if got := g.RaiseMost(member.c, "wall"); got != 0 {
		t.Fatalf("a member who is no officer is told %d coin a line", got)
	}
	treasury(t, g, officer, member, 60)
	before, _ := g.Digest()
	most := g.RaiseMost(officer.c, "wall")
	if after, _ := g.Digest(); after != before {
		t.Fatal("asking what a raise may carry changed the game")
	}
	if least := sheets.IntParam(g.Rules().Book.GoalParams, "reward-least"); most < least {
		t.Fatalf("a treasury of %d coin covers %d coin a line", g.Ledger.Of(game.TreasuryPool(0), ledger.Coin), most)
	}
	unchanged(t, officer, "a raise one coin a line over the most", game.Command{Kind: game.Raise, Slot: "wall", Price: most + 1})
	officer.must(game.Command{Kind: game.Raise, Slot: "wall", Price: most})
	if x := lastGoal(g); x.Build == nil || x.Reward != most {
		t.Fatalf("the raise's line carries %d coin, not %d", x.Reward, most)
	}
	audit(t, g)
}

// A raise one of whose lines is withdrawn ends whole, and the structure
// can be raised again.
func TestAWithdrawnLineEndsItsRaise(t *testing.T) {
	g, ts := society(t, 2)
	officer, member := ts[0], ts[1]
	p := g.Places[0]
	kind := ""
	for i := range g.Rules().Book.Structures {
		row := &g.Rules().Book.Structures[i]
		if _, lines, ok := p.Next(row, g.Rules().Settle); ok && len(lines) > 1 {
			kind = row.ID
			break
		}
	}
	if kind == "" {
		t.Fatal("no structure is raised by more than one line")
	}
	tier := int64(0)
	if st := p.Get(kind); st != nil {
		tier = st.Tier
	}
	before := len(g.Goals)
	officer.must(game.Command{Kind: game.Raise, Slot: kind})
	first := g.Goals[before:]
	officer.must(game.Command{Kind: game.WithdrawGoal, Target: first[0].ID})
	for _, x := range first {
		if x.State != goal.Ended {
			t.Fatalf("line %s of a withdrawn raise is %s", x.ID, x.State)
		}
	}
	before = len(g.Goals)
	officer.must(game.Command{Kind: game.Raise, Slot: kind})
	second := g.Goals[before:]
	for i, x := range second {
		if x.Build.Project == first[0].Build.Project {
			t.Fatal("a second raise shares the first one's project")
		}
		m := materialWith(t, g, x.Cond.Tag)
		member.grant(ledger.Material(m), x.Cond.Count)
		member.must(game.Command{Kind: game.DeliverGoal, Target: x.ID, Material: m, Units: x.Cond.Count})
		// A met line's goods are built in: the rest can no longer be withdrawn from under them.
		if i == 0 {
			unchanged(t, officer, "withdrawing a raise with a line built in", game.Command{Kind: game.WithdrawGoal, Target: second[len(second)-1].ID})
		}
	}
	if st := p.Get(kind); st == nil || st.Tier != tier+1 {
		t.Fatalf("the %s did not rise from tier %d: %+v", kind, tier, st)
	}
	audit(t, g)
}

// An approval the bank can no longer cover is refused and still waits.
func TestARefusedApprovalStillWaits(t *testing.T) {
	g, ts := society(t, 10)
	leader, second, member := ts[0], ts[1], ts[2]
	gd := g.Guilds[0]
	spend := sheets.IntParam(g.Rules().Book.SettlementParams, "officer-spend")
	leader.must(game.Command{Kind: game.Promote, Target: second.c.C.ID})
	member.grant(ledger.Coin, spend+200)
	member.must(game.Command{Kind: game.Deposit, Asset: ledger.Coin, Units: spend + 200})
	leader.must(game.Command{Kind: game.Pay, Target: member.c.C.ID, Asset: ledger.Coin, Units: spend + 100})
	leader.must(game.Command{Kind: game.Pay, Target: member.c.C.ID, Asset: ledger.Coin, Units: spend})
	unchanged(t, second, "an approval the treasury cannot cover", game.Command{Kind: game.Approve, Option: gd.G.Approvals[0].ID})
	if len(gd.G.Approvals) != 1 {
		t.Fatal("a refused approval was taken")
	}
	audit(t, g)
}

// A leader voted out does not succeed itself.
func TestAVotedOutLeaderIsReplaced(t *testing.T) {
	g, ts := society(t, 5)
	gd, leader := g.Guilds[0], ts[0]
	advanceDays(t, g, 1)
	for _, tr := range ts {
		tr.must(game.Command{Kind: game.Look})
	}
	for _, tr := range ts[1:] {
		tr.must(game.Command{Kind: game.Vote, Target: leader.c.C.ID, Option: "leader"})
	}
	if gd.G.Leader == leader.c.C.ID || gd.G.Leader == "" || gd.G.IsOfficer(leader.c.C.ID) {
		t.Fatalf("after four of five voted the leader out, the leader is %q", gd.G.Leader)
	}
}

// A vow to hold off a thing holds no coin: neither a reward nor a
// settlement's pledges.
func TestAVowTakesNoCoin(t *testing.T) {
	g, ts := society(t, 1)
	ts[0].grant(ledger.Coin, 100)
	vow := game.GoalSpec{Title: "No blade this season", Issuer: goal.ByCharacter, Reward: 20, Mode: goal.First, Lifetime: goal.Season,
		Turnover: goal.Expire, Cond: goal.Condition{Verb: goal.Hold, Tag: "blade"}}
	unchanged(t, ts[0], "a vow with a reward", game.Command{Kind: game.PostGoal, Goal: &vow})
	vow.Reward, vow.Issuer = 0, goal.BySettlement
	unchanged(t, ts[0], "a settlement's vow", game.Command{Kind: game.PostGoal, Goal: &vow})
	audit(t, g)
}

// A Haul pays one hauler, and only someone it is for may take it.
func TestAHaulIsForOneOfItsOwn(t *testing.T) {
	g, ts := society(t, 3)
	poster, friend, stranger := ts[0], ts[1], ts[2]
	timber := materialWith(t, g, "timber")
	poster.grant(ledger.Material(timber), 20)
	poster.grant(ledger.Coin, 500)
	haul := game.GoalSpec{Title: "Timber east", Issuer: goal.ByParty, Members: []string{friend.c.C.ID}, Reward: 10, Mode: goal.Each, Cap: 3,
		Lifetime: goal.Standing, Turnover: goal.Keep, Material: timber, Units: 20,
		Cond: goal.Condition{Verb: goal.Haul, From: here(g, poster), At: away(poster), Count: 20}}
	unchanged(t, poster, "an Each haul", game.Command{Kind: game.PostGoal, Goal: &haul})
	haul.Mode, haul.Cap = goal.First, 0
	x := post(poster, haul)
	stranger.grant(ledger.Coin, 500)
	unchanged(t, stranger, "a party's haul taken by a stranger", game.Command{Kind: game.TakeHaul, Target: x.ID})
	if g.HaulHere(x, stranger.c) != "" || g.HaulHere(x, friend.c) != "take" {
		t.Fatal("the haul is offered to the wrong hands")
	}
	friend.grant(ledger.Coin, 500)
	friend.must(game.Command{Kind: game.TakeHaul, Target: x.ID})
	audit(t, g)
}

// A goal ends at the tick its time runs out, and a call for help when its
// caller has crawled out.
func TestGoalsEndWhenTheirTimeRunsOut(t *testing.T) {
	g, ts := society(t, 2)
	poster, downed := ts[0], ts[1]
	least := sheets.IntParam(g.Rules().Book.GoalParams, "ephemeral-least")
	poster.grant(ledger.Coin, 50)
	x := post(poster, game.GoalSpec{Title: "Quick", Issuer: goal.ByCharacter, Reward: 10, Mode: goal.First, Lifetime: goal.Ephemeral, Turnover: goal.Expire,
		Ticks: least, Cond: goal.Condition{Verb: goal.Reach, Count: 1, At: away(poster)}})
	held := poster.c.C.Coin
	for range least {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	if x.State != goal.Ended || poster.c.C.Coin != held+10 {
		t.Fatalf("after its %d ticks the goal is %s and its poster holds %d coin, was %d", least, x.State, poster.c.C.Coin, held)
	}
	unchanged(t, downed, "a pledge to a goal past its time", game.Command{Kind: game.Pledge, Target: x.ID, Units: 1})

	// A purse of exactly the rescue reward offers what it covers after the
	// listing fee.
	rescue := sheets.IntParam(g.Rules().Book.GoalParams, "rescue-reward")
	downed.grant(ledger.Coin, rescue-downed.c.C.Coin)
	downed.c.C.Set(char.Down, 0)
	downed.must(game.Command{Kind: game.CallHelp})
	help := lastGoal(g)
	if help.Reward <= 0 || help.Reward+help.Fee != rescue {
		t.Fatalf("a purse of %d coin offers %d and a fee of %d", rescue, help.Reward, help.Fee)
	}
	for downed.c.Long != nil {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	if g.Called(downed.c) || help.State != goal.Ended || downed.c.C.Coin != rescue-help.Fee {
		t.Fatalf("crawled out with the call %s and %d coin", help.State, downed.c.C.Coin)
	}
	audit(t, g)
}

// A guild under its members' least takes no settlement by charter.
func TestACharterNeedsAFullGuild(t *testing.T) {
	g, ts := newTraders(t, 1)
	ts[0].must(game.Command{Kind: game.FoundGuild, Note: "The Free Company"})
	if g.CharterAt(ts[0].c).Can {
		t.Fatal("a guild of one may charter")
	}
	unchanged(t, ts[0], "a charter by a guild of one", game.Command{Kind: game.Charter})
}

// A founded guild its last member leaves gives up its settlements and
// what it held.
func TestAGuildNobodyIsInIsOver(t *testing.T) {
	g, ts := society(t, 5)
	founder := ts[0]
	sp := func(id string) int64 { return sheets.IntParam(g.Rules().Book.SettlementParams, id) }
	founder.must(game.Command{Kind: game.FoundGuild, Note: "The Free Company"})
	gd := g.GuildOf(founder.c.C.Guild)
	for _, tr := range ts[1:] {
		founder.must(game.Command{Kind: game.Invite, Target: tr.c.C.ID})
		tr.must(game.Command{Kind: game.Join, Target: gd.G.ID})
	}
	founder.grant(ledger.Coin, sp("charter-coin")+70)
	founder.must(game.Command{Kind: game.Deposit, Asset: ledger.Coin, Units: sp("charter-coin") + 70})
	founder.grant(ledger.Material(materialWith(t, g, "timber")), sp("charter-timber"))
	founder.grant(ledger.Material(materialWith(t, g, "stone")), sp("charter-stone"))
	founder.c.C.At = freeTile(t, g, founder.c.C.At)
	founder.must(game.Command{Kind: game.Found, Note: "Reedhold"})
	p := g.PlaceAt(founder.c.C.At)
	muster := post(founder, game.GoalSpec{Title: "Stone for the yard", Issuer: goal.ByAdmin, Mode: goal.Pooled, Lifetime: goal.Standing, Turnover: goal.Keep,
		Cond: goal.Condition{Verb: goal.Deliver, Tag: "stone", Count: 50, At: here(g, founder)}})
	for _, tr := range ts {
		tr.must(game.Command{Kind: game.Leave})
	}
	if p.Guild != "" || g.Ledger.Of(gd.Pool(), ledger.Coin) != 0 || g.Ledger.Of(game.TreasuryPool(p.N), ledger.Coin) != sp("charter-coin")+70 {
		t.Fatalf("an empty guild still runs %q with %d coin; the treasury holds %d", p.Guild, g.Ledger.Of(gd.Pool(), ledger.Coin), g.Ledger.Of(game.TreasuryPool(p.N), ledger.Coin))
	}
	if muster.State != goal.Ended || muster.Why != "disbanded" {
		t.Fatalf("a guild that is over still has a muster up: %s (%s)", muster.State, muster.Why)
	}
	// The settlement it founded can be run again, by charter.
	founder.must(game.Command{Kind: game.FoundGuild, Note: "The Second Company"})
	for _, tr := range ts[1:] {
		founder.must(game.Command{Kind: game.Invite, Target: tr.c.C.ID})
		tr.must(game.Command{Kind: game.Join, Target: founder.c.C.Guild})
	}
	if view := g.CharterAt(founder.c); !view.Take || view.Why == "a guild already runs this settlement" {
		t.Fatalf("a settlement nobody runs is not offered by charter: %+v", view)
	}
	stranger := ts[1]
	stranger.c.C.At = p.Hex
	p.Get("forge").Condition = 60
	for _, tag := range []string{"stone", "timber", "metal"} {
		stranger.grant(ledger.Material(materialWith(t, g, tag)), 200)
	}
	stranger.must(game.Command{Kind: game.Mend, Slot: "forge", Units: 40})
	audit(t, g)
}

// Nobody pays to raise what no rule reads yet: a structure whose system
// waits, or a tier up of one whose tiers do.
func TestWaitingStructuresAreNotRaised(t *testing.T) {
	g, ts := society(t, 2)
	officer, member := ts[0], ts[1]
	p := g.Places[0]
	var whole, tiers int
	for i := range g.Rules().Book.Structures {
		row := &g.Rules().Book.Structures[i]
		_, _, ok := p.Next(row, g.Rules().Settle)
		switch {
		case !ok:
		case row.Waits != "":
			whole++
			unchanged(t, officer, "raising the "+row.ID+", which waits", game.Command{Kind: game.Raise, Slot: row.ID})
		case row.TiersWait != "" && p.Get(row.ID) != nil:
			tiers++
			unchanged(t, officer, "a tier up of the "+row.ID+", which waits", game.Command{Kind: game.Raise, Slot: row.ID})
		}
	}
	if whole == 0 || tiers == 0 {
		t.Fatalf("%d structures and %d tiers wait: drop the half of this test nothing waits for", whole, tiers)
	}
	// Raids read every tier of the wall, so its second rises too.
	timber := materialWith(t, g, "timber")
	officer.must(game.Command{Kind: game.Raise, Slot: "wall"})
	x := lastGoal(g)
	member.grant(ledger.Material(timber), x.Cond.Count)
	member.must(game.Command{Kind: game.DeliverGoal, Target: x.ID, Material: timber, Units: x.Cond.Count})
	if !p.Open("wall") {
		t.Fatal("the wall's first tier did not rise")
	}
	for i := range g.Rules().Book.Structures {
		row := &g.Rules().Book.Structures[i]
		if waits := game.RaiseWaits(p, row); (row.ID == "wall" || row.ID == "forge") && waits != "" {
			t.Fatalf("the %s's next tier waits for %q", row.ID, waits)
		}
	}
	stone := materialWith(t, g, "stone")
	officer.must(game.Command{Kind: game.Raise, Slot: "wall"})
	y := lastGoal(g)
	member.grant(ledger.Material(stone), y.Cond.Count)
	member.must(game.Command{Kind: game.DeliverGoal, Target: y.ID, Material: stone, Units: y.Cond.Count})
	if w := p.Get("wall"); w == nil || w.Tier != 2 {
		t.Fatalf("the wall's second tier did not rise: %+v", w)
	}
	audit(t, g)
}

// Goods go into and out of the bank only at a settlement the guild runs,
// and are paid only to someone standing there; coin moves from anywhere.
func TestTheBankIsAPlace(t *testing.T) {
	g, ts := society(t, 10)
	leader, second, member := ts[0], ts[1], ts[2]
	gd := g.Guilds[0]
	home := leader.c.C.At
	away := home.Neighbour(0)
	spend := sheets.IntParam(g.Rules().Book.SettlementParams, "officer-spend")
	value := g.Rules().Values.Asset(ledger.Provisions)
	leader.must(game.Command{Kind: game.Promote, Target: second.c.C.ID})
	over := spend/value + 1
	member.grant(ledger.Provisions, over+40)
	member.grant(ledger.Coin, 100)

	member.c.C.At = away
	unchanged(t, member, "goods given to the bank from the road", game.Command{Kind: game.Deposit, Asset: ledger.Provisions, Units: 40})
	member.must(game.Command{Kind: game.Deposit, Asset: ledger.Coin, Units: 50})
	if g.BankHere(member.c) {
		t.Fatal("the bank is in reach away from the guild's settlement")
	}
	member.c.C.At = home
	member.must(game.Command{Kind: game.Deposit, Asset: ledger.Provisions, Units: over + 40})
	if !g.BankHere(member.c) || g.Ledger.Of(gd.Pool(), ledger.Provisions) != over+40 {
		t.Fatalf("at home the bank holds %d provisions", g.Ledger.Of(gd.Pool(), ledger.Provisions))
	}
	if !g.CanPayGoods(gd, leader.c, member.c.C.ID) || g.CanPayGoods(gd, member.c, leader.c.C.ID) {
		t.Fatal("at the bank an officer, and only an officer, may hand a member goods")
	}

	member.c.C.At = away
	if g.DrawMost(gd, member.c, ledger.Provisions) != 0 || g.CanPayGoods(gd, leader.c, member.c.C.ID) {
		t.Fatal("goods are offered to someone on the road")
	}
	unchanged(t, member, "a draw from the road", game.Command{Kind: game.Draw, Asset: ledger.Provisions, Units: 1})
	unchanged(t, leader, "goods paid to someone on the road", game.Command{Kind: game.Pay, Target: member.c.C.ID, Asset: ledger.Provisions, Units: 5})
	leader.must(game.Command{Kind: game.Pay, Target: member.c.C.ID, Asset: ledger.Coin, Units: 10})
	member.c.C.At, leader.c.C.At = home, away
	unchanged(t, leader, "goods paid by an officer on the road", game.Command{Kind: game.Pay, Target: member.c.C.ID, Asset: ledger.Provisions, Units: 5})
	leader.c.C.At = home
	member.must(game.Command{Kind: game.Draw, Asset: ledger.Provisions, Units: 1})
	leader.must(game.Command{Kind: game.Pay, Target: member.c.C.ID, Asset: ledger.Provisions, Units: 5})
	if member.c.C.Provisions != 6 {
		t.Fatalf("at the bank a draw and a payment left the member %d provisions", member.c.C.Provisions)
	}

	// A payment over the officer's day is approved at the bank too.
	leader.must(game.Command{Kind: game.Pay, Target: member.c.C.ID, Asset: ledger.Provisions, Units: over})
	if len(gd.G.Approvals) != 1 {
		t.Fatalf("a payment past the day's limit left %d approvals", len(gd.G.Approvals))
	}
	ask := game.Command{Kind: game.Approve, Option: gd.G.Approvals[0].ID}
	second.c.C.At = away
	unchanged(t, second, "goods approved from the road", ask)
	second.c.C.At, member.c.C.At = home, away
	unchanged(t, second, "goods approved for someone on the road", ask)
	member.c.C.At = home
	second.must(ask)
	if member.c.C.Provisions != 6+over {
		t.Fatalf("the approved goods did not arrive: %d provisions", member.c.C.Provisions)
	}
	audit(t, g)
}

// The most a member is told it may draw is what a draw takes and no more:
// held by its share of what it gave, by its coin and by the stock, and by
// neither share nor gift once an officer allows it.
func TestTheMostAMemberMayDraw(t *testing.T) {
	g, ts := society(t, 3)
	leader, member, other := ts[0], ts[1], ts[2]
	gd := g.Guilds[0]
	value := g.CostEach(ledger.Provisions)
	share := sheets.IntParam(g.Rules().Book.SettlementParams, "draw-share")
	member.grant(ledger.Provisions, 40)
	member.must(game.Command{Kind: game.Deposit, Asset: ledger.Provisions, Units: 40})
	draw := func(units int64) game.Command {
		return game.Command{Kind: game.Draw, Asset: ledger.Provisions, Units: units}
	}

	byShare := 40 * share / 100
	if byShare <= 1 || byShare >= 40 {
		t.Fatalf("a share of %d%% does not bound a gift of 40", share)
	}
	member.grant(ledger.Coin, value)
	if got := g.DrawMost(gd, member.c, ledger.Provisions); got != 1 {
		t.Fatalf("with coin for one, the most to draw is %d", got)
	}
	member.grant(ledger.Coin, 40*value)
	most := g.DrawMost(gd, member.c, ledger.Provisions)
	if most != byShare {
		t.Fatalf("a member who gave 40 may draw %d, not its share of %d", most, byShare)
	}
	unchanged(t, member, "a draw of one more than the most", draw(most+1))
	member.must(draw(most))
	if got := g.DrawMost(gd, member.c, ledger.Provisions); got != 0 {
		t.Fatalf("its share drawn, the most is %d", got)
	}

	other.grant(ledger.Coin, 100*value)
	if got := g.DrawMost(gd, other.c, ledger.Provisions); got != 0 {
		t.Fatalf("a member who gave nothing may draw %d", got)
	}
	leader.must(game.Command{Kind: game.Allow, Target: other.c.C.ID, Units: 1})
	left := g.Ledger.Of(gd.Pool(), ledger.Provisions)
	if got := g.DrawMost(gd, other.c, ledger.Provisions); got != left {
		t.Fatalf("allowed to draw freely, the most is %d of the %d the bank holds", got, left)
	}
	unchanged(t, other, "a draw of more than the bank holds", draw(left+1))
	other.must(draw(left))
	audit(t, g)
}

// Goods a goal hands its poster wait where they were handed over until
// the poster acts there: delivered, hauled, or a haul's stock given back.
func TestDeliveredGoodsWaitForThePoster(t *testing.T) {
	g, ts := society(t, 2)
	poster, runner := ts[0], ts[1]
	home := poster.c.C.At
	far := home.Neighbour(0)
	fibre, timber := materialWith(t, g, "fibre"), materialWith(t, g, "timber")
	held := func(asset string) int64 { return g.Ledger.Of(ledger.Char(poster.c.C.ID), asset) }
	poster.grant(ledger.Coin, 500)
	runner.grant(ledger.Coin, 500)
	runner.grant(ledger.Material(fibre), 40)
	x := post(poster, game.GoalSpec{Title: "Forty fibre", Issuer: goal.ByCharacter, Reward: 50, Mode: goal.First, Lifetime: goal.Standing,
		Turnover: goal.Keep, Cond: goal.Condition{Verb: goal.Deliver, Tag: "fibre", Count: 40, At: here(g, poster)}})

	poster.c.C.At = far
	runner.must(game.Command{Kind: game.DeliverGoal, Target: x.ID, Material: fibre, Units: 40})
	met(t, x)
	waits := g.WaitingFor(poster.c)
	if held(ledger.Material(fibre)) != 0 || len(waits) != 1 || waits[0].At != home || waits[0].Goods[0].Units != 40 {
		t.Fatalf("delivered while away: the poster carries %d fibre and %+v waits", held(ledger.Material(fibre)), waits)
	}
	audit(t, g)

	// Acting anywhere else collects nothing, and nothing is lost by waiting.
	poster.must(game.Command{Kind: game.Look})
	advanceDays(t, g, 3)
	if waits := g.WaitingFor(poster.c); held(ledger.Material(fibre)) != 0 || len(waits) != 1 || waits[0].Goods[0].Units != 40 {
		t.Fatalf("after three days away the poster carries %d fibre and %+v waits", held(ledger.Material(fibre)), waits)
	}
	poster.c.C.At = home
	poster.must(game.Command{Kind: game.Look})
	if held(ledger.Material(fibre)) != 40 || len(g.WaitingFor(poster.c)) != 0 || len(poster.c.Waits) != 0 {
		t.Fatalf("back home the poster carries %d fibre and %+v still waits", held(ledger.Material(fibre)), g.WaitingFor(poster.c))
	}

	// A haul's stock waits at its end, and one withdrawn from the road
	// waits at the board it was posted on.
	poster.grant(ledger.Material(timber), 40)
	haul := game.GoalSpec{Title: "Timber out", Issuer: goal.ByCharacter, Reward: 10, Mode: goal.First, Lifetime: goal.Standing, Turnover: goal.Keep,
		Material: timber, Units: 20, Cond: goal.Condition{Verb: goal.Haul, Tag: "timber", From: here(g, poster), At: goal.TileRef(far), Count: 20}}
	y := post(poster, haul)
	runner.must(game.Command{Kind: game.TakeHaul, Target: y.ID})
	runner.c.C.At = far
	runner.must(game.Command{Kind: game.DeliverGoal, Target: y.ID})
	met(t, y)
	z := post(poster, haul)
	poster.c.C.At = home.Neighbour(1)
	poster.must(game.Command{Kind: game.WithdrawGoal, Target: z.ID})
	if held(ledger.Material(timber)) != 0 || len(g.WaitingFor(poster.c)) != 2 {
		t.Fatalf("a haul delivered and one withdrawn from the road: the poster carries %d timber and %+v waits", held(ledger.Material(timber)), g.WaitingFor(poster.c))
	}
	audit(t, g)
	for _, at := range []hex.Hex{far, home} {
		poster.c.C.At = at
		poster.must(game.Command{Kind: game.Look})
	}
	if held(ledger.Material(timber)) != 40 || len(poster.c.Waits) != 0 {
		t.Fatalf("after calling at both the poster carries %d timber", held(ledger.Material(timber)))
	}

	// Standing where it is handed over, the poster takes it at once.
	runner.grant(ledger.Material(fibre), 5)
	w := post(poster, game.GoalSpec{Title: "Five more", Issuer: goal.ByCharacter, Reward: 10, Mode: goal.First, Lifetime: goal.Standing,
		Turnover: goal.Keep, Cond: goal.Condition{Verb: goal.Deliver, Tag: "fibre", Count: 5, At: here(g, poster)}})
	runner.c.C.At = home
	runner.must(game.Command{Kind: game.DeliverGoal, Target: w.ID, Material: fibre, Units: 5})
	if held(ledger.Material(fibre)) != 45 {
		t.Fatalf("delivered to a poster standing there: %d fibre", held(ledger.Material(fibre)))
	}
	audit(t, g)
}

// A server guild is led by whoever acted on the most of the last days; a
// tie keeps the leader.
func TestAServerGuildFollowsItsMostActiveDays(t *testing.T) {
	g, ts := society(t, 3)
	gd := g.Guilds[0]
	first, daily, veteran := ts[0], ts[1], ts[2]
	every := sheets.IntParam(g.Rules().Book.SettlementParams, "server-leader-every")
	if gd.G.Leader != first.c.C.ID {
		t.Fatalf("the guild's first member does not lead it: %q", gd.G.Leader)
	}
	veteran.c.C.Walked = 100000
	for range every {
		daily.must(game.Command{Kind: game.Look})
		advanceDays(t, g, 1)
	}
	if gd.G.Leader != daily.c.C.ID {
		t.Fatalf("after %d days only one member acted every day, and the leader is %q", every, gd.G.Leader)
	}
	// Once the others have acted as often as the leader, the tie keeps it.
	for range 3 * every {
		for _, tr := range ts {
			tr.must(game.Command{Kind: game.Look})
		}
		advanceDays(t, g, 1)
	}
	if gd.G.Leader != daily.c.C.ID {
		t.Fatalf("a tie moved the leadership to %q", gd.G.Leader)
	}
}

// A founded guild that never ran a settlement leaves nothing behind when
// its last member goes: what it held is sunk as fees.
func TestAGuildWithNoSettlementSinksWhatItHeld(t *testing.T) {
	g, ts := newTraders(t, 1)
	founder := ts[0]
	founder.must(game.Command{Kind: game.FoundGuild, Note: "The Free Company"})
	gd := g.GuildOf(founder.c.C.Guild)
	founder.grant(ledger.Coin, 70)
	founder.must(game.Command{Kind: game.Deposit, Asset: ledger.Coin, Units: 70})
	sunk := g.Ledger.Of(ledger.ToFees, ledger.Coin)
	founder.must(game.Command{Kind: game.Leave})
	if left := g.Ledger.Held(gd.Pool()); len(left) != 0 || g.Ledger.Of(ledger.ToFees, ledger.Coin) != sunk+70 {
		t.Fatalf("a guild nobody is in still holds %+v; the fees sink took %d coin", left, g.Ledger.Of(ledger.ToFees, ledger.Coin)-sunk)
	}
	audit(t, g)
}

// A full granary shortens the rest that clears a wound; the wound itself
// slows a long action there as much as anywhere (GDD 4.14).
func TestAFullGranaryShortensRestNotTheWound(t *testing.T) {
	g, ts := society(t, 2)
	officer, member := ts[0], ts[1]
	r := g.Rules()
	wp := func(id string) int64 { return sheets.IntParam(r.Book.WorldParams, id) }
	var work *sheets.GuildWork
	for i := range r.Book.GuildWorks {
		if r.Book.GuildWorks[i].Gives == "rest" {
			work = &r.Book.GuildWorks[i]
		}
	}
	for i := range r.Book.Structures {
		if st := &r.Book.Structures[i]; st.ID == work.Needs {
			g.Places[0].Raise(st, g.Tick(), r.Settle)
		}
	}
	member.grant(ledger.Provisions, work.Uses[0].Quantity*3)
	member.must(game.Command{Kind: game.Deposit, Asset: ledger.Provisions, Units: work.Uses[0].Quantity * 3})
	officer.must(game.Command{Kind: game.Work, Option: work.ID, Units: 1})
	advanceDays(t, g, 1)
	if _, w := g.WorkRunning(0, work.ID); w == nil {
		t.Fatal("the granary's work is not running")
	}

	member.c.C.Set(char.Wounded, g.Tick()+sheets.TicksPerDay)
	member.must(game.Command{Kind: game.Forage, Ticks: wp("gather-ticks-min")})
	if got, want := member.c.Long.Ends-member.c.Long.Started, wp("gather-ticks-min")+wp("wounded-ticks"); got != want {
		t.Fatalf("a wounded forage at a full granary takes %d ticks, want %d", got, want)
	}
	member.must(game.Command{Kind: game.Cancel})
	member.must(game.Command{Kind: game.Rest})
	if got := member.c.Long.Ends - member.c.Long.Started; got != work.By || got >= wp("rest-ticks") {
		t.Fatalf("rest at a full granary takes %d ticks, want %d", got, work.By)
	}
	for member.c.Long != nil {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	if member.c.C.Has(char.Wounded, g.Tick()) {
		t.Fatal("the rest did not clear the wound")
	}
}

// Deliveries stay in a goal's escrow until they are paid for: a goal
// withdrawn, run out or reset short gives them back, and a First goal's
// losers get theirs when it is won.
func TestAGoalEndingShortGivesItsDeliveriesBack(t *testing.T) {
	g, ts := society(t, 3)
	poster, a, b := ts[0], ts[1], ts[2]
	fibre := materialWith(t, g, "fibre")
	asset := ledger.Material(fibre)
	held := func(tr *trader) int64 { return g.Ledger.Of(ledger.Char(tr.c.C.ID), asset) }
	poster.grant(ledger.Coin, 1000)
	a.grant(asset, 100)
	b.grant(asset, 100)
	spec := game.GoalSpec{Title: "Forty fibre", Issuer: goal.ByCharacter, Reward: 50, Mode: goal.First, Lifetime: goal.Standing,
		Turnover: goal.Keep, Cond: goal.Condition{Verb: goal.Deliver, Tag: "fibre", Count: 40, At: here(g, poster)}}
	deliver := func(tr *trader, x *game.Goal, n int64) {
		t.Helper()
		tr.must(game.Command{Kind: game.DeliverGoal, Target: x.ID, Material: fibre, Units: n})
	}

	x := post(poster, spec)
	deliver(a, x, 30)
	if held(a) != 70 || held(poster) != 0 {
		t.Fatalf("30 of 40 delivered: the runner carries %d fibre and the poster %d", held(a), held(poster))
	}
	coin := coinOf(poster)
	poster.must(game.Command{Kind: game.WithdrawGoal, Target: x.ID})
	if held(a) != 100 || held(poster) != 0 || coinOf(poster) != coin+50 {
		t.Fatalf("withdrawn at 30 of 40: the runner carries %d fibre, the poster %d and %d coin more", held(a), held(poster), coinOf(poster)-coin)
	}

	timed := spec
	timed.Lifetime, timed.Turnover, timed.Ticks = goal.Ephemeral, goal.Expire, sheets.TicksPerDay
	y := post(poster, timed)
	deliver(a, y, 30)
	advanceDays(t, g, 2)
	if y.State != goal.Ended || held(a) != 100 || held(poster) != 0 {
		t.Fatalf("run out at 30 of 40 (%s): the runner carries %d fibre and the poster %d", y.State, held(a), held(poster))
	}

	z := post(poster, spec)
	deliver(a, z, 30)
	deliver(b, z, 40)
	met(t, z)
	if held(a) != 100 || held(b) != 60 || held(poster) != 40 {
		t.Fatalf("won by the second runner: the loser carries %d fibre, the winner %d and the poster %d", held(a), held(b), held(poster))
	}

	season := spec
	season.Lifetime, season.Turnover, season.Mode = goal.Season, goal.Reset, goal.Pooled
	w := post(poster, season)
	deliver(a, w, 30)
	toSeasonEnd(t, g)
	if w.State != goal.Live || w.Total() != 0 || held(a) != 100 || len(w.Held) != 0 {
		t.Fatalf("reset at 30 of 40 (%s, %d counted): the runner carries %d fibre", w.State, w.Total(), held(a))
	}
	audit(t, g)
}

// What is delivered to a settlement's own goal, or hauled for a muster,
// goes to the bank of the guild behind it; a muster's stock nobody hauled
// goes back to the officer who put it up.
func TestASettlementsGoodsGoToItsGuildsBank(t *testing.T) {
	g, ts := society(t, 3)
	officer, a, b := ts[0], ts[1], ts[2]
	gd := g.Guilds[0]
	timber := materialWith(t, g, "timber")
	asset := ledger.Material(timber)
	far := officer.c.C.At.Neighbour(0)
	x := proposal(t, g, ts, game.GoalSpec{Title: "Timber for the palisade", Issuer: goal.BySettlement, Mode: goal.Pooled, Lifetime: goal.Standing,
		Turnover: goal.Keep, Cond: goal.Condition{Verb: goal.Deliver, Tag: "timber", Count: 20, At: here(g, officer)}})
	a.grant(asset, 20)
	a.must(game.Command{Kind: game.DeliverGoal, Target: x.ID, Material: timber, Units: 20})
	met(t, x)
	if bank := g.Ledger.Of(gd.Pool(), asset); bank != 20 || g.Ledger.Of(game.TreasuryPool(0), asset) != 0 {
		t.Fatalf("a settlement's delivery left the bank %d timber and the treasury %d", bank, g.Ledger.Of(game.TreasuryPool(0), asset))
	}

	officer.grant(asset, 40)
	haul := game.GoalSpec{Title: "Timber out", Issuer: goal.ByAdmin, Mode: goal.First, Lifetime: goal.Standing, Turnover: goal.Keep,
		Material: timber, Units: 20, Cond: goal.Condition{Verb: goal.Haul, From: here(g, officer), At: goal.TileRef(far), Count: 20}}
	y := post(officer, haul)
	b.grant(ledger.Coin, 500)
	b.must(game.Command{Kind: game.TakeHaul, Target: y.ID})
	b.c.C.At = far
	b.must(game.Command{Kind: game.DeliverGoal, Target: y.ID})
	met(t, y)
	if bank := g.Ledger.Of(gd.Pool(), asset); bank != 40 {
		t.Fatalf("a muster's haul left the bank %d timber", bank)
	}
	z := post(officer, haul)
	officer.must(game.Command{Kind: game.WithdrawGoal, Target: z.ID})
	if got := g.Ledger.Of(ledger.Char(officer.c.C.ID), asset); got != 20 || g.Ledger.Of(game.TreasuryPool(0), asset) != 0 {
		t.Fatalf("a muster's haul withdrawn: its officer carries %d timber and the treasury %d", got, g.Ledger.Of(game.TreasuryPool(0), asset))
	}
	audit(t, g)
}

// A pledge to a live goal pays the listing fee its coin adds, and is a
// deed only once it has been paid out.
func TestAPledgePaysItsFeeAndCountsWhenPaid(t *testing.T) {
	g, ts := society(t, 3)
	poster, pledger, runner := ts[0], ts[1], ts[2]
	fibre := materialWith(t, g, "fibre")
	poster.grant(ledger.Coin, 2000)
	pledger.grant(ledger.Coin, 2000)
	spec := func(reward int64) game.GoalSpec {
		return game.GoalSpec{Title: "Five fibre", Issuer: goal.ByCharacter, Reward: reward, Mode: goal.First, Lifetime: goal.Standing,
			Turnover: goal.Keep, Cond: goal.Condition{Verb: goal.Deliver, Tag: "fibre", Count: 5, At: here(g, poster)}}
	}
	deeds := func() int64 { return pledger.c.C.Deeds.Get(game.DeedPledged) }
	whole, small := post(poster, spec(1000)), post(poster, spec(10))
	coin := coinOf(pledger)
	pledger.must(game.Command{Kind: game.Pledge, Target: small.ID, Units: 990})
	if small.Reward != 1000 || small.Fee != whole.Fee || coinOf(pledger) != coin-990-(whole.Fee-g.Rules().Values.GoalFee(10)) {
		t.Fatalf("pledged up to %d coin the goal has paid a %d coin fee; posted at that reward, %d", small.Reward, small.Fee, whole.Fee)
	}
	coin = coinOf(pledger)
	poster.must(game.Command{Kind: game.WithdrawGoal, Target: small.ID})
	if coinOf(pledger) != coin+990 || deeds() != 0 {
		t.Fatalf("a pledge given back returned %d coin and counts as %d coin pledged", coinOf(pledger)-coin, deeds())
	}
	pledger.must(game.Command{Kind: game.Pledge, Target: whole.ID, Units: 100})
	runner.grant(ledger.Material(fibre), 5)
	runner.must(game.Command{Kind: game.DeliverGoal, Target: whole.ID, Material: fibre, Units: 5})
	met(t, whole)
	if deeds() != 100 || coinOf(runner) != 1100 {
		t.Fatalf("a pledge paid out counts as %d coin pledged; the runner was paid %d", deeds(), coinOf(runner))
	}
	audit(t, g)
}

// A guild's raise is its officers' to withdraw, whoever posted it.
func TestARaiseIsItsOfficersToWithdraw(t *testing.T) {
	g, ts := society(t, 10)
	leader, second, member := ts[0], ts[1], ts[2]
	gd := g.Guilds[0]
	leader.must(game.Command{Kind: game.Promote, Target: second.c.C.ID})
	second.must(game.Command{Kind: game.Raise, Slot: "wall"})
	x := lastGoal(g)
	unchanged(t, member, "a member withdrawing the guild's raise", game.Command{Kind: game.WithdrawGoal, Target: x.ID})
	gd.G.Member(second.c.C.ID).Officer = false
	unchanged(t, second, "a former officer withdrawing the raise it posted", game.Command{Kind: game.WithdrawGoal, Target: x.ID})
	if g.CanWithdraw(x, second.c) || !g.CanWithdraw(x, leader.c) {
		t.Fatal("the raise is offered to the wrong hands to withdraw")
	}
	leader.must(game.Command{Kind: game.WithdrawGoal, Target: x.ID})
	if x.State != goal.Ended {
		t.Fatalf("withdrawn by another officer, the raise is %s", x.State)
	}
}

// A work gives nothing while its structure is shut and lapses at the next
// world day with its stock untouched; one whose structure is shut can
// still be switched off.
func TestAWorkStopsWithItsStructure(t *testing.T) {
	g, ts := society(t, 2)
	officer, member := ts[0], ts[1]
	gd, p, r := g.Guilds[0], g.Places[0], g.Rules()
	var work *sheets.GuildWork
	for i := range r.Book.GuildWorks {
		if r.Book.GuildWorks[i].Gives == "rest" {
			work = &r.Book.GuildWorks[i]
		}
	}
	for i := range r.Book.Structures {
		if st := &r.Book.Structures[i]; st.ID == work.Needs {
			p.Raise(st, g.Tick(), r.Settle)
		}
	}
	uses := work.Uses[0].Quantity
	member.grant(ledger.Provisions, uses*5)
	member.must(game.Command{Kind: game.Deposit, Asset: ledger.Provisions, Units: uses * 5})
	on := game.Command{Kind: game.Work, Option: work.ID, Units: 1}
	officer.must(on)
	advanceDays(t, g, 1)
	open := p.Get(work.Needs).Condition
	p.Get(work.Needs).Condition = 0
	if _, w := g.WorkRunning(0, work.ID); w != nil {
		t.Fatal("a work runs with its structure shut")
	}
	bank := g.Ledger.Of(gd.Pool(), ledger.Provisions)
	advanceDays(t, g, 1)
	if len(gd.G.Works) != 0 || g.Ledger.Of(gd.Pool(), ledger.Provisions) != bank {
		t.Fatalf("a day with its structure shut: %d works run, the bank fed them %d provisions", len(gd.G.Works), bank-g.Ledger.Of(gd.Pool(), ledger.Provisions))
	}
	unchanged(t, officer, "a work switched on with its structure shut", on)

	p.Get(work.Needs).Condition = open
	officer.must(on)
	p.Get(work.Needs).Condition = 0
	officer.must(game.Command{Kind: game.Work, Option: work.ID})
	if len(gd.G.Works) != 0 {
		t.Fatal("a work whose structure is shut could not be switched off")
	}
	audit(t, g)
}

// A pledge to a faction's bounty pays the listing fee its own coin adds:
// what the faction minted into it was never listed, and no pledger pays
// for that.
func TestAPledgeToABountyPaysItsOwnFee(t *testing.T) {
	g, ts := society(t, 1)
	pledger := ts[0]
	threat, _ := g.World.GaugeOf("threat")
	var bounty *game.Goal
	for range 5 {
		for i := range g.World.Regions {
			g.World.Regions[i].Gauge[threat] = sheets.IntParam(g.Rules().Book.GoalParams, "bounty-threat")
		}
		advanceDays(t, g, 1)
		if x := lastGoal0(g); x != nil && x.Issuer.Kind == goal.ByFaction {
			bounty = x
			break
		}
	}
	if bounty == nil || bounty.Fee != 0 {
		t.Fatalf("no bounty was posted free of a fee: %+v", bounty)
	}
	fee := g.Rules().Values.GoalFee(bounty.Reward+10) - g.Rules().Values.GoalFee(bounty.Reward)
	pledger.grant(ledger.Coin, 1000)
	coin := coinOf(pledger)
	pledger.must(game.Command{Kind: game.Pledge, Target: bounty.ID, Units: 10})
	if paid := coin - coinOf(pledger); paid != 10+fee || fee >= g.Rules().Values.GoalFee(bounty.Reward) {
		t.Fatalf("a pledge of 10 coin to a bounty of %d cost %d coin; its own fee is %d", bounty.Reward-10, paid, fee)
	}
	audit(t, g)
}

// lastGoal0 is the newest goal, or nil before any.
func lastGoal0(g *game.Game) *game.Goal {
	if len(g.Goals) == 0 {
		return nil
	}
	return lastGoal(g)
}

// A settlement goal that went live on pledges and ends unmet gives each
// pledger back its share of what is left, the fee borne by all of them as
// they pledged.
func TestAnUnmetSettlementGoalRefundsByShare(t *testing.T) {
	g, ts := society(t, 3)
	x := post(ts[0], game.GoalSpec{Title: "To the far side", Issuer: goal.BySettlement, Mode: goal.First, Lifetime: goal.Standing,
		Turnover: goal.Keep, Cond: goal.Condition{Verb: goal.Reach, Count: 1, At: away(ts[0])}})
	big, small := x.Need, x.Need/4
	ts[2].grant(ledger.Coin, small)
	ts[2].must(game.Command{Kind: game.Pledge, Target: x.ID, Units: small})
	ts[1].grant(ledger.Coin, big)
	ts[1].must(game.Command{Kind: game.Pledge, Target: x.ID, Units: big})
	if x.State != goal.Live || x.Fee <= 0 {
		t.Fatalf("pledged past its need the goal is %s with a %d coin fee", x.State, x.Fee)
	}
	ts[0].must(game.Command{Kind: game.WithdrawGoal, Target: x.ID})
	lostBig, lostSmall := big-coinOf(ts[1]), small-coinOf(ts[2])
	if lostBig+lostSmall != x.Fee || lostSmall <= 0 && x.Fee >= 5 || lostBig < lostSmall*3 {
		t.Fatalf("of a %d coin fee the pledger of %d bore %d and the pledger of %d bore %d", x.Fee, big, lostBig, small, lostSmall)
	}
	if ts[1].c.C.Deeds.Get(game.DeedPledged) != lostBig || ts[2].c.C.Deeds.Get(game.DeedPledged) != lostSmall {
		t.Fatal("what a pledger did not get back is not what counts as pledged")
	}
	audit(t, g)
}

// Reopening a closed structure restores what its least repair pays for,
// however few points were asked.
func TestReopeningBuysWhatItCosts(t *testing.T) {
	g, ts := society(t, 1)
	st := g.Places[0].Get("market")
	st.Condition = 0
	for _, m := range g.Rules().Book.Materials {
		ts[0].grant(ledger.Material(m.ID), 500)
	}
	ts[0].must(game.Command{Kind: game.Mend, Slot: "market", Units: 1})
	if want := settle.ReopenPoints(g.Rules().Settle); want <= 1 || st.Condition != want {
		t.Fatalf("a closed market mended by 1 point stands at %d; its reopening pays for %d", st.Condition, want)
	}
	audit(t, g)
}
