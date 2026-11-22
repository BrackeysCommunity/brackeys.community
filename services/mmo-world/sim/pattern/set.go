package pattern

import "slices"

// Set applies one point's committed value on a day. A solved board, a
// mark that does not fit, or a solution not of this board changes
// nothing and returns the zero Result.
func (p *Progress) Set(b Board, s Solution, m Mark) Result {
	if p.Done || !b.Fits(m) || !b.solves(s) {
		return Result{}
	}
	switch b.Kind {
	case Order:
		return p.setOrder(b, s, m)
	case State:
		return p.setState(b, s, m)
	case Alignment:
		return p.setAlignment(b, s, m)
	case Connection:
		return p.setConnection(b, s, m)
	case Completion:
		m.Value = 1
		if m.Point != int(s[0]) {
			return p.wrong(Result{})
		}
		p.put(m)
		return p.right(b, m.Day, Result{})
	case Constellation:
		return p.setConstellation(b, s, m)
	}
	return Result{}
}

// setOrder keeps Round a prefix of the solution; the first point out of
// order ends the attempt and the line goes dark.
func (p *Progress) setOrder(b Board, s Solution, m Mark) Result {
	m.Value = 1
	if len(p.Round) == b.Points {
		// A right round held back for servers: a fresh activation
		// re-signs a point instead of starting over.
		p.put(m)
		return p.right(b, m.Day, Result{})
	}
	at := len(p.Round)
	if int(s[at]) != m.Point {
		p.Round, p.Marks = nil, nil
		return p.wrong(Result{})
	}
	p.Round = append(p.Round, m.Point)
	p.put(m)
	if len(p.Round) < b.Points {
		return Result{}
	}
	return p.right(b, m.Day, Result{})
}

// setState counts an attempt only when every point holds a mark from the
// same day; a wrong one leaves the marks to lapse.
func (p *Progress) setState(b Board, s Solution, m Mark) Result {
	p.put(m)
	if len(p.Marks) < b.Points {
		return Result{}
	}
	for _, h := range p.Marks {
		if h.Day != m.Day {
			return Result{}
		}
	}
	if !p.matches(s) {
		return p.wrong(Result{})
	}
	return p.right(b, m.Day, Result{})
}

func (p *Progress) setAlignment(b Board, s Solution, m Mark) Result {
	p.put(m)
	r := Result{Reach: p.reach(s)}
	if len(p.Marks) < b.Points {
		return r
	}
	if !p.matches(s) {
		return p.wrong(r)
	}
	return p.right(b, m.Day, r)
}

// setConnection judges the set once repairs reach Need; a wrong set
// undoes every repair.
func (p *Progress) setConnection(b Board, s Solution, m Mark) Result {
	m.Value = 1
	p.put(m)
	if len(p.Marks) < b.need() {
		return Result{}
	}
	if len(p.Marks) != b.need() || !p.matches(s) {
		p.Marks = nil
		return p.wrong(Result{})
	}
	return p.right(b, m.Day, Result{})
}

// setConstellation finds points until the hidden one shows; a find at
// the hidden point counts like any other, so finding tells nothing. An
// activation is the attempt, and may land on the hidden one early from
// the clues alone.
func (p *Progress) setConstellation(b Board, s Solution, m Mark) Result {
	hidden := int(s[0])
	if m.Value == Find {
		if i, ok := slices.BinarySearch(p.Found, m.Point); !ok {
			p.Found = slices.Insert(p.Found, i, m.Point)
		}
		p.put(m)
		return Result{}
	}
	if m.Point != hidden {
		return p.wrong(Result{})
	}
	p.put(m)
	return p.right(b, m.Day, Result{})
}

// matches reports whether every held mark holds the solution's value at
// its point. Connection's solution is 1 at a live run, so a repair (1) at
// a dead run (0) fails it.
func (p *Progress) matches(s Solution) bool {
	for _, h := range p.Marks {
		if h.Value != s[h.Point] {
			return false
		}
	}
	return true
}

func (p *Progress) reach(s Solution) int {
	n := 0
	for n < len(s) {
		h, ok := p.Held(n)
		if !ok || h.Value != s[n] {
			break
		}
		n++
	}
	return n
}

func (p *Progress) wrong(r Result) Result {
	p.Attempts++
	p.Wrong++
	r.Complete, r.Wrong = true, true
	return r
}

// right solves the board, unless it needs more servers than its held
// marks were set from; then the attempt is held back, not complete.
func (p *Progress) right(b Board, day int64, r Result) Result {
	if !p.servers(b) {
		return r
	}
	p.Attempts++
	p.Done, p.Solved = true, day
	r.Complete, r.Solved = true, true
	return r
}

func (p *Progress) servers(b Board) bool {
	if b.Servers <= 0 {
		return true
	}
	var seen []string
	for _, h := range p.Marks {
		if h.Server == "" {
			continue
		}
		if i, ok := slices.BinarySearch(seen, h.Server); !ok {
			seen = slices.Insert(seen, i, h.Server)
		}
	}
	return int64(len(seen)) >= b.Servers
}

// solves reports whether s has the shape of this board's solution.
func (b Board) solves(s Solution) bool {
	switch b.Kind {
	case Order, State, Alignment, Connection:
		return len(s) == b.Points && b.Points > 0
	case Completion, Constellation:
		return len(s) == 1 && s[0] >= 0 && s[0] < int64(b.Points)
	}
	return false
}

// Lapse drops marks older than days and returns the points lapsed. An
// order round is one line, so any of it lapsing puts out the whole round.
func (p *Progress) Lapse(day, days int64) []int {
	if p.Done {
		return nil
	}
	old := func(m Mark) bool { return day-m.Day > days }
	if len(p.Round) > 0 {
		if !slices.ContainsFunc(p.Marks, old) {
			return nil
		}
		out := slices.Sorted(slices.Values(p.Round))
		p.Round, p.Marks = nil, nil
		return out
	}
	var out []int
	for _, m := range p.Marks {
		if old(m) {
			out = append(out, m.Point)
		}
	}
	p.Marks = slices.DeleteFunc(p.Marks, old)
	if len(out) > 0 && len(p.Found) > 0 {
		p.Found = slices.DeleteFunc(p.Found, func(pt int) bool { return slices.Contains(out, pt) })
	}
	return out
}
