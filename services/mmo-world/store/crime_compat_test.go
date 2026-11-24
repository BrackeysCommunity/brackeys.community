package store_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

func importGame(t *testing.T, ctx context.Context, st *store.Store, id string, g *game.Game) {
	t.Helper()
	now := time.Now()
	if err := st.EnsurePartitions(ctx, now); err != nil {
		t.Fatal(err)
	}
	m := store.Meta{ID: id, KeyVersion: 1, KeyCheck: "x", SheetsDigest: "s", StartedAt: now, TickSeconds: 600}
	if err := st.Import(ctx, m, g, func(c string) string { return "discord-" + c }, now); err != nil {
		t.Fatal(err)
	}
}

// A world saved before theft loads from the store at its digest with no
// syndicate and every character's alignment nil.
func TestCrimeCompatStoreOldWorld(t *testing.T) {
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
	var g game.Game
	if err := json.Unmarshal(body, &g); err != nil {
		t.Fatal(err)
	}
	g.Attach(r)
	importGame(t, ctx, store.New(pool, "w-crime-old"), "w-crime-old", &g)
	back, err := store.New(pool, "w-crime-old").Load(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	if d, _ := back.Digest(); d.String() != strings.TrimSpace(string(digest)) {
		t.Fatalf("the stored pre-MM10 world loads to %s, saved as %s", d, digest)
	}
	if back.Syndicate != nil {
		t.Fatal("a world from before theft loads with a syndicate")
	}
	for _, c := range back.Chars {
		if c.C.Alignment != nil {
			t.Fatalf("%s loads with an alignment", c.C.ID)
		}
	}
}

// The syndicate's moves, a character's alignment and hot goods, and a
// saved NPC's leaning all survive the store.
func TestCrimeCompatStoreRoundTrip(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	r := rules(t)
	g, err := game.New(r)
	if err != nil {
		t.Fatal(err)
	}
	res, err := g.Act(game.Command{Key: "a", Kind: game.Create, Option: "knife"})
	if err != nil {
		t.Fatal(err)
	}
	c := res.Char
	c.C.Alignment = &char.Alignment{Value: -12, Made: true, Stopped: 1, Thefts: 2,
		Hot:    []char.HotLot{{Material: "scrap", Units: 2, Mark: item.Hot{Victim: "faction:0", Faction: "faction:0", Ends: 8, At: "0,0"}}},
		Wanted: []char.Wanted{{Victim: "faction:0", Faction: "faction:0", Place: 0, Worth: 20, Source: "pool:store:0", Fact: 3, Ends: 500}}}
	c.C.Pack[0].Hot = &item.Hot{Victim: "npc:x", Ends: 4, At: "1,0"}
	g.Syndicate = &game.Syndicate{Moves: []game.DenMove{{Fence: "r-0,0-den-fence-0", From: hex.Hex{}, To: hex.Hex{Q: 2, R: -1}, Day: 3, Cause: "lapsed"}}}
	n := g.NPCs.Save(npc.Stub{ID: "r-0,0-den-fence-0", Kind: npc.Resident, Role: "den-fence", Traits: []string{}}, g.Tick())
	n.Leaning = npc.LeaningCrooked
	if err := g.NPCs.Touched(n); err != nil {
		t.Fatal(err)
	}
	want, err := g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	importGame(t, ctx, store.New(pool, "w-crime"), "w-crime", g)
	back, err := store.New(pool, "w-crime").Load(ctx, r)
	if err != nil {
		t.Fatal(err)
	}
	if d, _ := back.Digest(); d != want {
		t.Fatalf("the world loads to %s, stood at %s", d, want)
	}
	bc := back.Char(c.C.ID)
	if !reflect.DeepEqual(bc.C.Alignment, c.C.Alignment) || !reflect.DeepEqual(bc.C.Pack[0].Hot, c.C.Pack[0].Hot) {
		t.Fatalf("the character loads as %+v", bc.C.Alignment)
	}
	if !reflect.DeepEqual(back.Syndicate, g.Syndicate) {
		t.Fatalf("the syndicate loads as %+v", back.Syndicate)
	}
	if bn := back.NPCs.Get(n.Stub.ID); bn == nil || bn.Leaning != npc.LeaningCrooked {
		t.Fatalf("the fence loads as %+v", bn)
	}
}
