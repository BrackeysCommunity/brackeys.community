// Package season is the season clock and its day table (GDD 12.6): which
// band a season day falls in, when each world stage ends, and how the
// finale's pressure is chosen. It reads sheets and holds no game state.
package season

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/sheets"
)

// The story.days bands.
const (
	Opening = "opening"
	Rising  = "rising"
	Last    = "last"
	Finale  = "finale"
)

// Clock is the running season.
type Clock struct {
	N      int64  `json:"n"`
	Start  int64  `json:"start"` // the world day that is the season's day 1
	Days   int64  `json:"days"`
	Legacy bool   `json:"legacy,omitempty"`
	Epoch  string `json:"epoch,omitempty"` // the sheets digest taken at its start
}

// Day is the 1-based season day of a world day.
func (c Clock) Day(worldDay int64) int64 { return worldDay - c.Start + 1 }

// Closes reports whether the season ends on this world day.
func (c Clock) Closes(worldDay int64) bool { return worldDay == c.Start+c.Days }

// Turned reports whether tick is the first tick of a season the director
// began, where an epoch may be taken.
func (c Clock) Turned(tick int64) bool {
	return c.N > 0 && !c.Legacy && tick == c.Start*sheets.TicksPerDay
}

// Next is the season that starts on worldDay and lasts days. The sheets
// digest carries over until an epoch is taken.
func (c Clock) Next(worldDay, days int64) Clock {
	return Clock{N: c.N + 1, Start: worldDay, Days: days, Epoch: c.Epoch}
}

// Span is a run of season days in one band; a rising band split by its
// Split day is two spans.
type Span struct {
	Band     string
	From, To int64
	Stage    int // the world stage that ends on To; -1 none
}

// Table is a season's spans in day order.
type Table []Span

// TableFor scales the story.days bands, written for a season of base days,
// to a season of days: each end becomes floor(end × days / base), the last
// ends on days, and every span keeps at least one day while days allow.
// A season shorter than its spans leaves the earliest ones empty. World
// stages are numbered from 0 across the rising and last spans.
func TableFor(rows []sheets.SeasonDay, days, base int64) Table {
	if base <= 0 {
		base = days
	}
	sorted := slices.Clone(rows)
	slices.SortStableFunc(sorted, func(a, b sheets.SeasonDay) int { return cmp.Compare(a.From, b.From) })
	var t Table
	for _, r := range sorted {
		if r.Split > 0 && r.Split < r.To {
			t = append(t, Span{Band: r.ID, To: r.Split})
		}
		t = append(t, Span{Band: r.ID, To: r.To})
	}
	if len(t) == 0 {
		return nil
	}
	for i := range t {
		t[i].To = t[i].To * days / base
	}
	t[len(t)-1].To = days
	prev := int64(0)
	for i := range t {
		t[i].To = max(t[i].To, prev+1)
		prev = t[i].To
	}
	next := days + 1
	for i := len(t) - 1; i >= 0; i-- {
		t[i].To = min(t[i].To, next-1)
		next = t[i].To
	}
	stage := 0
	prev = 0
	for i := range t {
		t[i].From = prev + 1
		prev = max(prev, t[i].To)
		t[i].Stage = -1
		if t[i].Band == Rising || t[i].Band == Last {
			t[i].Stage = stage
			stage++
		}
	}
	return t
}

// At is the span a season day falls in; a day before the first span gives
// the first and a day past the last gives the last.
func (t Table) At(day int64) Span {
	if len(t) == 0 {
		return Span{Stage: -1}
	}
	for _, s := range t {
		if day <= s.To && s.From <= s.To {
			return s
		}
	}
	return t[len(t)-1]
}

// StageEnds is the season day a world stage ends on, 0 for a stage the
// table has none of.
func (t Table) StageEnds(stage int) int64 {
	for _, s := range t {
		if s.Stage == stage {
			return s.To
		}
	}
	return 0
}

// FinaleFrom is the season day the finale band starts on, 0 with none.
func (t Table) FinaleFrom() int64 {
	for _, s := range t {
		if s.Band == Finale {
			return s.From
		}
	}
	return 0
}

// Pressure is one unresolved pressure a finale may be cast from.
type Pressure struct {
	Kind   string
	Ref    fact.Ref
	Region int
	Score  int64
}

// Largest is the highest score; tie picks among the tied, given how many
// tie, by their index in ps order. A nil tie takes the first.
func Largest(ps []Pressure, tie func(n int) int) (Pressure, bool) {
	i, ok := LargestAt(ps, tie)
	if !ok {
		return Pressure{}, false
	}
	return ps[i], true
}

// LargestAt is the index in ps of the pressure Largest picks. tie is
// called only when more than one ties.
func LargestAt(ps []Pressure, tie func(n int) int) (int, bool) {
	if len(ps) == 0 {
		return 0, false
	}
	top := ps[0].Score
	for _, p := range ps[1:] {
		top = max(top, p.Score)
	}
	var tied []int
	for i, p := range ps {
		if p.Score == top {
			tied = append(tied, i)
		}
	}
	k := 0
	if tie != nil && len(tied) > 1 {
		n := len(tied)
		k = ((tie(n) % n) + n) % n
	}
	return tied[k], true
}

// Epoch is a rules epoch taken at a season boundary (GDD 18.5): the sheets
// digests before and after, and how many sheets changed.
type Epoch struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Sheets int64  `json:"sheets"`
}
