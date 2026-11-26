package store_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/season"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

// foreignManifest checks the stored audit holds a live caravan's pool to
// its manifest: with the stored manifest naming another material, the
// goods in the pool read as a discrepancy. It puts the stored sim back.
func foreignManifest(t *testing.T, ctx context.Context, pool *pgxpool.Pool, st *store.Store, worldID, caravan string) {
	t.Helper()
	var raw []byte
	if err := pool.QueryRow(ctx, `SELECT sim FROM mmo.world WHERE id = $1`, worldID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.UseNumber()
	var sim map[string]any
	if err := dec.Decode(&sim); err != nil {
		t.Fatal(err)
	}
	cvs, _ := sim["emergence"].(map[string]any)["caravans"].([]any)
	i := slices.IndexFunc(cvs, func(x any) bool { return x.(map[string]any)["id"] == caravan })
	if i < 0 || cvs[i].(map[string]any)["material"] == nil {
		t.Fatalf("the stored caravan %s carries no manifest", caravan)
	}
	cvs[i].(map[string]any)["material"] = "foreign-good"
	bent, err := json.Marshal(sim)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE mmo.world SET sim = $1 WHERE id = $2`, bent, worldID); err != nil {
		t.Fatal(err)
	}
	bad, err := st.Audit(ctx)
	if _, rerr := pool.Exec(ctx, `UPDATE mmo.world SET sim = $1 WHERE id = $2`, raw, worldID); rerr != nil {
		t.Fatal(rerr)
	}
	if err != nil || !slices.ContainsFunc(bad, func(s string) bool { return strings.Contains(s, ledger.CaravanPool(caravan)) }) {
		t.Fatal("a foreign good in a live caravan's pool passed the stored audit:", bad, err)
	}
}

func emergenceJSON(t *testing.T, g *game.Game) string {
	t.Helper()
	b, err := json.Marshal(g.Emergence)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// emergenceReloads checks a fresh load of a world lands on g's digest and
// emergence state.
func emergenceReloads(t *testing.T, ctx context.Context, pool *pgxpool.Pool, worldID string, r *game.Rules, g *game.Game, what string) *game.Game {
	t.Helper()
	back, err := store.New(pool, worldID).Load(ctx, r)
	if err != nil {
		t.Fatalf("%s: %v", what, err)
	}
	want, _ := g.Digest()
	if d, _ := back.Digest(); d != want {
		t.Fatalf("%s: reloads at %s, the game stood at %s", what, d, want)
	}
	if got, want := emergenceJSON(t, back), emergenceJSON(t, g); got != want {
		t.Fatalf("%s: emergence reloads as\n%s\nwant\n%s", what, got, want)
	}
	return back
}

// A world saved before emergence loads from the store at its saved digest
// with no emergence state, takes emergence-start through the command save
// alone, reloads at the digest that left, and plays on.
func TestPreMM10WorldLoads(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	r := testkit.Rules(t, testkit.Book(t), keys.Throwaway("pre-mm10"))
	dir := filepath.Join(sheetfs.ModuleRoot(), "sim", "game", "testdata", "pre-mm10")
	body, err := os.ReadFile(filepath.Join(dir, "snapshot.json"))
	if err != nil {
		t.Fatal(err)
	}
	digest, err := os.ReadFile(filepath.Join(dir, "digest.txt"))
	if err != nil {
		t.Fatal(err)
	}
	saved := strings.TrimSpace(string(digest))
	var g game.Game
	if err := json.Unmarshal(body, &g); err != nil {
		t.Fatal(err)
	}
	g.Attach(r)
	now := time.Now()
	st := store.New(pool, "w-pre10")
	if err := st.EnsurePartitions(ctx, now); err != nil {
		t.Fatal(err)
	}
	m := store.Meta{ID: "w-pre10", KeyVersion: 1, KeyCheck: "x", SheetsDigest: "s", StartedAt: now, TickSeconds: 600}
	if err := st.Import(ctx, m, &g, func(c string) string { return "discord-" + c }, now); err != nil {
		t.Fatal(err)
	}

	st = store.New(pool, "w-pre10")
	old, err := st.Load(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	if d, _ := old.Digest(); d.String() != saved {
		t.Fatalf("the stored pre-MM10 world loads to %s, saved as %s", d, saved)
	}
	if old.Emergence != nil {
		t.Fatal("a world from before emergence loads with emergence state")
	}

	start := game.Command{Key: game.EmergenceStart, Kind: game.EmergenceStart}
	if res := testkit.Act(t, ctx, st, old, start, ""); res.Char != nil {
		t.Fatalf("emergence-start acted for %s", res.Char.C.ID)
	}
	if old.Emergence == nil {
		t.Fatal("emergence-start left no emergence state")
	}
	back := emergenceReloads(t, ctx, pool, st.World, r, old, "after emergence-start")
	if back.Emergence == nil || back.Emergence.Season != old.Emergence.Season {
		t.Fatalf("emergence reloads as %+v", back.Emergence)
	}
	held, _ := back.Digest()
	again := game.Command{Key: "emergence-start-again", Kind: game.EmergenceStart}
	var ref *game.Refused
	if _, err := back.Act(again); !errors.As(err, &ref) || ref.Code != game.BadArgs {
		t.Fatalf("a second emergence-start: %v", err)
	}
	if d, _ := back.Digest(); d != held {
		t.Fatal("a refused emergence-start changed the game")
	}

	st = store.New(pool, "w-pre10")
	if back, err = st.Load(ctx, r); err != nil {
		t.Fatal(err)
	}
	testkit.Ticks(t, ctx, st, back, int(sheets.TicksPerDay))
	emergenceReloads(t, ctx, pool, st.World, r, back, "a day after emergence-start")
	if bad, err := st.Audit(ctx); err != nil || len(bad) > 0 {
		t.Fatal(bad, err)
	}
}

// lowLines is the module's sheets with the road and route lines crossed by
// one step and one load, and season zero a day long.
func lowLines(t *testing.T) *sheets.Book {
	t.Helper()
	b := testkit.Book(t)
	for _, id := range []string{string(emerge.Road), string(emerge.Route)} {
		i := slices.IndexFunc(b.Promotions, func(p sheets.PromotionRow) bool { return p.ID == id })
		if i < 0 {
			t.Fatalf("no %s line", id)
		}
		b.Promotions[i].Count, b.Promotions[i].Distinct = 1, min(b.Promotions[i].Distinct, 1)
	}
	setStoryParam(t, b, "season-zero-days", 1)
	return b
}

func setStoryParam(t *testing.T, b *sheets.Book, id string, v int64) {
	t.Helper()
	i := slices.IndexFunc(b.StoryParams, func(p sheets.Param) bool { return p.ID == id })
	if i < 0 {
		t.Fatalf("no param %s", id)
	}
	b.StoryParams[i].Value = fixed.FromInt(v)
}

// beside is a tile next to the character's settlement it can step onto:
// in a region, with no placed content and no settlement.
func beside(t *testing.T, g *game.Game, c *game.Char) hex.Hex {
	t.Helper()
	for _, h := range c.C.At.Neighbours() {
		if _, _, ok := g.EnterCost(c, c.C.At, h, g.Tick()); !ok || g.World.RegionAt(h) < 0 || g.Placed(h) != nil || g.IsSettlement(h) || g.IsDungeon(h) {
			continue
		}
		return h
	}
	t.Fatal("no tile to step onto beside the settlement")
	return hex.Hex{}
}

// promotionsOf are a world's promotions of one type.
func promotionsOf(g *game.Game, ty emerge.Type) []emerge.Promotion {
	var out []emerge.Promotion
	for _, p := range g.Emergence.Promotions {
		if p.Type == ty {
			out = append(out, p)
		}
	}
	return out
}

// emergenceHeld checks the world still holds what it promoted: its roads
// laid on their tiles, the found material known to the item rules, and the
// caravan live with its goods in its pool.
func emergenceHeld(t *testing.T, g *game.Game, mat string, caravan string, what string) {
	t.Helper()
	e := g.Emergence
	if e == nil || len(promotionsOf(g, emerge.Road)) == 0 || len(promotionsOf(g, emerge.Route)) == 0 || len(e.Routes) == 0 {
		t.Fatalf("%s: the promotions are gone", what)
	}
	if len(e.Roads) == 0 {
		t.Fatalf("%s: no road", what)
	}
	for h, id := range e.Roads {
		if tl := g.World.Tile(h); tl == nil || tl.Road == 0 || e.RoadRecs[id] == nil {
			t.Fatalf("%s: the road %s at %s is not laid", what, id, h.Ref())
		}
	}
	if !slices.ContainsFunc(e.Materials, func(m sheets.Material) bool { return m.ID == mat }) {
		t.Fatalf("%s: the found material %s is gone", what, mat)
	}
	if _, ok := g.Rules().Values.Found.Get(mat); !ok {
		t.Fatalf("%s: the price rules do not know %s", what, mat)
	}
	i := slices.IndexFunc(e.Caravans, func(cv *emerge.Caravan) bool { return cv.ID == caravan })
	if i < 0 {
		t.Fatalf("%s: the caravan %s is not on the road", what, caravan)
	}
	if bad := ledger.Audit(g.Ledger.Balances(), g.Holdings()); len(bad) > 0 {
		t.Fatalf("%s: %v", what, bad)
	}
	if !slices.ContainsFunc(g.Holdings(), func(b ledger.Balance) bool { return b.Account == ledger.CaravanPool(caravan) && b.Units > 0 }) {
		t.Fatalf("%s: the caravan carries nothing", what)
	}
}

// What emergence made survives every way a world is saved and loaded: a
// road and a route promoted in play, a found material carried as the
// route's load, and the route's first caravan, live on its walk, hold
// through the tick save that sent it out, a rules epoch taken at the
// season's close (the store re-stamped and the world loaded on the new
// book), the epoch's command save, and a restart on fresh rules.
func TestEmergenceSurvivesSaves(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	k := keys.Throwaway("store-emergence")
	book, next := lowLines(t), lowLines(t)
	setStoryParam(t, next, "ruin-troubles", sheets.IntParam(book.StoryParams, "ruin-troubles")+1)
	from, err := book.Digest()
	if err != nil {
		t.Fatal(err)
	}
	to, err := next.Digest()
	if err != nil {
		t.Fatal(err)
	}
	r := testkit.Rules(t, book, k)
	const world = "w-emerge"
	st, g, c := testkit.Founded(t, ctx, pool, r, store.Meta{ID: world, KeyVersion: 1, KeyCheck: k.Check(), SheetsDigest: from, TickSeconds: 600})
	if g.Emergence == nil {
		t.Fatal("a new world has no emergence state")
	}
	emergenceReloads(t, ctx, pool, world, r, g, "founded")

	// A found material derived as a variant derives one, from a creature's
	// first drop; the variant that would make it is the sim's to prove.
	var found sheets.Material
	for _, cr := range book.Creatures {
		if len(cr.Drops) == 0 {
			continue
		}
		if base, ok := sheets.Lookup(book.Materials)[cr.Drops[0]]; ok {
			if found, ok = r.Emerge.Found(*base, book.Adaptations[0].ID); ok {
				break
			}
		}
	}
	if found.ID == "" {
		t.Fatal("no material to derive")
	}
	g.Emergence.Materials = append(g.Emergence.Materials, found)
	g.Attach(r)
	testkit.Act(t, ctx, st, g, game.Command{Key: "load", Char: c.C.ID, Kind: game.Correct, Asset: ledger.Material(found.ID), Units: 3, Note: "test load"}, "")

	// A second settlement a step away: the step lays a road and carries
	// the load between the two, which makes a route.
	to2 := beside(t, g, c)
	ns := c.C.At.Neighbours()
	g.Places = append(g.Places, &game.Place{N: len(g.Places), Hex: to2, Lattice: -1, Founded: g.Tick()})
	testkit.Act(t, ctx, st, g, game.Command{Key: "step", Char: c.C.ID, Kind: game.Step, Dir: slices.Index(ns[:], to2)}, "")
	for range 64 {
		if g.Char(c.C.ID).Long == nil {
			break
		}
		testkit.Ticks(t, ctx, st, g, 1)
	}
	if g.Char(c.C.ID).C.At != to2 {
		t.Fatal("the step did not arrive")
	}
	if len(promotionsOf(g, emerge.Road)) == 0 || len(promotionsOf(g, emerge.Route)) == 0 {
		t.Fatalf("the step promoted %+v", g.Emergence.Promotions)
	}
	emergenceReloads(t, ctx, pool, world, r, g, "after the step")

	// The day's turn sends the route's first caravan out and closes season
	// zero in the same tick.
	day := int64(sheets.TicksPerDay)
	testkit.Ticks(t, ctx, st, g, int(day-g.Tick()))
	if len(g.Emergence.Caravans) != 1 {
		t.Fatalf("%d caravans left at the day's turn", len(g.Emergence.Caravans))
	}
	caravan := g.Emergence.Caravans[0].ID
	if g.Emergence.Caravans[0].Arrive <= g.Tick() {
		t.Fatal("the caravan arrives as it leaves")
	}
	if clk, _, ok := g.Season(); !ok || !clk.Turned(g.Tick()) || clk.N != 1 {
		t.Fatalf("season zero did not close at the turn: %+v", clk)
	}
	emergenceHeld(t, g, found.ID, caravan, "the live game")
	back := emergenceReloads(t, ctx, pool, world, r, g, "after the tick save")
	emergenceHeld(t, back, found.ID, caravan, "after the tick save")

	// The epoch, as the service takes it at the close.
	if err := st.Restamp(ctx, from, to); err != nil {
		t.Fatal(err)
	}
	nr := testkit.Rules(t, next, k)
	if g, err = st.Load(ctx, nr); err != nil {
		t.Fatal(err)
	}
	emergenceHeld(t, g, found.ID, caravan, "loaded on the new book")
	testkit.Act(t, ctx, st, g, game.Command{Key: "season-epoch-1", Kind: game.SeasonEpoch,
		Epoch: &season.Epoch{From: from, To: to, Sheets: int64(len(sheets.Changed(book, next)))}}, "")
	back = emergenceReloads(t, ctx, pool, world, nr, g, "after the epoch's command save")
	emergenceHeld(t, back, found.ID, caravan, "after the epoch's command save")

	// A restart: a new process, new rules on the new book.
	fresh := testkit.Rules(t, next, k)
	st = store.New(pool, world)
	m, err := st.MetaFor(ctx, k, 1, 0, next)
	if err != nil || m.SheetsDigest != to {
		t.Fatalf("the restarted world is stamped %s: %v", m.SheetsDigest, err)
	}
	if g, err = st.Load(ctx, fresh); err != nil {
		t.Fatal(err)
	}
	emergenceHeld(t, g, found.ID, caravan, "after a restart")
	if bad, err := st.Audit(ctx); err != nil || len(bad) > 0 {
		t.Fatal("the stored audit with the caravan live:", bad, err)
	}
	foreignManifest(t, ctx, pool, st, world, caravan)
	testkit.Act(t, ctx, st, g, game.Command{Key: "unload", Char: c.C.ID, Kind: game.Correct, Asset: ledger.Material(found.ID), Units: -1, Note: "test unload"}, "")
	for range 4 * day {
		if !slices.ContainsFunc(g.Emergence.Caravans, func(cv *emerge.Caravan) bool { return cv.ID == caravan }) {
			break
		}
		testkit.Ticks(t, ctx, st, g, 1)
	}
	if slices.ContainsFunc(g.Emergence.Caravans, func(cv *emerge.Caravan) bool { return cv.ID == caravan }) {
		t.Fatal("the caravan never came in after the restart")
	}
	emergenceReloads(t, ctx, pool, world, fresh, g, "after the caravan came in")
	if bad, err := st.Audit(ctx); err != nil || len(bad) > 0 {
		t.Fatal(bad, err)
	}
}
