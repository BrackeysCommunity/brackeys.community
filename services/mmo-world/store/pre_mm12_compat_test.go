package store_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

// A world saved before staging and the house, imported through the store,
// loads at its saved digest with no house, no live stage, no staged good
// and no ground pin anywhere, and a world day on it reloads where it
// stood, still with none, its log empty and both audits holding.
func TestPreMM12WorldLoads(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	r := testkit.Rules(t, testkit.Book(t), keys.Throwaway("pre-mm12"))
	dir := filepath.Join(sheetfs.ModuleRoot(), "sim", "game", "testdata", "pre-mm12")
	read := func(name string) []byte {
		b, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	saved := strings.TrimSpace(string(read("digest.txt")))
	var g game.Game
	if err := json.Unmarshal(read("snapshot.json"), &g); err != nil {
		t.Fatal(err)
	}
	g.Attach(r)
	const world = "w-pre12"
	importGame(t, ctx, store.New(pool, world), world, &g)

	st := store.New(pool, world)
	old, err := st.Load(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	if d, _ := old.Digest(); d.String() != saved {
		t.Fatalf("the stored pre-MM12 world loads to %s, saved as %s", d, saved)
	}
	nothingStaged(t, ctx, pool, world, old, "at load")

	testkit.Ticks(t, ctx, st, old, int(sheets.TicksPerDay))
	back := reloadsAt(t, ctx, pool, world, r, old, "a world day on")
	nothingStaged(t, ctx, pool, world, back, "a world day on")
	if problems := ledger.Audit(back.Ledger.Balances(), back.Holdings()); len(problems) > 0 {
		t.Fatal(problems)
	}
	if bad, err := st.Audit(ctx); err != nil || len(bad) > 0 {
		t.Fatal(bad, err)
	}
	if p, err := st.AllHouseLog(ctx, 0, 0); err != nil || len(p.Rows) != 0 {
		t.Fatalf("a world nobody staged in logs %+v, %v", p.Rows, err)
	}
}

// nothingStaged requires a game, and its stored world row, to hold no
// house, live stage, staged good or landed ground.
func nothingStaged(t *testing.T, ctx context.Context, pool *pgxpool.Pool, world string, g *game.Game, when string) {
	t.Helper()
	if g.Houses != nil || g.Live != nil {
		t.Fatalf("%s: a world from before the house holds houses %v and live ops %v", when, g.Houses, g.Live)
	}
	for _, c := range g.Chars {
		if len(c.C.Staged) > 0 || c.C.StagedDay != 0 {
			t.Fatalf("%s: %s carries staged goods %+v from day %d", when, c.C.ID, c.C.Staged, c.C.StagedDay)
		}
	}
	for _, b := range g.Ledger.Balances() {
		if _, _, ok := ledger.StagedOf(b.Asset); ok || b.Account == ledger.FromStaged || b.Account == ledger.ToStaged {
			t.Fatalf("%s: the ledger holds %+v", when, b)
		}
	}
	market, err := json.Marshal(g.Market)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(market), `"staged"`) {
		t.Fatalf("%s: the market holds a staged book or listing", when)
	}
	for _, x := range g.World.Tiles {
		b, err := json.Marshal(x)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(b), `"ground"`) {
			t.Fatalf("%s: tile %s holds a ground pin", when, x.Hex.Ref())
		}
	}
	var keysIn bool
	if err := pool.QueryRow(ctx, `SELECT sim ? 'houses' OR sim ? 'live' FROM mmo.world WHERE id = $1`, world).Scan(&keysIn); err != nil {
		t.Fatal(err)
	}
	if keysIn {
		t.Fatalf("%s: the stored world row carries a house or live ops", when)
	}
}
