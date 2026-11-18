package service_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/harness/agent"
	"jams.team/mmo-world/replay"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

func TestMain(m *testing.M) { pgtest.Main(m) }

const (
	world   = "w-proof"
	opToken = "op-test-token"
)

var master = sha256.Sum256([]byte("mmo/test-master"))

type running struct {
	srv  *service.Server
	http *httptest.Server
	op   *agent.HTTP
	cli  *agent.HTTP
	pool *pgxpool.Pool
	stop func()
	book *sheets.Book
	set  keys.Set
}

func start(t *testing.T, dbURL string, logs io.Writer) *running {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	book, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	set, err := keys.Derive(master[:], world, 0)
	if err != nil {
		t.Fatal(err)
	}
	guard := service.NewGuard(logs)
	guard.Arm(keys.Needles(master[:], set))
	log := slog.New(slog.NewJSONHandler(guard, nil))
	if err := service.CheckKeys(ctx, pool, keys.Needles(master[:], set)); err != nil {
		t.Fatal(err)
	}
	srv, err := service.Open(ctx, pool, service.Config{World: world, KeyVersion: 1, TickSeconds: 600, Book: book, Keys: set,
		OperatorToken: opToken, ManualClock: true, Poll: time.Millisecond, Log: log, Events: service.NewEvents("", "", log)})
	if err != nil {
		t.Fatal(err)
	}
	hs := httptest.NewServer(srv.Handler())
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = srv.Run(ctx)
	}()
	r := &running{srv: srv, http: hs, op: agent.NewHTTP(hs.URL, opToken), cli: agent.NewHTTP(hs.URL, ""), pool: pool, book: book, set: set}
	r.stop = func() {
		cancel()
		<-done
		hs.Close()
		srv.Close(context.Background())
		pool.Close()
	}
	t.Cleanup(func() {
		if r.stop != nil {
			r.stop()
		}
	})
	return r
}

// advance sets the manual clock to tick and waits for the world to reach it.
func advance(t *testing.T, ctx context.Context, r *running, tick int64) {
	t.Helper()
	if _, err := r.op.Do(ctx, http.MethodPost, api.PathOperator+"/clock", map[string]int64{"due": tick}, nil); err != nil {
		t.Fatal(err)
	}
	for range 10000 {
		h, err := r.cli.Health(ctx)
		if err == nil && h.Tick >= tick {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("world never reached tick %d", tick)
}

func digest(t *testing.T, ctx context.Context, r *running) (int64, string) {
	t.Helper()
	var out struct {
		Tick   int64  `json:"tick"`
		Digest string `json:"digest"`
	}
	if ref, err := r.op.Do(ctx, http.MethodGet, api.PathOperator+"/digest", nil, &out); err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	return out.Tick, out.Digest
}

func players(b *sheets.Book) []*agent.Player {
	return agent.Players("u", 6, agent.Wanderer{BandOrder: agent.Bands(b)}, &agent.Traveller{})
}

// TestScriptedWeek is the milestone's proof: the scripted client plays a
// simulated week through the API; the world replays from its snapshots
// to the digests it recorded; the ledger holds; a double-sent action
// writes once; a preview never carries an outcome; and no key reaches
// the logs or the database.
func TestScriptedWeek(t *testing.T) {
	if testing.Short() {
		t.Skip("a simulated week")
	}
	ctx := context.Background()
	var logs bytes.Buffer
	r := start(t, pgtest.DB(t), &logs)
	week := int64(7 * sheets.TicksPerDay)
	ps := players(r.book)
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

	var audit struct {
		Discrepancies []string `json:"discrepancies"`
	}
	if ref, err := r.op.Do(ctx, http.MethodGet, api.PathOperator+"/audit", nil, &audit); err != nil || ref != nil || len(audit.Discrepancies) > 0 {
		t.Fatal("conservation check:", audit.Discrepancies, ref, err)
	}

	rules, err := game.NewRules(r.book, r.set)
	if err != nil {
		t.Fatal(err)
	}
	rep, err := replay.Run(ctx, store.New(r.pool, world), rules, 0, week)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Mismatch != nil || rep.Digest != d || rep.Checked != week {
		t.Fatalf("replay: %+v, live digest %s", rep, d)
	}
	t.Logf("replay: %d ticks and %d actions from tick %d, every digest matched", rep.Ticks, rep.Actions, rep.From)

	doubleSend(t, ctx, r, ps)
	preview(t, ctx, r, ps)

	if strings.Contains(logs.String(), "[redacted]") {
		t.Fatal("a key reached the log guard")
	}
	if err := service.CheckKeys(ctx, r.pool, keys.Needles(master[:], r.set)); err != nil {
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

// preview finds a character in a fight, previews every option, and checks
// that no preview names a chance, a roll or an outcome, and that
// previewing changes nothing.
func preview(t *testing.T, ctx context.Context, r *running, ps []*agent.Player) {
	for _, p := range ps {
		o, err := r.cli.Options(ctx, p.Character)
		if err != nil {
			t.Fatal(err)
		}
		if o.Fight == nil {
			if !o.Explore || o.Long != nil {
				continue
			}
			if _, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "explore-" + p.Discord, CharacterID: p.Character, Version: o.Version, Kind: api.ActExplore}); err != nil || ref != nil {
				continue
			}
			if o, err = r.cli.Options(ctx, p.Character); err != nil || o.Fight == nil {
				continue
			}
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
		return
	}
	t.Fatal("no character could be put in front of a beat to preview")
}
