package pattern

import (
	"slices"

	"jams.team/mmo-world/sim/draw"
)

// What a clue says, by kind. Points are board indexes.
const (
	ClueAfter   = "after"   // order: Point comes before Other
	ClueOffset  = "offset"  // state: Other's value is Point's plus N, mod Values
	ClueFacing  = "facing"  // alignment: Point faces N
	ClueLive    = "live"    // connection: Point's run is live (N 1) or dead (N 0)
	ClueMissing = "missing" // completion: the gap lies at an index from Point to Other
	ClueNear    = "near"    // constellation: the hidden point is within N indexes of Point
)

type Clue struct {
	Kind  string `json:"kind"` // after, offset, facing, live, missing, near
	Point int    `json:"point"`
	Other int    `json:"other"`
	N     int64  `json:"n"`
}

// Clues draws n clues true of s, clue i under pattern.clue with the
// board's id and i. Each draw takes one clue not yet given; only once
// every distinct clue is out do they repeat. A board too small to say
// anything gets none.
func Clues(d *draw.Drawer, b Board, s Solution, n int) []Clue {
	pool := b.candidates(s)
	if len(pool) == 0 || n <= 0 {
		return nil
	}
	out := make([]Clue, 0, n)
	left := append([]Clue(nil), pool...)
	for i := range n {
		if len(left) == 0 {
			left = append(left, pool...)
		}
		k := d.Below(uint64(len(left)), clueP, draw.Str(b.ID), draw.Int(int64(i)))
		out = append(out, left[k])
		left = append(left[:k], left[k+1:]...)
	}
	return out
}

// candidates is every clue of the board's kind that s makes true, in a
// fixed order.
func (b Board) candidates(s Solution) []Clue {
	if !b.solves(s) {
		return nil
	}
	var out []Clue
	switch b.Kind {
	case Order:
		for i := range b.Points {
			for j := i + 1; j < b.Points; j++ {
				out = append(out, Clue{Kind: ClueAfter, Point: int(s[i]), Other: int(s[j])})
			}
		}
	case State:
		v := b.values()
		for a := range b.Points {
			for c := a + 1; c < b.Points; c++ {
				out = append(out, Clue{Kind: ClueOffset, Point: a, Other: c, N: ((s[c]-s[a])%v + v) % v})
			}
		}
	case Alignment:
		for a := range b.Points {
			out = append(out, Clue{Kind: ClueFacing, Point: a, N: s[a]})
		}
	case Connection:
		for a := range b.Points {
			out = append(out, Clue{Kind: ClueLive, Point: a, N: s[a]})
		}
	case Completion:
		gap := int(s[0])
		for a := 0; a <= gap; a++ {
			for c := max(gap, a+1); c < b.Points; c++ {
				out = append(out, Clue{Kind: ClueMissing, Point: a, Other: c})
			}
		}
		// The whole board says nothing, unless it is all there is.
		if len(out) > 1 {
			out = slices.DeleteFunc(out, func(c Clue) bool { return c.Point == 0 && c.Other == b.Points-1 })
		}
	case Constellation:
		hidden := int(s[0])
		for a := range b.Points {
			if a != hidden {
				out = append(out, Clue{Kind: ClueNear, Point: a, N: int64(abs(a - hidden))})
			}
		}
	}
	return out
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}
