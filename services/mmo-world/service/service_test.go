package service_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/api/client"
	"jams.team/mmo-world/harness/agent"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/replay"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

func TestMain(m *testing.M) { pgtest.Main(m) }

const (
	world   = "w-proof"
	opToken = "op-test-token"
)

type running struct {
	srv  *service.Server
	http *httptest.Server
	op   *client.HTTP
	cli  *client.HTTP
	pool *pgxpool.Pool
	book *sheets.Book
	cfg  service.Config
	// done closes once Run has returned, with its error in runErr.
	done   chan struct{}
	runErr error
	stop   func()
}

// start runs a disposable world on the manual clock in a fresh database.
func start(t *testing.T, logs io.Writer) *running {
	t.Helper()
	return startOn(t, pgtest.Pool(t), logs, nil)
}

// startOn runs the world in pool; edit, if any, changes its config.
func startOn(t *testing.T, pool *pgxpool.Pool, logs io.Writer, edit func(*service.Config)) *running {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	sec, _ := testkit.Secrets(t, "mmo/test-master", world)
	guard := service.NewGuard(logs)
	guard.Arm(sec.Needles)
	if err := service.CheckKeys(ctx, pool, sec.Needles); err != nil {
		t.Fatal(err)
	}
	cfg := service.Config{Secrets: sec, TickSeconds: 600, Book: testkit.Book(t), OperatorToken: opToken, ManualClock: true,
		Disposable: true, Poll: time.Millisecond, Log: slog.New(slog.NewJSONHandler(guard, nil))}
	if edit != nil {
		edit(&cfg)
	}
	srv, err := service.Open(ctx, pool, cfg)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	hs := httptest.NewServer(srv.Handler())
	r := &running{srv: srv, http: hs, op: client.New(hs.URL, opToken), cli: client.New(hs.URL, ""), pool: pool, book: cfg.Book,
		cfg: cfg, done: make(chan struct{})}
	go func() {
		defer close(r.done)
		r.runErr = srv.Run(ctx)
	}()
	r.op.Poll, r.cli.Poll = time.Millisecond, time.Millisecond
	r.stop = func() {
		cancel()
		<-r.done
		hs.Close()
		srv.Close(context.Background())
	}
	t.Cleanup(func() {
		if r.stop != nil {
			r.stop()
		}
	})
	return r
}

// halt stops a running world before the test ends.
func (r *running) halt() {
	r.stop()
	r.stop = nil
}

// replays replays the world from tick 0 to tick to and expects it to end
// on the live digest.
func replays(t *testing.T, ctx context.Context, r *running, to int64, live string) replay.Report {
	t.Helper()
	rep, err := replay.Run(ctx, store.New(r.pool, world), testkit.Rules(t, r.book, r.cfg.Keys), 0, to)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Mismatch != nil || rep.Digest != live {
		t.Fatalf("replay: %+v, live digest %s", rep, live)
	}
	return rep
}

// structural: how long a test waits for the world to reach a tick.
const tickWait = 10 * time.Second

// advance sets the manual clock to tick and waits for the world to reach it.
func advance(t *testing.T, ctx context.Context, r *running, tick int64) {
	t.Helper()
	wait, cancel := context.WithTimeout(ctx, tickWait)
	defer cancel()
	if err := r.op.Advance(wait, tick); err != nil {
		t.Fatal(err)
	}
}

func digest(t *testing.T, ctx context.Context, r *running) (int64, string) {
	t.Helper()
	d, err := r.op.Digest(ctx)
	if err != nil {
		t.Fatal(err)
	}
	return d.Tick, d.Digest
}

