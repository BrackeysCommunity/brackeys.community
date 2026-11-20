package guild

import (
	"testing"

	"jams.team/mmo-world/sim/tally"
)

var p = Params{Least: 5, OfficerPer: 5, OfficerSpend: 500, ApprovalDays: 1, LeaderIdleDays: 14, VoteShare: 66, VoteDays: 2,
	ServerLeaderDays: 14, ServerLeaderEvery: 7, DrawShare: 50, SpoilsDays: 14}

func five() *Guild {
	g := New("g-1", "Reeds", "a", 0)
	for i, c := range []string{"b", "c", "d", "e"} {
		g.Join(c, int64(i+1))
	}
	return g
}

// TestOfficersOnePerFive, at least one.
func TestOfficersOnePerFive(t *testing.T) {
	g := five()
	if g.Officers(p) != 1 || g.Promote("b", 9, p) {
		t.Fatal("five members took a second officer")
	}
	for _, c := range []string{"f", "g", "h", "i", "j"} {
		g.Join(c, 10)
	}
	if !g.Promote("b", 11, p) || !g.Full(p) {
		t.Fatal("ten members could not name a second officer")
	}
}

// TestSpendingPastTheDayWaits for a second officer.
func TestSpendingPastTheDayWaits(t *testing.T) {
	g := five()
	if !g.MaySpend("a", 3, 400, p) {
		t.Fatal("400 refused")
	}
	g.Spent("a", 3, 400)
	if g.MaySpend("a", 3, 200, p) || !g.MaySpend("a", 4, 200, p) {
		t.Fatal("the day's limit misread")
	}
	g.Approvals = append(g.Approvals, Approval{ID: "x", By: "a", Day: 3})
	if _, ok := g.Approve("x", "a"); ok {
		t.Fatal("an officer approved its own spend")
	}
	if gone := g.Lapse(5, p); len(gone) != 1 {
		t.Fatal("an approval did not lapse after a day")
	}
}

// TestVoteNeedsTwoThirds of active members, never against an admin.
func TestVoteNeedsTwoThirds(t *testing.T) {
	g := five()
	if g.Cast("b", "a", Leader, 1, 5, p, "v1") || g.Cast("c", "a", Leader, 1, 5, p, "v1") || g.Cast("d", "a", Leader, 1, 5, p, "v1") {
		t.Fatal("three of five carried")
	}
	if !g.Cast("e", "a", Leader, 1, 5, p, "v1") || g.Leader != "" {
		t.Fatal("four of five did not carry")
	}
	g.Member("b").Admin = true
	if g.Removable("b", Officer) {
		t.Fatal("an admin could be voted out")
	}
}

// TestSuccessionFallsToTheLongestServingOfficer.
func TestSuccessionFallsToTheLongestServingOfficer(t *testing.T) {
	g := five()
	for _, c := range []string{"f", "g", "h", "i", "j"} {
		g.Join(c, 10)
	}
	g.Promote("c", 20, p)
	idle := func(id string) bool { return id != "a" }
	if l := g.Succeed(idle); l != "c" {
		t.Fatalf("leader %q, want the officer c", l)
	}
	if g.Succeed(idle) != "" {
		t.Fatal("an active leader was replaced")
	}
}

// TestServerLeaderIsTheMostActive.
func TestServerLeaderIsTheMostActive(t *testing.T) {
	g := five()
	var acted tally.Tally
	acted.Bump("d", 9)
	acted.Bump("b", 3)
	if g.PickLeader(acted, 7) != "d" || g.Picked != 7 {
		t.Fatal("the most active member was not picked")
	}
}

// TestDrawUpToHalfOfDeposits and shares by recent deposits.
func TestDrawUpToHalfOfDeposits(t *testing.T) {
	g := five()
	g.Deposit("b", 1, 100)
	g.Deposit("b", 1, 20)
	if !g.MayDraw("b", 60, p) || g.MayDraw("b", 61, p) || g.MayDraw("c", 1, p) {
		t.Fatal("draw limits misread")
	}
	g.Drew("b", 60)
	if g.MayDraw("b", 1, p) {
		t.Fatal("drew past half")
	}
	g.Deposit("c", 20, 50)
	if s := g.Shares(20, p); s.Get("b") != 0 || s.Get("c") != 50 {
		t.Fatalf("shares %v", s)
	}
	if r := g.Rank(false); r[0].Char != "b" {
		t.Fatalf("rank %v", r)
	}
}
