package game_test

import (
	"encoding/json"
	"testing"

	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

// A world in which a player asks to be forgotten replays from a snapshot
// taken before the ask to the same digest at every tick, and its ledger
// stays balanced.
func TestForgetReplays(t *testing.T) {
	r := rules(t)
	g, err := game.New(r)
	if err != nil {
		t.Fatal(err)
	}
	given := map[int64][]game.Command{}
	half := int64(sheets.TicksPerDay)
	script(t, g, 0, half, given)
	snap, err := json.Marshal(g)
	if err != nil {
		t.Fatal(err)
	}
	if len(g.Chars) < 2 {
		t.Fatalf("script made %d characters", len(g.Chars))
	}
	gone := g.Chars[0].C.ID
	ask := half + half/2
	given[ask] = append(given[ask], game.Command{Key: "forget-me", Char: gone, Kind: game.Forget})
	want := map[int64]string{}
	play := func(g *game.Game) {
		t.Helper()
		for g.Tick() < 2*half {
			script(t, g, g.Tick(), g.Tick()+1, given)
			d, err := g.Digest()
			if err != nil {
				t.Fatal(err)
			}
			if w, ok := want[g.Tick()]; !ok {
				want[g.Tick()] = d.String()
			} else if w != d.String() {
				t.Fatalf("tick %d replays to %s, want %s", g.Tick(), d, w)
			}
		}
	}
	play(g)
	if c := g.Char(gone); c.Forget == 0 || c.Forgotten == 0 {
		t.Fatalf("%s: asked %d, swept %d", gone, c.Forget, c.Forgotten)
	}
	if held := g.Ledger.Held(ledger.Char(gone)); len(held) != 0 {
		t.Fatalf("%s still holds %v", gone, held)
	}
	if bad := ledger.Audit(g.Ledger.Balances(), g.Holdings()); len(bad) > 0 {
		t.Fatal(bad)
	}

	var h game.Game
	if err := json.Unmarshal(snap, &h); err != nil {
		t.Fatal(err)
	}
	h.Attach(r)
	play(&h)
	if len(want) != int(half) {
		t.Fatalf("compared %d ticks", len(want))
	}
}
