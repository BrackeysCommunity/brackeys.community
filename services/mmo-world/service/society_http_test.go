package service_test

import (
	"fmt"
	"io"
	"net/url"
	"slices"
	"testing"

	"jams.team/mmo-world/api"
)

// Goals, the guild and classes over HTTP: a server's first player gets
// its guild and settlement, posts a vow the forum feed shows, the
// operator hides it, and a second player's rescue shows on both sides.
func TestSocietyOverHTTP(t *testing.T) {
	ctx := t.Context()
	r := start(t, io.Discard)
	create := func(key, user string) api.Character {
		rep, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: key, DiscordID: user, Kind: api.ActCreate, Option: api.StartHook,
			Server: "srv-1", Note: "The Reedwardens", Admin: user == "admin"})
		if err != nil || ref != nil {
			t.Fatal(ref, err)
		}
		return rep.Character
	}
	a, b := create("c1", "admin"), create("c2", "member")
	qa := "?characterId=" + url.QueryEscape(a.ID)
	act := func(req api.ActionRequest) api.ActionReply {
		t.Helper()
		o, err := r.cli.Options(ctx, req.CharacterID)
		if err != nil {
			t.Fatal(err)
		}
		req.Version = o.Version
		rep, ref, err := r.cli.Act(ctx, req)
		if err != nil || ref != nil {
			t.Fatalf("%s: %+v %v", req.Kind, ref, err)
		}
		return rep
	}

	gd, err := r.cli.Guild(ctx, a.ID)
	if err != nil || gd.ID == "" || !gd.Server || gd.Name != "The Reedwardens" || len(gd.Members) != 2 || len(gd.Works) == 0 ||
		len(gd.Settlements) != 1 || gd.Banner == "" || !gd.Officer {
		t.Fatalf("guild %+v: %v", gd, err)
	}
	if !gd.Members[0].Admin || gd.Charter.Coin == 0 {
		t.Fatalf("a server admin is not an officer of its guild, or the charter has no cost: %+v", gd)
	}
	// The bank is in reach at the guild's own settlement, and a structure
	// whose system waits is marked and not offered.
	waits, raisable := 0, 0
	for _, st := range gd.Settlements[0].Structures {
		if st.Kind == "market" && (!st.Stands || len(st.Repairs) != 0) {
			t.Fatalf("a starting settlement's market in full repair: %+v", st)
		}
		switch {
		case st.Waits != "" && st.CanRaise:
			t.Fatalf("the %s waits for %s and is offered to raise", st.Kind, st.Waits)
		case st.Waits != "":
			waits++
		case st.CanRaise:
			raisable++
		}
	}
	if !gd.BankHere || waits == 0 || raisable == 0 {
		t.Fatalf("bank here %v; %d structures wait, %d can be raised", gd.BankHere, waits, raisable)
	}
	cl, err := r.cli.Classes(ctx, a.ID)
	if err != nil || len(cl.Classes) == 0 || cl.Most == 0 || len(cl.Classes[0].Needs) == 0 || len(cl.Classes[0].Tiers) == 0 || cl.Prey != nil {
		t.Fatalf("classes %+v: %v", cl, err)
	}

	gs := readSolo[api.Goals](t, r, api.PathGoals+qa, 200)
	if gs.Banner == "" || len(gs.Targets) == 0 || gs.Fee == 0 || gs.FeeLeast == 0 || gs.Limit == 0 || gs.Ephemeral == 0 || len(gs.Board) != 0 {
		t.Fatalf("goals %+v", gs)
	}
	if len(gs.Traits) == 0 || len(gs.Fields) == 0 || len(gs.Vows) == 0 || gs.Places == nil || gs.Waiting == nil || gs.PartyMost == 0 || gs.Even ||
		len(gs.Party) != 1 || gs.Party[0].Value != b.ID {
		t.Fatalf("what the form narrows by: traits %v, fields %v, vows %v, places %v, waiting %v, party %v of %d, even %v",
			gs.Traits, gs.Fields, gs.Vows, gs.Places, gs.Waiting, gs.Party, gs.PartyMost, gs.Even)
	}
	// What the form picks a duration and a Hold's gauge, side and line from.
	if gs.EphemeralLeast <= 0 || gs.EphemeralLeast > gs.Ephemeral || gs.Ephemeral > gs.EphemeralMost {
		t.Fatalf("an ephemeral goal's %d ticks are outside the %d to %d served", gs.Ephemeral, gs.EphemeralLeast, gs.EphemeralMost)
	}
	lined := false
	for _, x := range gs.Gauges {
		if len(x.Lines) == 0 || x.Label == "" {
			t.Fatalf("a gauge with no lines or no name: %+v", x)
		}
		lined = lined || x.Value == gs.Gauge && slices.Contains(x.Lines, gs.Line)
	}
	if !lined || len(gs.Sides) != 2 || gs.Sides[0].Value != api.SideBelow || gs.Sides[1].Value != api.SideAbove {
		t.Fatalf("a Hold starts on %s at %d, among gauges %+v and sides %+v", gs.Gauge, gs.Line, gs.Gauges, gs.Sides)
	}
	vow := api.GoalSpec{Title: "Reach the gate", Issuer: "character", Mode: "first", Lifetime: "standing", Turnover: "carry",
		Cond: api.Condition{Verb: "reach", Count: 1, At: "settlement:0"}}
	act(api.ActionRequest{InteractionID: "post", CharacterID: a.ID, Kind: api.ActPostGoal, Goal: &vow})
	gs = readSolo[api.Goals](t, r, api.PathGoals+qa, 200)
	if len(gs.Board) != 1 || len(gs.Mine) != 1 || !gs.Board[0].Vow || gs.Live != 1 || gs.Board[0].What == "" {
		t.Fatalf("after posting: %+v", gs)
	}
	if x := gs.Board[0]; !x.CanWithdraw || x.CanPledge {
		t.Fatalf("its poster may withdraw an unpaid goal, and nobody pledges to one: withdraw %v, pledge %v", x.CanWithdraw, x.CanPledge)
	}
	if theirs := readSolo[api.Goals](t, r, api.PathGoals+"?characterId="+b.ID, 200); len(theirs.Board) != 1 || theirs.Board[0].CanWithdraw {
		t.Fatalf("another character's view of it: %+v", theirs.Board)
	}
	if sh := readSolo[api.Sheet](t, r, api.PathSheet+qa, 200); len(sh.Vows) != 1 || sh.Vows[0].Title != vow.Title || sh.Vows[0].Broken {
		t.Fatalf("the poster's vows: %+v", sh.Vows)
	}
	board := readSolo[api.Board](t, r, api.PathBoard, 200)
	if len(board.Posts) != 1 || board.Posts[0].Banner == "" || board.Posts[0].Goal.ID != gs.Board[0].ID {
		t.Fatalf("forum feed %+v", board)
	}
	bad := api.GoalSpec{Title: "x", Issuer: "character", Reward: 5, Mode: "first", Lifetime: "standing", Turnover: "carry",
		Cond: api.Condition{Verb: "reach", Count: 1, At: "settlement:0"}}
	o, _ := r.cli.Options(ctx, a.ID)
	if _, ref, _ := r.cli.Act(ctx, api.ActionRequest{InteractionID: "bad", CharacterID: a.ID, Version: o.Version, Kind: api.ActPostGoal, Goal: &bad}); ref == nil {
		t.Fatal("a reward under the least went through")
	}
	if _, ref, _ := r.cli.Act(ctx, api.ActionRequest{InteractionID: "hide-as-player", CharacterID: a.ID, Version: o.Version, Kind: api.ActHideGoal, Target: gs.Board[0].ID}); ref == nil || ref.Code != api.CodeForbidden {
		t.Fatalf("a player hid a goal: %+v", ref)
	}
	hid := gs.Board[0].ID
	op(t, r, api.OperatorRequest{InteractionID: "hide", Kind: api.ActHideGoal, Target: hid, Note: "test hide"})
	if gs = readSolo[api.Goals](t, r, api.PathGoals+qa, 200); len(gs.Board) != 0 {
		t.Fatalf("a hidden goal is still on the board: %+v", gs.Board)
	}
	if board = readSolo[api.Board](t, r, api.PathBoard, 200); len(board.Posts) != 0 || len(board.Hidden) != 1 || board.Hidden[0] != hid {
		t.Fatalf("a hidden goal is still in the forum feed, or not named as hidden: %+v", board)
	}

	// A vow to hold off a thing, as the form posts it.
	off := api.GoalSpec{Title: "No blade", Issuer: "character", Mode: "first", Lifetime: "season", Turnover: "expire",
		Cond: api.Condition{Verb: "hold", Tag: gs.Vows[0].Value}}
	act(api.ActionRequest{InteractionID: "vow", CharacterID: a.ID, Kind: api.ActPostGoal, Goal: &off})
	if gs = readSolo[api.Goals](t, r, api.PathGoals+qa, 200); len(gs.Mine) != 1 || gs.Mine[0].Verb != "hold" || gs.Mine[0].Count != 0 || !gs.Mine[0].Vow {
		t.Fatalf("a vow to hold off a thing: %+v", gs.Mine)
	}

	// The second player's view of the same guild, and a deposit that ranks it.
	op(t, r, api.OperatorRequest{InteractionID: "purse", CharacterID: b.ID, Kind: api.OpCorrect, Asset: "coin", Units: 50, Note: "test purse"})
	act(api.ActionRequest{InteractionID: "dep", CharacterID: b.ID, Kind: api.ActDeposit, Asset: "coin", Units: 20})
	gd, err = r.cli.Guild(ctx, b.ID)
	if err != nil || gd.Treasury != 20 || gd.Officer {
		t.Fatalf("after a deposit: treasury %d, officer %v: %v", gd.Treasury, gd.Officer, err)
	}
	// Goods in the bank: what a unit costs, what the giver may draw of them
	// and whom an officer may pay them to, as the cards offer them.
	op(t, r, api.OperatorRequest{InteractionID: "pack", CharacterID: b.ID, Kind: api.OpCorrect, Asset: "provisions", Units: 10, Note: "test pack"})
	act(api.ActionRequest{InteractionID: "dep-goods", CharacterID: b.ID, Kind: api.ActDeposit, Asset: "provisions", Units: 10})
	gd, err = r.cli.Guild(ctx, b.ID)
	if err != nil || len(gd.Bank) != 1 {
		t.Fatalf("the bank after a gift of goods: %+v: %v", gd.Bank, err)
	}
	stock := gd.Bank[0]
	if stock.Material != "provisions" || stock.Units != 10 || stock.Value <= 0 || stock.Draw <= 0 || stock.Draw > stock.Units {
		t.Fatalf("the bank's stock as its giver sees it: %+v", stock)
	}
	act(api.ActionRequest{InteractionID: "draw", CharacterID: b.ID, Kind: api.ActDraw, Asset: stock.Material, Units: stock.Draw})
	o, _ = r.cli.Options(ctx, b.ID)
	if _, ref, _ := r.cli.Act(ctx, api.ActionRequest{InteractionID: "draw-more", CharacterID: b.ID, Version: o.Version, Kind: api.ActDraw, Asset: stock.Material, Units: 1}); ref == nil {
		t.Fatal("a draw past the most served went through")
	}
	gd, err = r.cli.Guild(ctx, a.ID)
	if err != nil || len(gd.Members) != 2 {
		t.Fatalf("the officer's page: %+v: %v", gd, err)
	}
	for _, m := range gd.Members {
		if !m.PayGoods {
			t.Fatalf("at the bank an officer is not offered to pay %s goods", m.ID)
		}
	}
	for _, st := range gd.Settlements[0].Structures {
		if st.RewardMost != 0 {
			t.Fatalf("an empty treasury covers %d coin a line of the %s", st.RewardMost, st.Kind)
		}
	}
	if theirs, _ := r.cli.Guild(ctx, b.ID); theirs.Members[0].PayGoods || theirs.Members[1].PayGoods {
		t.Fatal("a member who is no officer is offered to pay goods")
	}
	here := readSolo[api.Here](t, r, api.PathHere+qa, 200)
	if here.Downed == nil {
		t.Fatal("the downed list is null, not empty")
	}
	if o, _ := r.cli.Options(ctx, a.ID); o.Rescue != nil {
		t.Fatalf("a character on its feet has a rescue: %+v", o.Rescue)
	}
	audit, err := r.op.Audit(ctx)
	if err != nil || len(audit.Discrepancies) != 0 {
		t.Fatalf("audit %+v: %v", audit, err)
	}
}

