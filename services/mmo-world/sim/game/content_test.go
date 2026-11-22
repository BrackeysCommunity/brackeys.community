package game_test

import (
	"context"
	"testing"

	"jams.team/mmo-world/harness/agent"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/sheets"
)

// Every tile a character stands on has been reached, so play never reads
// the native fallback (GDD 4.17).
func TestEveryCharacterTileReached(t *testing.T) {
	b := testkit.Book(t)
	g, err := game.New(rules(t))
	if err != nil {
		t.Fatal(err)
	}
	if !g.World.Drawn() {
		t.Fatal("a new world does not draw its content from history")
	}
	l := service.NewLocal(g)
	ps := testkit.Team(b, "reach", 8)
	s := agent.NewScript(l, ps, "reach")
	ctx := context.Background()
	unreached := func(when string) {
		t.Helper()
		for _, c := range g.Chars {
			if _, ok := g.Content(c.C.At); !ok {
				t.Fatalf("tick %d, %s: %s stands on %s, which holds no content", g.Tick(), when, c.C.ID, c.C.At.Ref())
			}
		}
	}
	walked := int64(0)
	for tick := int64(0); tick < 10*sheets.TicksPerDay; tick++ {
		if err := s.Turn(ctx, tick); err != nil {
			t.Fatal(err)
		}
		unreached("after the commands")
		if err := l.Advance(); err != nil {
			t.Fatal(err)
		}
		unreached("after the tick")
	}
	for _, c := range g.Chars {
		walked += c.C.Walked
	}
	if len(g.Chars) == 0 || walked == 0 {
		t.Fatalf("%d characters walked %d tiles: the play proves nothing", len(g.Chars), walked)
	}
}