// TestScriptedWeek has the scripted client play a simulated week through the
// API, then checks that the world replays to its recorded digests, the ledger
// holds, a double-sent action writes once, no preview carries an outcome, and
// no key reaches the logs or the database.
func TestScriptedWeek(t *testing.T) {
	if testing.Short() {
		t.Skip("a simulated week")
	}
	ctx := context.Background()
	var logs bytes.Buffer
	r := start(t, &logs)
	week := int64(7 * sheets.TicksPerDay)
	ps := testkit.Team(r.book, "u", 6)
	s := agent.NewScript(r.cli, ps, "week")
	for tick := int64(0); tick < week; tick++ {
		if err := s.Turn(ctx, tick); err != nil {
			t.Fatal(err)
		}
		advance(t, ctx, r, tick+1)
	}
	tick, d := digest(t, ctx, r)
	if tick != week {
		t.Fatalf("tick %d after a week", tick)
	}
	actions := 0
	for _, p := range ps {
		actions += p.Actions
		t.Logf("%s (%s, %s): %d actions, %d refused", p.Discord, p.Policy.Name(), p.Character, p.Actions, p.Refused)
	}
	var walked, fights, ambushes, defaults, ledgerTxns int64
	q := `SELECT (SELECT coalesce(sum((body->'c'->>'walked')::bigint), 0) FROM mmo.character),
		(SELECT count(*) FROM mmo.fact WHERE kind LIKE 'encounter.%'),
		(SELECT count(*) FROM mmo.fact WHERE kind = 'travel.ambushed'),
		(SELECT count(*) FROM mmo.fact WHERE kind = 'ambush.defaulted'),
		(SELECT count(*) FROM mmo.ledger_txn)`
	if err := r.pool.QueryRow(ctx, q).Scan(&walked, &fights, &ambushes, &defaults, &ledgerTxns); err != nil {
		t.Fatal(err)
	}
	t.Logf("week: %d actions, %d tiles walked, %d encounters ended, %d ambushes, %d defaulted, %d ledger transactions, digest %s",
		actions, walked, fights, ambushes, defaults, ledgerTxns, d)
	if actions == 0 || walked == 0 || fights == 0 || ledgerTxns == 0 {
		t.Fatal("the week did too little to prove anything")
	}

	if audit, err := r.op.Audit(ctx); err != nil || len(audit.Discrepancies) > 0 {
		t.Fatal("conservation check:", audit.Discrepancies, err)
	}

	rep := replays(t, ctx, r, week, d)
	if rep.Checked != week {
		t.Fatalf("replay checked %d of %d ticks", rep.Checked, week)
	}
	t.Logf("replay: %d ticks and %d actions from tick %d, every digest matched", rep.Ticks, rep.Actions, rep.From)

	doubleSend(t, ctx, r, ps)
	preview(t, ctx, r, s, ps, week)

	if strings.Contains(logs.String(), "[redacted]") {
		t.Fatal("a key reached the log guard")
	}
	if err := service.CheckKeys(ctx, r.pool, r.cfg.Needles); err != nil {
		t.Fatal(err)
	}
}

func doubleSend(t *testing.T, ctx context.Context, r *running, ps []*agent.Player) {
	p := ps[0]
	o, err := r.cli.Options(ctx, p.Character)
	if err != nil {
		t.Fatal(err)
	}
	req := api.ActionRequest{InteractionID: "double-1", CharacterID: p.Character, Version: o.Version, Kind: api.ActCancel}
	if o.Long == nil && o.Fight == nil {
		req.Kind, req.Dir = api.ActStep, 0
		for _, m := range o.Moves {
			if m.Open {
				req.Dir = m.Dir
				break
			}
		}
	}
	if o.Fight != nil {
		req.Kind, req.Option = api.ActPress, "hold"
	}
	first, ref, err := r.cli.Act(ctx, req)
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	second, ref, err := r.cli.Act(ctx, req)
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	if !second.Duplicate || second.Character.Version != first.Character.Version {
		t.Fatalf("second send: duplicate %v, version %d against %d", second.Duplicate, second.Character.Version, first.Character.Version)
	}
	var rows int
	if err := r.pool.QueryRow(ctx, "SELECT count(*) FROM mmo.action WHERE interaction_id = 'double-1'").Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("%d action rows for a double send (%v)", rows, err)
	}
	stale := req
	stale.InteractionID = "stale-1"
	if _, ref, err := r.cli.Act(ctx, stale); err != nil || ref == nil || ref.Code != api.CodeStale {
		t.Fatalf("a stale version was not refused: %+v %v", ref, err)
	}
}

// exploreTries is how often preview explores before trying the next
// player, and previewTicks how long the team plays on to find a beat.
const (
	exploreTries = 6
	previewTicks = 72
)

// preview plays the team on until a character stands in front of a beat,
// then checks its previews.
func preview(t *testing.T, ctx context.Context, r *running, s *agent.Script, ps []*agent.Player, tick int64) {
	for range previewTicks {
		if previewOnce(t, ctx, r, ps) {
			return
		}
		if err := s.Turn(ctx, tick); err != nil {
			t.Fatal(err)
		}
		tick++
		advance(t, ctx, r, tick)
	}
	t.Fatal("no character could be put in front of a beat to preview")
}

// previewOnce finds a character in a fight, previews every option, and
// checks that no preview names a chance, a roll or an outcome, and that
// previewing changes nothing.
func previewOnce(t *testing.T, ctx context.Context, r *running, ps []*agent.Player) bool {
	for _, p := range ps {
		o, err := r.cli.Options(ctx, p.Character)
		if err != nil {
			t.Fatal(err)
		}
		// A thin herd can leave an explore empty: try a few times.
		for try := 0; o.Fight == nil && o.Explore && o.Long == nil && try < exploreTries; try++ {
			if _, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: fmt.Sprintf("explore-%s-%d", p.Discord, try), CharacterID: p.Character, Version: o.Version, Kind: api.ActExplore}); err != nil || ref != nil {
				break
			}
			if o, err = r.cli.Options(ctx, p.Character); err != nil {
				t.Fatal(err)
			}
		}
		if o.Fight == nil {
			continue
		}
		_, before := digest(t, ctx, r)
		for _, opt := range o.Fight.Options {
			var raw json.RawMessage
			if ref, err := r.cli.Do(ctx, http.MethodPost, api.PathPreview, api.PreviewRequest{CharacterID: p.Character, Option: opt.ID}, &raw); err != nil || ref != nil {
				t.Fatal(ref, err)
			}
			var fields map[string]any
			if err := json.Unmarshal(raw, &fields); err != nil {
				t.Fatal(err)
			}
			for _, banned := range []string{"chance", "draw", "rolled", "success", "outcome", "margin"} {
				if _, ok := fields[banned]; ok {
					t.Fatalf("preview of %s carries %q: %s", opt.ID, banned, raw)
				}
			}
			if fields["band"] == "" {
				t.Fatalf("preview of %s has no band", opt.ID)
			}
		}
		if _, after := digest(t, ctx, r); after != before {
			t.Fatal("a preview changed the world")
		}
		return true
	}
	return false
}

