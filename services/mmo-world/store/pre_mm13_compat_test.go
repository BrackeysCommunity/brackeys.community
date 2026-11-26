package store_test

import (
	"cmp"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/mapview"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

// A world saved before the live map, imported through the store, loads at
// its saved digest with empty map tables. A service opened on it keys
// every holder in its first pass and writes no last-seen record, so each
// found tile out of a viewer's sight reads as found and never seen.
func TestPreMM13WorldLoads(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	book := testkit.Book(t)
	// The service runs on the keys the world was played with, so it reads
	// the weather, and so the sight, the save was made under.
	set := keys.Throwaway("pre-mm13")
	r := testkit.Rules(t, book, set)
	dir := filepath.Join(sheetfs.ModuleRoot(), "sim", "game", "testdata", "pre-mm13")
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

	const world = "w-pre13"
	sec := service.Secrets{World: world, KeyVersion: 1, Keys: set}
	sheetsDigest, err := book.Digest()
	if err != nil {
		t.Fatal(err)
	}
	st := store.New(pool, world)
	now := time.Now()
	if err := st.EnsurePartitions(ctx, now); err != nil {
		t.Fatal(err)
	}
	m := store.Meta{ID: world, KeyVersion: sec.KeyVersion, KeyCheck: sec.Keys.Check(), SheetsDigest: sheetsDigest, StartedAt: now, TickSeconds: 600}
	if err := st.Import(ctx, m, &g, func(c string) string { return "discord-" + c }, now); err != nil {
		t.Fatal(err)
	}
	old, err := st.Load(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	if d, _ := old.Digest(); d.String() != saved {
		t.Fatalf("the stored pre-MM13 world loads to %s, saved as %s", d, saved)
	}
	if n, err := st.CountSeen(ctx); err != nil || n != 0 {
		t.Fatalf("an imported world keeps %d last-seen records (%v)", n, err)
	}
	if rows, err := st.Sights(ctx); err != nil || len(rows) != 0 {
		t.Fatalf("an imported world keeps %d sight keys (%v)", len(rows), err)
	}

	srv, err := service.Open(ctx, pool, service.Config{Secrets: sec, TickSeconds: 600, Book: book, ManualClock: true,
		Poll: time.Millisecond, Log: slog.New(slog.NewJSONHandler(io.Discard, nil))})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close(context.Background())

	if n, err := st.CountSeen(ctx); err != nil || n != 0 {
		t.Fatalf("the first pass wrote %d last-seen records (%v)", n, err)
	}
	rows, err := st.Sights(ctx)
	if err != nil {
		t.Fatal(err)
	}
	stored := map[mapview.Holder]mapview.Key{}
	for _, row := range rows {
		var discs [][3]int64
		if err := json.Unmarshal(row.Key, &discs); err != nil {
			t.Fatal(err)
		}
		k := mapview.Key{}
		for _, d := range discs {
			k = append(k, mapview.Disc{Q: d[0], R: d[1], Radius: d[2]})
		}
		stored[mapview.Holder{Kind: row.Kind, ID: row.ID}] = k
	}
	want := mapview.Keys(old)
	if !maps.EqualFunc(stored, want, slices.Equal) {
		t.Fatalf("the first pass keyed %v, the world's holders are %v", stored, want)
	}
	guilds := 0
	for h := range want {
		if h.Kind == mapview.HolderGuild {
			guilds++
		}
	}
	if guilds == 0 || len(want)-guilds != len(old.Chars) {
		t.Fatalf("%d guilds and %d characters keyed, the world holds %d characters", guilds, len(want)-guilds, len(old.Chars))
	}

	// Every character's overlay over the chunks of the found tiles out of
	// its sight holds those tiles not at all: nothing was seen to leave.
	chunkOf := old.World.Gen().ChunkOf
	dark := 0
	for _, c := range old.Chars {
		sight := mapview.Sights(old, c)
		var out []hex.Hex
		for _, ts := range old.World.Tiles {
			if ts.Discovered != nil && !sight[ts.Hex] {
				out = append(out, ts.Hex)
			}
		}
		if len(out) == 0 {
			continue
		}
		dark += len(out)
		var chunks []api.MapChunkID
		for _, h := range out {
			cc := chunkOf(h)
			if id := (api.MapChunkID{A: cc.A, B: cc.B}); !slices.Contains(chunks, id) {
				chunks = append(chunks, id)
			}
		}
		slices.SortFunc(chunks, func(a, b api.MapChunkID) int { return cmp.Or(cmp.Compare(a.A, b.A), cmp.Compare(a.B, b.B)) })
		ov, ref, err := srv.MapOverlay(ctx, c.C.ID, api.MapOverlayQuery{Chunks: chunks})
		if err != nil || ref != nil {
			t.Fatal(ref, err)
		}
		if ov.Viewer != api.ViewerCharacter || ov.Self == nil || ov.Self.Character != c.C.ID {
			t.Fatalf("%s's overlay: viewer %s, self %+v", c.C.ID, ov.Viewer, ov.Self)
		}
		for _, l := range ov.Tiles {
			h := hex.Hex{Q: l.Q, R: l.R}
			if l.Fog != api.FogSight || !sight[h] {
				t.Fatalf("%s's overlay holds %v as %s, with nothing seen to leave its sight", c.C.ID, h, l.Fog)
			}
			if slices.Contains(out, h) {
				t.Fatalf("%s's overlay holds %v, found and out of its sight", c.C.ID, h)
			}
		}
		recs, err := st.SeenIn(ctx, c.C.ID, c.C.Guild, chunkPairs(chunks))
		if err != nil || len(recs) != 0 {
			t.Fatalf("%s reads %d records (%v)", c.C.ID, len(recs), err)
		}
	}
	if dark == 0 {
		t.Fatal("no character has a found tile out of its sight")
	}
	t.Logf("%d holders keyed; %d found tiles out of a character's sight read as never seen", len(want), dark)
}

func chunkPairs(ids []api.MapChunkID) [][2]int64 {
	out := make([][2]int64, len(ids))
	for i, id := range ids {
		out[i] = [2]int64{id.A, id.B}
	}
	return out
}
