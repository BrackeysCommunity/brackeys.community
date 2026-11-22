package store_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/world"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

// preRead is the part of a tile read from before content came from
// history that a stored world must keep: what stands there, what lives
// there, its dungeon and its stock.
type preRead struct {
	At        hex.Hex          `json:"at"`
	Site      string           `json:"site"`
	Creatures []string         `json:"creatures"`
	Dungeon   *gen.Plan        `json:"dungeon,omitempty"`
	Stock     map[string]int64 `json:"stock"`
}

func preReads(g *game.Game) []preRead {
	var out []preRead
	for _, tl := range g.World.Tiles {
		if tl.Discovered == nil {
			continue
		}
		h := tl.Hex
		r := preRead{At: h, Site: g.SiteAt(h), Creatures: g.Creatures(h), Stock: map[string]int64{}}
		for _, m := range g.Materials(h) {
			r.Stock[m] = g.StockLeft(h, m)
		}
		if p, ok := g.Plan(h); ok {
			r.Dungeon = &p
		}
		out = append(out, r)
	}
	slices.SortFunc(out, func(a, b preRead) int { return hex.Compare(a.At, b.At) })
	return out
}

func readsJSON(t *testing.T, v []preRead) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// A world kept from before content was drawn from history loads from the
// store at its saved digest without drawing anything. The freeze's
// command save alone carries every tile it froze, so a reload before any
// tick lands on the frozen digest, and every discovered tile reads as the
// snapshot recorded it.
func TestPreMM8aWorldLoads(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	r := testkit.Rules(t, testkit.Book(t), keys.Throwaway("pre-mm8a"))
	dir := filepath.Join(sheetfs.ModuleRoot(), "sim", "game", "testdata", "pre-mm8a")
	read := func(name string) []byte {
		t.Helper()
		b, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	saved := strings.TrimSpace(string(read("digest.txt")))
	var recorded []preRead
	if err := json.Unmarshal(read("reads.json"), &recorded); err != nil {
		t.Fatal(err)
	}
	want := readsJSON(t, recorded)

	var g game.Game
	if err := json.Unmarshal(read("snapshot.json"), &g); err != nil {
		t.Fatal(err)
	}
	g.Attach(r)
	now := time.Now()
	st := store.New(pool, "w-pre")
	if err := st.EnsurePartitions(ctx, now); err != nil {
		t.Fatal(err)
	}
	m := store.Meta{ID: "w-pre", KeyVersion: 1, KeyCheck: "x", SheetsDigest: "s", StartedAt: now, TickSeconds: 600}
	if err := st.Import(ctx, m, &g, func(c string) string { return "discord-" + c }, now); err != nil {
		t.Fatal(err)
	}

	st = store.New(pool, "w-pre")
	old, err := st.Load(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	if d, _ := old.Digest(); d.String() != saved {
		t.Fatalf("the stored pre-MM8a world loads to %s, saved as %s", d, saved)
	}
	if old.World.Drawn() {
		t.Fatal("a world from before content was drawn loaded as drawing")
	}
	if got := readsJSON(t, preReads(old)); got != want {
		t.Fatalf("loaded, the discovered tiles read otherwise:\n%s", got)
	}

	testkit.Act(t, ctx, st, old, game.Command{Key: game.ContentFreeze, Kind: game.ContentFreeze}, "")
	frozen, _ := old.Digest()
	if frozen.String() == saved || !old.World.Drawn() {
		t.Fatal("the freeze changed nothing")
	}
	back, err := store.New(pool, "w-pre").Load(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	if d, _ := back.Digest(); d != frozen {
		t.Fatalf("reloaded after the freeze's save alone at %s, the game stood at %s", d, frozen)
	}
	discovered := 0
	for _, tl := range back.World.Tiles {
		if tl.Discovered == nil {
			continue
		}
		discovered++
		if tl.Content == nil || !tl.Content.Native {
			t.Fatalf("%s reloaded with content %+v", tl.Hex.Ref(), tl.Content)
		}
	}
	if discovered == 0 {
		t.Fatal("the snapshot holds no discovered tile")
	}
	if !back.World.Drawn() {
		t.Fatal("the frozen world reloaded at version 0")
	}
	if got := readsJSON(t, preReads(back)); got != want {
		t.Fatalf("frozen and reloaded, the discovered tiles read otherwise:\n%s", got)
	}

	st = store.New(pool, "w-pre")
	if back, err = st.Load(ctx, r); err != nil {
		t.Fatal(err)
	}
	testkit.Ticks(t, ctx, st, back, 1)
	ticked, _ := back.Digest()
	again, err := store.New(pool, "w-pre").Load(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	if d, _ := again.Digest(); d != ticked {
		t.Fatalf("a tick after the freeze reloads at %s, stood at %s", d, ticked)
	}
	if bad, err := st.Audit(ctx); err != nil || len(bad) > 0 {
		t.Fatal(bad, err)
	}
}

// pinSearch is how far from the settlement a test looks for a tile a pin
// may stand on.
const pinSearch = 40

// A pin-edit changes a tile the store already holds and nothing else the
// command save would write: if the process dies before the next tick, the
// world still reloads at the digest the edit left, with the edit on it.
func TestPinEditSurvivesCrash(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	r := rules(t)
	st, g, c := founded(t, ctx, pool, r)

	// The nearest tile a designer could pin, reached by standing on it and
	// stored by a tick's save before the edit.
	designer := world.PinBy{Role: world.PinDesigner}
	leadFix := func(h hex.Hex) tile.Fix {
		a := r.Gen.Archetypes(h)
		if len(a) < 2 {
			return tile.Fix{}
		}
		return tile.Fix{Lead: a[len(a)-1]}
	}
	var at hex.Hex
	found := false
	for d := int64(1); d <= pinSearch && !found; d++ {
		for _, h := range hex.Ring(c.C.At, d) {
			if f := leadFix(h); !f.Empty() && g.World.CheckPin(h, 1, f, designer, false) == nil {
				at, found = h, true
				break
			}
		}
	}
	if !found {
		t.Fatal("no tile near the settlement takes a designer's pin")
	}
	if err := g.Teleport(c, at); err != nil {
		t.Fatal(err)
	}
	testkit.Ticks(t, ctx, st, g, 1)
	fix := leadFix(at)
	if g.World.Content(at).Lead == fix.Lead {
		fix.Lead = r.Gen.Archetypes(at)[0]
	}
	if err := g.World.CheckPin(at, 1, fix, designer, true); err != nil {
		t.Fatalf("an edit of reached %s: %v", at.Ref(), err)
	}
	before, err := json.Marshal(g.World.Tile(at))
	if err != nil {
		t.Fatal(err)
	}
	testkit.Act(t, ctx, st, g, game.Command{Key: "edit-1", Kind: game.PinEdit, Pin: &game.PinCmd{At: at, Fix: fix}}, "")
	after, err := json.Marshal(g.World.Tile(at))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(before, after) || g.World.Content(at).Lead != fix.Lead {
		t.Fatalf("the edit left %s as it was", at.Ref())
	}
	want, _ := g.Digest()
	back, err := store.New(pool, "w-test").Load(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := back.Digest(); got != want {
		t.Fatalf("reloaded after the edit's save alone at %s, the game stood at %s", got, want)
	}
	stored, err := json.Marshal(back.World.Tile(at))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(stored, after) || len(back.World.Pins) != len(g.World.Pins) {
		t.Fatalf("%s reloaded as %s, edited to %s", at.Ref(), stored, after)
	}
}

// A restamp moves a world onto new sheets only from the exact digest it
// runs on, and touches no other world.
func TestRestamp(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	r := rules(t)
	st, _, _ := testkit.Founded(t, ctx, pool, r, store.Meta{ID: "w-kept", KeyVersion: 1, KeyCheck: "x", SheetsDigest: "old", TickSeconds: 600})
	other, _, _ := testkit.Founded(t, ctx, pool, r, store.Meta{ID: "w-other", KeyVersion: 1, KeyCheck: "x", SheetsDigest: "old", TickSeconds: 600})
	sheetsOf := func(s *store.Store) string {
		t.Helper()
		m, err := s.Meta(ctx)
		if err != nil {
			t.Fatal(err)
		}
		return m.SheetsDigest
	}
	for _, c := range []struct{ from, to string }{{"older", "new"}, {"", "new"}, {"old", ""}} {
		if err := st.Restamp(ctx, c.from, c.to); err == nil {
			t.Fatalf("a restamp from %q to %q went through", c.from, c.to)
		}
		if got := sheetsOf(st); got != "old" {
			t.Fatalf("a refused restamp from %q left the world on %q", c.from, got)
		}
	}
	if err := st.Restamp(ctx, "older", "new"); !errors.Is(err, store.ErrOtherSheets) {
		t.Fatalf("a restamp from the wrong digest: %v", err)
	}
	if err := st.Restamp(ctx, "old", "new"); err != nil {
		t.Fatal(err)
	}
	if got := sheetsOf(st); got != "new" {
		t.Fatalf("restamped onto %q", got)
	}
	if got := sheetsOf(other); got != "old" {
		t.Fatalf("another world moved to %q", got)
	}
	if err := st.Restamp(ctx, "old", "newer"); !errors.Is(err, store.ErrOtherSheets) || sheetsOf(st) != "new" {
		t.Fatalf("a second restamp from the old digest: %v", err)
	}
	if _, err := store.New(pool, "w-kept").Load(ctx, r); err != nil {
		t.Fatal(err)
	}
}
