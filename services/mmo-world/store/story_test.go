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

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/season"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/db"
	"jams.team/mmo-world/store/pgtest"
)

func storyJSON(t *testing.T, g *game.Game) string {
	t.Helper()
	b, err := json.Marshal(g.Story)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// reloads checks a fresh load of a world lands on g's digest and story.
func reloads(t *testing.T, ctx context.Context, pool *pgxpool.Pool, worldID string, r *game.Rules, g *game.Game, what string) *game.Game {
	t.Helper()
	back, err := store.New(pool, worldID).Load(ctx, r)
	if err != nil {
		t.Fatalf("%s: %v", what, err)
	}
	want, _ := g.Digest()
	if d, _ := back.Digest(); d != want {
		t.Fatalf("%s: reloads at %s, the game stood at %s", what, d, want)
	}
	if got, want := storyJSON(t, back), storyJSON(t, g); got != want {
		t.Fatalf("%s: the story reloads as\n%s\nwant\n%s", what, got, want)
	}
	return back
}

// A world saved before seasons loads from the store at its saved digest
// with no story, takes season-start through the command save, and reloads
// at the digest that left, with the season's clock.
func TestPreMM9WorldLoads(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	r := testkit.Rules(t, testkit.Book(t), keys.Throwaway("pre-mm9"))
	dir := filepath.Join(sheetfs.ModuleRoot(), "sim", "game", "testdata", "pre-mm9")
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
	st := store.New(pool, "w-pre9")
	if err := st.EnsurePartitions(ctx, now); err != nil {
		t.Fatal(err)
	}
	m := store.Meta{ID: "w-pre9", KeyVersion: 1, KeyCheck: "x", SheetsDigest: "s", StartedAt: now, TickSeconds: 600}
	if err := st.Import(ctx, m, &g, func(c string) string { return "discord-" + c }, now); err != nil {
		t.Fatal(err)
	}

	st = store.New(pool, "w-pre9")
	old, err := st.Load(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	if d, _ := old.Digest(); d.String() != saved {
		t.Fatalf("the stored pre-MM9 world loads to %s, saved as %s", d, saved)
	}
	if old.Story != nil {
		t.Fatal("a world from before seasons loads with a story")
	}

	if res := testkit.Act(t, ctx, st, old, game.Command{Key: game.SeasonStart, Kind: game.SeasonStart}, ""); res.Char != nil {
		t.Fatalf("season-start acted for %s", res.Char.C.ID)
	}
	if d, _ := old.Digest(); d.String() == saved {
		t.Fatal("season-start changed nothing")
	}
	back := reloads(t, ctx, pool, st.World, r, old, "after season-start")
	c, _, ok := back.Season()
	days := sheets.IntParam(r.Book.WorldParams, "season-days")
	if n := back.World.Day / days; !ok || c != (season.Clock{N: n, Start: n * days, Days: days, Legacy: true}) {
		t.Fatalf("after season-start on day %d the reloaded clock is %+v (%v)", back.World.Day, c, ok)
	}

	st = store.New(pool, "w-pre9")
	if back, err = st.Load(ctx, r); err != nil {
		t.Fatal(err)
	}
	testkit.Ticks(t, ctx, st, back, int(sheets.TicksPerDay))
	reloads(t, ctx, pool, st.World, r, back, "a day after season-start")
	if bad, err := st.Audit(ctx); err != nil || len(bad) > 0 {
		t.Fatal(bad, err)
	}
}

// A new world's story survives the tick save across a day's turn and the
// command save of an operator's cast.
func TestStorySurvivesSaves(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	r := rules(t)
	st, g, c := testkit.Founded(t, ctx, pool, r, store.Meta{ID: "w-story", KeyVersion: 1, KeyCheck: "x", SheetsDigest: "s", TickSeconds: 600})
	if g.Story == nil {
		t.Fatal("a new world has no story")
	}
	reloads(t, ctx, pool, st.World, r, g, "founded")
	testkit.Ticks(t, ctx, st, g, int(sheets.TicksPerDay)+1)
	reloads(t, ctx, pool, st.World, r, g, "past a day's turn")

	n, ok := g.SettlementAt(c.C.At)
	if !ok {
		t.Fatal("the character does not stand at a settlement")
	}
	cast := arc.Cast{{Role: "front", Ref: arc.RegionRef(g.World.RegionAt(c.C.At))}, {Role: "seat", Ref: arc.SettlementRef(n)}}
	arcs := len(g.Story.Arcs)
	testkit.Act(t, ctx, st, g, game.Command{Key: "cast-overrun", Kind: game.ArcCast, Arc: &game.ArcCmd{Template: "the-overrun", Cast: cast}}, "")
	if len(g.Story.Arcs) != arcs+1 {
		t.Fatal("the cast added no arc")
	}
	back := reloads(t, ctx, pool, st.World, r, g, "after the cast's command save alone")
	if a := back.Story.Arcs[len(back.Story.Arcs)-1]; a.Template != "the-overrun" || len(a.Stages) == 0 {
		t.Fatalf("the cast arc reloads as %+v", a)
	}
}

// storedFact is a fact row written straight to the store.
type storedFact struct {
	id, tick, weight int64
	kind             string
	causes           []fact.ID
}

func insertFacts(t *testing.T, ctx context.Context, q *db.Queries, worldID string, fs []storedFact) {
	t.Helper()
	rows := make([]db.InsertFactsParams, len(fs))
	for i, f := range fs {
		causes, err := json.Marshal(f.causes)
		if err != nil {
			t.Fatal(err)
		}
		subj, _ := json.Marshal([]fact.Ref{char.Ref("c-1")})
		rows[i] = db.InsertFactsParams{WorldID: worldID, ID: f.id, Tick: f.tick, Kind: f.kind, Region: pgtype.Text{String: "region:0", Valid: true},
			Weight: int32(f.weight), Subjects: subj, Data: []byte(`[]`), Causes: causes, At: pgtype.Timestamptz{Time: time.Now(), Valid: true}}
	}
	if _, err := q.InsertFacts(ctx, rows); err != nil {
		t.Fatal(err)
	}
}

func ids(fs []fact.Fact) []int64 {
	out := make([]int64, len(fs))
	for i, f := range fs {
		out[i] = int64(f.ID)
	}
	return out
}

// The chronicle reads a day's facts of the floor weight or more, heaviest
// then newest first, and never a pin or a personal thread; a fact by id
// carries its causes, and the causes open one level deep.
func TestChronicleDay(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	day := int64(sheets.TicksPerDay)
	insertFacts(t, ctx, db.New(pool), "w-chron", []storedFact{
		{id: 1, tick: day - 1, weight: 90, kind: "arc.cast"},    // the day before
		{id: 2, tick: day, weight: 60, kind: "trouble.started"}, // at the floor
		{id: 3, tick: day + 1, weight: 80, kind: "trouble.lost", causes: []fact.ID{2, 1}},
		{id: 4, tick: day + 2, weight: 59, kind: "goal.met"}, // under the floor
		{id: 5, tick: day + 3, weight: 80, kind: "arc.stage-ended", causes: []fact.ID{3, 99}},
		{id: 6, tick: day + 4, weight: 95, kind: "pin.placed"},      // hidden
		{id: 7, tick: day + 5, weight: 95, kind: "thread.cast"},     // hidden
		{id: 8, tick: day + 6, weight: 70, kind: "threadbare.held"}, // not a thread's kind
		{id: 9, tick: 2 * day, weight: 90, kind: "season.closed"},   // the next day
		{id: 10, tick: 2*day - 1, weight: 60, kind: "notable.died"},
	})
	st := store.New(pool, "w-chron")
	got, err := st.ChronicleDay(ctx, day, 2*day, 60)
	if err != nil {
		t.Fatal(err)
	}
	if want := []int64{5, 3, 8, 10, 2}; !slices.Equal(ids(got), want) {
		t.Fatalf("the chronicle reads %v, want %v", ids(got), want)
	}
	other, err := store.New(pool, "w-other").ChronicleDay(ctx, 0, 3*day, 0)
	if err != nil || len(other) != 0 {
		t.Fatalf("another world's chronicle reads %v (%v)", ids(other), err)
	}

	recent, err := st.RecentIn(ctx, "region:0", 20)
	if err != nil {
		t.Fatal(err)
	}
	if slices.Contains(ids(recent), 6) || slices.Contains(ids(recent), 7) || !slices.Contains(ids(recent), 8) {
		t.Fatalf("the region's recent facts are %v", ids(recent))
	}

	f, causes, err := st.FactCauses(ctx, 5)
	if err != nil {
		t.Fatal(err)
	}
	if f.Kind != "arc.stage-ended" || !slices.Equal(f.Causes, []fact.ID{3, 99}) || !slices.Equal(ids(causes), []int64{3}) {
		t.Fatalf("fact 5 reads %+v with causes %v", f, ids(causes))
	}
	if !slices.Equal(causes[0].Causes, []fact.ID{2, 1}) {
		t.Fatalf("its cause reads causes %v", causes[0].Causes)
	}
	if _, err := st.Fact(ctx, 99); !errors.Is(err, store.ErrNoFact) {
		t.Fatalf("an id never stored reads %v", err)
	}
	if fs, err := st.Facts(ctx, []fact.ID{7, 2, 99}); err != nil || !slices.Equal(ids(fs), []int64{2, 7}) {
		t.Fatalf("facts by id read %v (%v)", ids(fs), err)
	}
	if fs, err := st.Facts(ctx, nil); err != nil || len(fs) != 0 {
		t.Fatalf("no ids read %v (%v)", ids(fs), err)
	}
}

// The events read gives only the named kinds after an id, oldest first,
// at most the limit.
func TestStoryFactsSince(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	insertFacts(t, ctx, db.New(pool), "w-events", []storedFact{
		{id: 1, tick: 1, weight: 70, kind: "arc.cast"},
		{id: 2, tick: 1, weight: 70, kind: "goal.met"},
		{id: 3, tick: 2, weight: 60, kind: "trouble.started"},
		{id: 4, tick: 2, weight: 80, kind: "arc.cast-off"},
		{id: 5, tick: 3, weight: 80, kind: "trouble.held"},
		{id: 6, tick: 4, weight: 80, kind: "arc.cast"},
	})
	st := store.New(pool, "w-events")
	kinds := []string{"arc.cast", "trouble.started", "trouble.held"}
	for _, c := range []struct {
		after fact.ID
		n     int32
		want  []int64
	}{
		{0, 10, []int64{1, 3, 5, 6}},
		{1, 10, []int64{3, 5, 6}},
		{3, 1, []int64{5}},
		{6, 10, []int64{}},
	} {
		got, err := st.StoryFactsSince(ctx, kinds, c.after, c.n)
		if err != nil {
			t.Fatal(err)
		}
		if !slices.Equal(ids(got), c.want) {
			t.Fatalf("after %d, at most %d: %v, want %v", c.after, c.n, ids(got), c.want)
		}
	}
	if got, err := st.StoryFactsSince(ctx, nil, 0, 10); err != nil || len(got) != 0 {
		t.Fatalf("no kinds read %v (%v)", ids(got), err)
	}
}
