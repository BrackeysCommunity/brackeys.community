package item

import (
	"fmt"
	"slices"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/sheets"
)

// Growth is levels, milestones and the offers they make (GDD 9.12).
type Growth struct {
	d         *Deriver
	curve     map[int64]sheets.LevelStep
	params    []sheets.Param
	deeds     map[string]*sheets.DeedXP
	exploit   []sheets.Offer
	mount     []sheets.Offer
	mountRows map[string]*sheets.MountKind
	exploitBy map[string]*sheets.Offer
	mountBy   map[string]*sheets.Offer
	offers    *draw.Drawer
}

// NewGrowth reads the growth sheets. Milestone offers are drawn under the
// roll key, so the same instance at the same milestone always gets the
// same two.
func NewGrowth(b *sheets.Book, d *Deriver, rollKey draw.Key) *Growth {
	g := &Growth{d: d, curve: map[int64]sheets.LevelStep{}, params: b.GrowthParams, deeds: sheets.Lookup(b.XPByDeed),
		exploit: b.ExploitOffers, mount: b.MountOffers, mountRows: sheets.Lookup(b.MountKinds), offers: draw.NewDrawer(rollKey)}
	for _, s := range b.LevelCurve {
		g.curve[s.Level] = s
	}
	g.exploitBy, g.mountBy = sheets.Lookup(b.ExploitOffers), sheets.Lookup(b.MountOffers)
	return g
}

func (g *Growth) Param(id string) int64 { return sheets.IntParam(g.params, id) }

// Params is the growth.params sheet, for practice.
func (g *Growth) Params() []sheets.Param { return g.params }

// Deed is the xp a growth.xp-by-deed row gives.
func (g *Growth) Deed(id string) int64 { return g.deeds[id].XP }

// ToNext is the xp from a level to the next.
func (g *Growth) ToNext(level int64) int64 { return g.curve[level].XPToNext }

// Milestone reports whether reaching a level takes a pick.
func (g *Growth) Milestone(level int64) bool { return g.curve[level].Milestone }

// Cap is a tier's level cap.
func (g *Growth) Cap(tier int64) int64 { return g.d.tiers[tier].LevelCap }

// Gain is what a level adds at a tier: gain at cap × level / cap.
func (g *Growth) Gain(tier, level int64) fixed.F {
	t := g.d.tiers[tier]
	return fixed.Ratio(t.GainAtCap*level, t.LevelCap*fixed.Hundredths)
}

// Stat is frozen points at a level: pts × (1 + gain), rounded. The base
// never changes; level belongs to the instance.
func (g *Growth) Stat(pts, tier, level int64) int64 {
	return fixed.One.Add(g.Gain(tier, level)).Of(pts)
}

// Levelled is what an AddXP did.
type Levelled struct {
	From, To   int64
	Milestones []int64
}

// AddXP gives an instance experience and levels it, up to its tier's
// cap. Reaching a milestone fixes its two offers.
func (g *Growth) AddXP(in *Instance, k *Kind, xp int64) Levelled {
	out := Levelled{From: in.Level, To: in.Level}
	var limit int64
	if in.Mount != "" {
		limit = g.Cap(g.mountRows[in.Mount].Tier)
	} else {
		limit = g.Cap(max(1, k.Tier))
	}
	if xp <= 0 || in.Level >= limit {
		return out
	}
	in.XP += xp
	for in.Level < limit && in.XP >= g.ToNext(in.Level) {
		in.XP -= g.ToNext(in.Level)
		in.Level++
		// Only a milestone that can still become a pick is announced:
		// picks taken, the open offer and those waiting all count.
		pending := int64(len(in.Picks) + len(in.Waiting))
		if len(in.Offers) > 0 {
			pending++
		}
		if g.Milestone(in.Level) && pending < g.Param("max-picks") {
			out.Milestones = append(out.Milestones, in.Level)
			if len(in.Offers) == 0 {
				in.Offers = g.offersAt(in, k, in.Level)
			} else {
				in.Waiting = append(in.Waiting, in.Level)
			}
		}
	}
	if in.Level >= limit {
		in.XP = 0
	}
	out.To = in.Level
	return out
}

// Offers are a milestone's choices, chosen by the instance's record.
// Gear offers traits from the tables of the steps in its ancestry, each
// weighed by how often its step appears; mounts and exploits offer from
// their own tables. Candidates rank by the record keys they favour, then
// by a keyed draw, and the top two are the offers.
func (g *Growth) Offers(in *Instance, k *Kind) []string { return g.offersAt(in, k, in.Level) }

