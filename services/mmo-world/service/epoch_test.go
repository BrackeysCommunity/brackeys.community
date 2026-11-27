package service_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"slices"
	"strings"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

// nextRoll is the test world's keys at roll epoch n, derived from the
// master testkit.Secrets uses.
func nextRoll(t *testing.T, n int32) keys.Set {
	t.Helper()
	m := sha256.Sum256([]byte("mmo/test-master"))
	k, err := keys.Derive(m[:], world, int64(n))
	if err != nil {
		t.Fatal(err)
	}
	return k
}

// stampOf is the sheets digest and roll epoch the store holds the world on.
func stampOf(t *testing.T, r *running) store.Stamp {
	t.Helper()
	m, err := store.New(r.pool, world).Meta(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return m.Stamp()
}

// epochFact is the stored season.epoch fact's data.
func epochFact(t *testing.T, r *running) fact.Fact {
	t.Helper()
	var data []byte
	if err := r.pool.QueryRow(context.Background(), "SELECT data FROM mmo.fact WHERE world_id = $1 AND kind = 'season.epoch'", world).Scan(&data); err != nil {
		t.Fatal(err)
	}
	var ds []fact.Datum
	if err := json.Unmarshal(data, &ds); err != nil {
		t.Fatal(err)
	}
	return fact.Fact{Data: ds}
}

// TestRollEpoch steps the roll key alone at season zero's close: the
// store moves rules_epoch on the same book, the fact records the roll
// epoch, the notes and the promotions route never show it, and the world
// reopens both on the old settings and on the ones the log line asks for.
func TestRollEpoch(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	book := shortSeasons(t)
	digest, err := book.Digest()
	if err != nil {
		t.Fatal(err)
	}
	one := int32(1)
	staged := func(c *service.Config) {
		c.Disposable, c.Book, c.NextEpoch, c.NextKeys = false, book, &one, nextRoll(t, one)
	}
	var logs bytes.Buffer
	r := startOn(t, pool, &logs, staged)
	end := int64(4 * sheets.TicksPerDay)
	advance(t, ctx, r, end-1)
	if strings.Contains(logs.String(), "EPOCH TAKEN") || stampOf(t, r) != (store.Stamp{Sheets: digest, Roll: 0}) {
		t.Fatal("the roll epoch was taken before the close")
	}
	advance(t, ctx, r, end)
	if got := stampOf(t, r); got != (store.Stamp{Sheets: digest, Roll: 1}) {
		t.Fatalf("after the close the world stands on %+v", got)
	}
	if !strings.Contains(logs.String(), service.EnvEpoch+"=1") || !strings.Contains(logs.String(), service.EnvEpochNext) {
		t.Fatalf("the log does not say which roll epoch to set:\n%s", logs.String())
	}
	if n := actionCount(t, ctx, r, "season-epoch-1"); n != 1 {
		t.Fatalf("%d epochs recorded", n)
	}
	if d, ok := epochFact(t, r).Get("roll"); !ok || d.N != 1 {
		t.Fatal("the season.epoch fact does not record the roll epoch")
	}
	notes, ok, err := store.New(pool, world).EpochNotes(ctx, 1)
	if err != nil || !ok || notes.From != digest || notes.To != digest || notes.Sheets != 0 || len(notes.Seen) != 0 || notes.Unseen != 0 {
		t.Fatalf("roll-only notes %+v %v %v", notes, ok, err)
	}
	promos := read[api.StoryEvents](t, r, true, api.PathStoryPromotions, 200)
	i := slices.IndexFunc(promos.Events, func(ev api.StoryEvent) bool { return ev.Fact.Kind == "season.epoch" })
	if i < 0 || promos.Events[i].Epoch == nil {
		t.Fatalf("no season.epoch with notes on the promotions route: %+v", promos.Events)
	}
	if slices.ContainsFunc(promos.Events[i].Fact.Data, func(d api.Datum) bool { return d.Key == "roll" }) {
		t.Fatal("the promotions route shows the roll step")
	}
	advance(t, ctx, r, end+1)
	_, live := digest2(t, r)

	r.halt()
	logs.Reset()
	back := startOn(t, pool, &logs, staged)
	if actionCount(t, ctx, back, "season-epoch-1") != 1 {
		t.Fatal("a restart on the old settings took the roll epoch again")
	}
	if _, d := digest2(t, back); d != live {
		t.Fatalf("restarted at %s, left at %s", d, live)
	}
	advance(t, ctx, back, end+2)
	_, live = digest2(t, back)

	back.halt()
	logs.Reset()
	moved := startOn(t, pool, &logs, func(c *service.Config) { c.Disposable, c.Book, c.Epoch, c.Keys = false, book, one, nextRoll(t, one) })
	if strings.Contains(logs.String(), "EPOCH TAKEN") {
		t.Fatal("a world on the new roll epoch took it again")
	}
	if _, d := digest2(t, moved); d != live {
		t.Fatalf("reopened on roll epoch 1 at %s, left at %s", d, live)
	}

	moved.halt()
	cfg := moved.cfg
	cfg.Epoch, cfg.Keys = 0, nextRoll(t, 0)
	if _, err := service.Open(ctx, pool, cfg); !errors.Is(err, store.ErrOtherKeys) {
		t.Fatalf("a world on roll epoch 1 opened on roll epoch 0: %v", err)
	}
}

// TestEpochRestartMidway is a world re-stamped onto the pending epoch at
// the close but stopped before the epoch was recorded: reopened with the
// same settings, it runs on the next stamp's rules and records the epoch
// and its notes once.
func TestEpochRestartMidway(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	book, next := shortSeasons(t), shortSeasons(t)
	ruin := sheets.IntParam(book.StoryParams, "ruin-troubles")
	setParam(t, next.StoryParams, "ruin-troubles", ruin+1)
	from, err := book.Digest()
	if err != nil {
		t.Fatal(err)
	}
	to, err := next.Digest()
	if err != nil {
		t.Fatal(err)
	}
	r := startOn(t, pool, io.Discard, func(c *service.Config) { c.Disposable, c.Book = false, book })
	end := int64(4 * sheets.TicksPerDay)
	advance(t, ctx, r, end)
	r.halt()
	if err := store.New(pool, world).RestampEpoch(ctx, store.Stamp{Sheets: from, Roll: 0}, store.Stamp{Sheets: to, Roll: 1}); err != nil {
		t.Fatal(err)
	}

	one := int32(1)
	var logs bytes.Buffer
	back := startOn(t, pool, &logs, func(c *service.Config) {
		c.Disposable, c.Book, c.Next, c.NextEpoch, c.NextKeys = false, book, next, &one, nextRoll(t, one)
	})
	if !strings.Contains(logs.String(), "EPOCH TAKEN") || actionCount(t, ctx, back, "season-epoch-1") != 1 {
		t.Fatalf("the epoch was not recorded at the reopen:\n%s", logs.String())
	}
	if read[api.Lexicon](t, back, true, api.PathLexicon, 200).Numbers.RuinTroubles != ruin+1 {
		t.Fatal("the reopened world runs on the old book")
	}
	if got := stampOf(t, back); got != (store.Stamp{Sheets: to, Roll: 1}) {
		t.Fatalf("the world stands on %+v", got)
	}
	f := epochFact(t, back)
	if d, _ := f.Get("to"); d.S != to {
		t.Fatalf("season.epoch %+v", f.Data)
	}
	if d, ok := f.Get("roll"); !ok || d.N != 1 {
		t.Fatal("the recorded epoch does not carry the roll epoch")
	}
	if n, ok, err := store.New(pool, world).EpochNotes(ctx, 1); err != nil || !ok || n.To != to || n.Unseen != 1 {
		t.Fatalf("notes after the reopen: %+v %v %v", n, ok, err)
	}
	advance(t, ctx, back, end+1)
}

// TestUnloadablePendingBook stages a book the live world cannot load
// under: the open fails with the reason before any tick runs, and the
// world is left as it was.
func TestUnloadablePendingBook(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	book := testkit.Book(t)
	r := startOn(t, pool, io.Discard, func(c *service.Config) { c.Disposable, c.Book = false, book })
	advance(t, ctx, r, 3)
	tick, live := digest2(t, r)
	r.halt()

	next := testkit.Book(t)
	// The weather reads this cell when a world is bound to its rules, not
	// when the rules are built.
	next.WorldParams = slices.DeleteFunc(next.WorldParams, func(p sheets.Param) bool { return p.ID == "weather-turn" })
	cfg := r.cfg
	cfg.Next = next
	srv, err := service.Open(ctx, pool, cfg)
	if err == nil {
		srv.Close(ctx)
		t.Fatal("a world opened on a pending book it cannot load")
	}
	if !strings.Contains(err.Error(), service.EnvSheetsNext) || !strings.Contains(err.Error(), "weather-turn") {
		t.Fatalf("the open failed without saying why: %v", err)
	}
	again := startOn(t, pool, io.Discard, func(c *service.Config) { c.Disposable, c.Book = false, book })
	if at, d := digest2(t, again); at != tick || d != live {
		t.Fatalf("the failed open moved the world: tick %d %s, was %d %s", at, d, tick, live)
	}
}

// TestRollEpochStepsBack refuses a pending roll epoch below the running one
// before the world is touched: it would put the world back on a used key.
func TestRollEpochStepsBack(t *testing.T) {
	sec, _ := testkit.Secrets(t, "mmo/test-master", world)
	zero := int32(0)
	sec.Epoch, sec.NextEpoch, sec.NextKeys = 1, &zero, nextRoll(t, zero)
	cfg := service.Config{Secrets: sec, TickSeconds: 600, Poll: time.Millisecond, Book: testkit.Book(t),
		Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	srv, err := service.Open(context.Background(), nil, cfg)
	if err == nil {
		srv.Close(context.Background())
		t.Fatal("a world opened on a roll epoch that steps back")
	}
	if !strings.Contains(err.Error(), service.EnvEpochNext) || !strings.Contains(err.Error(), service.EnvEpoch+"=") {
		t.Fatalf("the open failed without naming both settings: %v", err)
	}
}
