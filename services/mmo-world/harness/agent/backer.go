package agent

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/sheets"
)

// Backer is how an Earner serves the arc sides its options list (GDD
// 12.2), before its own errand: it chooses a stage's side at a market by
// what it can serve, brings goods it can spare to a goods side where it
// stands, declares for a beats side in that side's region, and with
// nothing pressing goes out of its way to a side within Reach. It backs
// one side of a stage, never two.
type Backer struct {
	// Tags are the tags each material holds, from the sheets.
	Tags map[string][]string
	// Reach is the most tiles it goes to serve a side.
	Reach int64
}

// structural: how far an earner goes out of its way for a side, and how
// many encounters a trip it seeks for a beats side it backs.
const (
	backReach  = 6
	backFights = 3
)

// NewBacker is a backer under the sheets' material tags.
func NewBacker(b *sheets.Book) *Backer {
	return &Backer{Tags: MaterialTags(b), Reach: backReach}
}

// MaterialTags is the tags each material holds, provisions holding its own.
func MaterialTags(b *sheets.Book) map[string][]string {
	tags := map[string][]string{provisions: {provisions}}
	for _, m := range b.Materials {
		tags[m.ID] = m.Tags
	}
	return tags
}

// sides are the options an earner may serve: of each arc, the side it
// backs, else the one it set out for, else the one it chooses.
func (e *Earner) sides(o api.Options, t *trip) []api.SideOption {
	byArc := map[string][]api.SideOption{}
	for _, s := range o.Sides {
		byArc[s.Arc] = append(byArc[s.Arc], s)
	}
	for a, goal := range t.aims {
		if !slices.ContainsFunc(byArc[a], func(s api.SideOption) bool { return s.Goal == goal }) {
			delete(t.aims, a)
		}
	}
	chosen := map[string]string{}
	var out []api.SideOption
	for _, s := range o.Sides {
		of := byArc[s.Arc]
		switch {
		case slices.ContainsFunc(of, func(x api.SideOption) bool { return x.Backed }):
			if s.Backed {
				out = append(out, s)
			}
		case t.aims[s.Arc] != "":
			if t.aims[s.Arc] == s.Goal {
				out = append(out, s)
			}
		default:
			if _, ok := chosen[s.Arc]; !ok {
				chosen[s.Arc] = e.choose(o.Purse, of)
			}
			if chosen[s.Arc] == s.Goal {
				out = append(out, s)
			}
		}
	}
	slices.SortStableFunc(out, func(a, b api.SideOption) int { return cmp.Compare(hexDistance(o.At, a.At), hexDistance(o.At, b.At)) })
	return out
}

// choose is the side of a stage an earner sets out for when it backs
// none. It reads the stage at a market, where it sees what it carries: a
// side ahead of the rest that it can serve, so backers converge and a mark
// gets met; else the goods side it can give most to; else the first whose
// deeds it can do. Away from a market it has not chosen yet.
func (e *Earner) choose(p api.Purse, of []api.SideOption) string {
	if !p.Market {
		return ""
	}
	serves := func(s api.SideOption) bool {
		switch s.Wants {
		case arc.WantGoods:
			_, units := e.spare(p, s.Tag)
			return units > 0
		case arc.WantBeats, arc.WantReach:
			return true
		}
		return false
	}
	for _, s := range of {
		if s.Wants == arc.WantReach || !serves(s) {
			continue
		}
		ahead := true
		for _, x := range of {
			if x.Goal != s.Goal && x.Wants != arc.WantReach && x.Left <= s.Left {
				ahead = false
			}
		}
		if ahead {
			return s.Goal
		}
	}
	goal, most := "", int64(0)
	for _, s := range of {
		if s.Wants != arc.WantGoods {
			continue
		}
		if _, units := e.spare(p, s.Tag); units > most {
			goal, most = s.Goal, units
		}
	}
	if goal != "" {
		return goal
	}
	for _, s := range of {
		if s.Wants != arc.WantGoods && serves(s) {
			return s.Goal
		}
	}
	return ""
}

