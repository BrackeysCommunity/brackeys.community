package game

import (
	"testing"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/econ"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tally"
)

// threadSides opens an arc's first stage by hand with a pooled side goal
// for each side, of mark units, sponsored by sponsor.
func threadSides(t *testing.T, g *Game, a *Arc, mark int64, sponsor int, sides ...string) []*Goal {
	t.Helper()
	if g.Story == nil {
		g.Story = &Story{}
	}
	g.Story.NextArc++
	due := g.Tick() + 3*sheets.TicksPerDay
	var goals []*Goal
	var runs []SideRun
	for _, id := range sides {
		x := &Goal{Title: id, Issuer: goal.Ref{Kind: goal.ByFaction, ID: "0"}, Scope: goal.World, Board: 0, Mode: goal.Pooled,
			Lifetime: goal.Ephemeral, Turnover: goal.Expire, Posted: g.Tick(), Expires: due + 1, State: goal.Live, Progress: tally.Tally{},
			Cond: goal.Condition{Verb: goal.Back, Side: SideKey(a.ID, 0, id), Count: mark, At: goal.SettlementRef(0)}}
		if err := goal.Valid(x, g.Tick(), g.GoalLimits()); err != nil {
			t.Fatal(err)
		}
		g.openGoal(x)
		goals = append(goals, x)
		runs = append(runs, SideRun{Side: id, Goal: x.ID, Mark: mark, Sponsor: sponsor, Opponent: -1, At: goal.SettlementRef(0)})
	}
	a.Stages = []StageRun{{Began: g.Tick(), Due: due, Sides: runs}}
	g.Story.Arcs = append(g.Story.Arcs, a)
	return goals
}

// invitation is a character's open invitation, cast with a fence.
func invitation(t *testing.T, g *Game, c *Char, fence string) (*Arc, []*Goal) {
	t.Helper()
	a := &Arc{ID: "arc-invite", Template: "the-invitation", Scope: arc.Personal, Char: c.C.ID, Seat: g.SettlementHex(0), By: "test",
		Cast: arc.Cast{{Role: "character", Ref: char.Ref(c.C.ID)}, {Role: "npc", Ref: npc.Ref(fence)}}}
	return a, threadSides(t, g, a, 1, econ.Keepers, "take-the-job", "turn-it-down")
}

func chose(t *testing.T, g *Game, c *Char, to, choice string) {
	t.Helper()
	first := fact.ID(g.Log.Len())
	if _, err := g.factWith(c, []fact.Ref{npc.Ref(to)}, factNPCChose, g.Tick(), fact.S("topic", "the-invitation"), fact.S("choice", choice)); err != nil {
		t.Fatal(err)
	}
	if err := g.creditGoals(first, "chose-"+i64(int64(first))); err != nil {
		t.Fatal(err)
	}
}

func TestWordSideCountsOnce(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	g.adjustStanding(c, syndicateKey, g.r.Story.Gate)
	_, sides := invitation(t, g, c, "fence-1")
	take, down := sides[0], sides[1]
	chose(t, g, c, "someone-else", "take-the-job")
	if take.Total() != 0 {
		t.Fatal("a word to another NPC counts")
	}
	chose(t, g, c, "fence-1", "take-the-job")
	chose(t, g, c, "fence-1", "take-the-job")
	if got := take.Progress.Get(c.C.ID); got != 1 {
		t.Fatalf("the word counts once, got %d", got)
	}
	if down.Total() != 0 {
		t.Fatal("taking the job counted toward turning it down")
	}
	// Another character's thread is not its to answer.
	other := mustCreate(t, g, "b", "knife")
	g.adjustStanding(other, syndicateKey, g.r.Story.Gate)
	chose(t, g, other, "fence-1", "turn-it-down")
	if down.Total() != 0 {
		t.Fatal("another character's word counts on a personal thread")
	}
}

func TestSyndicateGateShuns(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	a, sides := invitation(t, g, c, "fence-1")
	s, ok := g.sideOf(sides[0])
	if !ok || s.a != a {
		t.Fatal("the invitation's side is not read")
	}
	g.adjustStanding(c, syndicateKey, g.r.Story.Gate-1)
	if !g.shunned(c, s) {
		t.Fatalf("%d syndicate standing is under the gate", g.r.Story.Gate-1)
	}
	chose(t, g, c, "fence-1", "take-the-job")
	if sides[0].Total() != 0 {
		t.Fatal("a word under the gate counts")
	}
	if len(g.SidesFor(c)) != 0 {
		t.Fatal("a side under the gate is offered")
	}
	g.adjustStanding(c, syndicateKey, 1)
	if g.shunned(c, s) {
		t.Fatal("standing at the gate is shunned")
	}
	// A row that is not the syndicate's ignores the gate.
	g.adjustStanding(c, syndicateKey, -g.r.Story.Gate)
	war := &Arc{ID: "arc-war", Template: "the-road-war", Scope: arc.ScopeWorld, Seat: g.SettlementHex(0), By: "test"}
	ws := threadSides(t, g, war, 10, 0, "prey-on-it")
	if ps, _ := g.sideOf(ws[0]); g.shunned(c, ps) {
		t.Fatal("the syndicate's gate shuns from a road war")
	}
}

func TestPreyWaylayCountsTimesShare(t *testing.T) {
	g := guardGame(t)
	thief := mustCreate(t, g, "a", "knife")
	idle := mustCreate(t, g, "b", "knife")
	war := &Arc{ID: "arc-war", Template: "the-road-war", Scope: arc.ScopeWorld, Seat: g.SettlementHex(0), By: "test"}
	prey := threadSides(t, g, war, 50, 0, "prey-on-it")[0]
	s, ok := g.sideOf(prey)
	if !ok || s.wants != arc.WantGoods {
		t.Fatal("the prey side is not a goods side")
	}
	g.enlist(thief, s)
	m := g.r.Book.Materials[0].ID
	waylay := func(c *Char, outcome string, units int64) {
		t.Helper()
		first := fact.ID(g.Log.Len())
		if _, err := g.factWith(c, []fact.Ref{{Kind: "caravan", ID: "r@1"}}, factTheft, g.Tick(), fact.S("kind", KindWaylay), fact.S("outcome", outcome),
			fact.N("units", units), fact.S("material", m), fact.S("side", prey.ID)); err != nil {
			t.Fatal(err)
		}
		if err := g.creditGoals(first, "w-"+i64(int64(first))); err != nil {
			t.Fatal(err)
		}
	}
	waylay(idle, theftWon, 8)
	if prey.Total() != 0 {
		t.Fatal("a waylay by someone not backing the side counts")
	}
	waylay(thief, "lost", 8)
	if prey.Total() != 0 {
		t.Fatal("a lost waylay counts")
	}
	standing := thief.C.Standing.Get(factionOwner(0))
	waylay(thief, theftWon, 8)
	want := fixed.PercentFloor(8, g.hotCell("prey-share"))
	if got := prey.Progress.Get(thief.C.ID); got != want {
		t.Fatalf("a backer's waylay counts %d, want 8 × prey-share = %d", got, want)
	}
	if thief.C.Standing.Get(factionOwner(0)) <= standing && want*g.r.Values.Asset(m) >= g.r.Story.StandingFor {
		t.Fatal("the waylay earned no standing with the sponsor")
	}
}