// TestFailedSaveReloads breaks the stored world row under a running
// service: the tick's save fails, the world goes stale and nothing is
// served from it. Once the row is right again the world loads, ticks,
// takes actions and replays to its recorded digests.
func TestFailedSaveReloads(t *testing.T) {
	ctx := context.Background()
	r := start(t, io.Discard)
	advance(t, ctx, r, 2)
	var good string
	if err := r.pool.QueryRow(ctx, "SELECT digest FROM mmo.world WHERE id = $1", world).Scan(&good); err != nil {
		t.Fatal(err)
	}
	if _, err := r.pool.Exec(ctx, "UPDATE mmo.world SET digest = 'broken' WHERE id = $1", world); err != nil {
		t.Fatal(err)
	}
	if err := r.op.SetClock(ctx, 3); err != nil {
		t.Fatal(err)
	}
	down, cancel := context.WithTimeout(ctx, tickWait)
	defer cancel()
	if err := r.cli.WaitHealth(down, func(_ api.Health, err error) bool { return err != nil }); err != nil {
		t.Fatal("health stayed up while the world could not load")
	}
	if _, err := r.op.Digest(ctx); err == nil {
		t.Fatal("a stale world was served")
	}
	if _, err := r.pool.Exec(ctx, "UPDATE mmo.world SET digest = $2 WHERE id = $1", world, good); err != nil {
		t.Fatal(err)
	}
	advance(t, ctx, r, 3)
	if _, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "after-1", DiscordID: "u-after", Kind: api.ActCreate}); err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	advance(t, ctx, r, 4)
	if h, err := r.cli.Health(ctx); err != nil || !h.OK {
		t.Fatalf("health after recovery: %+v %v", h, err)
	}
	tick, d := digest(t, ctx, r)
	replays(t, ctx, r, tick, d)
}

// TestStaleRecoversWithoutTraffic breaks the world row so an action's save
// fails and the world goes stale with no tick due, mends it, and expects
// health to come back with no further request.
func TestStaleRecoversWithoutTraffic(t *testing.T) {
	ctx := context.Background()
	r := start(t, io.Discard)
	advance(t, ctx, r, 1)
	var good string
	if err := r.pool.QueryRow(ctx, "SELECT digest FROM mmo.world WHERE id = $1", world).Scan(&good); err != nil {
		t.Fatal(err)
	}
	if _, err := r.pool.Exec(ctx, "UPDATE mmo.world SET digest = 'broken' WHERE id = $1", world); err != nil {
		t.Fatal(err)
	}
	if _, _, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "c-stale", DiscordID: "u-stale", Kind: api.ActCreate}); err == nil {
		t.Fatal("an action saved over a broken world row")
	}
	wait, cancel := context.WithTimeout(ctx, tickWait)
	defer cancel()
	if err := r.cli.WaitHealth(wait, func(_ api.Health, err error) bool { return err != nil }); err != nil {
		t.Fatal("health stayed up while the world could not load")
	}
	if _, err := r.pool.Exec(ctx, "UPDATE mmo.world SET digest = $2 WHERE id = $1", world, good); err != nil {
		t.Fatal(err)
	}
	if err := r.cli.WaitHealth(wait, func(h api.Health, err error) bool { return err == nil && h.OK && h.Tick == 1 }); err != nil {
		t.Fatal("the world did not recover by itself")
	}
}

// TestLostLockStopsRun ends the lock's connection under a running world
// and expects Run to stop with the lock lost.
func TestLostLockStopsRun(t *testing.T) {
	ctx := context.Background()
	r := start(t, io.Discard)
	var n int
	if err := r.pool.QueryRow(ctx, `SELECT count(pg_terminate_backend(pid)) FROM pg_locks
		WHERE locktype = 'advisory' AND pid <> pg_backend_pid()`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("ended %d lock holders (%v)", n, err)
	}
	select {
	case <-r.done:
	case <-time.After(tickWait):
		t.Fatal("Run kept going without its lock")
	}
	if r.runErr == nil || !strings.Contains(r.runErr.Error(), "lost the world's lock") {
		t.Fatalf("Run returned %v", r.runErr)
	}
}

// TestOtherEpochRefused founds a world, then opens it on another roll
// epoch: the roll key differs, so the open must be refused.
func TestOtherEpochRefused(t *testing.T) {
	r := start(t, io.Discard)
	r.halt()
	cfg := r.cfg
	cfg.Epoch++
	if _, err := service.Open(context.Background(), r.pool, cfg); !errors.Is(err, store.ErrOtherKeys) {
		t.Fatalf("a world opened on another roll epoch: %v", err)
	}
}
