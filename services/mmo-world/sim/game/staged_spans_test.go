package game

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// openSpanGoal opens a goal that no single event meets, so progress shows.
func openSpanGoal(g *Game, issuer goal.Ref, cond goal.Condition, reward int64) *Goal {
	y := &Goal{Title: "Span", Issuer: issuer, Scope: goal.World, Mode: goal.Each, Lifetime: goal.Ephemeral, Turnover: goal.Expire,
		Posted: g.Tick(), Expires: g.Tick() + 3*sheets.TicksPerDay, State: goal.Live, Cond: cond, Reward: reward}
	g.openGoal(y)
	return y
}

func credited(x *Goal, id fact.ID) bool {
	return slices.ContainsFunc(x.Facts, func(c goal.Cite) bool { return c.Fact == id })
}

// TestStagedSpanBounds: the fact written just before a stage's context is
// clean and the last one inside it is staged.
func TestStagedSpanBounds(t *testing.T) {
	g, _, b, st, _ := pathsGame(t)
	region := goal.RegionRef(world.RegionRef(g.World.RegionAt(b.C.At)))
	cond := goal.Condition{Verb: goal.Reach, Count: 5, At: region}
	worldGoal := openSpanGoal(g, goal.Ref{Kind: goal.ByWorld}, cond, 0)
	contest := openSpanGoal(g, goal.Ref{Kind: goal.ByStaged, ID: st.ID}, cond, 0)

	from := fact.ID(g.Log.Len())
	clean, err := g.fact(b, "travel.entered", g.Tick(), fact.At(b.C.At)...)
	if err != nil {
		t.Fatal(err)
	}
	restore := g.withStage(st)
	staged, err := g.fact(b, "travel.entered", g.Tick(), fact.At(b.C.At)...)
	restore()
	if err != nil {
		t.Fatal(err)
	}
	if g.stagedFact(clean) {
		t.Fatal("the fact written before the stage read as staged")
	}
	if !g.stagedFact(staged) {
		t.Fatal("the last fact written in the stage read as clean")
	}
	if err := g.creditGoals(from, "spans"); err != nil {
		t.Fatal(err)
	}
	if !credited(worldGoal, clean.ID) || credited(worldGoal, staged.ID) {
		t.Fatalf("world goal cites %+v", worldGoal.Facts)
	}
	if !credited(contest, staged.ID) {
		t.Fatalf("staged contest cites %+v", contest.Facts)
	}
}

// TestStagedCraftCreditsNoWorldGoal: a craft from staged units moves no
// coin-paying world Make goal, but counts toward its stage's contest.
func TestStagedCraftCreditsNoWorldGoal(t *testing.T) {
	g, _, b, st, m := pathsGame(t)
	mintStaged(t, g, b, st.Settlement, m, 6)
	cond := goal.Condition{Verb: goal.Make, Count: 5}
	worldGoal := openSpanGoal(g, goal.Ref{Kind: goal.ByWorld}, cond, 50)
	contest := openSpanGoal(g, goal.Ref{Kind: goal.ByStaged, ID: st.ID}, cond, 0)
	rec := item.Recipe{Process: "shape", Method: "narrow-grind", Slot: "tool", Inputs: []item.Input{{Kind: m, Qty: 3}}}
	if _, err := g.Act(Command{Key: "craft", Char: b.C.ID, Kind: Craft, Recipe: &rec}); err != nil {
		t.Fatal(err)
	}
	if made := b.C.Item("craft"); made == nil || made.Staged == nil {
		t.Fatalf("the craft's output is %+v", made)
	}
	if len(worldGoal.Progress) != 0 || len(worldGoal.Facts) != 0 {
		t.Fatalf("a world goal took a staged craft: progress %v", worldGoal.Progress)
	}
	if len(contest.Progress) == 0 {
		t.Fatal("the staged contest took nothing from the staged craft")
	}
	audit(t, g)
}

// TestStagedUnitsWeigh: staged units count toward being laden but pay no
// hauling deed.
func TestStagedUnitsWeigh(t *testing.T) {
	g, a, _, st, m := pathsGame(t)
	clean := a.Carried()
	room := g.Capacity(a) - a.Load()
	if room < 0 {
		t.Fatalf("a starts laden: load %d over capacity %d", a.Load(), g.Capacity(a))
	}
	a.C.Staged = char.AddStaged(a.C.Staged, st.Settlement, m, room+1)
	if !g.Laden(a) {
		t.Fatalf("load %d over capacity %d is not laden", a.Load(), g.Capacity(a))
	}
	if a.Carried() != clean {
		t.Fatal("staged units counted as clean goods carried")
	}
}
