package game_test

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/class"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/ledger"
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

// holding gives a character an active class and one of its abilities.
func holding(tr *trader, cls, ability string) {
	tr.c.C.Classes = class.State{Earned: []class.Earned{{ID: cls}}, Active: []string{cls}, Abilities: []string{ability}}
}

// Even shares pays any pooled goal its holder posts equally, and nobody
// else's.
func TestEvenSharesOnAnyPooledGoal(t *testing.T) {
	g, ts := society(t, 4)
	reeve, plain, a, b := ts[0], ts[1], ts[2], ts[3]
	fibre := materialWith(t, g, "fibre")
	holding(reeve, "reeve", "even-shares")
	if !g.EvenShares(reeve.c) || g.EvenShares(plain.c) {
		t.Fatal("Even shares is read off the wrong character")
	}
	pooled := func(by *trader) *game.Goal {
		by.grant(ledger.Coin, 200)
		return post(by, game.GoalSpec{Title: "Thirty fibre", Issuer: goal.ByCharacter, Reward: 90, Mode: goal.Pooled, Even: true, Lifetime: goal.Standing,
			Turnover: goal.Keep, Cond: goal.Condition{Verb: goal.Deliver, Tag: "fibre", Count: 30, At: here(g, by)}})
	}
	for _, c := range []struct {
		by     *trader
		a, b   int64
		evenly bool
	}{{reeve, 45, 45, true}, {plain, 60, 30, false}} {
		x := pooled(c.by)
		if x.Even != c.evenly {
			t.Fatalf("a pooled goal posted with even shares by %s is even: %v", c.by.c.C.ID, x.Even)
		}
		wasA, wasB := coinOf(a), coinOf(b)
		a.grant(ledger.Material(fibre), 20)
		b.grant(ledger.Material(fibre), 10)
		a.must(game.Command{Kind: game.DeliverGoal, Target: x.ID, Material: fibre, Units: 20})
		b.must(game.Command{Kind: game.DeliverGoal, Target: x.ID, Material: fibre, Units: 10})
		met(t, x)
		if coinOf(a)-wasA != c.a || coinOf(b)-wasB != c.b {
			t.Fatalf("20 and 10 of 30 were paid %d and %d coin, want %d and %d", coinOf(a)-wasA, coinOf(b)-wasB, c.a, c.b)
		}
	}
	audit(t, g)
}

// Mark prey offers its holder the tags that tell creatures apart, and
// holds the one named for the day.
func TestMarkPreyOffersCreatureTags(t *testing.T) {
	g, ts := society(t, 2)
	stalker, other := ts[0], ts[1]
	holding(stalker, "stalker", "mark-prey")
	tags := g.PreyTags(stalker.c)
	if len(tags) == 0 || len(g.PreyTags(other.c)) != 0 {
		t.Fatalf("a Stalker is offered %v and anyone else %v", tags, g.PreyTags(other.c))
	}
	for _, tag := range tags {
		stalker.must(game.Command{Kind: game.MarkPrey, Option: tag})
	}
	if g.PreyToday(stalker.c) != tags[len(tags)-1] {
		t.Fatalf("today's mark is %q", g.PreyToday(stalker.c))
	}
	unchanged(t, stalker, "a mark every creature carries", game.Command{Kind: game.MarkPrey, Option: "creature"})
	advanceDays(t, g, 1)
	if g.PreyToday(stalker.c) != "" {
		t.Fatal("yesterday's mark still stands")
	}
}

// A Master's eye sees whether a recipe's kind is registered before
// committing; nobody else is told.
func TestMastersEyeSeesTheRegistry(t *testing.T) {
	g, ts := society(t, 2)
	smith, other := ts[0], ts[1]
	holding(smith, "smith", "masters-eye")
	recipe, _ := bladeWithTrait(t, g.Rules())
	see := func(tr *trader) game.Appraisal {
		ap, err := g.Appraise(tr.c, recipe)
		if err != nil {
			t.Fatal(err)
		}
		return ap
	}
	if ap := see(smith); !ap.Eye || ap.Registered {
		t.Fatalf("before anyone made it: %+v", ap)
	}
	other.grant(ledger.Material(recipe.Inputs[0].Kind), recipe.Inputs[0].Qty)
	other.grant(ledger.Coin, 50)
	other.must(game.Command{Kind: game.Craft, Recipe: &recipe})
	if ap := see(smith); !ap.Eye || !ap.Registered {
		t.Fatalf("once it is registered: %+v", ap)
	}
	if ap := see(other); ap.Eye || ap.Registered {
		t.Fatalf("without the ability: %+v", ap)
	}
}
