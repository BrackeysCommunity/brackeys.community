package pattern

import (
	"fmt"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/draw"
)

func drawer(b byte) *draw.Drawer {
	var k draw.Key
	for i := range k {
		k[i] = b + byte(i)
	}
	return draw.NewDrawer(k)
}

var kinds = []string{Order, State, Alignment, Connection, Completion, Constellation}

func board(kind, id string) Board {
	b := Board{ID: id, Kind: kind, Points: 5, Values: 1}
	switch kind {
	case State:
		b.Values = 4
	case Alignment:
		b.Values = 6
	case Connection:
		b.Need = 3
	case Constellation:
		b.Need = 2
	}
	return b
}

func mark(pt int, v, day int64) Mark {
	return Mark{Point: pt, Value: v, Day: day, By: "c1", Server: "s1"}
}

// rightMarks is a full right attempt on one day, in the order it is set.
func rightMarks(b Board, s Solution, day int64) []Mark {
	var out []Mark
	switch b.Kind {
	case Order:
		for _, pt := range s {
			out = append(out, mark(int(pt), 0, day))
		}
	case State, Alignment:
		for pt, v := range s {
			out = append(out, mark(pt, v, day))
		}
	case Connection:
		for pt, v := range s {
			if v == 1 {
				out = append(out, mark(pt, 1, day))
			}
		}
	case Completion:
		out = append(out, mark(int(s[0]), 1, day))
	case Constellation:
		for pt := range b.Points {
			if pt != int(s[0]) && len(out) < int(b.Need) {
				out = append(out, mark(pt, Find, day))
			}
		}
		out = append(out, mark(int(s[0]), Activate, day))
	}
	return out
}

func apply(p *Progress, b Board, s Solution, ms []Mark) Result {
	var r Result
	for _, m := range ms {
		r = p.Set(b, s, m)
	}
	return r
}

func TestSolutionKeyed(t *testing.T) {
	for _, kind := range kinds {
		differ := false
		for i := range 8 {
			b := board(kind, fmt.Sprintf("%s@%d", kind, i))
			a, again, other := Solve(drawer(1), b), Solve(drawer(1), b), Solve(drawer(2), b)
			if !slices.Equal(a, again) {
				t.Fatalf("%s: one key gave %v then %v", b.ID, a, again)
			}
			if !b.solves(a) || !b.solves(other) {
				t.Fatalf("%s: solution %v not of the board", b.ID, a)
			}
			differ = differ || !slices.Equal(a, other)
		}
		if !differ {
			t.Errorf("%s: two keys gave the same solutions on every board", kind)
		}
	}
}

func TestSolutionShape(t *testing.T) {
	d := drawer(3)
	for i := range 20 {
		id := fmt.Sprintf("b%d", i)
		o := Solve(d, board(Order, id))
		if got := slices.Sorted(slices.Values(o)); !slices.Equal(got, Solution{0, 1, 2, 3, 4}) {
			t.Fatalf("order %v is not a permutation", o)
		}
		for _, v := range Solve(d, board(State, id)) {
			if v < 0 || v >= 4 {
				t.Fatalf("state value %d out of range", v)
			}
		}
		live := 0
		for _, v := range Solve(d, board(Connection, id)) {
			live += int(v)
		}
		if live != 3 {
			t.Fatalf("connection has %d live runs, want 3", live)
		}
	}
}

func TestRightAttemptSolves(t *testing.T) {
	for _, kind := range kinds {
		b := board(kind, kind+"@right")
		s := Solve(drawer(1), b)
		var p Progress
		ms := rightMarks(b, s, 7)
		for i, m := range ms[:len(ms)-1] {
			if r := p.Set(b, s, m); r.Complete {
				t.Fatalf("%s: complete after %d of %d marks", kind, i+1, len(ms))
			}
		}
		r := p.Set(b, s, ms[len(ms)-1])
		if !r.Complete || !r.Solved || r.Wrong {
			t.Fatalf("%s: right attempt gave %+v", kind, r)
		}
		if !p.Done || p.Solved != 7 || p.Attempts != 1 || p.Wrong != 0 {
			t.Fatalf("%s: progress after solving %+v", kind, p)
		}
		if again := p.Set(b, s, ms[0]); again != (Result{}) {
			t.Fatalf("%s: a solved board took a mark: %+v", kind, again)
		}
	}
}

