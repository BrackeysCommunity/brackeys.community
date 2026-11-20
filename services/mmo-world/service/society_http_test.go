package service_test

import (
	"io"
	"net/url"
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
