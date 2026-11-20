// Package faucet is the one way coin enters the world (GDD 10.2, 10.4,
// 10.5): a budget per active character each world day, spent through
// faction buy orders, and the stabiliser that moves the budget's rate to
// hold coin per active character inside a band.
package faucet

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/sheets"
)

// Params are the faucet's sheet cells.
type Params struct {
	Rate   int64 // coin per active character per world day, at rest
	Floor  int64 // active characters each open settlement assumes at least
	Low    int64 // the band, in coin per active character
	High   int64
	Step   int64 // percent a day outside the band
	Return int64 // percent of the rate a day back toward Rate inside it
	Days   int64 // the measuring window, in world days
	Most   int64 // percent of Rate the faucet never rises past
}

// ParamsOf reads them from economy.params.
func ParamsOf(p []sheets.Param) Params {
	i := func(id string) int64 { return sheets.IntParam(p, id) }
	return Params{Rate: i("faucet-rate"), Floor: i("faucet-floor"), Low: i("band-low"), High: i("band-high"),
		Step: i("stabiliser-step"), Return: i("stabiliser-return"), Days: i("stabiliser-days"), Most: i("faucet-most")}
}

// State is the faucet's rate and the samples it is steered by.
type State struct {
	// Rate is coin per active character per world day.
	Rate fixed.F `json:"rate"`
	// Samples are coin per active character at each of the last world
	// days, oldest first.
	Samples []int64 `json:"samples"`
}

// New is a faucet at its resting rate.
func New(p Params) State { return State{Rate: fixed.FromInt(p.Rate), Samples: []int64{}} }

// structural: the smallest move the rate can make.
const ulp = fixed.F(1)

// Moves the stabiliser makes.
const (
	Rose  = "rose"
	Fell  = "fell"
	Eased = "eased"
	Held  = "held"
)

// Step adds the day's coin per active character to the window and moves
// the rate by the window's mean: down Step per cent above the band, up
// Step per cent below it (never past Most), else back toward rest by
// Return per cent of itself. It returns the mean and the move.
func (s *State) Step(perActive int64, p Params) (mean int64, move string) {
	s.Samples = append(s.Samples, perActive)
	if over := int64(len(s.Samples)) - p.Days; over > 0 {
		s.Samples = s.Samples[over:]
	}
	mean = s.Mean()
	rest := fixed.FromInt(p.Rate)
	switch {
	case mean > p.High:
		s.Rate = s.Rate.Mul(fixed.Percent(fixed.Hundredths - p.Step))
		return mean, Fell
	case mean < p.Low:
		// At least one raw unit, or rounding pins a rate cut very low.
		up := fixed.Max(s.Rate.Mul(fixed.Percent(fixed.Hundredths+p.Step)), s.Rate.Add(ulp))
		s.Rate = fixed.Min(up, rest.Mul(fixed.Percent(p.Most)))
		return mean, Rose
	}
	gap := rest.Sub(s.Rate)
	step := fixed.Max(s.Rate.Mul(fixed.Percent(p.Return)), ulp)
	switch gap.Cmp(0) {
	case 0:
		return mean, Held
	case 1:
		s.Rate = s.Rate.Add(fixed.Min(gap, step))
	default:
		s.Rate = s.Rate.Sub(fixed.Min(gap.Neg(), step))
	}
	return mean, Eased
}

// Mean is coin per active character over the window, rounded; 0 before
// the first sample.
func (s State) Mean() int64 {
	if len(s.Samples) == 0 {
		return 0
	}
	var sum int64
	for _, x := range s.Samples {
		sum += x
	}
	return fixed.Ratio(sum, int64(len(s.Samples))).Int()
}

// Budget is a world day's coin for active characters, at the rate.
func (s *State) Budget(active int64) int64 { return s.Rate.MulInt(active).Floor() }

// Share is one thing a settlement's budget buys: the urgency that weighs
// its share, and its price each.
type Share struct {
	Urgency int64 // percent, 100 for no special need
	Price   int64
}

// Plan shares a settlement's budget over its wants by urgency, as whole
// units at each want's price; what the shares leave is spent a unit at a
// time on the most urgent wants it still covers, so a small budget buys a
// few goods rather than none.
func Plan(budget int64, wants []Share) []int64 {
	var total int64
	for _, w := range wants {
		total += w.Urgency
	}
	out := make([]int64, len(wants))
	if total == 0 {
		return out
	}
	left := budget
	for i, w := range wants {
		if w.Price > 0 {
			out[i] = budget * w.Urgency / total / w.Price
			left -= out[i] * w.Price
		}
	}
	order := make([]int, len(wants))
	for i := range order {
		order[i] = i
	}
	slices.SortStableFunc(order, func(a, b int) int {
		return cmp.Or(cmp.Compare(wants[b].Urgency, wants[a].Urgency), cmp.Compare(out[a], out[b]))
	})
	for spent := true; spent; {
		spent = false
		for _, i := range order {
			if p := wants[i].Price; p > 0 && p <= left {
				out[i]++
				left -= p
				spent = true
			}
		}
	}
	return out
}
