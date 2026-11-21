package party

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/hex"
)

const most = 4

func four() *Party {
	return &Party{ID: "pt-1", Leader: "a", Formed: 10, Members: []Member{
		{ID: "a", Joined: 10}, {ID: "b", Joined: 10}, {ID: "c", Joined: 12}, {ID: "d", Joined: 15},
	}}
}

func TestValid(t *testing.T) {
	if err := four().Valid(most); err != nil {
		t.Fatalf("a party of four: %v", err)
	}
	for name, p := range map[string]*Party{
		"one":           {ID: "pt-1", Leader: "a", Members: []Member{{ID: "a"}}},
		"five":          {ID: "pt-1", Leader: "a", Members: []Member{{ID: "a"}, {ID: "b"}, {ID: "c"}, {ID: "d"}, {ID: "e"}}},
		"twice":         {ID: "pt-1", Leader: "a", Members: []Member{{ID: "a"}, {ID: "a"}}},
		"no id":         {ID: "pt-1", Leader: "a", Members: []Member{{ID: "a"}, {ID: ""}}},
		"leader absent": {ID: "pt-1", Leader: "z", Members: []Member{{ID: "a"}, {ID: "b"}}},
	} {
		if p.Valid(most) == nil {
			t.Errorf("%s: valid", name)
		}
	}
	two := &Party{ID: "pt-2", Leader: "b", Members: []Member{{ID: "a"}, {ID: "b"}}}
	if err := two.Valid(most); err != nil {
		t.Errorf("a party of two led by its second: %v", err)
	}
	if four().Valid(3) == nil {
		t.Error("four members under a cap of three")
	}
}

func TestSeatAndHas(t *testing.T) {
	p := four()
	for i, id := range []string{"a", "b", "c", "d"} {
		if p.Seat(id) != i || !p.Has(id) {
			t.Errorf("%s: seat %d, has %v", id, p.Seat(id), p.Has(id))
		}
	}
	if p.Seat("z") != -1 || p.Has("z") {
		t.Error("a stranger has a seat")
	}
	if !slices.Equal(p.IDs(), []string{"a", "b", "c", "d"}) {
		t.Errorf("ids %v", p.IDs())
	}
	if !p.Full(most) || p.Full(most+1) {
		t.Error("full")
	}
}

func TestLeavePassesTheLeader(t *testing.T) {
	p := four()
	p.Members[1].Follows = true
	p.Members[2].Follows = true
	p.Invite("e", "a", 20)
	p.Invite("f", "c", 20)
	if p.Leave("a") {
		t.Fatal("three left, and the party ended")
	}
	// b joined on the same tick as a and before c: the longest-standing.
	if p.Leader != "b" || p.Members[0].Follows || !p.Members[1].Follows {
		t.Fatalf("leader %s, members %+v", p.Leader, p.Members)
	}
	if _, ok := p.InviteFor("e", 15); ok {
		t.Error("the leaver's invitation stayed")
	}
	if _, ok := p.InviteFor("f", 15); !ok {
		t.Error("another member's invitation went")
	}

	// Join order breaks a tie in Joined, even out of order in the slice.
	q := &Party{ID: "pt-3", Leader: "x", Members: []Member{{ID: "x", Joined: 1}, {ID: "y", Joined: 9}, {ID: "z", Joined: 5}, {ID: "w", Joined: 5}}}
	q.Leave("x")
	if q.Leader != "z" {
		t.Errorf("leader %s, want the earliest joined first in order", q.Leader)
	}

	if p.Leave("c") {
		t.Fatal("two left, and the party ended")
	}
	if p.Leader != "b" {
		t.Errorf("a member's leaving moved the leader to %s", p.Leader)
	}
	if !p.Leave("b") {
		t.Fatal("one left, and the party went on")
	}
	if p.Leader != "d" || len(p.Members) != 1 {
		t.Errorf("leader %s, members %+v", p.Leader, p.Members)
	}
	if !p.Leave("z") {
		t.Error("a stranger leaving a party of one")
	}
	if four().Leave("z") {
		t.Error("a stranger leaving ended a party of four")
	}
	if !p.Leave("d") || p.Leader != "" || len(p.Members) != 0 {
		t.Errorf("the last leaver: leader %q, members %+v", p.Leader, p.Members)
	}
}

func TestInvitesAndJoin(t *testing.T) {
	p := &Party{ID: "pt-1", Leader: "a", Members: []Member{{ID: "a", Joined: 3}, {ID: "b", Joined: 3}}}
	p.Invite("c", "a", 9)
	p.Invite("c", "b", 12)
	if len(p.Invites) != 1 {
		t.Fatalf("invites %+v", p.Invites)
	}
	if x, ok := p.InviteFor("c", 12); !ok || x.By != "b" {
		t.Errorf("the second invitation: %+v %v", x, ok)
	}
	if _, ok := p.InviteFor("c", 13); ok {
		t.Error("an invitation past its tick")
	}
	p.Invite("d", "a", 5)
	if !p.Expire(6) || len(p.Invites) != 1 || p.Expire(6) {
		t.Errorf("expire: %+v", p.Invites)
	}
	p.Join("c", 7)
	p.Join("c", 8)
	if len(p.Members) != 3 || p.Members[2] != (Member{ID: "c", Joined: 7}) || len(p.Invites) != 0 {
		t.Errorf("join: %+v %+v", p.Members, p.Invites)
	}
}

func TestPartied(t *testing.T) {
	p := four()
	if Pair("b", "a") != "a|b" || Pair("a", "b") != "a|b" {
		t.Error("a pair is not sorted")
	}
	if !p.MarkPartied("c", "a") || p.MarkPartied("a", "c") {
		t.Error("a pair is marked once")
	}
	p.MarkPartied("b", "a")
	p.MarkPartied("d", "c")
	if !slices.IsSorted(p.Partied) || len(p.Partied) != 3 {
		t.Errorf("partied %v", p.Partied)
	}
}

func TestWithin(t *testing.T) {
	o := hex.Hex{Q: 3, R: -2}
	if !Within(o, o) {
		t.Error("the same tile")
	}
	for d := range hex.Directions {
		if !Within(o, o.Neighbour(d)) {
			t.Errorf("neighbour %d", d)
		}
	}
	for _, far := range hex.Ring(o, 2) {
		if Within(o, far) || Within(far, o) {
			t.Errorf("%v is two away", far)
		}
	}
}

func TestRef(t *testing.T) {
	if r := Ref("pt-7"); r.String() != "party:pt-7" {
		t.Errorf("ref %s", r)
	}
}
