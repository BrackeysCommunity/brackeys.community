package agent

import (
	"context"
	"reflect"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/keys"
)

func testPlan() *GuildPlan {
	return &GuildPlan{
		Tags:       map[string][]string{provisions: {provisions}, "timber": {"timber"}, "heartwood": {"timber"}, "fieldstone": {"stone"}, "reedflax": {"fibre"}},
		GoodsShare: 25, Tithe: 10, StockDays: 5, StartDays: 2, Settlements: 2, Distance: 6, Works: true,
	}
}

// homePage is a guild's page as a member standing in its settlement reads it.
func homePage() api.Guild {
	return api.Guild{
		ID: "g-1", Treasury: 120,
		Bank: []api.BankStock{{Material: "timber", Units: 30}, {Material: "heartwood", Units: 10}, {Material: provisions, Units: 20}},
		Works: []api.GuildWork{
			{ID: "stoked-forge", Uses: []api.CostLine{{Tag: "timber", Quantity: 20}}, Needs: "forge", Days: 2, Can: true},
			{ID: "road-patrol", Uses: []api.CostLine{{Tag: provisions, Quantity: 15}}, Days: 1, Can: true},
			{ID: "full-granary", Uses: []api.CostLine{{Tag: provisions, Quantity: 30}}, Needs: "granary", Can: true},
			{ID: "stocked-wall", Uses: []api.CostLine{{Tag: "stone", Quantity: 10}}, Waits: "later", Can: true},
			{ID: "open-ledger", Uses: []api.CostLine{{Quantity: 50}}, Days: 2, On: true, Can: true},
		},
		Settlements: []api.Settlement{{N: 0, Here: true, Structures: []api.Structure{{Kind: "forge", Tier: 1}, {Kind: "granary"}}}},
		Charter:     api.Charter{Coin: 1000, Timber: 200, Stone: 100},
	}
}

func TestShortCountsRunnableWorksAndTheCharter(t *testing.T) {
	g := testPlan()
	got := g.short(homePage(), false, nil)
	// forge 100 and charter 200 timber less 40 held; patrol 75 provisions
	// less 20; ledger 250 and charter 1,000 coin less 120; charter stone.
	want := map[string]int64{"timber": 260, provisions: 55, tagCoin: 1130, "stone": 100}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("short = %v, want %v", got, want)
	}
	// With the charter out, only the works are wanted.
	if got := g.short(homePage(), true, nil); !reflect.DeepEqual(got, map[string]int64{"timber": 60, provisions: 55, tagCoin: 130}) {
		t.Fatalf("short with the charter out = %v", got)
	}
	// A guild that leaves its works dark wants the charter alone.
	g.Works = false
	if got := g.short(homePage(), false, nil); !reflect.DeepEqual(got, map[string]int64{"timber": 160, tagCoin: 880, "stone": 100}) {
		t.Fatalf("short with works dark = %v", got)
	}
	// And one that has founded wants nothing more for it.
	g.Settlements = 1
	if got := g.short(homePage(), false, nil); len(got) != 0 {
		t.Fatalf("short once founded = %v", got)
	}
}

func TestGiftsAreSharesCappedByTheShortfall(t *testing.T) {
	g := testPlan()
	p := api.Purse{Coin: 700, Provisions: 52, Goods: []api.Goods{{Material: "reedflax", Units: 40}, {Material: "timber", Units: 40}, {Material: "fieldstone", Units: 3}}}
	short := map[string]int64{"timber": 6, "stone": 100, provisions: 55, tagCoin: 1130}
	got := g.gifts(p, 400, short)
	want := []api.ActionRequest{
		{Kind: api.ActDeposit, Asset: "timber", Units: 6},     // a quarter is 10; the guild is 6 short
		{Kind: api.ActDeposit, Asset: "fieldstone", Units: 1}, // a share is never less than one
		{Kind: api.ActDeposit, Asset: provisions, Units: 10},  // a quarter of the 40 over its floor
		{Kind: api.ActDeposit, Asset: coin, Units: 30},        // a tenth of the 300 over its comfort
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("gifts = %+v, want %+v", got, want)
	}
	// What was promised comes off the board for the next member.
	if want := map[string]int64{"timber": 0, "stone": 99, provisions: 45, tagCoin: 1100}; !reflect.DeepEqual(short, want) {
		t.Fatalf("left on the board = %v, want %v", short, want)
	}
	if got := g.gifts(api.Purse{Coin: 300, Provisions: 5}, 400, map[string]int64{provisions: 55, tagCoin: 100}); len(got) != 0 {
		t.Fatalf("a member under its floor and comfort gave %+v", got)
	}
}