// A haul hangs on the board where its stock starts and is handed in at its
// end, away from that board: the page there still serves it to its hauler,
// to deliver.
func TestAHaulIsServedAtItsEnd(t *testing.T) {
	ctx := t.Context()
	r := start(t, io.Discard)
	create := func(key, user string) api.Character {
		rep, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: key, DiscordID: user, Kind: api.ActCreate, Option: api.StartHook, Server: "srv-1"})
		if err != nil || ref != nil {
			t.Fatal(ref, err)
		}
		return rep.Character
	}
	poster, hauler := create("c1", "poster"), create("c2", "hauler")
	act := func(req api.ActionRequest) {
		t.Helper()
		o, err := r.cli.Options(ctx, req.CharacterID)
		if err != nil {
			t.Fatal(err)
		}
		req.Version = o.Version
		if _, ref, err := r.cli.Act(ctx, req); err != nil || ref != nil {
			t.Fatalf("%s: %+v %v", req.Kind, ref, err)
		}
	}
	goals := func(c api.Character) api.Goals {
		t.Helper()
		return readSolo[api.Goals](t, r, api.PathGoals+"?characterId="+url.QueryEscape(c.ID), 200)
	}
	o, err := r.cli.Options(ctx, hauler.ID)
	if err != nil {
		t.Fatal(err)
	}
	i := slices.IndexFunc(o.Moves, func(m api.Move) bool { return m.Open })
	if i < 0 {
		t.Fatal("no way out of the settlement")
	}
	out := o.Moves[i]
	material := goals(poster).Targets[0].Options[1].Value
	op(t, r, api.OperatorRequest{InteractionID: "stock", CharacterID: poster.ID, Kind: api.OpCorrect, Asset: "mat:" + material, Units: 20, Note: "test stock"})
	for _, c := range []api.Character{poster, hauler} {
		op(t, r, api.OperatorRequest{InteractionID: "purse-" + c.ID, CharacterID: c.ID, Kind: api.OpCorrect, Asset: "coin", Units: 5000, Note: "test purse"})
	}
	haul := api.GoalSpec{Title: "Stock up the road", Issuer: "character", Reward: 10, Mode: "first", Lifetime: "standing", Turnover: "carry",
		Material: material, Units: 20, Cond: api.Condition{Verb: "haul", Count: 20, From: "settlement:0", At: fmt.Sprintf("tile:%d,%d", out.To.Q, out.To.R)}}
	act(api.ActionRequest{InteractionID: "post", CharacterID: poster.ID, Kind: api.ActPostGoal, Goal: &haul})
	id := goals(poster).Mine[0].ID
	if gs := goals(hauler); len(gs.Mine) != 0 || len(gs.Board) != 1 || gs.Board[0].Haul != "take" {
		t.Fatalf("a haul to take: %+v", gs)
	}
	act(api.ActionRequest{InteractionID: "take", CharacterID: hauler.ID, Kind: api.ActTakeHaul, Target: id})
	act(api.ActionRequest{InteractionID: "walk", CharacterID: hauler.ID, Kind: api.ActStep, Dir: out.Dir})
	if o, err = r.cli.Options(ctx, hauler.ID); err != nil {
		t.Fatal(err)
	}
	advance(t, ctx, r, o.Tick+out.Ticks)
	gs := goals(hauler)
	if gs.Settlement >= 0 || len(gs.Mine) != 1 || gs.Mine[0].ID != id || gs.Mine[0].Haul != "deliver" || gs.Mine[0].Mine {
		t.Fatalf("at a haul's end, off any board, its hauler is served %+v", gs.Mine)
	}
	act(api.ActionRequest{InteractionID: "hand-in", CharacterID: hauler.ID, Kind: api.ActDeliverGoal, Target: id})
	if gs := goals(hauler); len(gs.Mine) != 0 {
		t.Fatalf("a haul handed in is still served: %+v", gs.Mine)
	}
	audit, err := r.op.Audit(ctx)
	if err != nil || len(audit.Discrepancies) != 0 {
		t.Fatalf("audit %+v: %v", audit, err)
	}
}

