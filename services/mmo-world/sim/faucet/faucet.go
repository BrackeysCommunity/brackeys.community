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
	// Rate is coin per active character per world day, in hundredths.
	Rate fixed.F `json:"rate"`
	// Samples are coin per active character at each of the last world
	// days, oldest first.
	Samples []int64 `json:"samples"`
}

// New is a faucet at its resting rate.
func New(p Params) State { return State{Rate: fixed.FromInt(p.Rate), Samples: []int64{}} }

// Moves the stabiliser makes.
const (
	Rose  = "rose"
	Fell  = "fell"
	Eased = "eased"
	Held  = "held"
)

// Step takes the day's coin per active character, and moves the rate:
// down a step above the band, up a step below it, and inside it back
// toward rest by a share of itself. It returns the window's mean and the
// move.
func (s *State) Step(perActive int64, p Params) (mean int64, move string) {
	s.Samples = append(s.Samples, perActive)
	if over := int64(len(s.Samples)) - p.Days; over > 0 {
		s.Samples = s.Samples[over:]
	}
	var sum int64
	for _, x := range s.Samples {
		sum += x
	}
	mean = fixed.Ratio(sum, int64(len(s.Samples))).Int()
	rest := fixed.FromInt(p.Rate)
	switch {
	case mean > p.High:
		s.Rate = s.Rate.Mul(fixed.Ratio(hundred-p.Step, hundred))
		return mean, Fell
	case mean < p.Low:
		s.Rate = fixed.Min(s.Rate.Mul(fixed.Ratio(hundred+p.Step, hundred)), rest.Mul(fixed.Ratio(p.Most, hundred)))
		return mean, Rose
	}
	gap := rest.Sub(s.Rate)
	step := s.Rate.Mul(fixed.Ratio(p.Return, hundred))
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

// Budget is a world day's coin for active characters, at the rate.
func (s *State) Budget(active int64) int64 { return s.Rate.MulInt(active).Floor() }

// structural: percentages are out of a hundred.
const hundred = 100

// Want is one material a buyer at a settlement wants, at a price each,
// with the urgency that weighs its share of the budget.
type Want struct {
	Material string
	Buyer    int   // a faction index, or a negative for the keepers
	Urgency  int64 // percent, 100 for no special need
	Price    int64
}

// Plan shares a settlement's budget over its wants by urgency, as whole
// units at each want's price; what the shares leave is spent a unit at a
// time on the most urgent wants it still covers, so a small budget buys a
// few goods rather than none.
func Plan(budget int64, wants []Want) []int64 {
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