func TestClassStep(t *testing.T) {
	open := func(taken bool) []api.Tier {
		return []api.Tier{{Level: 1, Open: true, Options: []api.Ability{{ID: "waits", Waits: "later"}, {ID: "live", Taken: taken}}}, {Level: 5, Options: []api.Ability{{ID: "shut"}}}}
	}
	page := api.Classes{Most: 2, Active: 1, Here: true, Classes: []api.Class{
		{ID: "unearned", Tiers: open(false)},
		{ID: "chandler", Earned: true, Active: true, Level: 1, Tiers: open(false)},
	}}
	if req, ok := classStep(page); !ok || req.Kind != api.ActTakeAbility || req.Option != "live" {
		t.Fatalf("an open tier: %+v %v, want the ability its system reads", req, ok)
	}
	page.Classes[1].Tiers = open(true)
	if req, ok := classStep(page); ok {
		t.Fatalf("a tier already taken from: %+v", req)
	}
	// A third class goes active over a lower one, at a settlement only.
	page.Active = 2
	page.Classes = append(page.Classes, api.Class{ID: "warden", Earned: true, Active: true, Level: 6, Tiers: open(true)}, api.Class{ID: "stalker", Earned: true, Level: 4})
	if req, ok := classStep(page); !ok || req.Kind != api.ActChooseClass || req.Option != "stalker" {
		t.Fatalf("a higher inactive class: %+v %v", req, ok)
	}
	page.Here = false
	if req, ok := classStep(page); ok {
		t.Fatalf("away from a settlement: %+v", req)
	}
}

func TestOfficerApprovesLightsAndSetsOut(t *testing.T) {
	e := &Earner{Guild: testPlan()}
	b, tr := &board{}, &trip{}
	o := api.Options{CharacterID: "c-1"}
	page := homePage()
	page.Officer = true
	page.Members = []api.GuildMember{{ID: "c-1", Name: "Ash", Admin: true}, {ID: "c-2", Name: "Birch", Admin: true}}
	page.Approvals = []api.Approval{{ID: "a1", By: "Ash"}, {ID: "a2", By: "Birch"}}
	if req, ok := e.officer(o, tr, b, page); !ok || req.Kind != api.ActApprove || req.Option != "a2" {
		t.Fatalf("approvals: %+v %v, want the other officer's", req, ok)
	}
	page.Approvals = nil
	// The forge has two days of stock and its structure; the patrol has
	// one day; the granary is not built; the wall's work waits.
	if req, ok := e.officer(o, tr, b, page); !ok || req.Kind != api.ActWork || req.Option != "stoked-forge" || req.Units != 1 {
		t.Fatalf("works: %+v %v, want the forge lit", req, ok)
	}
	page.Works[0].On = true
	if req, ok := e.officer(o, tr, b, page); ok || tr.civic.phase != atHome {
		t.Fatalf("a guild short of its charter: %+v, phase %d", req, tr.civic.phase)
	}
	// The charter and two days of the ledger's coin in hand: the first
	// admin sets out, and the board says the charter is out.
	page.Treasury = 1100
	page.Bank = []api.BankStock{{Material: "timber", Units: 150}, {Material: "heartwood", Units: 50}, {Material: "fieldstone", Units: 100}}
	second := &trip{}
	if e.officer(api.Options{CharacterID: "c-2"}, second, b, page); second.civic.phase != atHome || b.charter {
		t.Fatal("the second admin set out")
	}
	if e.officer(o, tr, b, page); tr.civic.phase != drawing || !b.charter {
		t.Fatalf("phase %d, charter out %v: want the founder drawing", tr.civic.phase, b.charter)
	}
	if !page.Officer {
		t.Fatal("page changed")
	}
	page.Officer = false
	if req, ok := e.officer(o, &trip{}, &board{}, page); ok {
		t.Fatalf("not an officer: %+v", req)
	}
}

