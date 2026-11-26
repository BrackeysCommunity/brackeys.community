package store_test

import (
	"context"
	"encoding/json"
	"slices"
	"testing"

	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

// TestMapSeenStore: a pass's records and keys round-trip, a later record
// overwrites an earlier one for the same holder and tile, SeenIn reads a
// character's and a guild's records in the chunks asked and no others, a
// holder gone loses its rows, and a reset wipes the world's rows only.
func TestMapSeenStore(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	st, _, _ := founded(t, ctx, pool, rules(t))

	live := func(threat int) []byte {
		b, err := json.Marshal(map[string]any{"fog": "seen", "threat": threat})
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	key := func(radius int) []byte {
		b, err := json.Marshal([]map[string]int{{"q": 0, "r": 0, "radius": radius}})
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	radius := func(b []byte) int {
		var v []struct{ Radius int }
		if err := json.Unmarshal(b, &v); err != nil || len(v) != 1 {
			t.Fatalf("key %s: %v", b, err)
		}
		return v[0].Radius
	}
	threat := func(b []byte) int {
		var v struct{ Threat int }
		if err := json.Unmarshal(b, &v); err != nil {
			t.Fatal(err)
		}
		return v.Threat
	}
	count := func() int64 {
		t.Helper()
		n, err := st.CountSeen(ctx)
		if err != nil {
			t.Fatal(err)
		}
		return n
	}

	const char, guild = "c-1", "g-1"
	first := []store.SeenRow{
		{Kind: "character", ID: char, Q: 1, R: 0, A: 0, B: 0, Left: 10, Live: live(1)},
		{Kind: "character", ID: char, Q: 2, R: 0, A: 0, B: 0, Left: 10, Live: live(2)},
		{Kind: "character", ID: char, Q: 20, R: 0, A: 1, B: 0, Left: 10, Live: live(3)},
		{Kind: "character", ID: char, Q: 40, R: 0, A: 2, B: 0, Left: 10, Live: live(4)},
		{Kind: "guild", ID: guild, Q: 1, R: 0, A: 0, B: 0, Left: 9, Live: live(5)},
		{Kind: "guild", ID: guild, Q: 21, R: 0, A: 1, B: 0, Left: 11, Live: live(6)},
		{Kind: "character", ID: "c-2", Q: 1, R: 0, A: 0, B: 0, Left: 10, Live: live(7)},
		{Kind: "guild", ID: "g-2", Q: 1, R: 0, A: 0, B: 0, Left: 10, Live: live(8)},
	}
	keys := []store.SightRow{{Kind: "character", ID: char, Key: key(2)}, {Kind: "guild", ID: guild, Key: key(3)},
		{Kind: "character", ID: "c-2", Key: key(1)}}
	if err := st.SaveSight(ctx, 12, first, keys, nil); err != nil {
		t.Fatal(err)
	}
	if n := count(); n != int64(len(first)) {
		t.Fatalf("%d records kept for %d written", n, len(first))
	}

	// The same tile again, twice in one pass: the last row wins.
	again := []store.SeenRow{
		{Kind: "character", ID: char, Q: 1, R: 0, A: 0, B: 0, Left: 20, Live: live(90)},
		{Kind: "character", ID: char, Q: 1, R: 0, A: 0, B: 0, Left: 21, Live: live(91)},
	}
	if err := st.SaveSight(ctx, 21, again, []store.SightRow{{Kind: "character", ID: char, Key: key(4)}}, nil); err != nil {
		t.Fatal(err)
	}
	if n := count(); n != int64(len(first)) {
		t.Fatalf("an overwrite left %d records, want %d", n, len(first))
	}

	type got struct {
		kind, id     string
		q, a         int64
		left, threat int
	}
	read := func(c, g string, chunks [][2]int64) []got {
		t.Helper()
		rows, err := st.SeenIn(ctx, c, g, chunks)
		if err != nil {
			t.Fatal(err)
		}
		out := make([]got, len(rows))
		for i, x := range rows {
			out[i] = got{x.Kind, x.ID, x.Q, x.A, int(x.Left), threat(x.Live)}
		}
		return out
	}
	want := []got{
		{"character", char, 1, 0, 21, 91},
		{"character", char, 2, 0, 10, 2},
		{"character", char, 20, 1, 10, 3},
		{"guild", guild, 1, 0, 9, 5},
		{"guild", guild, 21, 1, 11, 6},
	}
	if g := read(char, guild, [][2]int64{{0, 0}, {1, 0}}); !slices.Equal(g, want) {
		t.Fatalf("SeenIn over two chunks:\n got %v\nwant %v", g, want)
	}
	if g := read(char, "", [][2]int64{{1, 0}}); !slices.Equal(g, []got{{"character", char, 20, 1, 10, 3}}) {
		t.Fatalf("SeenIn with no guild: %v", g)
	}
	if g := read("", guild, [][2]int64{{1, 0}, {5, 5}}); !slices.Equal(g, []got{{"guild", guild, 21, 1, 11, 6}}) {
		t.Fatalf("SeenIn with no character: %v", g)
	}
	if g := read(char, guild, nil); len(g) != 0 {
		t.Fatalf("SeenIn with no chunks: %v", g)
	}

	sights, err := st.Sights(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(sights) != 3 {
		t.Fatalf("Sights: %v", sights)
	}
	byHolder := map[[2]string]store.SightRow{}
	for _, s := range sights {
		byHolder[[2]string{s.Kind, s.ID}] = s
	}
	if s := byHolder[[2]string{"character", char}]; s.Tick != 21 || radius(s.Key) != 4 {
		t.Fatalf("the character's key was not overwritten: %+v", s)
	}
	if s := byHolder[[2]string{"guild", guild}]; s.Tick != 12 || radius(s.Key) != 3 {
		t.Fatalf("the guild's key: %+v", s)
	}

	// Another world's rows, which nothing here may touch.
	other := store.New(pool, "w-other")
	if err := other.SaveSight(ctx, 1, []store.SeenRow{{Kind: "character", ID: char, Q: 1, A: 0, B: 0, Left: 1, Live: live(1)}},
		[]store.SightRow{{Kind: "character", ID: char, Key: key(1)}}, nil); err != nil {
		t.Fatal(err)
	}

	if err := st.SaveSight(ctx, 22, nil, nil, [][2]string{{"character", char}, {"guild", "g-2"}}); err != nil {
		t.Fatal(err)
	}
	if g := read(char, guild, [][2]int64{{0, 0}, {1, 0}, {2, 0}}); !slices.Equal(g, want[3:]) {
		t.Fatalf("after the character was gone: %v", g)
	}
	if n := count(); n != 3 {
		t.Fatalf("%d records after two holders were gone, want 3 (c-2 and the guild's two)", n)
	}
	if sights, err = st.Sights(ctx); err != nil || len(sights) != 2 {
		t.Fatalf("Sights after a holder was gone: %v, %v", sights, err)
	}

	if err := st.Reset(ctx); err != nil {
		t.Fatal(err)
	}
	if n := count(); n != 0 {
		t.Fatalf("%d records survived a reset", n)
	}
	if sights, err = st.Sights(ctx); err != nil || len(sights) != 0 {
		t.Fatalf("keys survived a reset: %v, %v", sights, err)
	}
	if n, err := other.CountSeen(ctx); err != nil || n != 1 {
		t.Fatalf("another world's records after a reset: %d, %v", n, err)
	}
	if s, err := other.Sights(ctx); err != nil || len(s) != 1 {
		t.Fatalf("another world's keys after a reset: %v, %v", s, err)
	}
}
