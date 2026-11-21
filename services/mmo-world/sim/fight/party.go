package fight

import (
	"cmp"
	"fmt"
	"slices"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/tally"
)

// Split shares a haul by contribution: each line by largest remainder,
// so the parts sum to the line exactly. Members whose remainders tie for
// the last units are ordered by the tie stream; with none, by share
// order.
func Split(haul []item.Spoil, share tally.Tally, tie *draw.Stream) map[string][]item.Spoil {
	out := map[string][]item.Spoil{}
	var whole int64
	for _, c := range share {
		whole += c.N
	}
	if whole == 0 {
		return out
	}
	type cut struct {
		who  string
		n    int64
		rest int64
	}
	for _, s := range haul {
		var cuts []cut
		var given int64
		for _, c := range share {
			n := s.Qty * c.N / whole
			cuts = append(cuts, cut{c.Key, n, s.Qty * c.N % whole})
			given += n
		}
		slices.SortStableFunc(cuts, func(a, b cut) int { return cmp.Compare(b.rest, a.rest) })
		left := int(s.Qty - given)
		if tie != nil && left > 0 && left < len(cuts) && cuts[left].rest == cuts[left-1].rest {
			lo, hi := left-1, left
			for lo > 0 && cuts[lo-1].rest == cuts[left].rest {
				lo--
			}
			for hi < len(cuts) && cuts[hi].rest == cuts[left].rest {
				hi++
			}
			tied := cuts[lo:hi]
			tie.Shuffle(len(tied), func(i, j int) { tied[i], tied[j] = tied[j], tied[i] })
		}
		for i := range min(left, len(cuts)) {
			cuts[i].n++
		}
		for _, c := range cuts {
			if c.n > 0 {
				out[c.who] = append(out[c.who], item.Spoil{Material: s.Material, Qty: c.n})
			}
		}
	}
	return out
}

// SplitTie is the stream an encounter's or a hunt's split draws its ties
// from.
func (r *Rules) SplitTie(id string) *draw.Stream {
	return r.roll.Stream("haul.split", draw.Str(id))
}

// Cautious is the cautious option every beat offers: what a member who
// does not pick is given.
func (r *Rules) Cautious() string {
	for _, o := range r.options {
		if o.Kind == Careful && len(o.Beats) == 0 {
			return o.ID
		}
	}
	return ""
}

// PressMachine resolves a party machine's beat: every member present
// takes the machine option with the one result, as a pick of their own;
// only those who moved on the machine add to their share.
func (r *Rules) PressMachine(e *Encounter, ms []*Member, res puzzle.Result, movers []string, tick int64) ([]Pressed, []fact.Fact, error) {
	if e.Over {
		return nil, nil, fmt.Errorf("fight: encounter %s is over", e.ID)
	}
	if _, _, ok := r.Machine(e); !ok {
		return nil, nil, fmt.Errorf("fight: no machine on beat %d of %s", e.At, e.ID)
	}
	in := make([]*Member, 0, len(ms))
	for _, m := range ms {
		if slices.Contains(e.Down, m.Ch.ID) || slices.Contains(e.Gone, m.Ch.ID) {
			in = append(in, m)
			continue
		}
		_, _, opts := r.Choices(e, m.Ch, m.Kit, tick)
		pick := ""
		for _, o := range opts {
			if o.Puzzle && (pick == "" || o.ID == m.Pick) {
				pick = o.ID
			}
		}
		if pick == "" {
			return nil, nil, fmt.Errorf("fight: %s has no way to work the machine", m.Ch.ID)
		}
		got := res
		pm := *m
		pm.Pick, pm.Puzzle = pick, &got
		in = append(in, &pm)
	}
	return r.press(e, in, tick, func(who string) bool { return slices.Contains(movers, who) })
}