func TestAdminsGiveUpAWorkThatSparesTooLittle(t *testing.T) {
	g := testPlan()
	g.ReviewDays, g.KeepShare = 7, 25
	e := &Earner{Guild: g}
	b, o := &board{}, api.Options{CharacterID: "c-1"}
	page := homePage()
	page.Officer = true
	page.Members = []api.GuildMember{{ID: "c-1", Name: "Ash", Admin: true}}
	forge, ledger := &page.Works[0], &page.Works[4]
	forge.Spares, ledger.Spares = true, true
	off := func() (api.ActionRequest, bool) {
		b.tally(page)
		req, ok := e.officer(o, &trip{}, b, page)
		return req, ok && req.Kind == api.ActWork && req.Units == 0
	}
	// Four stocked days is too soon to judge, however little it spared.
	forge.On, forge.Ran, forge.Used = true, 4, 80
	ledger.Ran, ledger.Used, ledger.Gave = 9, 450, 200
	if req, ok := off(); ok {
		t.Fatalf("judged after 4 days: %+v", req)
	}
	// It lapses and is relit: the days before still count.
	forge.On, forge.Ran, forge.Used = false, 0, 0
	if req, ok := off(); ok {
		t.Fatalf("a lapsed work switched off: %+v", req)
	}
	forge.On, forge.Ran, forge.Used, forge.Gave = true, 3, 60, 30
	if req, ok := off(); !ok || req.Option != "stoked-forge" {
		t.Fatalf("7 stocked days, 30 spared of 140: %+v %v, want the forge off", req, ok)
	}
	// Dark for good: not stocked for, and not lit again.
	forge.On, forge.Ran, forge.Used, forge.Gave = false, 0, 0, 0
	if req, ok := e.officer(o, &trip{}, b, page); ok {
		t.Fatalf("a work given up was lit again: %+v", req)
	}
	if got := g.short(page, true, b.dark); got["timber"] != 0 {
		t.Fatalf("the guild still stocks a work it gave up: %v", got)
	}
	// The ledger spared 200 of 450 and stays; a patrol is never judged.
	if b.dark["open-ledger"] || b.dark["road-patrol"] {
		t.Fatalf("gave up %v", b.dark)
	}
}

func TestSourcesNearestFirstAndStruckWhenWorkedOut(t *testing.T) {
	g := testPlan()
	g.Seek = true
	home := api.Hex{}
	g.seen("s", api.Hex{Q: 5}, home, []string{"fieldstone", "timber"})
	g.seen("s", api.Hex{Q: 2}, home, []string{"fieldstone"})
	g.seen("s", api.Hex{Q: 2}, home, []string{"fieldstone"})
	b := g.boardOf("s")
	if got := b.sources["stone"]; len(got) != 2 || got[0].at != (api.Hex{Q: 2}) || got[1].at != (api.Hex{Q: 5}) {
		t.Fatalf("stone sources = %+v", got)
	}
	g.workedOut("s", api.Hex{Q: 2}, "fieldstone")
	g.seen("s", api.Hex{Q: 2}, home, []string{"fieldstone"})
	if got := b.sources["stone"]; len(got) != 1 || got[0].at != (api.Hex{Q: 5}) {
		t.Fatalf("stone sources after a worked-out node = %+v", got)
	}
	b.short = map[string]int64{"stone": 40, "timber": 90, "hide": 5, tagCoin: 300}
	d := &Dice{d: drawerFor("civic-test"), player: "p"}
	var went, looked bool
	for tick := range int64(40) {
		d.tick = tick
		to, known, seek := g.errandFor("s", d)
		if known {
			went = true
			// Timber is the larger shortfall, and has one source.
			if to != (api.Hex{Q: 5}) {
				t.Fatalf("errand to %+v", to)
			}
		}
		looked = looked || seek
	}
	if !went || !looked {
		t.Fatalf("in forty trips: went %v, looked for the hide nobody has seen %v", went, looked)
	}
	g.Seek = false
	if _, known, seek := g.errandFor("s", d); known || seek {
		t.Fatal("a guild that does not seek sent a member out")
	}
}

