package store_test

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
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
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	r, err := game.NewRules(b, keys.Throwaway("store-test"))
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// TestSaveLoad writes a game, plays it through commands and ticks with a
// save after each, and loads it back to the same digest; the deltas hold
// only tiles that differ from their baseline.
func TestSaveLoad(t *testing.T) {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, pgtest.DB(t))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	r := rules(t)
	g, err := game.New(r)
	if err != nil {
		t.Fatal(err)
	}
	st := store.New(pool, "w-test")
	now := time.Now()
	if err := st.EnsurePartitions(ctx, now); err != nil {
		t.Fatal(err)
	}
	if err := st.Create(ctx, store.Meta{ID: "w-test", KeyVersion: 1, KeyCheck: "x", SheetsDigest: "s", StartedAt: now, TickSeconds: 600}, g); err != nil {
		t.Fatal(err)
	}
	res, err := g.Act(game.Command{Key: "i-1", Kind: game.Create})
	if err != nil {
		t.Fatal(err)
	}
	c := res.Char
	if err := st.SaveAction(ctx, g, game.Command{Key: "i-1", Kind: game.Create}, c, "discord-1", []byte(`{}`), now); err != nil {
		t.Fatal(err)
	}
	cmds := []game.Command{
		{Key: "i-2", Char: c.C.ID, Kind: game.Correct, Asset: ledger.Provisions, Units: 3, Note: "test stock"},
		{Key: "i-3", Char: c.C.ID, Kind: game.Step, Dir: 0},
	}
	for _, cmd := range cmds {
		if _, err := g.Act(cmd); err != nil {
			t.Fatal(err)
		}
		if err := st.SaveAction(ctx, g, cmd, c, "", []byte(`{}`), now); err != nil {
			t.Fatal(err)
		}
	}
	for range 30 {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
		if _, err := st.SaveTick(ctx, g, 0, now); err != nil {
			t.Fatal(err)
		}
	}
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
