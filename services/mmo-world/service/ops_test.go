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
	"slices"
	"strings"
	"sync"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/puzzle"
	simworld "jams.team/mmo-world/sim/world"
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
	for _, kind := range []string{api.OpPinReserve, api.OpPinEdit, api.OpPinWithdraw, api.OpContentFreeze} {
		if _, ref, _ := r.cli.Act(ctx, api.ActionRequest{InteractionID: "a-" + kind, CharacterID: id, Kind: kind}); ref == nil || ref.Code != api.CodeForbidden {
			t.Fatalf("%s on the player path: %+v", kind, ref)
		}
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
		{api.ActPartyInvite, game.PartyInvite}, {api.ActPartyJoin, game.PartyJoin}, {api.ActPartyLeave, game.PartyLeave},
		{api.ActPartyPick, game.PartyPick}, {api.ActPartyWindow, game.PartyWindow}, {api.ActFollow, game.Follow}, {api.ActUnfollow, game.Unfollow},
		{api.ActDungeonPush, game.DungeonPush}, {api.ActDungeonLeave, game.DungeonLeave}, {api.ActDungeonName, game.DungeonName},
		{api.ActKeyMake, game.KeyMake}, {api.ActHuntPress, game.HuntPress}, {api.ActDeckSwap, game.DeckSwap}, {api.ActFollowTrack, game.FollowTrack},
		{api.OpHuntStart, game.HuntStart}, {api.OpHideName, game.HideName},
		{api.MachineParty, game.SourceParty}, {api.MachineFork, game.SourceFork}, {api.MachineGuardian, game.SourceGuardian},
		{api.WayOpen, game.WayOption(0)}, {api.WayMachine, game.WayOption(1)}, {api.WayHidden, game.WayOption(2)},
		{api.CodeNotInParty, game.NotInParty}, {api.CodeInParty, game.InParty}, {api.CodePartyFull, game.PartyFull},
		{api.CodeOutOfReach, game.OutOfReach}, {api.CodeNoInvite, game.NoInvite}, {api.CodePicked, game.Picked}, {api.CodeNotDue, game.NotDue},
		{api.CodeNoFork, game.NoFork}, {api.CodeNoWay, game.NoWay}, {api.CodeChose, game.Chose}, {api.CodeNamed, game.Named},
		{api.CodeBadName, game.BadName}, {api.CodeNotLeader, game.NotLeader}, {api.CodeNoKeyMaker, game.NoKeyMaker}, {api.CodeShort, game.Short},
		{api.CodeNoHunt, game.NoHunt}, {api.CodePressed, game.Pressed}, {api.CodeOpenHunt, game.OpenHunt}, {api.CodeNoSuchRow, game.NoSuchRow},
		{api.CodeNoSlot, game.NoSlot}, {api.CodeSwapped, game.Swapped}, {api.CodeNoTrack, game.NoTrack}, {api.CodeRivalWon, game.RivalWon},
		{api.CodeNoRoute, game.NoRoute}, {api.CodeUsed, game.Used},
		{api.ActPromoteName, game.PromoteName}, {api.CodeNotFirst, game.NotFirst}, {api.CodeNameClosed, game.NameClosed},
		{api.ActKindName, game.KindName},
		{api.OpPinReserve, game.PinReserve}, {api.OpPinEdit, game.PinEdit}, {api.OpPinWithdraw, game.PinWithdraw}, {api.OpContentFreeze, game.ContentFreeze},
		{api.CodePinReach, simworld.CodePinReach}, {api.CodePinSeen, simworld.CodePinSeen}, {api.CodePinUnseen, simworld.CodePinUnseen},
		{api.CodePinGround, simworld.CodePinGround}, {api.CodePinPath, simworld.CodePinPath}, {api.CodePinFix, simworld.CodePinFix},
		{api.CodePinBudget, simworld.CodePinBudget}, {api.CodePinAnchor, simworld.CodePinAnchor}, {api.CodePinTaken, simworld.CodePinTaken},
		{api.CodePinEntered, simworld.CodePinEntered}, {api.CodePinGone, simworld.CodePinGone}, {api.CodeAlreadyFrozen, simworld.CodeAlreadyFrozen},
		{api.ActSteal, game.Steal}, {api.ActFence, game.Fence}, {api.ActPayFine, game.PayFine}, {api.ActFlee, game.Flee},
		{api.TheftLift, game.KindLift}, {api.TheftBurgle, game.KindBurgle}, {api.TheftWaylay, game.KindWaylay}, {api.TheftFlee, game.KindFlee},
		{api.CodeNoTarget, game.NoTarget}, {api.CodeNothingToSteal, game.NothingToSteal}, {api.CodeStoppedByWatch, game.StoppedCode},
		{api.CodeNotStopped, game.NotStopped}, {api.CodeShort, game.ShortCode}, {api.CodeNotHot, game.NotHot}, {api.CodeHotGoods, game.HotGoods},
		{api.CodeFenceHidden, game.FenceHidden}, {api.CodeFenceSpent, game.FenceSpent}, {api.CodeNotMade, game.NotMade}, {api.CodeNoDen, game.NoDen},
		{api.CodeHostile, game.HostileCode}, {api.CodeNotABacker, game.NotABacker}, {api.CodeShunned, game.Shunned},
		{api.CondWanted, char.WantedCondition},
		{api.LeaningUpright, npc.LeaningUpright}, {api.LeaningCrooked, npc.LeaningCrooked}, {api.LeaningNone, npc.LeaningNone},
		{api.MoodWarm, game.MoodWarm}, {api.MoodCold, game.MoodCold}, {api.MoodHostile, game.MoodHostile},
	} {
		if pair[0] != pair[1] {
			t.Errorf("the API says %q where the rules say %q", pair[0], pair[1])
		}
	}
	if api.Unseen != puzzle.Unseen {
		t.Errorf("the API's unseen element is %d where the rules' is %d", api.Unseen, puzzle.Unseen)
	}
	b := testkit.Book(t)
	var bands, kinds []string
	for _, r := range b.AlignBands {
		bands = append(bands, r.ID)
	}
	for _, r := range b.TheftKinds {
		kinds = append(kinds, r.ID)
	}
	if want := []string{api.BandNotorious, api.BandCrooked, api.BandUnremarked, api.BandDecent, api.BandUpright}; !slices.Equal(bands, want) {
		t.Errorf("the API's bands are %v where alignment.bands has %v", want, bands)
	}
	if want := []string{api.TheftLift, api.TheftBurgle, api.TheftWaylay, api.TheftFlee}; !slices.Equal(kinds, want) {
		t.Errorf("the API's theft kinds are %v where theft.kinds has %v", want, kinds)
	}
	if !slices.Contains(api.EventKinds, "theft.made") {
		t.Error("the events channel does not carry theft.made")
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
	for _, kind := range []string{api.ActMachineArm, api.ActMachineSolve} {
		if _, ref, _ := l.Act(ctx, api.ActionRequest{InteractionID: "m-" + kind, CharacterID: first.Character.ID, Version: first.Character.Version, Kind: kind}); ref == nil || ref.Code != api.CodeForbidden {
			t.Fatalf("%s from chat: %+v", kind, ref)
		}
	}
	if _, ref, _ := l.Act(ctx, api.ActionRequest{InteractionID: "a/1", CharacterID: first.Character.ID, Version: first.Character.Version, Kind: api.ActRest}); ref == nil || ref.Code != api.CodeBadArgs {
		t.Fatalf("an interaction id with a '/': %+v", ref)
	}
}
