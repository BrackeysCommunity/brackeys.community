package service_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/puzzle"
)

// rawGet is a GET's body as the keys of its top-level object.
func rawGet(t *testing.T, r *running, path string) (map[string]json.RawMessage, string) {
	t.Helper()
	resp, err := http.Get(r.http.URL + path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("GET %s: %d %s %v", path, resp.StatusCode, body, err)
	}
	var out map[string]json.RawMessage
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatal(err)
	}
	return out, string(body)
}

// hasKeys fails unless an object carries every key, none of them null.
func hasKeys(t *testing.T, what string, obj map[string]json.RawMessage, keys ...string) {
	t.Helper()
	for _, k := range keys {
		if v, ok := obj[k]; !ok || string(v) == "null" {
			t.Errorf("%s has no %q", what, k)
		}
	}
}

// partyOnServer forms a party on a running world through the API: two
// characters made by Discord users u-a and u-b, standing together.
func partyOnServer(t *testing.T, ctx context.Context, r *running) (a, b string) {
	t.Helper()
	ids := make([]string, 2)
	for i, user := range []string{"u-a", "u-b"} {
		rep, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "new-" + user, DiscordID: user, Kind: api.ActCreate, Option: api.StartKnife})
		if err != nil || ref != nil {
			t.Fatal(ref, err)
		}
		ids[i] = rep.Character.ID
	}
	release := r.srv.Hold()
	g := r.srv.Game()
	g.Char(ids[1]).C.At = g.Char(ids[0]).C.At
	release()
	act(t, ctx, r, ids[0], api.ActionRequest{InteractionID: "invite", Kind: api.ActPartyInvite, Target: ids[1]})
	act(t, ctx, r, ids[1], api.ActionRequest{InteractionID: "join", Kind: api.ActPartyJoin, Target: ids[0]})
	return ids[0], ids[1]
}

