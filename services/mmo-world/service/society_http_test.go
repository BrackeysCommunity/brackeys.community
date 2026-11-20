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
	cl, err := r.cli.Classes(ctx, a.ID)
	if err != nil || len(cl.Classes) == 0 || cl.Most == 0 || len(cl.Classes[0].Needs) == 0 || len(cl.Classes[0].Tiers) == 0 {
		t.Fatalf("classes %+v: %v", cl, err)
	}

	gs := readSolo[api.Goals](t, r, api.PathGoals+qa, 200)
	if gs.Banner == "" || len(gs.Targets) == 0 || gs.Fee == 0 || gs.FeeLeast == 0 || gs.Limit == 0 || gs.Ephemeral == 0 || len(gs.Board) != 0 {
		t.Fatalf("goals %+v", gs)
	}
	vow := api.GoalSpec{Title: "Reach the gate", Issuer: "character", Mode: "first", Lifetime: "standing", Turnover: "carry",
		Cond: api.Condition{Verb: "reach", Count: 1, At: "settlement:0"}}
	act(api.ActionRequest{InteractionID: "post", CharacterID: a.ID, Kind: api.ActPostGoal, Goal: &vow})
	gs = readSolo[api.Goals](t, r, api.PathGoals+qa, 200)
	if len(gs.Board) != 1 || len(gs.Mine) != 1 || !gs.Board[0].Vow || gs.Live != 1 || gs.Board[0].What == "" {
		t.Fatalf("after posting: %+v", gs)
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
	op(t, r, api.OperatorRequest{InteractionID: "hide", Kind: api.ActHideGoal, Target: gs.Board[0].ID, Note: "test hide"})
	if gs = readSolo[api.Goals](t, r, api.PathGoals+qa, 200); len(gs.Board) != 0 {
		t.Fatalf("a hidden goal is still on the board: %+v", gs.Board)
	}
	if board = readSolo[api.Board](t, r, api.PathBoard, 200); len(board.Posts) != 0 {
		t.Fatalf("a hidden goal is still in the forum feed: %+v", board)
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
