package store_test

import (
	"context"
	"testing"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

// TestPartySurvivesAReload saves a party and a shared encounter through
// their commands, and a world-level command that names no character, and
// loads them back to the same digest with the encounter one value again.
func TestPartySurvivesAReload(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	r := rules(t)
	st, g, first := testkit.Founded(t, ctx, pool, r, store.Meta{ID: "w-test", KeyVersion: 1, KeyCheck: "x", SheetsDigest: "s", TickSeconds: 600})
	second := testkit.Act(t, ctx, st, g, game.Command{Key: "d-1", Kind: game.Create}, "discord-2").Char
	second.C.At = first.C.At
	testkit.Act(t, ctx, st, g, game.Command{Key: "d-2", Char: first.C.ID, Kind: game.PartyInvite, Target: second.C.ID}, "")
	testkit.Act(t, ctx, st, g, game.Command{Key: "d-3", Char: second.C.ID, Kind: game.PartyJoin, Target: first.C.ID}, "")
	testkit.Ticks(t, ctx, st, g, 1)
	sh := testkit.PartyMachineBeat(t, g, []*game.Char{first, second}, "rewire", 2)
	testkit.Ticks(t, ctx, st, g, 1)
	testkit.Act(t, ctx, st, g, game.Command{Key: "d-4", Char: first.C.ID, Kind: game.PartyPick, Option: g.Rules().Fight.Cautious(), Now: 1000}, "")
	h := g.SettlementHex(0)
	row := ""
	for _, x := range g.Rules().Book.Hunts {
		if x.Kind == "" && row == "" {
			row = x.ID
		}
	}
	res := testkit.Act(t, ctx, st, g, game.Command{Key: "d-5", Kind: game.HuntStart, Asset: row, To: &h}, "")
	if res.Char != nil {
		t.Fatal("a world-level command came back with a character")
	}
	var who string
	if err := pool.QueryRow(ctx, "SELECT character_id FROM mmo.action WHERE interaction_id = 'd-5'").Scan(&who); err != nil || who != "" {
		t.Fatalf("the world-level command was stored under %q (%v)", who, err)
	}
	want, _ := g.Digest()
	back, err := store.New(pool, "w-test").Load(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := back.Digest(); got != want {
		t.Fatalf("loaded digest %s, want %s", got, want)
	}
	bs := back.SharedByID(sh.ID)
	a, b := back.Char(first.C.ID), back.Char(second.C.ID)
	if bs == nil || len(back.Parties) != 1 || a.Fight == nil || b.Fight == nil || a.Fight.E != b.Fight.E || len(bs.Picks) != 1 {
		t.Fatalf("the shared encounter did not come back as one: %+v", bs)
	}
}
