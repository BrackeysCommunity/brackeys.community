package game

import (
	"slices"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tally"
)

// A server's staged fights (GDD 14.4, 14.5): a staged hunt and a staged
// hardship are the world's own hunt and trouble, opened for a stage. What
// they pay is staged goods, the stager takes none of it, experience from
// them counts against a daily allowance, and nothing they do reaches a
// gauge, a population, a faction, a notable or a trace.

// openStagedHunt opens a hunt stage's hunt: its row on the stage's tile,
// at the template's tier, until the stage ends. A refusal changes nothing.
func (g *Game) openStagedHunt(st *Stage, t int64) error {
	defer g.withStage(st)()
	tpl := g.stageTemplate(st.Template)
	if tpl == nil || tpl.Kind != sheets.StageHunt {
		return refuse(StageTemplate, "%s is not a hunt template", st.Template)
	}
	x, err := g.openHuntAs(st.Hunt, st.At, t, WhyStaged, huntOpening{tier: tpl.Tier, ends: st.Ends, stage: st.ID})
	if err != nil {
		return err
	}
	st.HuntID = x.H.ID
	return nil
}

// castHardship casts a hardship stage's trouble at the stage's settlement,
// by the server, until the stage ends. The world's troubles there are not
// held back by it, and it runs beside one; a second staged hardship at
// the place is refused. A refusal changes nothing.
func (g *Game) castHardship(st *Stage, t int64) error {
	defer g.withStage(st)()
	stpl := g.stageTemplate(st.Template)
	if stpl == nil || stpl.Kind != sheets.StageHardship {
		return refuse(StageTemplate, "%s is not a hardship template", st.Template)
	}
	tpl, ok := g.template(stpl.Trouble)
	if !ok || tpl.Row.Trouble == nil {
		return refuse(NoTemplate, "no trouble %q in story.troubles", stpl.Trouble)
	}
	if g.Story == nil {
		return refuse(NoSeason, "the world keeps no story")
	}
	n := st.Settlement
	if n < 0 || n >= len(g.Places) || g.Places[n].Ruined != 0 {
		return refuse(CastMisfit, "a hardship is cast at a standing settlement")
	}
	place := goal.SettlementRef(n)
	if slices.ContainsFunc(g.openArcs(arc.Settlement), func(a *Arc) bool { return a.By == ByServer && a.Place == place }) {
		return refuse(SlotBusy, "%s already has a staged hardship", g.PlaceName(g.SettlementHex(n)))
	}
	h := g.SettlementHex(n)
	r := g.World.RegionAt(h)
	if r < 0 {
		return refuse(CastMisfit, "a hardship is cast at a settlement in the awake regions")
	}
	cast := arc.Cast{{Role: rolePlace, Ref: arc.SettlementRef(n)}, {Role: roleSource, Ref: arc.RegionRef(r)}}
	if tpl.Row.Trouble.Wants == arc.WantSold {
		if f := g.World.Regions[r].Holder; f >= 0 {
			cast = append(cast, arc.Binding{Role: roleFaction, Ref: arc.FactionRef(f)})
		}
	}
	a, err := g.castFrom(tpl, arc.Candidate{Cast: arc.Sorted(cast), Regions: []int{r}, Seat: h, Place: n}, ByServer, t)
	if err != nil {
		return err
	}
	st.Arc = a.ID
	return nil
}

// stagedArc is the stage a server-staged arc was cast for, or nil.
func (g *Game) stagedArc(a *Arc) *Stage {
	if a.By != ByServer {
		return nil
	}
	return g.StageByID(a.Staging)
}

// hardshipEnded settles a staged hardship's stage in place of a trouble's
// effects: held, each character who held it takes one roll of its
// template's table as staged goods, the stager none; held or lapsed, its
// hunt leaves. No gauge, structure, faction, alignment or count moves.
func (g *Game) hardshipEnded(a *Arc, won string, held []string, cause fact.ID, key string, t int64) error {
	st := g.stagedArc(a)
	if st == nil {
		return nil
	}
	defer g.withStage(st)()
	if x := g.HuntByID(a.Hunt); x != nil && x.Stage == st.ID && !x.H.Over {
		if err := g.leaveHunt(x, t); err != nil {
			return err
		}
	}
	tpl := g.stageTemplate(st.Template)
	if won == "" || tpl == nil || tpl.Table == "" {
		return nil
	}
	for _, id := range held {
		c := g.Char(id)
		if c == nil || id == st.By {
			continue
		}
		s, ok := g.stagedRoll(tpl.Table, prizeDraw, draw.Str(st.ID), draw.Str(id))
		if !ok {
			continue
		}
		m := ledger.Move(ledger.SubKey(key, "prize", id), "prize", t, ledger.FromStaged, ledger.Char(id), g.goodsAsset(s.Material), s.Qty)
		m.Fact = cause
		if err := g.receive(c, m); err != nil {
			return err
		}
		g.touchOnce(c)
	}
	return nil
}

// huntShares are the health each presser took from a hunt, by which its
// spoils split; a staged hunt's stager has no share.
func (g *Game) huntShares(x *Hunt) tally.Tally {
	if x.Stage == "" {
		return x.H.Removed
	}
	st := g.StageByID(x.Stage)
	if st == nil {
		return x.H.Removed
	}
	return slices.DeleteFunc(slices.Clone(x.H.Removed), func(c tally.Count) bool { return c.Key == st.By })
}

// stagedHunt is the open staged hunt of a row in a region, or nil.
func (g *Game) stagedHunt(row, region string) *Hunt {
	for _, x := range g.Hunts {
		if x.H.Row == row && x.Region == region && !x.H.Over && x.Stage != "" {
			return x
		}
	}
	return nil
}

// huntContext applies a staged hunt's stage to a press on it when the
// command did not; a staged hunt whose stage is gone is refused.
func (g *Game) huntContext(x *Hunt) (func(), error) {
	if x.Stage == "" || g.staging != nil && g.staging.ID == x.Stage {
		return func() {}, nil
	}
	st := g.StageByID(x.Stage)
	if st == nil {
		return nil, refuse(NoHunt, "hunt %s's staging is gone", x.H.ID)
	}
	return g.withStage(st), nil
}

// mintAsset is the asset a fight mints a material as: staged while a
// stage is applied, the material's own otherwise.
func (g *Game) mintAsset(m string) string {
	if g.staging != nil {
		return g.goodsAsset(m)
	}
	return ledger.Material(m)
}

// xpLeft is what a character may still gain from staged fights today
// while a stage is applied (GDD 14.5), and the func that books what was
// spent of it; outside a stage there is no allowance. The stager has
// none of its own stage.
func (g *Game) xpLeft(c *Char) (*int64, func()) {
	st := g.staging
	if st == nil {
		return nil, func() {}
	}
	day := g.Tick() / sheets.TicksPerDay
	used := c.C.StagedXP
	if c.C.StagedDay != day {
		used = 0
	}
	left := max(0, g.lp("staged-xp")-used)
	if st.By == c.C.ID {
		left = 0
	}
	from := left
	return &left, func() {
		if spent := from - left; spent > 0 {
			c.C.StagedDay, c.C.StagedXP = day, used+spent
		}
	}
}

// levelledWithin is levelled under the staged xp allowance.
func (g *Game) levelledWithin(c *Char, in *item.Instance, xp, t int64) error {
	left, spent := g.xpLeft(c)
	var err error
	fight.Within(left, in, xp, func(xp int64) { err = g.levelled(c, in, xp, t) })
	if err != nil {
		return err
	}
	spent()
	return nil
}