// act sends a player's request at the character's current version.
func act(t *testing.T, ctx context.Context, r *running, id string, req api.ActionRequest) api.ActionReply {
	t.Helper()
	o, err := r.cli.Options(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	req.CharacterID, req.Version = id, o.Version
	rep, ref, err := r.cli.Act(ctx, req)
	if err != nil || ref != nil {
		t.Fatalf("%s: %+v %v", req.Kind, ref, err)
	}
	return rep
}

// TestPartyRoutes reads a party, the bot's board and the hunts through
// the API: every list is a list, never null, and the board and the
// thread hint carry the members' Discord users from the store.
func TestPartyRoutes(t *testing.T) {
	ctx := context.Background()
	r := start(t, io.Discard)
	a, b := partyOnServer(t, ctx, r)

	obj, _ := rawGet(t, r, api.PathParty+"?characterId="+a)
	hasKeys(t, "/v1/party", obj, "tick", "characterId", "version", "party", "reach", "invites", "thread")
	st, err := r.cli.Party(ctx, a)
	if err != nil || st.Party == nil || len(st.Party.Members) != 2 || !st.Party.Leader || st.Thread == nil ||
		!slices.Equal(st.Thread.Members, []string{"u-a", "u-b"}) || st.Thread.Party != st.Party.ID {
		t.Fatalf("the leader's party read: %+v %v", st, err)
	}
	if !slices.ContainsFunc(st.Reach, func(x api.Reachable) bool { return x.CharacterID == b && x.InParty }) {
		t.Fatalf("reach: %+v", st.Reach)
	}

	obj, _ = rawGet(t, r, api.PathParties)
	hasKeys(t, "/v1/parties", obj, "tick", "parties")
	board, err := r.cli.Parties(ctx)
	if err != nil || len(board.Parties) != 1 {
		t.Fatal(board, err)
	}
	pb := board.Parties[0]
	if pb.ID != st.Party.ID || len(pb.Members) != 2 || pb.Members[0].DiscordID != "u-a" || pb.Members[1].DiscordID != "u-b" || pb.Ended {
		t.Fatalf("the board: %+v", pb)
	}
	act(t, ctx, r, b, api.ActionRequest{InteractionID: "leave", Kind: api.ActPartyLeave})
	if board, _ = r.cli.Parties(ctx); len(board.Parties) != 1 || !board.Parties[0].Ended || board.Parties[0].ID != pb.ID {
		t.Fatalf("the board after the party ended: %+v", board)
	}

	obj, _ = rawGet(t, r, api.PathHunts)
	hasKeys(t, "/v1/hunts", obj, "tick", "every", "hunts")
}

// TestOptionsHidePicks holds one member's pick on a shared beat and reads
// the other's options over HTTP: who has picked shows, what never does.
func TestOptionsHidePicks(t *testing.T) {
	ctx := context.Background()
	r := start(t, io.Discard)
	a, b := partyOnServer(t, ctx, r)
	release := r.srv.Hold()
	g := r.srv.Game()
	sh := testkit.PartyMachineBeat(t, g, []*game.Char{g.Char(a), g.Char(b)}, puzzle.Rewire, 2)
	release()
	o, err := r.cli.Options(ctx, a)
	if err != nil || o.Fight == nil {
		t.Fatal(o, err)
	}
	pick := ""
	for _, x := range o.Fight.Options {
		if !x.Puzzle {
			pick = x.ID
		}
	}
	act(t, ctx, r, a, api.ActionRequest{InteractionID: "pick", Kind: api.ActPartyPick, Option: pick})
	_, body := rawGet(t, r, api.PathOptions+"?characterId="+b)
	for _, bad := range []string{`"picks"`, `"who"`, `"mine"`, `"option":"` + pick + `"`} {
		if strings.Contains(body, bad) {
			t.Errorf("the other member's options carry %s", bad)
		}
	}
	theirs, _ := r.cli.Options(ctx, b)
	f := theirs.Fight
	if f == nil || !f.Shared || len(f.Party) != 2 || !f.Party[0].Picked || f.Party[1].Picked || !f.Party[1].You {
		t.Fatalf("the other member's fight: %+v", f)
	}
	release = r.srv.Hold()
	opened := sh.Opened
	release()
	if opened == 0 {
		t.Fatal("a pick from chat opened no window: the service did not stamp it")
	}
}

// TestOperatorHunts opens a hunt with op hunt-start, which names no
// character, reads it on the hunts board, refuses a second of its row and
// a row that is not one, and replays; then hides a dungeon's given name.
func TestOperatorHunts(t *testing.T) {
	ctx := context.Background()
	r := start(t, io.Discard)
	rep, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "new", DiscordID: "u-h", Kind: api.ActCreate, Option: api.StartKnife})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	at := rep.Character.At
	row := "walking-factory"
	req := api.OperatorRequest{InteractionID: "op-hunt-1", CharacterID: rep.Character.ID, Kind: api.OpHuntStart, Asset: row, To: &at, Note: "a test hunt"}
	out := op(t, r, req)
	if out.Character.ID != "" || !slices.ContainsFunc(out.Facts, func(f api.Fact) bool { return f.Kind == "hunt.opened" }) {
		t.Fatalf("hunt-start replied %+v", out)
	}
	if again := op(t, r, req); !again.Duplicate {
		t.Fatal("a resent hunt-start was applied twice")
	}
	var stored string
	if err := r.pool.QueryRow(ctx, "SELECT character_id FROM mmo.action WHERE interaction_id = $1", req.InteractionID).Scan(&stored); err != nil || stored != "" {
		t.Fatalf("hunt-start stored under %q: %v", stored, err)
	}
	for _, tc := range []struct {
		req  api.OperatorRequest
		code string
	}{
		{api.OperatorRequest{InteractionID: "op-hunt-2", Kind: api.OpHuntStart, Asset: row, To: &at, Note: "again"}, api.CodeOpenHunt},
		{api.OperatorRequest{InteractionID: "op-hunt-3", Kind: api.OpHuntStart, Asset: "no-such-hunt", To: &at, Note: "no row"}, api.CodeNoSuchRow},
		{api.OperatorRequest{InteractionID: "op-hunt-4", Kind: api.OpHuntStart, Asset: row, Note: "nowhere"}, api.CodeBadArgs},
	} {
		if _, ref, _ := r.op.Operate(ctx, tc.req); ref == nil || ref.Code != tc.code {
			t.Errorf("%s: %+v, want %s", tc.req.InteractionID, ref, tc.code)
		}
	}
	hunts, err := r.cli.Hunts(ctx)
	if err != nil || len(hunts.Hunts) != 1 || hunts.Every != 1 {
		t.Fatal(hunts, err)
	}
	card := hunts.Hunts[0]
	if card.Row != row || card.Name == "" || card.Name == row || card.At != at || card.Health != card.Max || len(card.Spoils) == 0 || card.Closed ||
		card.Pressers == nil {
		t.Fatalf("the hunt's card: %+v", card)
	}
	if st, _ := r.cli.Party(ctx, rep.Character.ID); st.Party != nil {
		t.Fatalf("a hunter's party read: %+v", st)
	}
	advance(t, ctx, r, 2)
	tick, live := digest(t, ctx, r)
	replays(t, ctx, r, tick, live)

	release := r.srv.Hold()
	g := r.srv.Game()
	h, ok := testkit.Dungeon(g, 1)
	if ok {
		d := g.World.DungeonAt(h)
		d.Name, d.NamedBy = "The Drowned Stair", []string{rep.Character.ID}
	}
	release()
	if !ok {
		t.Skip("no dungeon near the first settlement")
	}
	to := api.Hex{Q: h.Q, R: h.R}
	hide := api.OperatorRequest{InteractionID: "op-hide-1", CharacterID: rep.Character.ID, Kind: api.OpHideName, To: &to, Note: "a rude name"}
	op(t, r, hide)
	release = r.srv.Hold()
	hidden, name := g.World.DungeonAt(h).Hidden, g.DungeonName(h)
	release()
	if !hidden || name == "The Drowned Stair" {
		t.Fatalf("the name after a hide: hidden %v, shown %q", hidden, name)
	}
	hide.InteractionID = "op-hide-2"
	if _, ref, _ := r.op.Operate(ctx, hide); ref == nil || ref.Code != api.CodeBadArgs {
		t.Fatalf("a second hide: %+v", ref)
	}
}
