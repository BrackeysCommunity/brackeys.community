package service_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/api/client"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

// structural: the tokens of a world whose forget path is guarded.
const (
	apiToken    = "api-forget-test"
	forgetToken = "forget-new"
)

// startForget runs a world whose player API and forget path take tokens,
// with r.cli sending the API token.
func startForget(t *testing.T) *running {
	t.Helper()
	r := startOn(t, pgtest.Pool(t), io.Discard, func(c *service.Config) {
		c.APIToken, c.ForgetToken = apiToken, forgetToken+",forget-old"
	})
	r.cli = client.New(r.http.URL, apiToken)
	r.cli.Poll = time.Millisecond
	return r
}

// forgetAs posts a forget with a token and returns its status and reply.
func forgetAs(t *testing.T, r *running, token string, req api.ForgetRequest) (int, api.ForgetReply, api.Refusal) {
	t.Helper()
	b, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	hr, err := http.NewRequest(http.MethodPost, r.http.URL+api.PathForget, bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		hr.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := r.http.Client().Do(hr)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	var out api.ForgetReply
	var ref api.Refusal
	if resp.StatusCode == http.StatusOK {
		err = json.Unmarshal(raw, &out)
	} else {
		err = json.Unmarshal(raw, &ref)
	}
	if err != nil {
		t.Fatalf("%d %s: %v", resp.StatusCode, raw, err)
	}
	return resp.StatusCode, out, ref
}

// playerOf is GET /v1/player for a Discord user.
func playerOf(t *testing.T, ctx context.Context, r *running, discord string) string {
	t.Helper()
	var p api.Player
	if ref, err := r.cli.Do(ctx, http.MethodGet, api.PathPlayer+"?discordId="+discord, nil, &p); err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	return p.CharacterID
}

// storedDiscord is the Discord id a character row holds.
func storedDiscord(t *testing.T, ctx context.Context, r *running, id string) string {
	t.Helper()
	var d string
	if err := r.pool.QueryRow(ctx, `SELECT discord_id FROM mmo.character WHERE world_id = $1 AND id = $2`, world, id).Scan(&d); err != nil {
		t.Fatal(err)
	}
	return d
}

func auditClean(t *testing.T, ctx context.Context, r *running) {
	t.Helper()
	a, err := r.op.Audit(ctx)
	if err != nil || len(a.Discrepancies) != 0 {
		t.Fatalf("audit: %v %v", a.Discrepancies, err)
	}
}

// TestForgetRoute forgets a party member through POST /v1/forget with the
// forget token: a user with no character is told so, a wrong token is
// refused, a repeat is answered from the first, and the member's Discord
// user leaves every read at once and its holdings at the next tick.
func TestForgetRoute(t *testing.T) {
	ctx := context.Background()
	r := startForget(t)
	a, b := partyOnServer(t, ctx, r)

	for _, token := range []string{"", "nope", opToken, forgetToken + ",forget-old"} {
		if status, _, _ := forgetAs(t, r, token, api.ForgetRequest{InteractionID: "f-bad", DiscordID: "u-b"}); status != http.StatusUnauthorized {
			t.Errorf("a forget with token %q answered %d", token, status)
		}
	}
	resp, err := r.http.Client().Do(authed(t, http.MethodGet, r.http.URL+api.PathLexicon, forgetToken))
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("the forget token opened %s: %d", api.PathLexicon, resp.StatusCode)
	}
	if id := playerOf(t, ctx, r, "u-b"); id != b {
		t.Fatalf("u-b plays %q before the forget", id)
	}

	if status, out, _ := forgetAs(t, r, forgetToken, api.ForgetRequest{InteractionID: "f-none", DiscordID: "u-none"}); status != http.StatusOK || out.Forgotten || out.Swept {
		t.Fatalf("a user with no character: %d %+v", status, out)
	}
	for _, req := range []api.ForgetRequest{{InteractionID: "", DiscordID: "u-b"}, {InteractionID: "f-x", DiscordID: ""}, {InteractionID: "new-u-a", DiscordID: "u-b"}} {
		if status, _, ref := forgetAs(t, r, forgetToken, req); status != http.StatusBadRequest {
			t.Errorf("forget %+v answered %d %+v", req, status, ref)
		}
	}
	if storedDiscord(t, ctx, r, b) != "u-b" {
		t.Fatal("a refused forget forgot the character")
	}

	status, out, ref := forgetAs(t, r, "forget-old", api.ForgetRequest{InteractionID: "f-b", DiscordID: "u-b"})
	if status != http.StatusOK || !out.Forgotten || out.Swept {
		t.Fatalf("the forget: %d %+v %+v", status, out, ref)
	}
	if d := storedDiscord(t, ctx, r, b); d != store.Tombstone+b {
		t.Fatalf("the forgotten character's row holds %q", d)
	}
	if id := playerOf(t, ctx, r, "u-b"); id != "" {
		t.Fatalf("/v1/player still finds %q", id)
	}
	if id := playerOf(t, ctx, r, store.Tombstone+b); id != "" {
		t.Fatalf("/v1/player finds the tombstone: %q", id)
	}
	st, err := r.cli.Party(ctx, a)
	if err != nil || st.Thread == nil || !slices.Equal(st.Thread.Members, []string{"u-a"}) {
		t.Fatalf("the thread before the sweep: %+v %v", st.Thread, err)
	}
	board, err := r.cli.Parties(ctx)
	if err != nil || len(board.Parties) != 1 {
		t.Fatal(board, err)
	}
	for _, m := range board.Parties[0].Members {
		if want := map[string]string{a: "u-a", b: ""}[m.CharacterID]; m.DiscordID != want {
			t.Errorf("board member %s shows Discord user %q", m.CharacterID, m.DiscordID)
		}
	}

	if status, again, _ := forgetAs(t, r, apiToken, api.ForgetRequest{InteractionID: "f-b", DiscordID: "u-b"}); status != http.StatusOK || again != out {
		t.Fatalf("a repeat: %d %+v", status, again)
	}
	advance(t, ctx, r, 1)
	if status, swept, _ := forgetAs(t, r, forgetToken, api.ForgetRequest{InteractionID: "f-b", DiscordID: "u-b"}); status != http.StatusOK || !swept.Forgotten || !swept.Swept {
		t.Fatalf("a repeat after the sweep: %d %+v", status, swept)
	}
	if status, fresh, _ := forgetAs(t, r, forgetToken, api.ForgetRequest{InteractionID: "f-b-2", DiscordID: "u-b"}); status != http.StatusOK || fresh.Forgotten {
		t.Fatalf("a fresh forget of a forgotten user: %d %+v", status, fresh)
	}
	auditClean(t, ctx, r)
	if board, err = r.cli.Parties(ctx); err != nil {
		t.Fatal(err)
	}
	for _, p := range board.Parties {
		if slices.ContainsFunc(p.Members, func(m api.BoardMember) bool { return m.CharacterID == b }) {
			t.Fatalf("the swept member is still in a party: %+v", p)
		}
	}
	release := r.srv.Hold()
	c := r.srv.Game().Char(b)
	forget, forgotten := c.Forget, c.Forgotten
	release()
	if forget == 0 || forgotten == 0 {
		t.Fatalf("the character is asked %d, swept %d", forget, forgotten)
	}
}

