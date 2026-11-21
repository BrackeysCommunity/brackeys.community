package agent

import (
	"slices"

	"jams.team/mmo-world/api"
)

// Hunter presses a live hunt in reach (GDD 7.6): once a tick, the best
// band of a win unless holding is better, never a machine; out of reach it
// walks nearer; down it crawls home, and wounded at home it rests before
// it goes back.
type Hunter struct {
	BandOrder []string
}

func (Hunter) Name() string { return "hunter" }

// Choose is the hunter's turn from its options alone: crawling, resting
// or waiting. Pressing needs the hunt: see Press and Toward.
func (Hunter) Choose(o api.Options, _ *Dice) (api.ActionRequest, bool) {
	switch {
	case o.Fight != nil || o.Long != nil:
		return api.ActionRequest{}, false
	case has(o.Conditions, api.CondDown):
		return api.ActionRequest{Kind: api.ActCrawl}, true
	case o.Rest && has(o.Conditions, api.CondWounded):
		return api.ActionRequest{Kind: api.ActRest}, true
	}
	return api.ActionRequest{}, false
}

// Press is a press at the hunt the hunter sees, when it may press now.
func (h Hunter) Press(v *api.HuntView) (api.ActionRequest, bool) {
	if v == nil || !v.CanPress {
		return api.ActionRequest{}, false
	}
	f := &api.Fight{Options: v.Options, Beat: 0, Beats: 2}
	pick := cautiousOr(f, h.BandOrder)
	if pick == "" {
		return api.ActionRequest{}, false
	}
	return api.ActionRequest{Kind: api.ActHuntPress, Target: v.ID, Option: pick}, true
}

// Toward is a step nearer to a hunt's tile, when a way is open.
func (Hunter) Toward(o api.Options, to api.Hex) (api.ActionRequest, bool) {
	if o.Fight != nil || o.Long != nil {
		return api.ActionRequest{}, false
	}
	best, dir := distance(o.At, to), -1
	for _, m := range o.Moves {
		if d := distance(m.To, to); m.Open && d < best {
			best, dir = d, m.Dir
		}
	}
	if dir < 0 {
		return api.ActionRequest{}, false
	}
	return api.ActionRequest{Kind: api.ActStep, Dir: dir}, true
}

// distance is the hex distance between two tiles in axial coordinates.
func distance(a, b api.Hex) int64 {
	dq, dr := a.Q-b.Q, a.R-b.R
	return max(abs(dq), abs(dr), abs(dq+dr))
}

func abs(x int64) int64 {
	if x < 0 {
		return -x
	}
	return x
}

// Sum is a slain hunt's parts against its roll, line by line, from its
// card: the parts paid must sum to the roll exactly.
func Sum(card api.HuntCard) (paid map[string]int64, ok bool) {
	paid = map[string]int64{}
	for _, s := range card.Shares {
		for _, g := range s.Goods {
			paid[g.Material] += g.Units
		}
	}
	ok = len(card.Rolled) > 0
	for _, r := range card.Rolled {
		if paid[r.Material] != r.Units {
			ok = false
		}
	}
	return paid, ok && !slices.ContainsFunc(card.Shares, func(s api.HuntShare) bool { return s.Removed < 0 })
}
