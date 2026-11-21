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
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/keys"
)

func op(t *testing.T, r *running, req api.OperatorRequest) api.ActionReply {
	t.Helper()
	out, ref, err := r.op.Operate(context.Background(), req)
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	return out
}

// TestOperator corrects a balance, grants a mount, bans and unbans, checks
// conservation, and resets the test world; a service that keeps its worlds
// refuses the reset.
func TestOperator(t *testing.T) {
	ctx := context.Background()
	r := start(t, io.Discard)
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
	if _, ref, _ := r.cli.Act(ctx, api.ActionRequest{InteractionID: "a2", CharacterID: id, Version: o.Version, Kind: api.ActRest}); ref == nil || ref.Code != api.CodeBanned {
		t.Fatalf("a banned character acted: %+v", ref)
	}
	op(t, r, api.OperatorRequest{InteractionID: "o4", CharacterID: id, Kind: api.OpUnban, Note: "appeal"})

	if audit, err := r.op.Audit(ctx); err != nil || len(audit.Discrepancies) > 0 {
		t.Fatal(audit, err)
	}
	if _, err := r.cli.Audit(ctx); err == nil {
		t.Fatal("operator path open without the operator token")
	}

	advance(t, ctx, r, 3)
	if _, err := r.op.Reset(ctx, world); err != nil {
		t.Fatal(err)
	}
	if h, _ := r.cli.Health(ctx); h.Tick != 0 {
		t.Fatalf("tick %d after a reset", h.Tick)
	}
	if _, err := r.cli.Options(ctx, id); err == nil {
		t.Fatal("a character survived the reset")
	}

	r.halt()
	kept := startOn(t, r.pool, io.Discard, func(c *service.Config) { c.Disposable = false })
	if _, err := kept.op.Reset(ctx, world); err == nil || !strings.Contains(err.Error(), "disposable") {
		t.Fatalf("a service that keeps its worlds reset one: %v", err)
	}
}

// TestKeyCheckFindsPlantedKey plants a key's base64 in a row and expects
// the start-up check to refuse.
func TestKeyCheckFindsPlantedKey(t *testing.T) {
	ctx := context.Background()
	r := start(t, io.Discard)
	needles := r.cfg.Needles
	if err := service.CheckKeys(ctx, r.pool, needles); err != nil {
		t.Fatal(err)
	}
	leak := base64.StdEncoding.EncodeToString(r.cfg.Keys.Quirk[:])
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
	g.Arm(keys.Needles([]byte("guard-master"), set))
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

// TestAPIMatchesRules ties the API's kinds and refusal codes to the rules'.
func TestAPIMatchesRules(t *testing.T) {
	for _, pair := range [][2]string{
		{api.ActCreate, game.Create}, {api.ActStep, game.Step}, {api.ActTravel, game.Travel}, {api.ActGather, game.Gather},
		{api.ActRest, game.Rest}, {api.ActCancel, game.Cancel}, {api.ActExplore, game.Explore}, {api.ActPress, game.Press},
		{api.OpCorrect, game.Correct}, {api.OpGrant, game.Grant}, {api.OpBan, game.Ban}, {api.OpUnban, game.Unban}, {api.OpMachine, game.SetMachine},
		{api.CodeNoSuchCharacter, game.NoSuchChar}, {api.CodeBusy, game.Busy}, {api.CodeBadArgs, game.BadArgs},
		{api.CodeNotHere, game.NotHere}, {api.CodeBanned, game.BannedCode}, {api.CodeNoEncounter, game.NoFight},
		{api.CodeNeedsActivity, game.InActivity}, {api.CodeDown, game.DownCode},
		{api.CondDown, char.Down}, {api.CondWounded, char.Wounded}, {api.CondHungry, char.Hungry},
		{api.ActMachineArm, game.MachineArm}, {api.ActMachineSolve, game.MachineSolve}, {api.ActBenchSolve, game.BenchSolve}, {api.ActBenchLesson, game.BenchLesson},
		{api.CodeNoMachine, game.NoMachine}, {api.CodeMachineArmed, game.MachineArmed}, {api.CodeLockedDown, game.LockedDown}, {api.CodeNoLesson, game.NoLesson},
		{api.MachineBeat, game.SourceBeat}, {api.MachinePouch, game.SourcePouch}, {api.MachineBench, game.SourceBench},
	} {
		if pair[0] != pair[1] {
			t.Errorf("the API says %q where the rules say %q", pair[0], pair[1])
		}
	}
}

// TestLocalRefusesAsHTTP plays a Local game and expects the refusals the
// HTTP path gives.
func TestLocalRefusesAsHTTP(t *testing.T) {
	ctx := context.Background()
	g, err := game.New(testkit.Rules(t, testkit.Book(t), keys.Throwaway("local-test")))
	if err != nil {
		t.Fatal(err)
	}
	l := service.NewLocal(g)
	if _, ref, _ := l.Act(ctx, api.ActionRequest{InteractionID: "c0", Kind: api.ActCreate}); ref == nil || ref.Code != api.CodeBadJSON {
		t.Fatalf("a create with no Discord user: %+v", ref)
	}
	first, ref, err := l.Act(ctx, api.ActionRequest{InteractionID: "c1", DiscordID: "u-1", Kind: api.ActCreate})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	if again, _, _ := l.Act(ctx, api.ActionRequest{InteractionID: "c1", DiscordID: "u-1", Kind: api.ActCreate}); !again.Duplicate || again.Character.ID != first.Character.ID {
		t.Fatalf("a double send: %+v", again)
	}
	if _, ref, _ := l.Act(ctx, api.ActionRequest{InteractionID: "c2", DiscordID: "u-1", Kind: api.ActCreate}); ref == nil || ref.Code != api.CodeSecondPC {
		t.Fatalf("a second character for one user: %+v", ref)
	}
	if _, ref, _ := l.Act(ctx, api.ActionRequest{InteractionID: "o1", CharacterID: first.Character.ID, Kind: api.OpCorrect}); ref == nil || ref.Code != api.CodeForbidden {
		t.Fatalf("an operator action on the player path: %+v", ref)
	}
	if _, ref, _ := l.Act(ctx, api.ActionRequest{InteractionID: "a/1", CharacterID: first.Character.ID, Version: first.Character.Version, Kind: api.ActRest}); ref == nil || ref.Code != api.CodeBadArgs {
		t.Fatalf("an interaction id with a '/': %+v", ref)
	}
}