// TestActForget forgets a player through /forget-me's action on POST
// /v1/actions, and a second through the operator path: both are the one
// recorded command, and every later press is refused.
func TestActForget(t *testing.T) {
	ctx := context.Background()
	r := startForget(t)
	ids := map[string]string{}
	for _, user := range []string{"u-me", "u-mail", "u-stays"} {
		rep, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "new-" + user, DiscordID: user, Kind: api.ActCreate, Option: api.StartKnife})
		if err != nil || ref != nil {
			t.Fatal(ref, err)
		}
		ids[user] = rep.Character.ID
	}
	advance(t, ctx, r, 2)
	act(t, ctx, r, ids["u-me"], api.ActionRequest{InteractionID: "forget-me", DiscordID: "u-me", Kind: api.ActForget})
	if _, ref, err := r.op.Operate(ctx, api.OperatorRequest{InteractionID: "op-forget", CharacterID: ids["u-mail"], Kind: api.ActForget,
		Note: "asked by email"}); err != nil || ref != nil {
		t.Fatalf("the operator's forget: %+v %v", ref, err)
	}
	for _, user := range []string{"u-me", "u-mail"} {
		id := ids[user]
		if d := storedDiscord(t, ctx, r, id); d != store.Tombstone+id {
			t.Fatalf("%s's row holds %q", user, d)
		}
		if got := playerOf(t, ctx, r, user); got != "" {
			t.Fatalf("/v1/player finds %s as %q", user, got)
		}
		o, err := r.cli.Options(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		_, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "after-" + user, CharacterID: id, Version: o.Version, Kind: api.ActForget})
		if err != nil || ref == nil || ref.Code != api.CodeForgotten {
			t.Fatalf("%s pressed again: %+v %v", user, ref, err)
		}
	}
	if got := playerOf(t, ctx, r, "u-stays"); got != ids["u-stays"] {
		t.Fatalf("the player who stays is %q", got)
	}
	advance(t, ctx, r, 4)
	auditClean(t, ctx, r)
	release := r.srv.Hold()
	for _, user := range []string{"u-me", "u-mail"} {
		if c := r.srv.Game().Char(ids[user]); c.Forgotten == 0 {
			release()
			t.Fatalf("%s was not swept", user)
		}
	}
	if !r.srv.Game().IsForgotten(ids["u-me"]) || r.srv.Game().IsForgotten(ids["u-stays"]) {
		release()
		t.Fatal("IsForgotten names the wrong characters")
	}
	release()
	_, live := digest(t, ctx, r)
	replays(t, ctx, r, 4, live)
	var kinds []string
	rows, err := r.pool.Query(ctx, `SELECT kind FROM mmo.action WHERE world_id = $1 AND kind = $2 ORDER BY seq`, world, game.Forget)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			t.Fatal(err)
		}
		kinds = append(kinds, k)
	}
	if rows.Close(); len(kinds) != 2 {
		t.Fatalf("recorded forgets: %v", kinds)
	}
}