func TestSolvedOnDayZero(t *testing.T) {
	b := board(Completion, "zero")
	s := Solve(drawer(1), b)
	var p Progress
	p.Set(b, s, mark(int(s[0]), 1, 0))
	if !p.Done || p.Solved != 0 {
		t.Fatalf("day-0 solve: %+v", p)
	}
	if p.Lapse(99, 1) != nil {
		t.Fatal("a solved board lapsed")
	}
}

func TestOrderWrong(t *testing.T) {
	b := board(Order, "order@wrong")
	s := Solve(drawer(1), b)
	var p Progress
	p.Set(b, s, mark(int(s[0]), 0, 1))
	p.Set(b, s, mark(int(s[1]), 0, 1))
	r := p.Set(b, s, mark(int(s[3]), 0, 1))
	if !r.Complete || !r.Wrong || r.Solved {
		t.Fatalf("out of order gave %+v", r)
	}
	if len(p.Round) != 0 || len(p.Marks) != 0 || p.Wrong != 1 || p.Attempts != 1 {
		t.Fatalf("round not reset: %+v", p)
	}
	// Repeating an activated point is out of order too.
	p.Set(b, s, mark(int(s[0]), 0, 2))
	if r := p.Set(b, s, mark(int(s[0]), 0, 2)); !r.Wrong {
		t.Fatalf("repeat gave %+v", r)
	}
	if r := apply(&p, b, s, rightMarks(b, s, 3)); !r.Solved {
		t.Fatalf("right round after a reset gave %+v", r)
	}
}

func TestStateWrong(t *testing.T) {
	b := board(State, "state@wrong")
	s := Solve(drawer(1), b)
	var p Progress
	ms := rightMarks(b, s, 4)
	ms[2].Value = (ms[2].Value + 1) % b.Values
	r := apply(&p, b, s, ms)
	if !r.Complete || !r.Wrong {
		t.Fatalf("a wrong value gave %+v", r)
	}
	if len(p.Marks) != b.Points {
		t.Fatalf("state marks reset on a wrong attempt: %+v", p.Marks)
	}
	// Fixing the one point the same day solves it.
	if r := p.Set(b, s, mark(2, s[2], 4)); !r.Solved {
		t.Fatalf("fixing the point gave %+v", r)
	}
}

func TestStateNeedsOneDay(t *testing.T) {
	b := board(State, "state@days")
	s := Solve(drawer(1), b)
	var p Progress
	ms := rightMarks(b, s, 4)
	ms[0].Day = 3
	if r := apply(&p, b, s, ms); r.Complete {
		t.Fatalf("marks over two days completed: %+v", r)
	}
	if r := p.Set(b, s, mark(0, s[0], 4)); !r.Solved {
		t.Fatalf("re-setting on the day gave %+v", r)
	}
}

func TestAlignmentWrongAndReach(t *testing.T) {
	b := board(Alignment, "align@wrong")
	s := Solve(drawer(1), b)
	var p Progress
	ms := rightMarks(b, s, 2)
	ms[3].Value = (ms[3].Value + 1) % b.Values
	var reaches []int
	var r Result
	for _, m := range ms {
		r = p.Set(b, s, m)
		reaches = append(reaches, r.Reach)
	}
	if !slices.Equal(reaches, []int{1, 2, 3, 3, 3}) {
		t.Fatalf("reach went %v", reaches)
	}
	if !r.Complete || !r.Wrong {
		t.Fatalf("a wrong facing gave %+v", r)
	}
	r = p.Set(b, s, mark(3, s[3], 2))
	if !r.Solved || r.Reach != b.Points {
		t.Fatalf("fixing the facing gave %+v", r)
	}
}

func TestConnectionWrong(t *testing.T) {
	b := board(Connection, "conn@wrong")
	s := Solve(drawer(1), b)
	var live, dead []int
	for pt, v := range s {
		if v == 1 {
			live = append(live, pt)
		} else {
			dead = append(dead, pt)
		}
	}
	var p Progress
	p.Set(b, s, mark(live[0], 1, 1))
	p.Set(b, s, mark(live[1], 1, 1))
	r := p.Set(b, s, mark(dead[0], 1, 1))
	if !r.Complete || !r.Wrong {
		t.Fatalf("a dead run in the set gave %+v", r)
	}
	if len(p.Marks) != 0 {
		t.Fatalf("repairs not reset: %+v", p.Marks)
	}
	if r := apply(&p, b, s, rightMarks(b, s, 2)); !r.Solved {
		t.Fatalf("the live set gave %+v", r)
	}
}

