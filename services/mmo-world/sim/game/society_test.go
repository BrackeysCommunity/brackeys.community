package game_test

import (
	"fmt"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
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
			s.Cond = goal.Condition{Verb: goal.Haul, From: here(g, member), At: "settlement:1", Count: 60}
		}
		return &s
	}
	unchanged(t, member, "a reward past the purse", game.Command{Kind: game.PostGoal, Goal: spec(500, goal.Deliver)})
	unchanged(t, member, "a haul whose reward is past the purse", game.Command{Kind: game.PostGoal, Goal: spec(500, goal.Haul)})
	unchanged(t, officer, "a raise the treasury cannot pay for", game.Command{Kind: game.Raise, Slot: "wall", Price: 5000})
	unchanged(t, member, "backing a side before arcs", game.Command{Kind: game.PostGoal, Goal: spec(0, goal.Back)})
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
	for _, slot := range []string{"wall", "granary", "stable", "storehouse", "waypost", "shrine"} {
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
	if _, w := g.WorkRunning(home, "road-patrol"); w == nil || w.Left != worth {
		t.Fatalf("a stocked work may give back %+v, want the %d coin its day's stock was worth", w, worth)
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
