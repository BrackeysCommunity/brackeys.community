package game_test

import (
	"context"
	"testing"
	"time"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/replay"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

func TestMain(m *testing.M) { pgtest.Main(m) }

// TestHuntStartReplaysWithNoCharacter: the operator's hunt-start is
// stored with no character, and the world replays from the store, hunt,
// press and close, to the digests it recorded.
func TestHuntStartReplaysWithNoCharacter(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	r := rules(t)
	st, g, c := testkit.Founded(t, ctx, pool, r, store.Meta{ID: "w-hunts", KeyVersion: 1, KeyCheck: "x", SheetsDigest: "s", TickSeconds: 600})
	h := c.C.At.Neighbours()[0]
	for _, n := range c.C.At.Neighbours() {
		if r.Gen.Passable(r.Gen.Baseline(n).Terrain) {
			h = n
			break
		}
	}
	start := game.Command{Key: "op-hunt", Kind: game.HuntStart, Asset: "dust-runner-migration", To: &h, Note: "a test hunt"}
	res, err := g.Act(start)
	if err != nil {
		t.Fatal(err)
	}
	if res.Char != nil {
		t.Fatalf("hunt-start acted for %s", res.Char.C.ID)
	}
	if err := st.SaveAction(ctx, g, start, nil, "", []byte(`{}`), time.Now()); err != nil {
		t.Fatal(err)
	}
	x := g.LiveHunts()[0]
	_, opts := g.HuntOptions(c, x)
	pick := ""
	for _, o := range opts {
		if o.Kind != fight.WayOut {
			pick = o.ID
			break
		}
	}
	if pick == "" {
		t.Fatalf("nothing to press with among %v", opts)
	}
	testkit.Act(t, ctx, st, g, game.Command{Key: "press-1", Char: c.C.ID, Kind: game.HuntPress, Target: x.H.ID, Option: pick}, "")
	testkit.Ticks(t, ctx, st, g, int(x.H.Ends-g.Tick())+1)
	if !x.H.Over {
		t.Fatal("the hunt outlived its window")
	}
	var who string
	if err := pool.QueryRow(ctx, "SELECT character_id FROM mmo.action WHERE world_id = $1 AND kind = $2", "w-hunts", game.HuntStart).Scan(&who); err != nil || who != "" {
		t.Fatalf("hunt-start stored for %q: %v", who, err)
	}
	rep, err := replay.Run(ctx, st, r, 0, g.Tick())
	if err != nil {
		t.Fatal(err)
	}
	want, _ := g.Digest()
	if rep.Mismatch != nil || rep.Digest != want.String() || rep.Actions < 2 {
		t.Fatalf("replay %+v, live digest %s", rep, want)
	}
	back, err := store.New(pool, "w-hunts").Load(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := back.Digest(); got != want {
		t.Fatalf("loaded digest %s, want %s", got, want)
	}
}
