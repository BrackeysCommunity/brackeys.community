package harness

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/api/client"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store/pgtest"
)

func TestMain(m *testing.M) { pgtest.Main(m) }

// TestLiveStages reads stages from the events and the story view as the
// live run sees them: a won goods side counts its mark met even when the
// last view came before the last unit, a raid held by its hunt does not,
// a lapse is read from the fact or, for a thread the events never carry,
// from the view.
func TestLiveStages(t *testing.T) {
	r := liveResult{arcs: map[string]*seasonArc{}, hunts: map[string]bool{}, places: map[int64]string{}, troubles: map[int64]*seasonPlace{}}
	n := func(k string, v int64) api.Datum { return api.Datum{Key: k, N: v} }
	s := func(k, v string) api.Datum { return api.Datum{Key: k, S: v} }
	siege := []api.Datum{s("arc", "arc-1"), s("template", "the-siege"), s("scope", "world")}
	raid := []api.Datum{s("arc", "arc-2"), s("template", "raid"), s("scope", "settlement"), n("settlement", 0)}
	data := func(base []api.Datum, more ...api.Datum) []api.Datum {
		return append(append([]api.Datum{}, base...), more...)
	}

	r.fact(api.Fact{Tick: 10, Kind: "arc.cast", Data: data(siege, n("stage", 0), n("due", 300), s("by", "director"), n("mark:garrison", 50), n("mark:besiegers", 50))})
	r.observe(api.StoryView{Arcs: []api.Arc{{ID: "arc-1", Template: "the-siege", Scope: "world", Regions: []string{"r-2", "r-5"}, Stage: 0, Stages: 3,
		Sides: []api.Side{{ID: "garrison", Mark: 50, Filled: 44, Backers: 3}, {ID: "besiegers", Mark: 50, Filled: 10, Backers: 1}}}}})
	r.fact(api.Fact{Tick: 40, Kind: "arc.stage-ended", Data: data(siege, n("stage", 0), s("side", "garrison"), n("backers", 4), n("units", 60))})
	r.fact(api.Fact{Tick: 40, Kind: "arc.stage-began", Data: data(siege, n("stage", 1), n("due", 600), n("mark:garrison", 50), n("mark:besiegers", 50))})
	r.observe(api.StoryView{Arcs: []api.Arc{{ID: "arc-1", Template: "the-siege", Scope: "world", Stage: 1, Stages: 3,
		Sides: []api.Side{{ID: "garrison", Mark: 50, Filled: 5, Backers: 1}}}}})
	r.fact(api.Fact{Tick: 600, Kind: "arc.stage-ended", Data: data(siege, n("stage", 1), s("side", "lapsed"), n("lapsed", 1))})

	r.fact(api.Fact{Tick: 50, Kind: "trouble.started", Data: data(raid, n("stage", 0), n("due", 194), s("hunt", "h-1"), n("mark:hold", 14))})
	r.observe(api.StoryView{Arcs: []api.Arc{{ID: "arc-2", Template: "raid", Scope: "settlement", Stages: 1,
		Cast:  []api.CastRef{{Role: "place", Kind: "settlement", ID: "0", Name: "Rustwell"}},
		Sides: []api.Side{{ID: "hold", Mark: 14, Filled: 3, Backers: 2}}}}})
	r.fact(api.Fact{Tick: 90, Kind: "trouble.held", Data: data(raid, n("stage", 0), s("side", "hold"))})

	r.observe(api.StoryView{Arcs: []api.Arc{{ID: "arc-3", Template: "the-debt", Scope: "personal", Stages: 1, Outcome: "lapsed", Lapsed: true,
		Sides: []api.Side{{ID: "pay", Mark: 1}}}}})
	r.fact(api.Fact{Tick: 2016, Kind: "season.finale", Data: []api.Datum{n("season", 0), s("template", "the-last-stand"), s("outcome", "hold")}})
	r.fact(api.Fact{Tick: 2016, Kind: "season.closed", Data: []api.Datum{n("season", 0)}})

	for _, a := range r.arcs {
		r.seasonResult.arcs = append(r.seasonResult.arcs, a)
	}
	if got := r.decided(); got != 1 {
		t.Errorf("%d stages decided by players, want the siege's first", got)
	}
	if got := r.lapsed(); got != 2 {
		t.Errorf("%d stages lapsed, want the siege's second and the debt", got)
	}
	a := r.arcs["arc-1"]
	if len(a.stages) != 2 || a.stages[0].sides[0].units != 50 || len(a.stages[0].sides[0].backers) != 3 || a.by != "director" || len(a.regions) != 2 {
		t.Errorf("the siege as read: %+v", a)
	}
	if raid := r.arcs["arc-2"].stages[0]; raid.won != "hold" || raid.decided() || raid.sides[0].units != 3 {
		t.Errorf("the raid held by its hunt as read: %+v", raid)
	}
	if at := r.troubles[0]; at == nil || at.held != 1 || r.places[0] != "Rustwell" {
		t.Errorf("troubles at settlement 0: %+v, named %q", at, r.places[0])
	}
	if !r.finale || r.finaleTemplate != "the-last-stand" || !r.closed || r.closedTick != 2016 {
		t.Errorf("finale %v %q, close %v at %d", r.finale, r.finaleTemplate, r.closed, r.closedTick)
	}
}