// fakeWorld serves one member's options and its guild's page, and keeps
// what the member did.
type fakeWorld struct {
	options api.Options
	guild   api.Guild
	classes api.Classes
	acts    []api.ActionRequest
	reads   int
}

func (f *fakeWorld) Act(_ context.Context, req api.ActionRequest) (api.ActionReply, *api.Refusal, error) {
	f.acts = append(f.acts, req)
	return api.ActionReply{Character: api.Character{ID: "c-1"}}, nil, nil
}

func (f *fakeWorld) Options(context.Context, string) (api.Options, error) { return f.options, nil }

func (f *fakeWorld) Guild(context.Context, string) (api.Guild, error) {
	f.reads++
	return f.guild, nil
}

func (f *fakeWorld) Classes(context.Context, string) (api.Classes, error) { return f.classes, nil }

func TestMemberGivesAtHomeOnceADay(t *testing.T) {
	plan := testPlan()
	w := &fakeWorld{guild: homePage(), options: api.Options{CharacterID: "c-1", Moves: []api.Move{{Dir: 0, Open: true}},
		Purse: api.Purse{Market: true, Coin: 100, Provisions: provisionsFloor, Goods: []api.Goods{{Material: "timber", Units: 8}}}}}
	p := &Player{Discord: "p", Server: "s", Policy: &Earner{Role: Gatherer, Comfort: 400, Guild: plan}}
	s := NewScript(w, []*Player{p}, "civic-test")
	ctx := context.Background()
	for tick := range int64(4) {
		w.options.Tick = tick
		if err := s.Turn(ctx, tick); err != nil {
			t.Fatal(err)
		}
	}
	if len(w.acts) < 2 || w.acts[0].Kind != api.ActCreate || w.acts[0].Server != "s" {
		t.Fatalf("acts = %+v, want a character made in its server", w.acts)
	}
	if got := w.acts[1]; got.Kind != api.ActDeposit || got.Asset != "timber" || got.Units != 2 {
		t.Fatalf("first act at home = %+v, want a quarter of its timber given", got)
	}
	var deposits int
	for _, a := range w.acts {
		if a.Kind == api.ActDeposit {
			deposits++
		}
	}
	if deposits != 1 || w.reads != 1 {
		t.Fatalf("%d deposits and %d page reads in one day, want one of each", deposits, w.reads)
	}
	// A player from no server leaves the guild alone.
	lone := &fakeWorld{guild: homePage(), options: w.options}
	s = NewScript(lone, []*Player{{Discord: "q", Policy: &Earner{Role: Gatherer, Comfort: 400, Guild: plan}}}, "civic-test")
	for tick := range int64(3) {
		if err := s.Turn(ctx, tick); err != nil {
			t.Fatal(err)
		}
	}
	if lone.reads != 0 {
		t.Fatalf("a player from no server read the guild page %d times", lone.reads)
	}
}

func drawerFor(label string) *draw.Drawer { return draw.NewDrawer(keys.Throwaway(label).Roll) }