func TestCompletionWrong(t *testing.T) {
	b := board(Completion, "comp@wrong")
	s := Solve(drawer(1), b)
	var p Progress
	r := p.Set(b, s, mark((int(s[0])+1)%b.Points, 1, 1))
	if !r.Complete || !r.Wrong || len(p.Marks) != 0 {
		t.Fatalf("a raise at the wrong index gave %+v, %+v", r, p)
	}
	if r := p.Set(b, s, mark(int(s[0]), 1, 1)); !r.Solved {
		t.Fatalf("a raise at the gap gave %+v", r)
	}
}

func TestConstellation(t *testing.T) {
	b := board(Constellation, "const@wrong")
	s := Solve(drawer(1), b)
	hidden := int(s[0])
	others := slices.DeleteFunc([]int{0, 1, 2, 3, 4}, func(pt int) bool { return pt == hidden })
	var p Progress
	if !p.Hidden(b, s, hidden) || p.Hidden(b, s, others[0]) {
		t.Fatal("hidden point not hidden at the start")
	}
	if r := p.Set(b, s, mark(hidden, Find, 1)); r != (Result{}) || len(p.Found) != 0 {
		t.Fatal("the hidden point was found")
	}
	p.Set(b, s, mark(others[0], Find, 1))
	p.Set(b, s, mark(others[0], Find, 1))
	if len(p.Found) != 1 || p.Shown(b) {
		t.Fatalf("found %v", p.Found)
	}
	p.Set(b, s, mark(others[1], Find, 1))
	if !p.Shown(b) || p.Hidden(b, s, hidden) {
		t.Fatal("the hidden point did not show at Need")
	}
	r := p.Set(b, s, mark(others[2], Activate, 1))
	if !r.Complete || !r.Wrong || len(p.Found) != 2 {
		t.Fatalf("a wrong activation gave %+v, %+v", r, p)
	}
	if r := p.Set(b, s, mark(hidden, Activate, 1)); !r.Solved {
		t.Fatalf("activating the hidden point gave %+v", r)
	}
}

func TestLapse(t *testing.T) {
	for _, kind := range []string{State, Alignment, Connection, Constellation} {
		b := board(kind, kind+"@lapse")
		s := Solve(drawer(1), b)
		var p Progress
		ms := rightMarks(b, s, 5)
		ms = ms[:len(ms)-1]
		ms[0].Day = 2
		apply(&p, b, s, ms)
		if got := p.Lapse(5, 3); got != nil {
			t.Fatalf("%s: a 3-day-old mark lapsed at 3 days: %v", kind, got)
		}
		got := p.Lapse(6, 3)
		if !slices.Equal(got, []int{ms[0].Point}) {
			t.Fatalf("%s: lapsed %v, want [%d]", kind, got, ms[0].Point)
		}
		if _, ok := p.Held(ms[0].Point); ok || slices.Contains(p.Found, ms[0].Point) {
			t.Fatalf("%s: the lapsed mark is still held: %+v", kind, p)
		}
		if len(p.Marks) != len(ms)-1 {
			t.Fatalf("%s: lapse dropped fresh marks: %+v", kind, p.Marks)
		}
	}
}

func TestOrderLapsePutsOutTheRound(t *testing.T) {
	b := board(Order, "order@lapse")
	s := Solve(drawer(1), b)
	var p Progress
	p.Set(b, s, mark(int(s[0]), 0, 1))
	p.Set(b, s, mark(int(s[1]), 0, 3))
	got := p.Lapse(5, 3)
	want := slices.Sorted(slices.Values([]int{int(s[0]), int(s[1])}))
	if !slices.Equal(got, want) || len(p.Round) != 0 || len(p.Marks) != 0 {
		t.Fatalf("lapsed %v (want %v), progress %+v", got, want, p)
	}
	if r := apply(&p, b, s, rightMarks(b, s, 6)); !r.Solved {
		t.Fatalf("a fresh round after lapse gave %+v", r)
	}
}

func TestServers(t *testing.T) {
	for _, kind := range []string{Order, State, Alignment, Connection, Constellation} {
		b := board(kind, kind+"@servers")
		b.Servers = 2
		s := Solve(drawer(1), b)
		var p Progress
		ms := rightMarks(b, s, 3)
		if r := apply(&p, b, s, ms); r.Complete || p.Done || p.Attempts != 0 {
			t.Fatalf("%s: one server completed: %+v", kind, r)
		}
		m := ms[len(ms)-1]
		m.By, m.Server = "c2", "s2"
		r := p.Set(b, s, m)
		if !r.Solved || !p.Done {
			t.Fatalf("%s: a second server's mark gave %+v", kind, r)
		}
	}
	// A wrong attempt needs no servers.
	b := board(Completion, "comp@servers")
	b.Servers = 3
	s := Solve(drawer(1), b)
	var p Progress
	if r := p.Set(b, s, mark((int(s[0])+1)%b.Points, 1, 1)); !r.Wrong {
		t.Fatalf("a wrong raise with servers gave %+v", r)
	}
}

