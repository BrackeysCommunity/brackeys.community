package game_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

func rules(t testing.TB) *game.Rules {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	r, err := game.NewRules(b, keys.Throwaway("game-test"))
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// script plays a few characters for ticks, choosing by a keyed draw, and
// returns the commands it gave at each tick.
func script(t testing.TB, g *game.Game, from, to int64, given map[int64][]game.Command) {
	t.Helper()
	d := draw.NewDrawer(keys.Throwaway("script").Roll)
	for g.Tick() < to {
		tick := g.Tick()
		if tick >= from {
			cmds, ok := given[tick]
			if !ok {
				cmds = choose(g, d, tick)
				given[tick] = cmds
			}
			for _, cmd := range cmds {
				if _, err := g.Act(cmd); err != nil {
					var r *game.Refused
					if !errors.As(err, &r) {
						t.Fatal(err)
					}
				}
			}
		}
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
}

func choose(g *game.Game, d *draw.Drawer, tick int64) []game.Command {
	var out []game.Command
	key := func(i int) string { return fmt.Sprintf("t%d-%d", tick, i) }
	if tick%40 == 0 && len(g.Chars) < 4 {
		out = append(out, game.Command{Key: key(0), Kind: game.Create})
	}
	for i, c := range g.Chars {
		ch := g.Choose(c)
		k := key(i + 1)
		switch {
		case ch.Fight != nil && !ch.Fight.Ambush:
			out = append(out, game.Command{Key: k, Char: c.C.ID, Kind: game.Press, Option: ch.Fight.Options[d.Below(uint64(len(ch.Fight.Options)), "pick", draw.Int(tick), draw.Str(c.C.ID))].ID})
		case !ch.FreeToMove:
		case ch.Explore && d.Percent(30, "explore", draw.Int(tick), draw.Str(c.C.ID)):
			out = append(out, game.Command{Key: k, Char: c.C.ID, Kind: game.Explore})
		case len(ch.Materials) > 0 && d.Percent(20, "gather", draw.Int(tick), draw.Str(c.C.ID)):
			out = append(out, game.Command{Key: k, Char: c.C.ID, Kind: game.Gather, Material: ch.Materials[0], Ticks: 2})
		default:
			out = append(out, game.Command{Key: k, Char: c.C.ID, Kind: game.Step, Dir: int(d.Below(6, "dir", draw.Int(tick), draw.Str(c.C.ID)))})
		}
	}
	return out
}

func TestReplayFromSnapshot(t *testing.T) {
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
	script(t, g, half, 2*half, given)
	want, _ := g.Digest()

	var h game.Game
	if err := json.Unmarshal(snap, &h); err != nil {
		t.Fatal(err)
	}
	h.Attach(r)
	script(t, &h, half, 2*half, given)
	got, _ := h.Digest()
	if got != want {
		t.Fatalf("replay from snapshot: %s, want %s", got, want)
	}
	if bad := ledger.Audit(g.Ledger.Balances, g.Holdings()); len(bad) > 0 {
		t.Fatal(bad)
	}
	if len(g.Chars) == 0 || g.Ledger.Posted == 0 {
		t.Fatalf("script did too little: %d characters, %d ledger posts", len(g.Chars), g.Ledger.Posted)
	}
	walked := int64(0)
	for _, c := range g.Chars {
		walked += c.C.Walked
	}
	if walked == 0 {
		t.Fatal("nobody walked")
	}
}

func TestRefusedChangesNothing(t *testing.T) {
	r := rules(t)
	g, _ := game.New(r)
	res, err := g.Act(game.Command{Key: "a", Kind: game.Create})
	if err != nil {
		t.Fatal(err)
	}
	id := res.Char.C.ID
	before, _ := g.Digest()
	for _, cmd := range []game.Command{
		{Key: "b", Char: id, Kind: game.Step, Dir: 9},
		{Key: "c", Char: id, Kind: game.Press, Option: "hold"},
		{Key: "d", Char: id, Kind: game.Gather, Material: "nothing", Ticks: 1},
		{Key: "e", Char: "c-99", Kind: game.Rest},
	} {
		var ref *game.Refused
		if _, err := g.Act(cmd); !errors.As(err, &ref) {
			t.Fatalf("%s: %v, want a refusal", cmd.Kind, err)
		}
	}
	after, _ := g.Digest()
	if before != after {
		t.Fatal("a refused command changed the game")
	}
}

// TestAmbushAwayDefault walks a character through a region at the ambush
// line until an ambush springs, stays away, and checks it resolves with
// the way out at the tick the journey would have ended.
func TestAmbushAwayDefault(t *testing.T) {
	r := rules(t)
	g, _ := game.New(r)
	res, err := g.Act(game.Command{Key: "k0", Kind: game.Create})
	if err != nil {
		t.Fatal(err)
	}
	c := res.Char
	threat := g.World.GaugeIndex("threat")
	for n := 1; n < 400 && c.Fight == nil; n++ {
		for i := range g.World.Regions {
			g.World.Regions[i].Gauge[threat] = 900
		}
		if c.Long == nil {
			ch := g.Choose(c)
			for _, m := range ch.Moves {
				if m.Open {
					if _, err := g.Act(game.Command{Key: fmt.Sprintf("k%d", n), Char: c.C.ID, Kind: game.Step, Dir: m.Dir}); err != nil {
						t.Fatal(err)
					}
					break
				}
			}
		}
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	if c.Fight == nil || !c.Fight.Ambush {
		t.Fatal("no ambush sprang in a region past the line")
	}
	if _, err := g.Act(game.Command{Key: "busy", Char: c.C.ID, Kind: game.Step, Dir: 0}); err == nil {
		t.Fatal("a character in an ambush started a journey")
	}
	due := c.Fight.Due
	for g.Tick() <= due {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	if c.Fight != nil {
		t.Fatalf("the ambush was still open at tick %d, due %d", g.Tick(), due)
	}
	found := false
	for _, f := range g.Log.Since(0) {
		if f.Kind == "ambush.defaulted" && f.Tick == due+1 {
			found = true
		}
	}
	if !found {
		t.Fatal("no ambush.defaulted fact at the tick after the journey's end")
	}
}

func TestOneLongActionAtATime(t *testing.T) {
	r := rules(t)
	g, _ := game.New(r)
	res, _ := g.Act(game.Command{Key: "a", Kind: game.Create})
	c := res.Char
	if _, err := g.Act(game.Command{Key: "b", Char: c.C.ID, Kind: game.Rest}); err != nil {
		t.Fatal(err)
	}
	var ref *game.Refused
	if _, err := g.Act(game.Command{Key: "c", Char: c.C.ID, Kind: game.Gather, Material: g.Materials(c.C.At)[0], Ticks: 1}); !errors.As(err, &ref) || ref.Code != game.Busy {
		t.Fatalf("a second long action: %v", err)
	}
	for range 6 {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	if c.Long != nil {
		t.Fatal("rest did not come due on its tick")
	}
}
