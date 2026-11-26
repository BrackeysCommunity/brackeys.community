package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/season"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

// TestOpForget sends op forget on the operator path as /forget-me's
// command, with its note; one with no note sends nothing.
func TestOpForget(t *testing.T) {
	var sent []api.OperatorRequest
	mux := http.NewServeMux()
	mux.HandleFunc("POST "+api.PathOperator, func(w http.ResponseWriter, r *http.Request) {
		var req api.OperatorRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Error(err)
		}
		sent = append(sent, req)
		_, _ = w.Write([]byte(`{"tick":1,"character":{"id":"c-3"},"facts":[]}`))
	})
	hs := httptest.NewServer(mux)
	defer hs.Close()
	t.Setenv(service.EnvURL, hs.URL)
	t.Setenv(service.EnvOperatorToken, "op")
	if _, err := stdout(t, func() error { return run([]string{"-id", "op-f1", "forget", "c-3", "asked", "by", "email"}) }); err != nil {
		t.Fatal(err)
	}
	if err := run([]string{"forget", "c-3"}); err == nil {
		t.Fatal("a forget with no note ran")
	}
	want := api.OperatorRequest{InteractionID: "op-f1", CharacterID: "c-3", Kind: api.ActForget, Note: "asked by email"}
	if len(sent) != 1 || sent[0].InteractionID != want.InteractionID || sent[0].CharacterID != want.CharacterID ||
		sent[0].Kind != want.Kind || sent[0].Note != want.Note {
		t.Fatalf("sent %+v", sent)
	}
}

// TestVerifyFromEpoch verifies a world whose last world day crosses a
// rules epoch: the replay starts at the epoch, as op replay asks.
func TestVerifyFromEpoch(t *testing.T) {
	ctx := context.Background()
	sec, secrets := testkit.Secrets(t, "mmo/op-verify-epoch", "w-verify")
	book := testkit.Book(t)
	r := testkit.Rules(t, book, sec.Keys)
	digest, err := book.Digest()
	if err != nil {
		t.Fatal(err)
	}
	url := pgtest.DB(t)
	st, g, _ := testkit.Founded(t, ctx, pgtest.PoolOn(t, url), r, store.Meta{ID: "w-verify", KeyVersion: 1, KeyCheck: sec.Keys.Check(),
		SheetsDigest: digest, TickSeconds: 600})
	day := int64(sheets.TicksPerDay)
	testkit.Ticks(t, ctx, st, g, int(day-1))
	*g.Story.Clock = season.Clock{N: 1, Start: 1, Days: sheets.IntParam(book.StoryParams, "season-days")}
	testkit.Ticks(t, ctx, st, g, 1)
	testkit.Act(t, ctx, st, g, game.Command{Key: "season-epoch-1", Kind: game.SeasonEpoch,
		Epoch: &season.Epoch{From: digest, To: "next-sheets", Sheets: 1}}, "")
	testkit.Ticks(t, ctx, st, g, 40)
	for _, kv := range append(secrets, service.EnvDatabase+"="+url) {
		k, v, _ := strings.Cut(kv, "=")
		t.Setenv(k, v)
	}
	out, err := stdout(t, func() error { return run([]string{"verify"}) })
	if err != nil {
		t.Fatalf("verify: %v\n%s", err, out)
	}
	var v verified
	if err := json.Unmarshal([]byte(out), &v); err != nil {
		t.Fatal(err)
	}
	if v.Tick != day+40 || v.Replay.From != day || v.Replay.Checked != 40 || v.Replay.Mismatch != nil {
		t.Fatalf("verified %+v", v)
	}
}
