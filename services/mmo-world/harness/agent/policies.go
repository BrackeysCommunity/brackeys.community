package agent

import (
	"slices"
	"sync"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/sheets"
)

// Bands ranks the odds bands best first, from the sheet, for policies
// that see bands by name only.
func Bands(b *sheets.Book) []string {
	rows := slices.Clone(b.OddsBands)
	slices.SortFunc(rows, func(x, y sheets.OddsBand) int { return int(y.Rank - x.Rank) })
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.ID
	}
	return out
}

// best is the option with the best band, never a machine (those are
// worked in the Activity); ties keep the first.
func best(f *api.Fight, bands []string) string {
	pick, rank := "", len(bands)
	for _, o := range f.Options {
		if o.Puzzle {
			continue
		}
		if r := slices.Index(bands, o.Band); r >= 0 && r < rank {
			pick, rank = o.ID, r
		}
	}
	return pick
}

func has(list []string, x string) bool { return slices.Contains(list, x) }

// Wanderer roams near where it is: fights what it meets for the best
// band, explores sites, gathers, rests off its wounds, and otherwise steps
// a random open way.
type Wanderer struct{ BandOrder []string }

func (Wanderer) Name() string { return "wanderer" }

func (w Wanderer) Choose(o api.Options, d *Dice) (api.ActionRequest, bool) {
	switch {
	case o.Fight != nil:
		if pick := best(o.Fight, w.BandOrder); pick != "" {
			return api.ActionRequest{Kind: api.ActPress, Option: pick}, true
		}
		return api.ActionRequest{}, false
	case o.Long != nil:
		return api.ActionRequest{}, false
	case has(o.Conditions, "down"):
		return api.ActionRequest{Kind: api.ActCrawl}, true
	case o.Rest && has(o.Conditions, "wounded"):
		return api.ActionRequest{Kind: api.ActRest}, true
	case o.Explore && d.Percent(wandererExplore, "wander.explore"):
		return api.ActionRequest{Kind: api.ActExplore}, true
	case len(o.Materials) > 0 && d.Percent(wandererGather, "wander.gather"):
		return api.ActionRequest{Kind: api.ActGather, Material: o.Materials[d.Below(len(o.Materials), "wander.material")], Ticks: o.GatherMax}, true
	}
	return step(o, d)
}

// structural: how often a wanderer explores or gathers when it can, in
// percent of its turns.
const (
	wandererExplore = 25
	wandererGather  = 15
)

func step(o api.Options, d *Dice) (api.ActionRequest, bool) {
	var open []int
	for _, m := range o.Moves {
		if m.Open {
			open = append(open, m.Dir)
		}
	}
	if len(open) == 0 {
		return api.ActionRequest{}, false
	}
	return api.ActionRequest{Kind: api.ActStep, Dir: open[d.Below(len(open), "step")]}, true
}

// Traveller walks out a leg in one direction, then takes the known route
// home as one long action. It is away while it travels: an ambush waits
// for it and takes its default.
type Traveller struct {
	mu   sync.Mutex
	legs map[string]*leg
}

type leg struct {
	home  api.Hex
	dir   int
	steps int
}

// structural: tiles a traveller walks out before turning for home.
const legTiles = 8

func (*Traveller) Name() string { return "traveller" }

func (t *Traveller) Choose(o api.Options, d *Dice) (api.ActionRequest, bool) {
	if o.Fight != nil || o.Long != nil {
		return api.ActionRequest{}, false
	}
	if has(o.Conditions, "down") {
		return api.ActionRequest{Kind: api.ActCrawl}, true
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.legs == nil {
		t.legs = map[string]*leg{}
	}
	l, ok := t.legs[o.CharacterID]
	if !ok {
		l = &leg{home: o.At, dir: d.Below(len(o.Moves), "travel.dir")}
		t.legs[o.CharacterID] = l
	}
	if l.steps >= legTiles {
		l.steps, l.dir = 0, d.Below(len(o.Moves), "travel.dir")
		if o.At != l.home {
			home := l.home
			return api.ActionRequest{Kind: api.ActTravel, To: &home}, true
		}
	}
	for _, m := range o.Moves {
		if m.Dir == l.dir && m.Open {
			l.steps++
			return api.ActionRequest{Kind: api.ActStep, Dir: m.Dir}, true
		}
	}
	l.dir = d.Below(len(o.Moves), "travel.dir")
	return step(o, d)
}