func (g *Growth) offersAt(in *Instance, k *Kind, level int64) []string {
	type cand struct {
		id    string
		score int64
		tie   uint64
	}
	var cs []cand
	add := func(id string, favours []string, weight int64) {
		if slices.Contains(in.Picks, id) || slices.ContainsFunc(cs, func(c cand) bool { return c.id == id }) {
			return
		}
		tie := g.offers.Draw("milestone.offer", draw.Str(in.ID), draw.Int(level), draw.Str(id))
		cs = append(cs, cand{id: id, score: (in.Record.Score(favours) + 1) * weight, tie: tie})
	}
	switch {
	case in.Mount != "":
		for _, o := range g.mount {
			add(o.ID, o.Favours, 1)
		}
	case k.Exploit != nil:
		for _, o := range g.exploit {
			add(o.ID, o.Favours, 1)
		}
	default:
		held := in.Traits(k, g.d)
		for _, step := range slices.Compact(slices.Clone(k.Steps)) {
			n := countOf(k.Steps, step)
			for _, t := range g.d.processes[step].Traits {
				if !slices.Contains(held, t) {
					add(t, g.d.traits[t].Favours, n)
				}
			}
		}
	}
	slices.SortFunc(cs, func(a, b cand) int {
		if a.score != b.score {
			return int(b.score - a.score)
		}
		switch {
		case a.tie < b.tie:
			return -1
		case a.tie > b.tie:
			return 1
		}
		return 0
	})
	n := min(len(cs), int(g.Param("milestone-offers")))
	out := make([]string, n)
	for i := range out {
		out[i] = cs[i].id
	}
	return out
}

// Pick takes one of a milestone's fixed offers. There is no re-roll.
// A milestone waiting behind it is offered next.
func (g *Growth) Pick(in *Instance, k *Kind, offer string) error {
	if !slices.Contains(in.Offers, offer) {
		return fmt.Errorf("item: %q is not on offer", offer)
	}
	in.Picks = append(in.Picks, offer)
	in.Offers = nil
	for len(in.Waiting) > 0 && len(in.Offers) == 0 && int64(len(in.Picks)) < g.Param("max-picks") {
		level := in.Waiting[0]
		in.Waiting = in.Waiting[1:]
		in.Offers = g.offersAt(in, k, level)
	}
	if len(in.Waiting) == 0 || len(in.Offers) == 0 {
		in.Waiting = nil
	}
	return nil
}

// PickCost is the units of the recipe's highest-tier input a pick takes.
func (g *Growth) PickCost(k *Kind) (string, int64) {
	return g.d.TopInput(k), g.Param("milestone-pick-units")
}

// ExploitOffer is an exploit-offers row, for a pick an exploit has taken.
func (g *Growth) ExploitOffer(id string) (sheets.Offer, bool) { return offerOf(g.exploitBy, id) }

// MountOffer is a mounts.offers row.
func (g *Growth) MountOffer(id string) (sheets.Offer, bool) { return offerOf(g.mountBy, id) }

func offerOf(rows map[string]*sheets.Offer, id string) (sheets.Offer, bool) {
	if o, ok := rows[id]; ok {
		return *o, true
	}
	return sheets.Offer{}, false
}

// FightXP is what a won beat gives the item used: by the item's tier
// against the creature's, more in a troubled region (GDD 7.7).
func (g *Growth) FightXP(itemTier, creatureTier int64, won, troubled bool) int64 {
	if !won {
		return g.Deed("beat-lost")
	}
	var xp int64
	switch diff := creatureTier - itemTier; {
	case diff >= 1:
		xp = g.Deed("win-tier-above")
	case diff == 0:
		xp = g.Deed("win-at-tier")
	case diff == -1:
		xp = g.Deed("win-tier-below")
	default:
		xp = g.Deed("win-two-below")
	}
	if troubled {
		xp = fixed.PercentOf(xp, fixed.Hundredths+g.Param("troubled-bonus"))
	}
	return xp
}

// Maturity is the share of material cost a kind's maturity saves: up to
// the sheet's maximum, on a curve that flattens at its craft count.
func (g *Growth) Maturity(crafts int64) fixed.F {
	top, flat := g.Param("maturity-max"), g.Param("maturity-crafts")
	c := min(crafts, flat)
	rest := flat - c
	// max × (1 − (1 − c/flat)²)
	return fixed.Ratio(top*(flat*flat-rest*rest), fixed.Hundredths*flat*flat)
}

// ExploitBeats is how much longer an exploit's state lasts with level.
func (g *Growth) ExploitBeats(level int64) int64 { return (level - 1) / g.Param("exploit-beats-per") }

// ExploitReach is how many more creatures it reaches with level.
func (g *Growth) ExploitReach(level int64) int64 { return (level - 1) / g.Param("exploit-reach-per") }

func countOf(ss []string, s string) int64 {
	var n int64
	for _, x := range ss {
		if x == s {
			n++
		}
	}
	return n
}
