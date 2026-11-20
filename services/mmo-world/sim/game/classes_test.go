package game_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/sheets"
)

// Every threshold a class unlocks at, and the skill its level follows,
// is something the game counts.
func TestEveryClassCanBeEarned(t *testing.T) {
	b := rules(t).Book
	processes := b.IDs("items.processes")
	for _, c := range b.Classes {
		if !slices.Contains(game.Skills, c.Skill) {
			t.Errorf("%s: its level follows %q, which nothing practises", c.ID, c.Skill)
		}
		for _, q := range c.Unlock {
			known := map[string][]string{"practice": game.Skills, "deed": game.Deeds, "crafts": processes}[q.Kind]
			if !slices.Contains(known, q.ID) {
				t.Errorf("%s: unlocks at %s %q, which nothing counts", c.ID, q.Kind, q.ID)
			}
		}
	}
}

// meet gives a character everything a class unlocks at.
func meet(t *testing.T, g *game.Game, tr *trader, id string) *sheets.Class {
	t.Helper()
	b := g.Rules().Book
	row := &b.Classes[slices.IndexFunc(b.Classes, func(c sheets.Class) bool { return c.ID == id })]
	for _, q := range row.Unlock {
		switch q.Kind {
		case "practice":
			for tr.c.C.Level(q.ID) < q.At {
				tr.c.C.Practise(q.ID, 1, g.Rules().Growth.Params())
			}
		case "deed":
			tr.c.C.Deeds.Bump(q.ID, q.At)
		case "crafts":
			tr.c.C.Crafts.Bump(q.ID, q.At)
		}
	}
	tr.must(game.Command{Kind: game.Look})
	return row
}

func abilitiesOf(g *game.Game, class string, tier int64) []string {
	var out []string
	for _, a := range g.Rules().Book.Abilities {
		if a.Class == class && a.Tier == tier {
			out = append(out, a.ID)
		}
	}
	return out
}

// A class unlocks by what was practised, the first in the world is
// recorded, two at most are active, and a tier gives one ability of two.
func TestClassesUnlockChooseAndTake(t *testing.T) {
	g, ts := society(t, 2)
	a, b := ts[0], ts[1]
	if len(a.c.C.Classes.Earned) != 0 {
		t.Fatalf("a new character has classes: %+v", a.c.C.Classes)
	}
	meet(t, g, a, "smith")
	meet(t, g, b, "smith")
	if e := a.c.C.Classes.Earned; len(e) != 1 || !e[0].First || b.c.C.Classes.Earned[0].First {
		t.Fatalf("first smith %+v, second %+v", e, b.c.C.Classes.Earned)
	}
	if g.ClassLevel(a.c, "smith") != 1 {
		t.Fatalf("a new smith is level %d", g.ClassLevel(a.c, "smith"))
	}
	pair := abilitiesOf(g, "smith", 1)
	if len(pair) != 2 {
		t.Fatalf("smith tier 1 offers %v", pair)
	}
	a.must(game.Command{Kind: game.TakeAbility, Option: pair[0]})
	unchanged(t, a, "the tier's other ability", game.Command{Kind: game.TakeAbility, Option: pair[1]})
	unchanged(t, a, "an ability of a shut tier", game.Command{Kind: game.TakeAbility, Option: abilitiesOf(g, "smith", 5)[0]})
	unchanged(t, b, "an ability of a class not earned", game.Command{Kind: game.TakeAbility, Option: abilitiesOf(g, "reeve", 1)[0]})

	// A third class earned waits; choosing it retires the oldest active,
	// whose abilities are kept.
	meet(t, g, a, "reeve")
	meet(t, g, a, "chandler")
	if got := a.c.C.Classes.Active; !slices.Equal(got, []string{"smith", "reeve"}) || len(a.c.C.Classes.Earned) != 3 {
		t.Fatalf("active %v of earned %+v", got, a.c.C.Classes.Earned)
	}
	a.must(game.Command{Kind: game.ChooseClass, Option: "chandler"})
	if got := a.c.C.Classes; !slices.Equal(got.Active, []string{"reeve", "chandler"}) || !slices.Contains(got.Abilities, pair[0]) {
		t.Fatalf("after choosing a third: %+v", got)
	}
}

// A Reeve's level follows the goals it met for others.
func TestReeveLevelFollowsGoalsMet(t *testing.T) {
	g, ts := society(t, 1)
	a := ts[0]
	meet(t, g, a, "reeve")
	at := sheets.IntParam(g.Rules().Book.ClassParams, "level-5-practice")
	for a.c.C.Level("goals") < at {
		a.c.C.Practise("goals", 1, g.Rules().Growth.Params())
	}
	if lv := g.ClassLevel(a.c, "reeve"); lv < sheets.IntParam(g.Rules().Book.ClassParams, "tier-levels") {
		t.Fatalf("a reeve at goals practice %d is class level %d", at, lv)
	}
}