func TestRefusedMarksChangeNothing(t *testing.T) {
	for _, kind := range kinds {
		b := board(kind, kind+"@refuse")
		s := Solve(drawer(1), b)
		var p Progress
		bad := []Mark{mark(-1, 0, 1), mark(b.Points, 0, 1)}
		if kind == State || kind == Alignment {
			bad = append(bad, mark(0, b.Values, 1), mark(0, -1, 1))
		}
		if kind == Constellation {
			bad = append(bad, mark(0, Activate+1, 1))
		}
		for _, m := range bad {
			if b.Fits(m) {
				t.Fatalf("%s: %+v fits", kind, m)
			}
			if r := p.Set(b, s, m); r != (Result{}) {
				t.Fatalf("%s: %+v gave %+v", kind, m, r)
			}
		}
		if r := p.Set(b, s[:0], rightMarks(b, s, 1)[0]); r != (Result{}) {
			t.Fatalf("%s: a solution of another shape was used", kind)
		}
		if !slices.Equal(p.Marks, nil) || p.Attempts != 0 {
			t.Fatalf("%s: refused marks changed progress: %+v", kind, p)
		}
	}
}

// holds is a clue read against the solution, the way a player reads it.
func holds(b Board, s Solution, c Clue) bool {
	in := func(pt int) bool { return pt >= 0 && pt < b.Points }
	if !in(c.Point) {
		return false
	}
	switch c.Kind {
	case ClueAfter:
		return in(c.Other) && slices.Index(s, int64(c.Point)) < slices.Index(s, int64(c.Other))
	case ClueOffset:
		return in(c.Other) && c.Point != c.Other && (s[c.Point]+c.N)%b.Values == s[c.Other]
	case ClueFacing:
		return s[c.Point] == c.N
	case ClueLive:
		return s[c.Point] == c.N
	case ClueMissing:
		return in(c.Other) && c.Point < c.Other && int64(c.Point) <= s[0] && s[0] <= int64(c.Other) &&
			(b.Points <= 2 || c.Point > 0 || c.Other < b.Points-1)
	case ClueNear:
		return c.Point != int(s[0]) && int64(abs(c.Point-int(s[0]))) <= c.N
	}
	return false
}

func clueKind(kind string) string {
	return map[string]string{Order: ClueAfter, State: ClueOffset, Alignment: ClueFacing, Connection: ClueLive, Completion: ClueMissing, Constellation: ClueNear}[kind]
}

func TestCluesTrue(t *testing.T) {
	for _, kind := range kinds {
		for i := range 30 {
			b := board(kind, fmt.Sprintf("%s@%d", kind, i))
			d := drawer(byte(i))
			s := Solve(d, b)
			pool := len(b.candidates(s))
			cs := Clues(d, b, s, 3)
			if len(cs) != 3 {
				t.Fatalf("%s: %d clues, want 3", b.ID, len(cs))
			}
			for j, c := range cs {
				if c.Kind != clueKind(kind) || !holds(b, s, c) {
					t.Fatalf("%s: clue %d %+v is false of %v", b.ID, j, c, s)
				}
				if j < pool && slices.Contains(cs[:j], c) {
					t.Fatalf("%s: clue %d repeats before the pool ran out", b.ID, j)
				}
			}
			if again := Clues(d, b, s, 3); !slices.Equal(cs, again) {
				t.Fatalf("%s: clues moved under one key", b.ID)
			}
			if more := Clues(d, b, s, 4); !slices.Equal(more[:3], cs) {
				t.Fatalf("%s: asking for more clues moved the first ones", b.ID)
			}
		}
	}
}

func TestCluesRepeatOnlyWhenExhausted(t *testing.T) {
	b := Board{ID: "tiny", Kind: Alignment, Points: 2, Values: 6}
	d := drawer(1)
	s := Solve(d, b)
	cs := Clues(d, b, s, 5)
	if len(cs) != 5 || cs[0] == cs[1] {
		t.Fatalf("clues %+v", cs)
	}
	for _, c := range cs {
		if !holds(b, s, c) {
			t.Fatalf("clue %+v false of %v", c, s)
		}
	}
	if Clues(d, Board{ID: "one", Kind: Order, Points: 1}, Solution{0}, 3) != nil {
		t.Fatal("a one-point order board gave clues")
	}
}
