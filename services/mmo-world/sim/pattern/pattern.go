// Package pattern is a pattern puzzle's rule, headless (GDD 4.13): a board
// of points, a keyed solution recomputed on demand and never stored, the
// marks characters commit at the points, and the clues the world hands
// out. It knows no tiles; the game maps points to hexes.
package pattern

import (
	"slices"

	"jams.team/mmo-world/sim/draw"
)

// The six kinds of pattern puzzle.
const (
	Order         = "order"
	State         = "state"
	Alignment     = "alignment"
	Connection    = "connection"
	Completion    = "completion"
	Constellation = "constellation"
)

// A constellation mark's Value says which act it is.
const (
	Find     int64 = 0
	Activate int64 = 1
)

const (
	solutionP = draw.Purpose("pattern.solution")
	clueP     = draw.Purpose("pattern.clue")
)

// Board is what the rule needs of a stored board.
type Board struct {
	ID      string
	Kind    string
	Points  int
	Values  int64 // settings, facings; 1 where a kind has none
	Need    int64
	Servers int64
}

// Solution is per kind: order a permutation of points; state and
// alignment a value per point; connection a 1 per live run and 0 per dead
// one; completion and constellation one point's index.
type Solution []int64

type Mark struct {
	Point  int    `json:"point"`
	Value  int64  `json:"value"`
	Day    int64  `json:"day"`
	By     string `json:"by"`
	Server string `json:"server,omitempty"`
}

type Progress struct {
	Marks    []Mark `json:"marks,omitempty"` // one per point, by point
	Round    []int  `json:"round,omitempty"` // order: points activated this round
	Found    []int  `json:"found,omitempty"` // constellation: points found
	Attempts int64  `json:"attempts,omitempty"`
	Wrong    int64  `json:"wrong,omitempty"`
	Solved   int64  `json:"solved,omitempty"` // the day it was solved
	// Done marks a solved board; day 0 is a world day, so Solved alone
	// cannot say it.
	Done bool `json:"done,omitempty"`
}

// Result is what one Set did. Reach is alignment's signal: how many
// points in a row from point 0 face the right way.
type Result struct {
	Complete, Wrong, Solved bool
	Reach                   int
}

// Fits reports whether a mark names a point of the board and a value the
// kind takes. Set ignores a mark that does not fit.
func (b Board) Fits(m Mark) bool {
	if m.Point < 0 || m.Point >= b.Points {
		return false
	}
	switch b.Kind {
	case State, Alignment:
		return m.Value >= 0 && m.Value < b.values()
	case Constellation:
		return m.Value == Find || m.Value == Activate
	case Order, Connection, Completion:
		return true
	}
	return false
}

func (b Board) values() int64 { return max(b.Values, 1) }

// need is connection's live runs, at least one and at most every point.
func (b Board) need() int { return int(min(max(b.Need, 1), int64(b.Points))) }

// shownAt is how many found points show constellation's hidden one; at
// most every other point.
func (b Board) shownAt() int { return int(min(max(b.Need, 0), int64(b.Points-1))) }

// Held is the mark held at a point.
func (p *Progress) Held(point int) (Mark, bool) {
	i, ok := p.find(point)
	if !ok {
		return Mark{}, false
	}
	return p.Marks[i], true
}

// Shown reports whether constellation's hidden point shows yet.
func (p *Progress) Shown(b Board) bool { return len(p.Found) >= b.shownAt() }

// Hidden reports whether a point is the solution's point not yet shown.
// Viewers are not told it.
func (p *Progress) Hidden(b Board, s Solution, point int) bool {
	return b.Kind == Constellation && len(s) > 0 && int(s[0]) == point && !p.Shown(b)
}

func (p *Progress) find(point int) (int, bool) {
	return slices.BinarySearchFunc(p.Marks, point, func(m Mark, pt int) int { return m.Point - pt })
}

func (p *Progress) put(m Mark) {
	i, ok := p.find(m.Point)
	if ok {
		p.Marks[i] = m
		return
	}
	p.Marks = slices.Insert(p.Marks, i, m)
}
