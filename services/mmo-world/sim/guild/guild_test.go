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

// TestOfficersOnePerFive, at least one, beside the leader and any admin.
func TestOfficersOnePerFive(t *testing.T) {
	g := five()
	g.SetAdmin("e", true, 5)
	if g.Officers(p) != 1 || g.Promote("a", 9, p) || g.Promote("e", 9, p) {
		t.Fatal("the leader or an admin was named an officer")
	}
	if !g.Promote("b", 9, p) || g.Promote("c", 9, p) {
		t.Fatal("five members name one officer, and no second")
	}
	for _, c := range []string{"f", "g", "h", "i", "j"} {
		g.Join(c, 10)
	}
	if !g.Promote("c", 11, p) || !g.Full(p) || g.Named() != 2 {
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
	g.Approvals = append(g.Approvals, Approval{ID: "x", By: "a", Day: 3}, Approval{ID: "y", By: "a", Day: 3})
	if _, ok := g.Approve("x", "a"); ok {
		t.Fatal("an officer approved its own spend")
	}
	if _, ok := g.Approve("x", "b"); ok {
		t.Fatal("a member approved a spend")
	}
	g.Promote("b", 3, p)
	if _, ok := g.Pending("y", "b"); !ok || len(g.Approvals) != 2 {
		t.Fatal("reading a pending approval took it")
	}
	if _, ok := g.Approve("y", "b"); !ok || len(g.Approvals) != 1 {
		t.Fatal("the guild's one named officer could not approve the leader's spend")
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
	if l := g.Succeed(func(id string) bool { return id != "a" }); l != "b" {
		t.Fatalf("leader %q after the founder was voted out, want the next longest-standing member b", l)
	}
	g.Member("b").Admin = true
	if g.Removable("b", Officer) {
		t.Fatal("an admin could be voted out")
	}
}

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

func TestServerLeaderIsTheMostActive(t *testing.T) {
	g := five()
	var acted tally.Tally
	if g.PickLeader(acted, 1) != "" || g.Leader != "a" {
		t.Fatal("a leader was picked though nobody acted")
	}
	acted.Bump("d", 9)
	acted.Bump("b", 3)
	if g.PickLeader(acted, 7) != "d" || g.Picked != 7 {
		t.Fatal("the most active member was not picked")
	}
	acted.Bump("b", 6)
	if g.PickLeader(acted, 14) != "" || g.Leader != "d" {
		t.Fatal("a tie did not leave the leader in place")
	}
}

// TestDrawUpToHalfOfDeposits and shares by recent deposits.
func TestDrawUpToHalfOfDeposits(t *testing.T) {
	g := five()
	g.Deposit("b", 1, 100, p)
	g.Deposit("b", 1, 20, p)
	if !g.MayDraw("b", 60, p) || g.MayDraw("b", 61, p) || g.MayDraw("c", 1, p) {
		t.Fatal("draw limits misread")
	}
	g.Drew("b", 60)
	if g.MayDraw("b", 1, p) {
		t.Fatal("drew past half")
	}
	g.Deposit("c", 20, 50, p)
	if s := g.Shares(20, p); s.Get("b") != 0 || s.Get("c") != 50 {
		t.Fatalf("shares %v", s)
	}
	if r := g.Rank(false); r[0].Char != "b" {
		t.Fatalf("rank %v", r)
	}
}
