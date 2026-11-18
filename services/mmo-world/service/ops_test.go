package service_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/store/pgtest"
)

func op(t *testing.T, r *running, req api.OperatorRequest) api.ActionReply {
	t.Helper()
	var out api.ActionReply
	if ref, err := r.op.Do(context.Background(), http.MethodPost, api.PathOperator, req, &out); err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	return out
}

// TestOperator corrects a balance, grants a mount, bans and unbans, checks
// conservation, and resets the test world.
func TestOperator(t *testing.T) {
	ctx := context.Background()
	r := start(t, pgtest.DB(t), io.Discard)
	rep, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "c1", DiscordID: "u-1", Kind: api.ActCreate})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	id := rep.Character.ID
	if _, ref, _ := r.cli.Act(ctx, api.ActionRequest{InteractionID: "c2", DiscordID: "u-1", Kind: api.ActCreate}); ref == nil || ref.Code != api.CodeSecondPC {
		t.Fatalf("a second character for one user: %+v", ref)
	}
	if out := op(t, r, api.OperatorRequest{InteractionID: "o1", CharacterID: id, Kind: api.OpCorrect, Asset: "coin", Units: 5, Note: "test purse"}); out.Character.Coin != 5 {
		t.Fatalf("coin %d after a correction of 5", out.Character.Coin)
	}
	if out := op(t, r, api.OperatorRequest{InteractionID: "o2", CharacterID: id, Kind: api.OpGrant, Asset: "rad-goat", Note: "mount trial"}); out.Character.Mount == nil {
		t.Fatal("no mount after a grant")
	}
	if _, ref, _ := r.cli.Act(ctx, api.ActionRequest{InteractionID: "a1", CharacterID: id, Kind: api.OpCorrect}); ref == nil || ref.Code != api.CodeForbidden {
		t.Fatalf("an operator action on the player path: %+v", ref)
	}
	op(t, r, api.OperatorRequest{InteractionID: "o3", CharacterID: id, Kind: api.OpBan, Note: "test ban"})
	o, _ := r.cli.Options(ctx, id)
	if _, ref, _ := r.cli.Act(ctx, api.ActionRequest{InteractionID: "a2", CharacterID: id, Version: o.Version, Kind: api.ActRest}); ref == nil || ref.Code != "banned" {
		t.Fatalf("a banned character acted: %+v", ref)
	}
	op(t, r, api.OperatorRequest{InteractionID: "o4", CharacterID: id, Kind: api.OpUnban, Note: "appeal"})

	var audit struct {
		Discrepancies []string `json:"discrepancies"`
	}
	if ref, err := r.op.Do(ctx, http.MethodGet, api.PathOperator+"/audit", nil, &audit); err != nil || ref != nil || len(audit.Discrepancies) > 0 {
		t.Fatal(audit, ref, err)
	}
	if ref, _ := r.cli.Do(ctx, http.MethodGet, api.PathOperator+"/audit", nil, nil); ref == nil {
		t.Fatal("operator path open without the operator token")
	}

	advance(t, ctx, r, 3)
	if ref, err := r.op.Do(ctx, http.MethodPost, api.PathOperator+"/reset", map[string]string{"world": world}, nil); err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	if h, _ := r.cli.Health(ctx); h.Tick != 0 {
		t.Fatalf("tick %d after a reset", h.Tick)
	}
	if _, err := r.cli.Options(ctx, id); err == nil {
		t.Fatal("a character survived the reset")
	}
}

// TestKeyCheckFindsPlantedKey plants a key's base64 in a row and expects
// the start-up check to refuse.
func TestKeyCheckFindsPlantedKey(t *testing.T) {
	ctx := context.Background()
	r := start(t, pgtest.DB(t), io.Discard)
	needles := keys.Needles(master[:], r.set)
	if err := service.CheckKeys(ctx, r.pool, needles); err != nil {
		t.Fatal(err)
	}
	leak := base64.StdEncoding.EncodeToString(r.set.Quirk[:])
	if _, err := r.pool.Exec(ctx, `UPDATE mmo.world SET sim = jsonb_set(sim, '{leak}', to_jsonb($1::text))`, leak); err != nil {
		t.Fatal(err)
	}
	if err := service.CheckKeys(ctx, r.pool, needles); err == nil || !strings.Contains(err.Error(), "world") {
		t.Fatalf("a planted key passed the check: %v", err)
	}
}

func TestGuardRedacts(t *testing.T) {
	var out bytes.Buffer
	g := service.NewGuard(&out)
	set := keys.Throwaway("guard")
	g.Arm(keys.Needles(master[:], set))
	log := slog.New(slog.NewJSONHandler(g, nil))
	log.Info("oops", "key", base64.StdEncoding.EncodeToString(set.Roll[:]))
	if strings.Contains(out.String(), base64.StdEncoding.EncodeToString(set.Roll[:])) || g.Leaks.Load() != 1 {
		t.Fatalf("guard let a key through: %s", out.String())
	}
}

func TestEventsBatch(t *testing.T) {
	var mu sync.Mutex
	var got []map[string]any
	hs := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			APIKey string           `json:"api_key"`
			Batch  []map[string]any `json:"batch"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if r.URL.Path != "/batch/" || body.APIKey != "phc_test" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		mu.Lock()
		got = append(got, body.Batch...)
		mu.Unlock()
	}))
	defer hs.Close()
	e := service.NewEvents(hs.URL, "phc_test", slog.New(slog.NewTextHandler(io.Discard, nil)))
	e.Capture("mmo_tick", "w", map[string]any{"tick": 1})
	e.Capture("mmo_action", "c-1", map[string]any{"kind": "step"})
	e.Close()
	mu.Lock()
	defer mu.Unlock()
	if len(got) != 2 || got[0]["event"] != "mmo_tick" || got[1]["distinct_id"] != "c-1" {
		t.Fatalf("posthog got %v", got)
	}
}
