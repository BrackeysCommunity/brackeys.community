package store_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

func TestMain(m *testing.M) { pgtest.Main(m) }

// TestSqlcSeesEveryMigration fails when a drizzle migration touches the
// mmo schema but sqlc.yaml does not list it, so the generated queries
// would be built against a stale schema.
func TestSqlcSeesEveryMigration(t *testing.T) {
	listed := pgtest.Migrations(t)
	dirs, err := filepath.Glob(filepath.Join(sheetfs.ModuleRoot(), "..", "..", "drizzle", "*", "migration.sql"))
	if err != nil {
		t.Fatal(err)
	}
	var want []string
	for _, f := range dirs {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(b), `"mmo".`) || strings.Contains(string(b), `SCHEMA "mmo"`) {
			want = append(want, filepath.Clean(f))
		}
	}
	for i := range listed {
		listed[i] = filepath.Clean(listed[i])
	}
	slices.Sort(want)
	if !slices.Equal(listed, want) {
		t.Fatalf("sqlc.yaml lists %v; the mmo migrations are %v", listed, want)
	}
}

func rules(t testing.TB) *game.Rules {
	return testkit.Rules(t, testkit.Book(t), keys.Throwaway("store-test"))
}

// TestSaveLoad writes a game, plays it through commands and ticks with a
// save after each, and loads it back to the same digest; the deltas hold
// only tiles that differ from their baseline.
func TestSaveLoad(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	r := rules(t)
	st, g, c := testkit.Founded(t, ctx, pool, r, store.Meta{ID: "w-test", KeyVersion: 1, KeyCheck: "x", SheetsDigest: "s", TickSeconds: 600})
	now := time.Now()
	cmds := []game.Command{
		{Key: "i-2", Char: c.C.ID, Kind: game.Correct, Asset: ledger.Provisions, Units: 3, Note: "test stock"},
		{Key: "i-3", Char: c.C.ID, Kind: game.Step, Dir: 0},
	}
	for _, cmd := range cmds {
		testkit.Act(t, ctx, st, g, cmd, "")
	}
	testkit.Ticks(t, ctx, st, g, 30)
	want, _ := g.Digest()
	back, err := store.New(pool, "w-test").Load(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := back.Digest()
	if got != want {
		t.Fatalf("loaded digest %s, want %s", got, want)
	}
	if bad, err := st.Audit(ctx); err != nil || len(bad) > 0 {
		t.Fatal(bad, err)
	}
	var tiles, regions int
	if err := pool.QueryRow(ctx, "SELECT (SELECT count(*) FROM mmo.tile), (SELECT count(*) FROM mmo.region_state)").Scan(&tiles, &regions); err != nil {
		t.Fatal(err)
	}
	if tiles != len(g.World.Tiles) || regions != len(g.World.Regions) {
		t.Fatalf("%d tile and %d region rows for %d and %d", tiles, regions, len(g.World.Tiles), len(g.World.Regions))
	}
	if err := st.SaveAction(ctx, g, cmds[1], c, "", []byte(`{}`), now); err == nil {
		t.Fatal("a second write of one interaction id went through")
	}
}

// TestSocietySurvivesAReload plays goals, a guild and a raise project
// through saves, and loads them back to the same digest, then to the same
// digest again after the days that turn them.
func TestSocietySurvivesAReload(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	r := rules(t)
	st, g, _ := testkit.Founded(t, ctx, pool, r, store.Meta{ID: "w-test", KeyVersion: 1, KeyCheck: "x", SheetsDigest: "s", TickSeconds: 600})
	act := func(cmd game.Command) *game.Char {
		t.Helper()
		discord := ""
		if cmd.Kind == game.Create {
			discord = "user-" + cmd.Key
		}
		return testkit.Act(t, ctx, st, g, cmd, discord).Char
	}
	officer := act(game.Command{Key: "s-1", Kind: game.Create, Option: "hook", Server: "srv", Note: "The Reedwardens"})
	member := act(game.Command{Key: "s-2", Kind: game.Create, Option: "hook", Server: "srv"})
	act(game.Command{Key: "s-3", Char: member.C.ID, Kind: game.Correct, Asset: ledger.Coin, Units: 200, Note: "test purse"})
	act(game.Command{Key: "s-4", Char: member.C.ID, Kind: game.Deposit, Asset: ledger.Coin, Units: 50})
	act(game.Command{Key: "s-5", Char: officer.C.ID, Kind: game.Raise, Slot: "wall"})
	act(game.Command{Key: "s-6", Char: member.C.ID, Kind: game.PostGoal, Goal: &game.GoalSpec{Title: "Timber for the wall", Issuer: goal.ByCharacter,
		Reward: 40, Mode: goal.Pooled, Lifetime: goal.Season, Turnover: goal.Evolve,
		Cond: goal.Condition{Verb: goal.Deliver, Tag: "timber", Count: 10, At: "settlement:0"}}})
	if len(g.Goals) < 2 || len(g.Guilds) != 1 || g.Ledger.Of(g.Guilds[0].Pool(), ledger.Coin) != 50 {
		t.Fatalf("%d goals, %d guilds", len(g.Goals), len(g.Guilds))
	}
	same := func(when string) {
		t.Helper()
		want, _ := g.Digest()
		back, err := store.New(pool, "w-test").Load(ctx, r)
		if err != nil {
			t.Fatal(err)
		}
		if got, _ := back.Digest(); got != want {
			t.Fatalf("%s: loaded digest %s, want %s", when, got, want)
		}
		if len(back.Goals) != len(g.Goals) || len(back.Guilds) != len(g.Guilds) || len(back.Places) != len(g.Places) {
			t.Fatalf("%s: loaded %d goals, %d guilds, %d places", when, len(back.Goals), len(back.Guilds), len(back.Places))
		}
	}
	same("at once")
	testkit.Ticks(t, ctx, st, g, 2*sheets.TicksPerDay)
	same("after two days")
	if bad, err := st.Audit(ctx); err != nil || len(bad) > 0 {
		t.Fatal(bad, err)
	}
}

// TestACommandSavesWhomItChanged pays a member out of the treasury and
// audits before any tick is saved: the payee's stored purse is level with
// the stored ledger.
func TestACommandSavesWhomItChanged(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	st, g, _ := testkit.Founded(t, ctx, pool, rules(t), store.Meta{ID: "w-test", KeyVersion: 1, KeyCheck: "x", SheetsDigest: "s", TickSeconds: 600})
	act := func(cmd game.Command) *game.Char {
		t.Helper()
		discord := ""
		if cmd.Kind == game.Create {
			discord = "user-" + cmd.Key
		}
		return testkit.Act(t, ctx, st, g, cmd, discord).Char
	}
	officer := act(game.Command{Key: "p-1", Kind: game.Create, Option: "hook", Server: "srv", Note: "The Reedwardens", Admin: true})
	member := act(game.Command{Key: "p-2", Kind: game.Create, Option: "hook", Server: "srv"})
	act(game.Command{Key: "p-3", Char: officer.C.ID, Kind: game.Correct, Asset: ledger.Coin, Units: 50, Note: "test purse"})
	act(game.Command{Key: "p-4", Char: officer.C.ID, Kind: game.Deposit, Asset: ledger.Coin, Units: 50, Server: "srv", Admin: true})
	before := member.C.Coin
	act(game.Command{Key: "p-5", Char: officer.C.ID, Kind: game.Pay, Target: member.C.ID, Asset: ledger.Coin, Units: 20, Server: "srv", Admin: true})
	if member.C.Coin != before+20 {
		t.Fatalf("the member holds %d coin after a payment of 20 on %d", member.C.Coin, before)
	}
	if bad, err := st.Audit(ctx); err != nil || len(bad) > 0 {
		t.Fatal(bad, err)
	}
}

// founded is a fresh disposable world with one character in it.
func founded(t *testing.T, ctx context.Context, pool *pgxpool.Pool, r *game.Rules) (*store.Store, *game.Game, *game.Char) {
	t.Helper()
	return testkit.Founded(t, ctx, pool, r, store.Meta{ID: "w-test", KeyVersion: 1, KeyCheck: "x", SheetsDigest: "s", TickSeconds: 600, Disposable: true})
}

// TestStaleWriterConflicts has a second writer, loaded before an action
// that left the tick where it was, try to save a tick: it must be refused.
func TestStaleWriterConflicts(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	r := rules(t)
	st, g, c := founded(t, ctx, pool, r)
	stale := store.New(pool, "w-test")
	old, err := stale.Load(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	testkit.Act(t, ctx, st, g, game.Command{Key: "i-2", Char: c.C.ID, Kind: game.Correct, Asset: ledger.Coin, Units: 2, Note: "test purse"}, "")
	if _, err := old.Advance(); err != nil {
		t.Fatal(err)
	}
	if _, err := stale.SaveTick(ctx, old, 0, time.Now()); !errors.Is(err, store.ErrConflict) {
		t.Fatalf("a stale writer saved a tick: %v", err)
	}
	if _, err := store.New(pool, "w-test").Load(ctx, r); err != nil {
		t.Fatal(err)
	}
}

// TestResetEmptiesEveryTable resets a played world and expects no row of
// it in any table of the mmo schema.
func TestResetEmptiesEveryTable(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	st, g, _ := founded(t, ctx, pool, rules(t))
	testkit.Ticks(t, ctx, st, g, 3)
	if err := st.Reset(ctx); err != nil {
		t.Fatal(err)
	}
	rows, err := pool.Query(ctx, `SELECT c.relname, a.attname FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname IN ('world_id', 'id') AND a.attnum > 0
		WHERE n.nspname = 'mmo' AND c.relkind = 'r' AND (a.attname = 'world_id' OR c.relname = 'world')`)
	if err != nil {
		t.Fatal(err)
	}
	type col struct{ table, column string }
	cols, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (col, error) {
		var c col
		return c, r.Scan(&c.table, &c.column)
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(cols) < 12 {
		t.Fatalf("found only %v", cols)
	}
	for _, c := range cols {
		var n int
		q := fmt.Sprintf("SELECT count(*) FROM mmo.%s WHERE %s = $1", pgx.Identifier{c.table}.Sanitize(), pgx.Identifier{c.column}.Sanitize())
		if err := pool.QueryRow(ctx, q, "w-test").Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n > 0 {
			t.Errorf("%d rows of the reset world in mmo.%s", n, c.table)
		}
	}
}

// TestMatchesRefusesOtherEpoch: the key check names the generation key
// only, so a process on another roll epoch must be refused on its own.
func TestMatchesRefusesOtherEpoch(t *testing.T) {
	k := keys.Throwaway("epoch-test")
	m := store.Meta{ID: "w", KeyVersion: 1, KeyCheck: k.Check(), RulesEpoch: 2, SheetsDigest: "s"}
	if err := m.Matches(k, 1, 2, "s"); err != nil {
		t.Fatal(err)
	}
	if err := m.Matches(k, 1, 3, "s"); !errors.Is(err, store.ErrOtherKeys) {
		t.Fatalf("another roll epoch matched: %v", err)
	}
}
