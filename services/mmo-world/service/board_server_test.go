package service_test

import (
	"context"
	"io"
	"slices"
	"strconv"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/sheets"
)

// TestBoardAsServerReads: the goals forum hides a goal's words where the
// server's staff hid it and leaves out another server's staged contest;
// the market forum names a settlement as the server masks it.
func TestBoardAsServerReads(t *testing.T) {
	ctx := context.Background()
	r := start(t, io.Discard)
	founded, n := founder(t, r, "new-a", "u-a", serverA)
	a := founded.ID
	staff := member(t, r, "new-staff", "u-staff", serverA, false)
	member(t, r, "new-b", "u-b", serverB, true)
	advance(t, ctx, r, 1)

	board := func(server string) []api.BoardPost {
		t.Helper()
		return read[api.Board](t, r, true, api.PathBoard+"?server="+server, 200).Posts
	}
	post := func(posts []api.BoardPost, id string) *api.Goal {
		if i := slices.IndexFunc(posts, func(p api.BoardPost) bool { return p.Goal.ID == id }); i >= 0 {
			return &posts[i].Goal
		}
		return nil
	}

	vow := api.GoalSpec{Title: "Reach the gate", Note: "by the old road", Issuer: "character", Mode: "first", Lifetime: "standing", Turnover: "carry",
		Cond: api.Condition{Verb: "reach", Count: 1, At: "settlement:" + strconv.Itoa(n)}}
	act(t, ctx, r, a, api.ActionRequest{InteractionID: "post", Kind: api.ActPostGoal, Goal: &vow})
	gs := readSolo[api.Goals](t, r, api.PathGoals+"?characterId="+a, 200)
	if len(gs.Board) != 1 {
		t.Fatalf("after posting, the board reads %+v", gs.Board)
	}
	id := gs.Board[0].ID
	act(t, ctx, r, staff, api.ActionRequest{InteractionID: "hide-1", Kind: api.ActModerate, Server: serverA, Staff: true, DiscordID: "u-staff",
		Moderate: &api.ModerateOrder{Action: "hide", Ref: game.RefGoal + ":" + id}})
	if x := post(board(serverA), id); x == nil || x.Title != x.What || x.Note != "" {
		t.Fatalf("server A reads the goal its staff hid as %+v", x)
	}
	if x := post(board(serverB), id); x == nil || x.Title != vow.Title || x.Note != vow.Note {
		t.Fatalf("server B reads A's hidden goal as %+v", x)
	}

	h := houseOf(t, r, serverA, a, true, false)
	tpl := slices.IndexFunc(h.Templates, func(tp api.StageTemplate) bool { return tp.Kind == sheets.StageContest })
	if tpl < 0 || len(h.Contests) == 0 {
		t.Fatalf("server A's house offers no contest: %+v", h)
	}
	before := map[string]bool{}
	for _, p := range board(serverA) {
		before[p.Goal.ID] = true
	}
	staged := false
	for i, contest := range h.Contests {
		o, err := r.cli.Options(ctx, a)
		if err != nil {
			t.Fatal(err)
		}
		_, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "stage-" + strconv.Itoa(i), CharacterID: a, Version: o.Version, Kind: api.ActStage,
			Server: serverA, Admin: true, DiscordID: "u-a",
			Stage: &api.StageOrder{Template: h.Templates[tpl].ID, Settlement: h.Settlements[0].N, At: h.Settlements[0].Sites[0].At, Contest: contest}})
		if err != nil {
			t.Fatal(err)
		}
		if ref == nil {
			staged = true
			break
		}
	}
	if !staged {
		t.Fatal("no contest could be staged")
	}
	advance(t, ctx, r, 1)
	var contest string
	for _, p := range board(serverA) {
		if !before[p.Goal.ID] && p.Goal.Issuer == "staged" {
			contest = p.Goal.ID
		}
	}
	if contest == "" {
		t.Fatalf("server A's board shows no staged contest: %+v", board(serverA))
	}
	if post(board(serverB), contest) != nil {
		t.Fatal("server B's board shows A's staged contest")
	}

	ref := game.RefSettlement + ":" + strconv.Itoa(n)
	release := r.srv.Hold()
	generated := r.srv.Game().GeneratedName(ref)
	release()
	if _, refusal, err := r.op.Operate(ctx, api.OperatorRequest{InteractionID: "op-rename", Kind: api.OpRename,
		Rename: &api.RenameOrder{Ref: ref, Name: "Lantern Hollow"}}); err != nil || refusal != nil {
		t.Fatalf("op rename: %+v %v", refusal, err)
	}
	act(t, ctx, r, staff, api.ActionRequest{InteractionID: "mask-1", Kind: api.ActModerate, Server: serverA, Staff: true, DiscordID: "u-staff",
		Moderate: &api.ModerateOrder{Action: "mask", Ref: ref}})
	forumName := func(server string) string {
		t.Helper()
		f := read[api.Forum](t, r, true, api.PathForum+"?server="+server, 200)
		if i := slices.IndexFunc(f.Posts, func(p api.ForumPost) bool { return p.Settlement == n }); i >= 0 {
			return f.Posts[i].Name
		}
		t.Fatalf("the forum has no post for settlement %d: %+v", n, f.Posts)
		return ""
	}
	if got := forumName(serverA); got != generated {
		t.Fatalf("server A's forum names its masked settlement %q, want %q", got, generated)
	}
	if got := forumName(serverB); got != "Lantern Hollow" {
		t.Fatalf("server B's forum names the settlement %q", got)
	}
}
