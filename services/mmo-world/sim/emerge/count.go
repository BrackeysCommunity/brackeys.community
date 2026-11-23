package emerge

import (
	"math/big"
	"slices"

	"jams.team/mmo-world/sim/fixed"
)

// Decay is keep^days for one trace's percent lost a day, built once so a
// counter decays lazily when read and no day turn walks the counters.
type Decay struct {
	keep  []fixed.F
	still bool // a trace that never fades
}

// NewDecay tabulates keep^d for d in 0..days. Past the table a value reads
// 0, which expiry has dropped by then anyway.
func NewDecay(percent, days int64) Decay {
	if percent <= 0 {
		return Decay{still: true}
	}
	// Each entry is (100-p)^d / 100^d rounded once, so the table does not
	// drift the way compounding rounded factors would.
	t := make([]fixed.F, max(days, 0)+1)
	num, den := big.NewInt(fixed.Scale), big.NewInt(1)
	keep, whole := big.NewInt(max(fixed.Hundredths-percent, 0)), big.NewInt(fixed.Hundredths)
	half, q := new(big.Int), new(big.Int)
	for i := range t {
		half.Rsh(den, 1)
		q.Add(num, half)
		q.Quo(q, den)
		t[i] = fixed.Raw(q.Int64())
		num.Mul(num, keep)
		den.Mul(den, whole)
	}
	return Decay{keep: t}
}

// After is v decayed over days.
func (d Decay) After(v fixed.F, days int64) fixed.F {
	if d.still || days <= 0 {
		return v
	}
	if days >= int64(len(d.keep)) {
		return 0
	}
	return v.Mul(d.keep[days])
}

// Counter is a decaying trace, decayed when read or written. It reads 0 in
// a later season than the one it was written in (GDD 13.4).
type Counter struct {
	V      fixed.F `json:"v"`
	Day    int64   `json:"day"`
	Season int64   `json:"season"`
}

func (c Counter) At(day, season int64, d Decay) fixed.F {
	if season != c.Season {
		return 0
	}
	return d.After(c.V, day-c.Day)
}

func (c *Counter) Add(day, season, n int64, d Decay) {
	if season != c.Season {
		*c = Counter{Day: day, Season: season}
	}
	c.V = c.At(day, season, d).Add(fixed.FromInt(n))
	c.Day = max(day, c.Day)
}

// Window counts units over the last n world days, in day buckets: what a
// line's "within N days" reads, exactly.
type Window struct {
	Days   []int64 `json:"days"` // ring indexed by day mod len
	Last   int64   `json:"last"`
	Season int64   `json:"season"`
}

func slot(day, length int64) int64 { return ((day % length) + length) % length }

func (w *Window) Add(day, season, n, length int64) {
	if length <= 0 {
		return
	}
	if int64(len(w.Days)) != length || season != w.Season {
		w.Days = make([]int64, length)
		w.Last = day
		w.Season = season
	}
	switch {
	case day > w.Last:
		for d := w.Last + 1; d <= day && d <= w.Last+length; d++ {
			w.Days[slot(d, length)] = 0
		}
		w.Last = day
	case w.Last-day >= length:
		return
	}
	w.Days[slot(day, length)] += n
}

// Sum is the units counted in (day-length, day].
func (w Window) Sum(day, season, length int64) int64 {
	if length <= 0 || season != w.Season || int64(len(w.Days)) != length {
		return 0
	}
	from := max(day-length+1, w.Last-length+1)
	to := min(day, w.Last)
	var s int64
	for d := from; d <= to; d++ {
		s += w.Days[slot(d, length)]
	}
	return s
}

// Seen is one id and the last day it counted.
type Seen struct {
	ID  string `json:"id"`
	Day int64  `json:"day"`
}

// Recent keeps the most recent distinct ids, capped, newest last. Keeping
// the cap's most recent is enough to decide "cap distinct within a window".
type Recent struct {
	IDs    []Seen `json:"ids,omitempty"`
	Season int64  `json:"season"`
}

func (r *Recent) See(id string, day, season, cap int64) {
	if season != r.Season {
		r.IDs = nil
		r.Season = season
	}
	if i := slices.IndexFunc(r.IDs, func(s Seen) bool { return s.ID == id }); i >= 0 {
		r.IDs = slices.Delete(r.IDs, i, i+1)
	}
	r.IDs = append(r.IDs, Seen{ID: id, Day: day})
	if cap > 0 && int64(len(r.IDs)) > cap {
		r.IDs = slices.Delete(r.IDs, 0, len(r.IDs)-int(cap))
	}
}

// Within is how many kept ids were seen in (day-length, day].
func (r Recent) Within(day, season, length int64) int64 {
	if season != r.Season {
		return 0
	}
	var n int64
	for _, s := range r.IDs {
		if s.Day > day-length && s.Day <= day {
			n++
		}
	}
	return n
}

// Top is up to n kept ids, newest first.
func (r Recent) Top(n int) []Seen {
	out := make([]Seen, 0, min(n, len(r.IDs)))
	for i := len(r.IDs) - 1; i >= 0 && len(out) < n; i-- {
		out = append(out, r.IDs[i])
	}
	return out
}

// Wins are one character's last win days with one style, newest last.
type Wins []int64

func (w *Wins) Add(day, cap int64) {
	*w = append(*w, day)
	if cap > 0 && int64(len(*w)) > cap {
		*w = slices.Delete(*w, 0, len(*w)-int(cap))
	}
}

// Qualifies is the need-th newest win day and whether it falls in
// (day-length, day], so all need wins do.
func (w Wins) Qualifies(day, length, need int64) (int64, bool) {
	if need <= 0 || int64(len(w)) < need {
		return 0, false
	}
	d := w[int64(len(w))-need]
	return d, d > day-length && d <= day
}

// Daily is a count for one world day, keeping the day before so a day turn
// that runs after the new day's first count still reads the day just ended.
type Daily struct {
	N       int64 `json:"n"`
	Day     int64 `json:"day"`
	Prev    int64 `json:"prev,omitempty"`
	PrevDay int64 `json:"prevDay,omitempty"`
}

func (d Daily) On(day int64) int64 {
	switch {
	case d.Day == day:
		return d.N
	case d.PrevDay == day && d.Prev != 0:
		return d.Prev
	}
	return 0
}

func (d *Daily) Add(day, n int64) {
	if d.Day != day {
		d.Prev, d.PrevDay = 0, 0
		if d.Day == day-1 {
			d.Prev, d.PrevDay = d.N, d.Day
		}
		d.N, d.Day = 0, day
	}
	d.N += n
}