// TestSeasonLiveOnAService plays the live season for a few ticks against
// a disposable world on the manual clock: the players arrive and act over
// HTTP, the run reads the story view and the events each tick, and it
// ends on the world's own audit and digest.
func TestSeasonLiveOnAService(t *testing.T) {
	if testing.Short() {
		t.Skip("runs a world service")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sec, _ := testkit.Secrets(t, "mmo/season-live-test", "w-season-live")
	b := testkit.Book(t)
	srv, err := service.Open(ctx, pgtest.Pool(t), service.Config{Secrets: sec, TickSeconds: 600, Book: b, OperatorToken: "op", ManualClock: true,
		Disposable: true, Poll: time.Millisecond, Log: slog.New(slog.NewJSONHandler(io.Discard, nil))})
	if err != nil {
		t.Fatal(err)
	}
	hs := httptest.NewServer(srv.Handler())
	done := make(chan error, 1)
	go func() { done <- srv.Run(ctx) }()
	defer func() {
		cancel()
		if err := <-done; err != nil && !errors.Is(err, context.Canceled) {
			t.Errorf("the world stopped: %v", err)
		}
		hs.Close()
		srv.Close(context.Background())
	}()
	op, cli := client.New(hs.URL, "op"), client.New(hs.URL, "")
	op.Poll, cli.Poll = time.Millisecond, time.Millisecond
	const ticks = 40
	w := liveSeason{api: cli, op: op, limit: ticks, pace: func(ctx context.Context, n int64) (int64, error) {
		wait, stop := context.WithTimeout(ctx, 30*time.Second)
		defer stop()
		return n, op.Advance(wait, n)
	}}
	r, err := playLive(ctx, b, w)
	if err != nil {
		t.Fatal(err)
	}
	if r.end-r.start != ticks-1 || r.failed != 0 || r.lagged != 0 {
		t.Errorf("ticks %d to %d, %d failed, %d lagged", r.start, r.end, r.failed, r.lagged)
	}
	if r.actions == 0 {
		t.Error("no player acted")
	}
	zero := sheets.IntParam(b.StoryParams, "season-zero-days")
	if r.clock.N != 0 || r.clock.Start != 0 || r.clock.Days != zero {
		t.Errorf("clock %+v, want season 0 of %d days", r.clock, zero)
	}
	if len(r.audit) > 0 {
		t.Errorf("ledger: %v", r.audit)
	}
	d, err := op.Digest(ctx)
	if err != nil || d.Digest != r.digest {
		t.Errorf("digest %s, the world's %+v (%v)", r.digest, d, err)
	}
	if _, err := playLive(ctx, b, liveSeason{api: cli, op: client.New(hs.URL, "not-op"), pace: w.pace, limit: 1}); err == nil {
		t.Error("the run read the story without the operator's token")
	}
	m := liveReading(r)
	dir := t.TempDir()
	if err := liveDoc(b, hs.URL, r, m).save(dir, "season-live.md"); err != nil {
		t.Fatal(err)
	}
	if fi, err := os.Stat(filepath.Join(dir, "season-live.md")); err != nil || fi.Size() == 0 {
		t.Fatalf("report: %v", err)
	}
	t.Logf("%d actions, %d refused, %d offered sides; %s", r.actions, r.refuse, r.offered, m.Value)
}
