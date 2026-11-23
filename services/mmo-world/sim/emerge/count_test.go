package emerge

import (
	"math"
	"strconv"
	"testing"

	"jams.team/mmo-world/sim/fixed"
)

func TestDecayTable(t *testing.T) {
	d := NewDecay(10, 15)
	v := fixed.FromInt(100)
	for day := int64(0); day <= 15; day++ {
		got := float64(d.After(v, day)) / fixed.Scale
		want := 100 * math.Pow(0.9, float64(day))
		if math.Abs(got-want) > 0.01 {
			t.Errorf("day %d: %v, want %.4f", day, d.After(v, day), want)
		}
	}
	if got := d.After(v, 16); got != 0 {
		t.Errorf("past the table: %v, want 0", got)
	}
	if got := NewDecay(0, 15).After(v, 400); got != v {
		t.Errorf("a trace that never fades read %v", got)
	}
}

func TestCounterDecaysAndFadesBySeason(t *testing.T) {
	d := NewDecay(10, 15)
	var c Counter
	c.Add(3, 1, 10, d)
	c.Add(4, 1, 10, d)
	if got := c.At(4, 1, d); got != fixed.FromInt(19) {
		t.Errorf("10 decayed a day plus 10: %v, want 19", got)
	}
	if got := c.At(6, 1, d); got != fixed.FromInt(19).Mul(fixed.Raw(8100)) {
		t.Errorf("two days on: %v", got)
	}
	if got := c.At(4, 2, d); got != 0 {
		t.Errorf("a later season read %v, want 0", got)
	}
	c.Add(5, 2, 3, d)
	if got := c.At(5, 2, d); got != fixed.FromInt(3) {
		t.Errorf("a new season starts from 0: %v", got)
	}
}

func TestWindowAcrossALongGap(t *testing.T) {
	const length = 9
	var w Window
	for day := int64(0); day < length; day++ {
		w.Add(day, 0, 1, length)
	}
	if got := w.Sum(8, 0, length); got != 9 {
		t.Fatalf("nine days of one: %d", got)
	}
	if got := w.Sum(9, 0, length); got != 8 {
		t.Errorf("a day on, day 0 leaves: %d", got)
	}
	w.Add(40, 0, 5, length)
	if got := w.Sum(40, 0, length); got != 5 {
		t.Errorf("after a gap longer than the window: %d, want 5", got)
	}
	if got := w.Sum(48, 0, length); got != 5 {
		t.Errorf("still inside: %d", got)
	}
	if got := w.Sum(49, 0, length); got != 0 {
		t.Errorf("gone: %d", got)
	}
	if got := w.Sum(40, 1, length); got != 0 {
		t.Errorf("a later season: %d", got)
	}
	w.Add(20, 0, 7, length)
	if got := w.Sum(40, 0, length); got != 5 {
		t.Errorf("a write older than the window counts nowhere: %d", got)
	}
}

func TestRecentBeyondItsCap(t *testing.T) {
	var r Recent
	for i := range int64(30) {
		r.See("c-"+strconv.FormatInt(i, 10), i, 0, 20)
	}
	if len(r.IDs) != 20 {
		t.Fatalf("kept %d, want 20", len(r.IDs))
	}
	if got := r.Within(29, 0, 30); got != 20 {
		t.Errorf("within 30 days: %d, want 20", got)
	}
	if got := r.Within(29, 0, 9); got != 9 {
		t.Errorf("within 9 days: %d, want 9", got)
	}
	r.See("c-10", 29, 0, 20)
	if len(r.IDs) != 20 || r.IDs[19].ID != "c-10" {
		t.Errorf("a seen id moves to newest without growing: %v", r.Top(2))
	}
	top := r.Top(3)
	if len(top) != 3 || top[0].ID != "c-10" || top[1].ID != "c-29" || top[2].ID != "c-28" {
		t.Errorf("top: %v", top)
	}
	if got := r.Within(29, 1, 30); got != 0 {
		t.Errorf("a later season: %d", got)
	}
}

func TestWinsQualifiesOnTheBoundary(t *testing.T) {
	var w Wins
	for day := int64(1); day <= 12; day++ {
		w.Add(day, 10)
	}
	if len(w) != 10 {
		t.Fatalf("kept %d wins", len(w))
	}
	// The 10th newest is day 3: inside (day-14, day] up to day 16.
	if d, ok := w.Qualifies(16, 14, 10); !ok || d != 3 {
		t.Errorf("day 16: %d %v, want 3 true", d, ok)
	}
	if d, ok := w.Qualifies(17, 14, 10); ok || d != 3 {
		t.Errorf("day 17: %d %v, want 3 false", d, ok)
	}
	if _, ok := w.Qualifies(12, 14, 11); ok {
		t.Error("eleven needed from ten")
	}
}

func TestDaily(t *testing.T) {
	var d Daily
	d.Add(4, 2)
	d.Add(4, 3)
	if d.On(4) != 5 || d.On(5) != 0 {
		t.Errorf("daily: %+v", d)
	}
	d.Add(5, 1)
	if d.On(5) != 1 || d.On(4) != 5 || d.On(3) != 0 {
		t.Errorf("a new day: %+v", d)
	}
}

func TestDailyKeepsTheDayBefore(t *testing.T) {
	var d Daily
	d.Add(5, 3)
	d.Add(6, 1)
	if d.On(5) != 3 || d.On(6) != 1 || d.On(4) != 0 {
		t.Fatalf("after days 5 and 6: %+v", d)
	}
	d.Add(8, 2)
	if d.On(6) != 0 || d.On(7) != 0 || d.On(8) != 2 {
		t.Fatalf("after day 8: %+v", d)
	}
}
