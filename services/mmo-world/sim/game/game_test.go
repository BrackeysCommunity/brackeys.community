package game_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"testing"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

func rules(t testing.TB) *game.Rules {
	t.Helper()
	return testkit.Rules(t, testkit.Book(t), keys.Throwaway("game-test"))
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
		{Key: "f", Char: id, Kind: game.Correct, Asset: ledger.Material("no-such-ore"), Units: 1, Note: "typo"},
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

// TestAmbushAwayDefault walks a character past the ambush line until an
// ambush springs, stays away, and checks it resolves with the way out the
// tick after the journey would have ended.
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

// TestAmbushNeedsCreatures walks past the ambush line where nothing lives:
// no ambush may spring, and no tick may fail.
func TestAmbushNeedsCreatures(t *testing.T) {
	b := testkit.Book(t)
	b.Creatures = slices.Clone(b.Creatures)
	for i := range b.Creatures {
		b.Creatures[i].Biomes = nil
	}
	r := testkit.Rules(t, b, keys.Throwaway("game-test"))
	g, _ := game.New(r)
	res, err := g.Act(game.Command{Key: "k0", Kind: game.Create})
	if err != nil {
		t.Fatal(err)
	}
	c := res.Char
	threat := g.World.GaugeIndex("threat")
	for n := 1; n < 400; n++ {
		for i := range g.World.Regions {
			g.World.Regions[i].Gauge[threat] = 900
		}
		if c.Long == nil {
			walk(t, g, c, fmt.Sprintf("k%d", n))
		}
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
		if c.Fight != nil {
			t.Fatal("an ambush sprang where nothing lives")
		}
	}
	if c.C.Walked == 0 {
		t.Fatal("nobody walked")
	}
}

// walk starts a one-tile step in the first open direction.
func walk(t *testing.T, g *game.Game, c *game.Char, key string) {
	t.Helper()
	for _, m := range g.Choose(c).Moves {
		if m.Open {
			if _, err := g.Act(game.Command{Key: key, Char: c.C.ID, Kind: game.Step, Dir: m.Dir}); err != nil {
				t.Fatal(err)
			}
			return
		}
	}
}

// hungryWalker is a character with no provisions five tiles out from
// home, by tiles it has entered.
func hungryWalker(t *testing.T) (*game.Game, *game.Char, hex.Hex) {
	t.Helper()
	g, _ := game.New(rules(t))
	res, err := g.Act(game.Command{Key: "k0", Kind: game.Create})
	if err != nil {
		t.Fatal(err)
	}
	c := res.Char
	var home hex.Hex
	for n := range 5 {
		walk(t, g, c, fmt.Sprintf("out-%d", n))
		for c.Long != nil {
			if _, err := g.Advance(); err != nil {
				t.Fatal(err)
			}
		}
		if n == 0 {
			home = c.C.At
		}
	}
	return g, c, home
}

// TestHungerEnds sends a character with no provisions on a journey long
// enough to go hungry, and checks the hunger ends when the journey does:
// on arrival, and on a cancel.
func TestHungerEnds(t *testing.T) {
	g, c, home := hungryWalker(t)
	far := c.C.At
	if _, err := g.Act(game.Command{Key: "home", Char: c.C.ID, Kind: game.Travel, To: &home}); err != nil {
		t.Fatal(err)
	}
	hungry := false
	for c.Long != nil {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
		hungry = hungry || (c.Long != nil && c.C.Has(char.Hungry, g.Tick()))
	}
	if !hungry {
		t.Fatal("a journey past the free ticks with no provisions never went hungry")
	}
	if c.C.Has(char.Hungry, g.Tick()) {
		t.Fatal("still hungry after the journey ended")
	}
	if _, err := g.Act(game.Command{Key: "back", Char: c.C.ID, Kind: game.Travel, To: &far}); err != nil {
		t.Fatal(err)
	}
	for c.Long != nil && !c.C.Has(char.Hungry, g.Tick()) {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	if c.Long == nil {
		t.Fatal("the way back never went hungry")
	}
	if _, err := g.Act(game.Command{Key: "stop", Char: c.C.ID, Kind: game.Cancel}); err != nil {
		t.Fatal(err)
	}
	if c.C.Has(char.Hungry, g.Tick()) {
		t.Fatal("still hungry after the journey was cancelled")
	}
}

// TestHungryAmbush walks a hungry character back and forth past the ambush
// line until an ambush springs while they are hungry: the hunger ends with
// the journey, and the ambush still leaves its owner a tick to answer.
func TestHungryAmbush(t *testing.T) {
	g, c, home := hungryWalker(t)
	far := c.C.At
	threat := g.World.GaugeIndex("threat")
	for n := range 200 {
		if c.Fight != nil {
			if _, err := g.Advance(); err != nil {
				t.Fatal(err)
			}
			continue
		}
		to := home
		if n%2 == 1 {
			to = far
		}
		if _, err := g.Act(game.Command{Key: fmt.Sprintf("j%d", n), Char: c.C.ID, Kind: game.Travel, To: &to}); err != nil {
			continue
		}
		for c.Long != nil {
			for i := range g.World.Regions {
				g.World.Regions[i].Gauge[threat] = 900
			}
			was := c.C.Has(char.Hungry, g.Tick())
			ends := c.Long.Ends
			if _, err := g.Advance(); err != nil {
				t.Fatal(err)
			}
			if c.Fight == nil || !was {
				continue
			}
			if c.C.Has(char.Hungry, g.Tick()) {
				t.Fatal("still hungry after an ambush ended the journey")
			}
			if c.Fight.Due < g.Tick() || c.Fight.Due < ends {
				t.Fatalf("an ambush at tick %d is due at %d, before the journey's end %d", g.Tick(), c.Fight.Due, ends)
			}
			return
		}
	}
	t.Skip("no ambush sprang on a hungry traveller")
}
