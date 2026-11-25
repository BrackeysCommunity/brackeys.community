package game

import (
	"testing"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/world"
)

// TestStagedCreditPerServer: a fact written in server b's staging counts
// toward none of server a's staged contests, while the same fact in a's own
// staging does; a clean fact still counts toward both world goal and contest.
func TestStagedCreditPerServer(t *testing.T) {
	g, _, b, stA, _ := pathsGame(t)
	stB := &Stage{ID: "st-b", Template: stA.Template, Kind: stA.Kind, Server: "b", Role: RoleAdmin, By: "someone-of-b",
		Settlement: stA.Settlement, At: stA.At, Open: true}
	g.Live.Stages = append(g.Live.Stages, stB)
	region := goal.RegionRef(world.RegionRef(g.World.RegionAt(b.C.At)))
	cond := goal.Condition{Verb: goal.Reach, Count: 9, At: region}
	worldGoal := openSpanGoal(g, goal.Ref{Kind: goal.ByWorld}, cond, 0)
	contestA := openSpanGoal(g, goal.Ref{Kind: goal.ByStaged, ID: stA.ID}, cond, 0)
	contestB := openSpanGoal(g, goal.Ref{Kind: goal.ByStaged, ID: stB.ID}, cond, 0)

	enter := func(st *Stage) fact.Fact {
		t.Helper()
		if st != nil {
			defer g.withStage(st)()
		}
		f, err := g.fact(b, "travel.entered", g.Tick(), fact.At(b.C.At)...)
		if err != nil {
			t.Fatal(err)
		}
		return f
	}
	from := fact.ID(g.Log.Len())
	clean, inB, inA := enter(nil), enter(stB), enter(stA)
	if staged, by := g.stagedOf(inB); !staged || by != "b" {
		t.Fatalf("b's staged fact reads staged %v by %q", staged, by)
	}
	if staged, by := g.stagedOf(inA); !staged || by != "a" {
		t.Fatalf("a's staged fact reads staged %v by %q", staged, by)
	}
	if err := g.creditGoals(from, "per-server"); err != nil {
		t.Fatal(err)
	}
	switch {
	case credited(contestA, inB.ID):
		t.Fatal("server b's staging counted toward server a's contest")
	case !credited(contestA, inA.ID):
		t.Fatal("server a's own staging did not count toward its contest")
	case !credited(contestB, inB.ID) || credited(contestB, inA.ID):
		t.Fatalf("server b's contest cites %+v", contestB.Facts)
	case !credited(worldGoal, clean.ID) || !credited(contestA, clean.ID) || !credited(contestB, clean.ID):
		t.Fatal("a clean fact lost a credit it had")
	case credited(worldGoal, inA.ID) || credited(worldGoal, inB.ID):
		t.Fatalf("the world goal cites %+v", worldGoal.Facts)
	}

	// A fact that names b's stage as a subject is b's staging too.
	named := fact.Fact{ID: fact.ID(g.Log.Len()) + 1, Kind: "travel.entered", Subjects: []fact.Ref{{Kind: kindStage, ID: stB.ID}}}
	if staged, by := g.stagedOf(named); !staged || by != "b" {
		t.Fatalf("a fact naming b's stage reads staged %v by %q", staged, by)
	}
	audit(t, g)
}
