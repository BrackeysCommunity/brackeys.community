package game

import (
	"fmt"
	"testing"

	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// TestStagedKillsStayStaged: a staged hunt's kill counts toward a staged
// contest but toward no world goal, so staging pays nothing through the
// world's boards.
func TestStagedKillsStayStaged(t *testing.T) {
	g, stager, ps, home, at := stagedFightGame(t)
	st := liveStage(g, stager, home, at, "hunt-2", sheets.StageHunt, quickHunt)
	if err := g.openStagedHunt(st, g.Tick()); err != nil {
		t.Fatal(err)
	}
	x := g.HuntByID(st.HuntID)
	region := goal.RegionRef(world.RegionRef(g.World.RegionAt(at)))
	cond := goal.Condition{Verb: goal.Defeat, Count: 1, At: region}
	open := func(issuer goal.Ref) *Goal {
		y := &Goal{Title: "Defeat", Issuer: issuer, Scope: goal.World, Mode: goal.Each, Lifetime: goal.Ephemeral, Turnover: goal.Expire,
			Posted: g.Tick(), Expires: g.Tick() + 3*sheets.TicksPerDay, State: goal.Live, Cond: cond}
		g.openGoal(y)
		return y
	}
	worldGoal := open(goal.Ref{Kind: goal.ByWorld})
	contest := open(goal.Ref{Kind: goal.ByStaged, ID: st.ID})
	x.H.Health = min(x.H.Health, 60)
	for n := 0; !x.H.Over; n++ {
		if n > 200 {
			t.Fatal("the staged hunt never fell")
		}
		pressFresh(t, g, ps[n%len(ps)], x, fmt.Sprintf("k-%d", n))
	}
	if !x.H.Slain {
		t.Fatal("the staged hunt was not slain")
	}
	if len(worldGoal.Progress) != 0 || len(worldGoal.Claims) != 0 {
		t.Fatalf("a world goal took a staged kill: progress %v, claims %v", worldGoal.Progress, worldGoal.Claims)
	}
	if len(contest.Progress) == 0 && len(contest.Claims) == 0 {
		t.Fatal("the staged contest took nothing from its own stage's kill")
	}
	audit(t, g)
}
