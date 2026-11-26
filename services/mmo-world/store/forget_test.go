package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

func discordOf(t *testing.T, ctx context.Context, pool *pgxpool.Pool, world, id string) string {
	t.Helper()
	var d string
	if err := pool.QueryRow(ctx, `SELECT discord_id FROM mmo.character WHERE world_id = $1 AND id = $2`, world, id).Scan(&d); err != nil {
		t.Fatal(err)
	}
	return d
}

// A forget command's save removes its character's identity in the same
// transaction: the tombstone, the house log's user, and the map rows the
// character held. Facts, the ledger and the guild's map rows stay, no read
// by or of a Discord id finds the character, and a failed save forgets
// nothing.
func TestForgetIdentity(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	r := rules(t)
	st, g, c := founded(t, ctx, pool, r)
	other := testkit.Act(t, ctx, st, g, game.Command{Key: "i-2", Kind: game.Create}, "discord-2").Char
	testkit.Act(t, ctx, st, g, game.Command{Key: "i-3", Char: c.C.ID, Kind: game.Correct, Asset: ledger.Coin, Units: 5, Note: "test purse"}, "")
	testkit.Ticks(t, ctx, st, g, 2)
	for _, row := range []struct{ key, char, discord string }{{"h-1", c.C.ID, "discord-1"}, {"h-2", "c-before", "discord-1"}, {"h-3", other.C.ID, "discord-2"}} {
		if _, err := pool.Exec(ctx, `INSERT INTO mmo.house_log (world_id, server, tick, key, character_id, discord_id, role, kind, what)
			VALUES ($1, 'srv', 1, $2, $3, $4, 'staff', 'house-pin', 'a pin')`, st.World, row.key, row.char, row.discord); err != nil {
			t.Fatal(err)
		}
	}
	seen := func(id string) store.SeenRow {
		return store.SeenRow{Kind: "character", ID: id, Q: 1, R: 2, A: 0, B: 0, Left: 1, Live: []byte(`{}`)}
	}
	guild := store.SeenRow{Kind: "guild", ID: "guild-1", Q: 1, R: 2, Left: 1, Live: []byte(`{}`)}
	if err := st.SaveSight(ctx, 1, []store.SeenRow{seen(c.C.ID), seen(other.C.ID), guild},
		[]store.SightRow{{Kind: "character", ID: c.C.ID, Key: []byte(`{}`)}, {Kind: "character", ID: other.C.ID, Key: []byte(`{}`)}}, nil); err != nil {
		t.Fatal(err)
	}
	facts, txns := g.Log.Count, g.Ledger.Posted
	forget := game.Command{Key: "f-1", Char: c.C.ID, Kind: game.Forget}

	stale := store.New(pool, st.World)
	old, err := stale.Load(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	testkit.Ticks(t, ctx, st, g, 1)
	if err := stale.SaveAction(ctx, old, forget, nil, "", []byte(`{}`), time.Now()); !errors.Is(err, store.ErrConflict) {
		t.Fatalf("a stale forget saved: %v", err)
	}
	if d := discordOf(t, ctx, pool, st.World, c.C.ID); d != "discord-1" {
		t.Fatalf("a failed forget left the Discord id %q", d)
	}

	if err := st.SaveAction(ctx, g, forget, nil, "", []byte(`{}`), time.Now()); err != nil {
		t.Fatal(err)
	}
	if d := discordOf(t, ctx, pool, st.World, c.C.ID); d != store.Tombstone+c.C.ID || !store.Forgotten(d) {
		t.Fatalf("the forgotten character's Discord id is %q", d)
	}
	if d := discordOf(t, ctx, pool, st.World, other.C.ID); d != "discord-2" {
		t.Fatalf("the other character's Discord id is %q", d)
	}
	for _, who := range []string{"discord-1", store.Tombstone + c.C.ID} {
		if id, err := st.CharacterOf(ctx, who); err != nil || id != "" {
			t.Fatalf("CharacterOf(%q) = %q, %v", who, id, err)
		}
	}
	if id, err := st.CharacterOf(ctx, "discord-2"); err != nil || id != other.C.ID {
		t.Fatalf("CharacterOf(discord-2) = %q, %v", id, err)
	}
	users, err := st.DiscordsOf(ctx, []string{c.C.ID, other.C.ID})
	if err != nil || len(users) != 1 || users[other.C.ID] != "discord-2" {
		t.Fatalf("DiscordsOf = %v, %v", users, err)
	}
	page, err := st.AllHouseLog(ctx, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{c.C.ID: "", "c-before": "", other.C.ID: "discord-2"}
	for _, x := range page.Rows {
		if w, ok := want[x.Character]; ok && x.Discord != w {
			t.Errorf("house log row of %s holds Discord id %q, want %q", x.Character, x.Discord, w)
		}
	}
	holders := func(kind, id string) (n int) {
		t.Helper()
		if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM mmo.map_seen WHERE world_id = $1 AND holder_kind = $2 AND holder_id = $3)
			+ (SELECT count(*) FROM mmo.map_sight WHERE world_id = $1 AND holder_kind = $2 AND holder_id = $3)`, st.World, kind, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := holders("character", c.C.ID); n != 0 {
		t.Fatalf("%d map rows of the forgotten character", n)
	}
	if holders("character", other.C.ID) != 2 || holders("guild", "guild-1") != 1 {
		t.Fatal("a forget deleted another holder's map rows")
	}
	if g.Log.Count < facts || g.Ledger.Posted < txns {
		t.Fatal("the log shrank")
	}
	back, err := store.New(pool, st.World).Load(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	if a, b := mustDigest(t, back), mustDigest(t, g); a != b {
		t.Fatalf("reloaded at %s, want %s", a, b)
	}
	if bad, err := st.Audit(ctx); err != nil || len(bad) > 0 {
		t.Fatal(bad, err)
	}
	if err := st.SaveAction(ctx, g, game.Command{Key: "f-2", Char: c.C.ID, Kind: game.Forget}, nil, "", []byte(`{}`), time.Now()); err != nil {
		t.Fatalf("a second forget's save: %v", err)
	}
	if d := discordOf(t, ctx, pool, st.World, c.C.ID); d != store.Tombstone+c.C.ID {
		t.Fatalf("a second forget left %q", d)
	}
}

func mustDigest(t *testing.T, g *game.Game) string {
	t.Helper()
	d, err := g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	return d.String()
}

// A forget played through the rules saves the identity change with the
// command, and the world reloads and audits clean once the sweep has run.
func TestForgetThroughTheRules(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	r := rules(t)
	st, g, c := founded(t, ctx, pool, r)
	testkit.Act(t, ctx, st, g, game.Command{Key: "i-2", Char: c.C.ID, Kind: game.Correct, Asset: ledger.Coin, Units: 5, Note: "test purse"}, "")
	testkit.Act(t, ctx, st, g, game.Command{Key: "f-1", Char: c.C.ID, Kind: game.Forget}, "discord-1")
	if d := discordOf(t, ctx, pool, st.World, c.C.ID); d != store.Tombstone+c.C.ID {
		t.Fatalf("the Discord id after a forget is %q", d)
	}
	testkit.Ticks(t, ctx, st, g, 2)
	back, err := store.New(pool, st.World).Load(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	if a, b := mustDigest(t, back), mustDigest(t, g); a != b {
		t.Fatalf("reloaded at %s, want %s", a, b)
	}
	if !back.IsForgotten(c.C.ID) {
		t.Fatal("the reloaded character is not forgotten")
	}
	if bad, err := st.Audit(ctx); err != nil || len(bad) > 0 {
		t.Fatal(bad, err)
	}
}
