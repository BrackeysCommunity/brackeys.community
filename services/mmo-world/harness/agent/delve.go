package agent

import (
	"slices"

	"jams.team/mmo-world/api"
)

// Delver is a party member in a dungeon (GDD 4.9, 7.5). On a beat it
// holds its pick for the party, the best band that is not a machine (a
// machine is worked in the Activity); at a fork it pushes on by the best
// way open; down, it crawls out. It never explores: the leader starts each
// delve, with Enter.
type Delver struct {
	BandOrder []string
}

func (Delver) Name() string { return "delver" }

// Choose is the delver's turn from its options alone: a beat, a crawl, or
// a wait. A fork needs the floor card: see Fork.
func (v Delver) Choose(o api.Options, _ *Dice) (api.ActionRequest, bool) {
	switch {
	case o.Fight != nil:
		if o.Fight.Shared && picked(o.Fight) {
			return api.ActionRequest{}, false
		}
		pick := cautiousOr(o.Fight, v.BandOrder)
		if pick == "" {
			return api.ActionRequest{}, false
		}
		kind := api.ActPress
		if o.Fight.Shared {
			kind = api.ActPartyPick
		}
		return api.ActionRequest{Kind: kind, Option: pick}, true
	case o.Long != nil:
		return api.ActionRequest{}, false
	case has(o.Conditions, api.CondDown):
		return api.ActionRequest{Kind: api.ActCrawl}, true
	}
	return api.ActionRequest{}, false
}

// Enter is the leader's turn at a dungeon's entrance: explore its first
// floor when the party stands there free.
func (Delver) Enter(o api.Options) (api.ActionRequest, bool) {
	if o.Fight != nil || o.Long != nil || !o.Explore || has(o.Conditions, api.CondDown) {
		return api.ActionRequest{}, false
	}
	return api.ActionRequest{Kind: api.ActExplore}, true
}

// Fork is the delver's choice at a fork, from its floor card: the hidden
// way when it stands open, then the machine's way once opened, else the
// open way. It chooses once; a way behind a machine still standing is
// worked first (WorkFork).
func (Delver) Fork(f *api.FloorView, me string) (api.ActionRequest, bool) {
	if f == nil || len(f.Ways) == 0 || slices.ContainsFunc(f.Choices, func(c api.ChoiceView) bool { return c.Name == me }) {
		return api.ActionRequest{}, false
	}
	for _, id := range []string{api.WayHidden, api.WayMachine, api.WayOpen} {
		if i := slices.IndexFunc(f.Ways, func(w api.WayView) bool { return w.ID == id }); i >= 0 && f.Ways[i].Open {
			return api.ActionRequest{Kind: api.ActDungeonPush, Option: id}, true
		}
	}
	return api.ActionRequest{Kind: api.ActDungeonLeave}, true
}

// WorkFork reports whether a fork's machine still stands between the
// party and its way: the delver works it before choosing.
func (Delver) WorkFork(f *api.FloorView) bool {
	if f == nil {
		return false
	}
	i := slices.IndexFunc(f.Ways, func(w api.WayView) bool { return w.ID == api.WayMachine })
	return i >= 0 && f.Ways[i].Machine != "" && !f.Ways[i].Open
}

// Machine reports whether the beat a delver faces holds a machine the
// party works together.
func (Delver) Machine(f *api.Fight) bool {
	return f != nil && slices.ContainsFunc(f.Options, func(o api.Option) bool { return o.Puzzle })
}

// picked reports whether the viewer has held its pick on a shared beat.
func picked(f *api.Fight) bool {
	i := slices.IndexFunc(f.Party, func(m api.PartyMember) bool { return m.You })
	return i >= 0 && f.Party[i].Picked
}

// cautiousOr is the best band of a win, unless the cautious option's band
// is better and the beat is not the last; never a machine.
func cautiousOr(f *api.Fight, bands []string) string {
	win := bestOf(f, bands, "win")
	hold := bestOf(f, bands, "cautious")
	if win == "" || (f.Beat < f.Beats-1 && rank(f, bands, hold) < rank(f, bands, win)) {
		if hold != "" {
			return hold
		}
	}
	if win != "" {
		return win
	}
	return best(f, bands)
}

// rank is an option's band rank, best first; the end of the list for none.
func rank(f *api.Fight, bands []string, id string) int {
	for _, o := range f.Options {
		if o.ID == id {
			if r := slices.Index(bands, o.Band); r >= 0 {
				return r
			}
		}
	}
	return len(bands)
}
