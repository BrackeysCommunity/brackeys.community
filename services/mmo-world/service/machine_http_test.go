package service_test

import (
	"context"
	"io"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/store/pgtest"
)

// rewired is the log that plugs every wire of a Rewire into its port.
func rewired(l api.PuzzleLayout) *api.PuzzleLog {
	log := &api.PuzzleLog{}
	for w, port := range l.Target {
		log.Moves = append(log.Moves, api.PuzzleMove{At: int64(w+1) * 200, A: int64(w), B: port})
	}
	return log
}

// TestMachinesOverHTTP works the bench through POST /v1/actions and the
// Activity's host, replays the stored commands to the live digest, then
// arms a machine and restarts the service: the countdown is still
// running, on the same deadline, and running out is a late haywire.
func TestMachinesOverHTTP(t *testing.T) {
	ctx := context.Background()
	var ahead atomic.Int64
	clock := func() time.Time { return time.Now().Add(time.Duration(ahead.Load())) }
	withClock := func(c *service.Config) { c.Now = clock }
	r := startOn(t, pgtest.Pool(t), io.Discard, withClock)
	var mu sync.Mutex
	var told [][]string
	r.srv.Subscribe(func(ids []string) {
		mu.Lock()
		defer mu.Unlock()
		told = append(told, ids)
	})
	heard := func() [][]string {
		mu.Lock()
		defer mu.Unlock()
		return slices.Clone(told)
	}
	rep, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "start", DiscordID: "tinker", Kind: api.ActCreate, Option: api.StartKnife})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	id, version := rep.Character.ID, rep.Character.Version
	if who, err := r.srv.CharacterOf(ctx, "tinker"); err != nil || who != id {
		t.Fatalf("tinker plays %q: %v", who, err)
	}
	if h := heard(); len(h) != 1 || !slices.Equal(h[0], []string{id}) {
		t.Fatalf("after a create the listener heard %v", h)
	}
	look := api.Viewer{Family: puzzle.Rewire, Level: 1}
	st, ok, err := r.srv.View(ctx, id, look)
	if err != nil || !ok || st.Bench == nil || st.Machine == nil || st.Machine.Source != api.MachineBench || st.Now == 0 {
		t.Fatalf("the bench where a new character stands: %+v %v", st, err)
	}
	here := readSolo[api.Here](t, r, api.PathHere+"?characterId="+id, 200)
	if here.Bench == nil || here.Bench.UsesCap == 0 || here.Bench.Uses != 0 {
		t.Fatalf("the place card's bench: %+v", here.Bench)
	}

	solve := api.ActionRequest{InteractionID: "bench-1", CharacterID: id, Version: version, Kind: api.ActBenchSolve,
		Machine: &api.MachineIntent{Family: look.Family, Level: look.Level, Log: rewired(st.Machine.Layout)}}
	rep, ref, err = r.cli.Act(ctx, solve)
	if err != nil || ref != nil || rep.Machine == nil || !rep.Machine.Solved || !slices.ContainsFunc(rep.Facts, func(f api.Fact) bool { return f.Kind == "bench.solved" }) {
		t.Fatalf("a bench solve over HTTP: %+v %v %v", rep, ref, err)
	}
	if again, _, _ := r.cli.Act(ctx, solve); !again.Duplicate || again.Machine == nil || !again.Machine.Solved {
		t.Fatalf("the same interaction again: %+v", again)
	}
	_, before := digest(t, ctx, r)
	solve.InteractionID, solve.Version, solve.Machine.Level = "bench-2", rep.Character.Version, 99
	if _, ref, _ := r.cli.Act(ctx, solve); ref == nil || ref.Code != api.CodeBadArgs {
		t.Fatalf("a bench level nobody offers: %+v", ref)
	}
	if _, after := digest(t, ctx, r); after != before {
		t.Fatal("a refused bench solve changed the world")
	}
	// The same log against the next machine is not a solve: it was drawn anew.
	st, _, _ = r.srv.View(ctx, id, look)
	solve.InteractionID, solve.Machine.Level, solve.Machine.Log = "bench-3", 1, &api.PuzzleLog{Moves: []api.PuzzleMove{{At: 10, A: 0, B: 0}}}
	if rep, ref, err = r.cli.Act(ctx, solve); err != nil || ref != nil || rep.Machine.Solved || rep.Machine.Haywire != "" {
		t.Fatalf("an unfinished bench log: %+v %v %v", rep.Machine, ref, err)
	}
	advance(t, ctx, r, 2)
	if h := heard(); h[len(h)-1] != nil {
		t.Fatalf("after a tick the listener heard %v", h[len(h)-1])
	}
	tick, live := digest(t, ctx, r)
	replays(t, ctx, r, tick, live)

	// A machine armed before a restart is still counting down after it.
	g := r.srv.Game()
	c := g.Char(id)
	testkit.MachineBeat(t, g, c, puzzle.Rewire, 2)
	st, _, _ = r.srv.View(ctx, id, api.Viewer{})
	log := rewired(st.Machine.Layout)
	armed, ref, err := r.srv.Act(ctx, api.ActionRequest{InteractionID: "act-arm", CharacterID: id, Version: c.Version, Kind: api.ActMachineArm,
		Machine: &api.MachineIntent{Source: api.MachineBeat}}, true)
	if err != nil || ref != nil || !armed.Character.Armed {
		t.Fatal(ref, err)
	}
	list, err := r.srv.Armed(ctx)
	if err != nil || len(list) != 1 || list[0].CharacterID != id {
		t.Fatalf("countdowns running: %+v %v", list, err)
	}
	if now := clock().UnixMilli(); list[0].Due <= now || list[0].Due > now+10*time.Minute.Milliseconds() {
		t.Fatalf("a deadline of %d at %d", list[0].Due, now)
	}
	if _, ref, _ := r.cli.Act(ctx, api.ActionRequest{InteractionID: "walk-off", CharacterID: id, Version: armed.Character.Version, Kind: api.ActPress, Option: "back-out"}); ref == nil || ref.Code != api.CodeMachineArmed {
		t.Fatalf("backing out of an armed machine: %+v", ref)
	}
	r.halt()
	r = startOn(t, r.pool, io.Discard, withClock)
	again, err := r.srv.Armed(ctx)
	if err != nil || !slices.Equal(again, list) {
		t.Fatalf("after a restart the countdowns are %+v, were %+v (%v)", again, list, err)
	}
	st, _, _ = r.srv.View(ctx, id, api.Viewer{})
	if st.Machine == nil || !st.Machine.Armed || st.Machine.Due != list[0].Due || st.Machine.Deadline+st.Machine.Grace != st.Machine.Due {
		t.Fatalf("the armed machine after a restart: %+v", st.Machine)
	}
	ahead.Store(int64(time.Until(time.UnixMilli(list[0].Due))) + int64(time.Second))
	late, ref, err := r.srv.Act(ctx, api.ActionRequest{InteractionID: "mx-" + id, CharacterID: id, Kind: api.ActMachineSolve, Machine: &api.MachineIntent{Log: log}}, false)
	if err != nil || ref != nil || late.Machine == nil || late.Machine.Solved || !late.Machine.Late || late.Machine.Haywire == "" {
		t.Fatalf("a log after the countdown ran out: %+v %v %v", late.Machine, ref, err)
	}
	if st, _, _ = r.srv.View(ctx, id, api.Viewer{}); st.Last == nil || !st.Last.Result.Late || st.Character.Armed {
		t.Fatalf("after the haywire: %+v", st.Last)
	}
	if _, ref, _ := r.srv.Act(ctx, api.ActionRequest{InteractionID: "mx-" + id + "-2", CharacterID: id, Kind: api.ActMachineSolve}, false); ref == nil || ref.Code != api.CodeNoMachine {
		t.Fatalf("a second expiry: %+v", ref)
	}
}
