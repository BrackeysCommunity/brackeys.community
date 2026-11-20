package faucet

import (
	"testing"

	"jams.team/mmo-world/sim/fixed"
)

var p = Params{Rate: 100, Floor: 5, Low: 350, High: 450, Step: 4, Return: 1, Days: 7, Most: 100}

func TestStepsByTheBand(t *testing.T) {
	s := New(p)
	if _, move := s.Step(500, p); move != Fell || s.Rate != fixed.FromInt(96) {
		t.Fatalf("above the band: %s at %s", move, s.Rate)
	}
	s = New(p)
	if _, move := s.Step(100, p); move != Rose || s.Rate != fixed.FromInt(100) {
		t.Fatalf("below the band, capped at rest: %s at %s", move, s.Rate)
	}
	s = State{Rate: fixed.FromInt(50)}
	if _, move := s.Step(400, p); move != Eased || s.Rate.Cmp(fixed.FromInt(50)) <= 0 {
		t.Fatalf("inside the band, back toward rest: %s at %s", move, s.Rate)
	}
	s = New(p)
	if _, move := s.Step(400, p); move != Held {
		t.Fatalf("at rest inside the band: %s", move)
	}
}

func TestRecoversFromALongCut(t *testing.T) {
	q := Params{Rate: 60, Floor: 5, Low: 350, High: 450, Step: 12, Return: 4, Days: 1, Most: 100}
	s := New(q)
	for range 120 {
		s.Step(1000, q)
	}
	low := s.Rate
	for range 150 {
		s.Step(0, q)
	}
	if s.Rate.Cmp(low) <= 0 || s.Rate != fixed.FromInt(q.Rate) {
		t.Fatalf("below the band after a long cut: %s from %s", s.Rate, low)
	}
	s = State{Rate: low}
	if s.Step(400, q); s.Rate.Cmp(low) <= 0 {
		t.Fatalf("inside the band after a long cut: %s from %s", s.Rate, low)
	}
}

func TestMeanOverTheWindow(t *testing.T) {
	s := New(p)
	for range 10 {
		s.Step(400, p)
	}
	if len(s.Samples) != int(p.Days) {
		t.Fatalf("%d samples kept", len(s.Samples))
	}
	if mean, _ := s.Step(1100, p); mean != 500 {
		t.Fatalf("mean %d, want 500", mean)
	}
}

func TestPlanStaysInBudget(t *testing.T) {
	wants := []Share{{Urgency: 100, Price: 7}, {Urgency: 200, Price: 8}, {Urgency: 100, Price: 70}}
	for _, budget := range []int64{0, 5, 9, 60, 1000} {
		var spent int64
		qty := Plan(budget, wants)
		for i, q := range qty {
			spent += q * wants[i].Price
		}
		if spent > budget || budget-spent >= wants[0].Price {
			t.Fatalf("budget %d: spent %d on %v", budget, spent, qty)
		}
	}
}