// aim keeps an arc to the one side the earner chose.
func (t *trip) aim(s api.SideOption) {
	if t.aims == nil {
		t.aims = map[string]string{}
	}
	t.aims[s.Arc] = s.Goal
}

// spare is what of a side's goods an earner carries above what it keeps:
// the provisions over its floor, or the largest stack of the side's tag,
// less a crafter's working stock.
func (e *Earner) spare(p api.Purse, tag string) (string, int64) {
	if tag == provisions {
		return provisions, p.Provisions - provisionsFloor
	}
	var asset string
	var most int64
	for _, g := range p.Goods {
		if tag != "" && g.Material != tag && !slices.Contains(e.Back.Tags[g.Material], tag) {
			continue
		}
		units := g.Units
		if e.Role == Crafter {
			units -= craftQty
		}
		if units > most {
			asset, most = g.Material, units
		}
	}
	return asset, most
}

// pressing reports whether the earner has something of its own to see to
// before it goes out of its way: a full pack, provisions to forage away
// from a market, a debt of provisions, or its guild's errand.
func (e *Earner) pressing(o api.Options, t *trip) bool {
	p := o.Purse
	full := p.Load.Capacity > 0 && p.Load.Carried*hundred >= p.Load.Capacity*80
	return full || (!p.Market && p.Provisions < tripTiles) || p.Owed > 0 || t.target != nil || t.civic.phase != atHome
}

// back is the backing step: what the earner does for a side this turn,
// if anything.
func (e *Earner) back(o api.Options, t *trip) (api.ActionRequest, bool) {
	if e.Back == nil || len(o.Sides) == 0 {
		return api.ActionRequest{}, false
	}
	if t.backTo != nil && *t.backTo == o.At {
		t.backTo, t.backWalk = nil, false
	}
	sides := e.sides(o, t)
	for _, s := range sides {
		if s.At != o.At || s.Left <= 0 {
			continue
		}
		switch s.Wants {
		case arc.WantGoods:
			if asset, units := e.spare(o.Purse, s.Tag); units > 0 {
				t.aim(s)
				return api.ActionRequest{Kind: api.ActBackSide, Target: s.Goal, Asset: asset, Units: min(units, s.Left)}, true
			}
		case arc.WantBeats:
			if !s.Backed {
				t.aim(s)
				return api.ActionRequest{Kind: api.ActBackSide, Target: s.Goal}, true
			}
			// Beats count only when won, so a declared backer seeks them.
			if o.Explore && t.fights < backFights && !has(o.Conditions, api.CondWounded) {
				t.fights++
				return api.ActionRequest{Kind: api.ActExplore}, true
			}
		}
	}
	if e.pressing(o, t) {
		return api.ActionRequest{}, false
	}
	for _, s := range sides {
		d := hexDistance(o.At, s.At)
		if d == 0 || d > e.Back.Reach || s.Left <= 0 {
			continue
		}
		switch s.Wants {
		case arc.WantGoods:
			if _, units := e.spare(o.Purse, s.Tag); units <= 0 {
				continue
			}
		case arc.WantBeats:
			if s.Backed {
				continue
			}
		case arc.WantReach:
		default:
			continue
		}
		// A route it asked for and is not on was refused: it walks there.
		if t.backTo != nil && *t.backTo != s.At {
			t.backTo, t.backWalk = nil, false
		}
		if t.backTo != nil {
			t.backWalk = true
		}
		if slices.Contains(o.Purse.Markets, s.At) && !t.backWalk {
			t.aim(s)
			to := s.At
			t.backTo = &to
			return api.ActionRequest{Kind: api.ActTravel, To: &to}, true
		}
		if req, ok := toward(o, s.At); ok {
			t.aim(s)
			return req, true
		}
	}
	return api.ActionRequest{}, false
}
