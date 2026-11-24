package store_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

// A world saved before theft and alignment, imported through the store,
// loads at its saved digest with every character unremarked and no
// syndicate. A saved NPC met there draws its leaning, which the command's
// save alone keeps; a world day on, it reloads where it stood and both
// audits hold.
func TestPreMM11aWorldLoads(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	r := testkit.Rules(t, testkit.Book(t), keys.Throwaway("pre-mm11a"))
	dir := filepath.Join(sheetfs.ModuleRoot(), "sim", "game", "testdata", "pre-mm11a")
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
	const world = "w-pre11a"
	importGame(t, ctx, store.New(pool, world), world, &g)

	st := store.New(pool, world)
	old, err := st.Load(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	if d, _ := old.Digest(); d.String() != saved {
		t.Fatalf("the stored pre-MM11a world loads to %s, saved as %s", d, saved)
	}
	if old.Syndicate != nil {
		t.Fatal("a world from before theft loads with a syndicate")
	}
	for _, c := range old.Chars {
		if c.C.Alignment != nil || game.AlignmentOf(c) != 0 {
			t.Fatalf("%s loads with alignment %+v", c.C.ID, c.C.Alignment)
		}
	}
	unleaned := 0
	for _, n := range old.NPCs.List {
		if n.Leaning == "" {
			unleaned++
		}
	}
	if unleaned == 0 {
		t.Fatal("every saved NPC of a world from before leanings already leans")
	}

	var m struct {
		Char string `json:"char"`
		NPC  string `json:"npc"`
	}
	if err := json.Unmarshal(read("meeting.json"), &m); err != nil {
		t.Fatal(err)
	}
	who, n := old.Char(m.Char), old.NPCs.Get(m.NPC)
	if who == nil || n == nil {
		t.Fatalf("the meeting names %s and %s, not in the stored world", m.Char, m.NPC)
	}
	if err := old.Teleport(who, r.NPC.At(n, old.Tick())); err != nil {
		t.Fatal(err)
	}
	testkit.Act(t, ctx, st, old, game.Command{Key: "pre11a-meet", Char: who.C.ID, Kind: game.Talk, NPC: n.Stub.ID}, "")
	leaning := old.NPCs.Get(m.NPC).Leaning
	if !slices.Contains([]string{npc.LeaningUpright, npc.LeaningCrooked, npc.LeaningNone}, leaning) {
		t.Fatalf("the met NPC leans %q", leaning)
	}
	back := reloadsAt(t, ctx, pool, world, r, old, "after the meeting")
	if got := back.NPCs.Get(m.NPC); got == nil || got.Leaning != leaning {
		t.Fatalf("the met NPC reloads as %+v, leaning %q", got, leaning)
	}

	st = store.New(pool, world)
	if back, err = st.Load(ctx, r); err != nil {
		t.Fatal(err)
	}
	testkit.Ticks(t, ctx, st, back, int(sheets.TicksPerDay))
	again := reloadsAt(t, ctx, pool, world, r, back, "a world day on")
	if problems := ledger.Audit(again.Ledger.Balances, again.Holdings()); len(problems) > 0 {
		t.Fatal(problems)
	}
	if bad, err := st.Audit(ctx); err != nil || len(bad) > 0 {
		t.Fatal(bad, err)
	}
}

// reloadsAt loads a world from the store afresh and requires the digest
// the game in hand stands at.
func reloadsAt(t *testing.T, ctx context.Context, pool *pgxpool.Pool, world string, r *game.Rules, g *game.Game, what string) *game.Game {
	t.Helper()
	back, err := store.New(pool, world).Load(ctx, r)
	if err != nil {
		t.Fatalf("%s: %v", what, err)
	}
	want, _ := g.Digest()
	if d, _ := back.Digest(); d != want {
		t.Fatalf("%s: reloads at %s, the game stood at %s", what, d, want)
	}
	return back
}