func TestFounderDrawsWalksAndCharters(t *testing.T) {
	e := &Earner{Guild: testPlan()}
	w := &fakeWorld{guild: homePage()}
	w.guild.Officer, w.guild.Officers, w.guild.Spend, w.guild.Treasury = true, 2, 500, 1100
	w.guild.Bank = []api.BankStock{{Material: "timber", Units: 200}, {Material: "fieldstone", Units: 100}}
	desk := &Desk{ctx: context.Background(), pages: w, player: &Player{Character: "c-1", Server: "s", Admin: true}}
	d := &Dice{d: drawerFor("civic-test"), player: "p"}
	b := &board{charter: true}
	tr := &trip{civic: civic{phase: drawing}}
	o := api.Options{CharacterID: "c-1", Moves: []api.Move{{Dir: 0, Open: true}, {Dir: 1, Open: true}},
		Purse: api.Purse{Market: true, Coin: 200, Provision: 3, Provisions: foundProvisions, Quotes: []api.Quote{{Material: "timber", Value: 8}, {Material: "fieldstone", Value: 8}}}}
	step := func() (api.ActionRequest, Verdict) {
		t.Helper()
		req, v, err := e.errand(o, tr, b, desk, d, 3)
		if err != nil {
			t.Fatal(err)
		}
		return req, v
	}
	// What the day's spend covers comes out at once: 500 coin of timber.
	if req, v := step(); v != Act || req.Kind != api.ActPay || req.Target != "c-1" || req.Asset != "timber" || req.Units != 62 {
		t.Fatalf("first draw: %+v %v", req, v)
	}
	// With the spend gone it asks for the rest of each, and waits on the
	// second officer.
	o.Purse.Goods = []api.Goods{{Material: "timber", Units: 62}}
	w.guild.Spend = 0
	if req, v := step(); v != Act || req.Asset != "timber" || req.Units != 138 {
		t.Fatalf("asking for the rest of the timber: %+v %v", req, v)
	}
	w.guild.Approvals = []api.Approval{{ID: "a1"}}
	if req, v := step(); v != Act || req.Asset != "fieldstone" || req.Units != 100 {
		t.Fatalf("asking for the stone: %+v %v", req, v)
	}
	if req, v := step(); v != Wait {
		t.Fatalf("with both asked for: %+v %v, want it to wait", req, v)
	}
	// A guild with one officer has nobody to ask: it waits for tomorrow.
	solo := &trip{civic: civic{phase: drawing}}
	w.guild.Approvals, w.guild.Officers = nil, 1
	if req, v, _ := e.errand(o, solo, b, desk, d, 3); v != Wait {
		t.Fatalf("one officer, no spend left: %+v %v", req, v)
	}
	// The goods in hand, it walks out, and charters where the page says
	// it can.
	o.Purse.Goods = []api.Goods{{Material: "timber", Units: 200}, {Material: "fieldstone", Units: 100}}
	if req, v := step(); v != Act || req.Kind != api.ActStep || tr.civic.phase != walking {
		t.Fatalf("setting out: %+v %v, phase %d", req, v, tr.civic.phase)
	}
	o.Purse.Market, o.At = false, api.Hex{Q: 7}
	w.guild.Charter.Can = true
	if req, v := step(); v != Act || req.Kind != api.ActFound || req.Note == "" {
		t.Fatalf("at a free tile: %+v %v", req, v)
	}
	// A refused charter leaves it walking; one that took ends the errand.
	if req, v := step(); v != Act || req.Kind != api.ActStep {
		t.Fatalf("after a charter that did not take: %+v %v", req, v)
	}
	w.guild.Settlements = append(w.guild.Settlements, api.Settlement{N: 2})
	if _, v := step(); v != Pass || tr.civic.phase != atHome || b.charter {
		t.Fatalf("founded: verdict %v, phase %d, charter out %v", v, tr.civic.phase, b.charter)
	}
}
