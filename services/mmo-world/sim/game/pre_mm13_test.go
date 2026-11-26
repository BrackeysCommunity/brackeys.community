package game_test

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
)

// testdata/pre-mm13 is a world saved before the live map, on world day 3:
// five characters from the first settlement, two of them in the guild a
// server installed there, and three walkers who went their own ways on the
// first day, so most of the tiles found lie out of everyone's sight. It was
// made by a throwaway test: create the five with keys.Throwaway("pre-mm13"),
// step each walker away from home for 48 ticks, run to tick 433, and write
// json.Marshal(g) and g.Digest().
const preMM13Dir = "testdata/pre-mm13/"

// A world saved before the live map attaches at its digest and plays a
// world day with the ledger holding: the map keeps nothing in the game.
func TestPreMM13WorldLoads(t *testing.T) {
	r := testkit.Rules(t, testkit.Book(t), keys.Throwaway("pre-mm13"))
	body, err := os.ReadFile(preMM13Dir + "snapshot.json")
	if err != nil {
		t.Fatal(err)
	}
	saved, err := os.ReadFile(preMM13Dir + "digest.txt")
	if err != nil {
		t.Fatal(err)
	}
	g := mm8aSnapshot(t, r, body)
	if d, _ := g.Digest(); d.String() != strings.TrimSpace(string(saved)) {
		t.Fatalf("the pre-MM13 save attaches at %s, saved as %s", d, strings.TrimSpace(string(saved)))
	}
	if err := preMM13Shows(g); err != nil {
		t.Fatal(err)
	}
	day := g.World.Day
	advanceDays(t, g, 1)
	audit(t, g)
	if g.World.Day != day+1 {
		t.Fatalf("a world day played from day %d reached day %d", day, g.World.Day)
	}
	if err := preMM13Shows(g); err != nil {
		t.Fatalf("after a world day: %v", err)
	}
}

// preMM13Shows is nil when the save holds what it was made for: a guild
// running a standing settlement, characters in it and out of it, and found
// tiles out of every character's and the guild's sight.
func preMM13Shows(g *game.Game) error {
	run := slices.IndexFunc(g.Places, func(p *game.Place) bool { return p.Guild != "" && p.Ruined == 0 && p.Faction == nil })
	if run < 0 {
		return fmt.Errorf("no guild runs a standing settlement")
	}
	guild := g.Places[run].Guild
	in, out := 0, 0
	for _, c := range g.Chars {
		switch c.C.Guild {
		case guild:
			in++
		case "":
			out++
		}
	}
	if in < 2 || out < 2 {
		return fmt.Errorf("%d characters in %s and %d in none", in, guild, out)
	}
	sight := map[hex.Hex]bool{}
	light := func(at hex.Hex) {
		for _, h := range hex.DiscAt(at, g.Sight(at)) {
			sight[h] = true
		}
	}
	for _, c := range g.Chars {
		light(c.C.At)
	}
	light(g.Places[run].Hex)
	dark := 0
	for _, ts := range g.World.Tiles {
		if ts.Discovered != nil && !sight[ts.Hex] {
			dark++
		}
	}
	if dark == 0 {
		return fmt.Errorf("every found tile is in someone's sight")
	}
	return nil
}