// What a goal asks is said with a unit on every number, as the cards that
// print it must.
func TestGoalsSayWhatTheirNumbersCount(t *testing.T) {
	ctx := t.Context()
	r := start(t, io.Discard)
	rep, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "c1", DiscordID: "poster", Kind: api.ActCreate, Option: api.StartHook, Server: "srv-1"})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	c := rep.Character
	gs := readSolo[api.Goals](t, r, api.PathGoals+"?characterId="+url.QueryEscape(c.ID), 200)
	pick := func(verb string) api.Pick {
		i := slices.IndexFunc(gs.Targets, func(x api.Targets) bool { return x.Verb == verb })
		if i < 0 {
			t.Fatalf("nothing to %s", verb)
		}
		return gs.Targets[i].Options[0]
	}
	slot, creature, field, trait := pick("make"), pick("defeat"), gs.Fields[0].Value, gs.Traits[0].Value
	for i, tc := range []struct {
		cond api.Condition
		want string
	}{
		{api.Condition{Verb: "deliver", Tag: "stone", Count: 300, At: "settlement:0"}, "deliver 300 goods of stone"},
		{api.Condition{Verb: "make", Tag: slot.Value, Trait: trait, Count: 3}, "make 3 items, any " + slot.Value + " with " + trait},
		{api.Condition{Verb: "defeat", Kind: creature.Value, Count: 1}, "defeat 1 creature, " + creature.Label},
		{api.Condition{Verb: "hold", Gauge: "scarcity", Line: 300, Count: 3, At: "region:r-0"}, "hold scarcity above 300 pts for 3 days"},
		{api.Condition{Verb: "discover", Field: field, AtLeast: 70, Count: 1, Hex: &gs.At, Within: gs.Within},
			fmt.Sprintf("discover 1 tile with %s of 70 pts or more within %d tiles", field, gs.Within)},
	} {
		o, err := r.cli.Options(ctx, c.ID)
		if err != nil {
			t.Fatal(err)
		}
		spec := api.GoalSpec{Title: "Asked", Issuer: "character", Mode: "first", Lifetime: "standing", Turnover: "carry", Cond: tc.cond}
		if _, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: fmt.Sprint("post-", i), CharacterID: c.ID, Version: o.Version, Kind: api.ActPostGoal, Goal: &spec}); err != nil || ref != nil {
			t.Fatalf("%s: %+v %v", tc.want, ref, err)
		}
		mine := readSolo[api.Goals](t, r, api.PathGoals+"?characterId="+url.QueryEscape(c.ID), 200).Mine
		if got := mine[len(mine)-1].What; got != tc.want {
			t.Fatalf("a goal says %q, want %q", got, tc.want)
		}
	}
}
