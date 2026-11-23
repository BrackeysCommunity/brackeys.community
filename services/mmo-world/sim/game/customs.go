package game

import (
	"encoding/json"
	"maps"
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/ledger"
)

// Customs (GDD 13.2): a settlement's goal renewed enough seasons running
// becomes something the world posts by itself each season, paid from the
// settlement's treasury so no coin comes from nowhere.

func init() {
	registerEmerge(emergeHook{Name: "customs", Order: customsOrder, Close: customsClose, Day: customsDay})
}

// structural: customs read the goal lines at the close, after legends.
const customsOrder = legendsOrder + 1

const (
	factCustomHeld    = "custom.held"
	factCustomSkipped = "custom.skipped"
)

// customsClose counts each settlement signature seen live this season and
// met or carried over, makes a custom of one counted in enough seasons
// running, and lets go of every run this season broke.
func customsClose(g *Game, _ int64) error {
	c, ok := g.clock()
	if !ok {
		return nil
	}
	e := g.Emergence
	need := g.r.Emerge.Lines.Line(emerge.Custom).Count
	for _, sig := range slices.Sorted(maps.Keys(e.Lines)) {
		l := e.Lines[sig]
		x := g.GoalOf(l.Goal)
		// A raise's lines are posted before they are bound to their project,
		// so the goal is read again here.
		if x == nil || customPlace(x) < 0 || customGoal(x) || !l.Met && !x.Open() {
			continue
		}
		s := e.Sigs[sig]
		if s == nil {
			s = &emerge.Sig{Sig: sig}
			e.Sigs[sig] = s
		}
		s.Count(e.Season)
		if s.Done != "" || s.Streak < need || l.Place >= len(g.Places) {
			continue
		}
		spec, err := json.Marshal(customSpec(x))
		if err != nil {
			return err
		}
		at := g.SettlementHex(l.Place)
		p, err := g.promoteTrace(Promoting{Type: emerge.Custom, Region: -1, At: &at, Places: []int{l.Place},
			Data: []fact.Datum{fact.S(datumVerb, x.Cond.Verb), fact.S("goal", x.ID)}})
		if err != nil {
			return err
		}
		if p == nil {
			continue
		}
		s.Done = p.ID
		day := max(1, l.FirstDay*g.storyDays()/max(c.Days, 1))
		e.Customs = append(e.Customs, &emerge.CustomRec{ID: p.ID, Place: l.Place, Spec: spec, Day: day, Held: e.Season})
	}
	for _, sig := range slices.Sorted(maps.Keys(e.Sigs)) {
		if s := e.Sigs[sig]; s.Done == "" && s.Last != e.Season {
			delete(e.Sigs, sig)
		}
	}
	return nil
}

// customGoal reports whether a custom posted x: a settlement's goal that
// nobody posted, which renews nothing further.
func customGoal(x *Goal) bool { return x.Issuer.Kind == goal.BySettlement && x.Poster == "" }

// customSpec is the goal a custom posts: the original's words, target and
// count as a pooled settlement goal for the season, at its reward.
func customSpec(x *Goal) GoalSpec {
	return GoalSpec{Title: x.Title, Note: x.Note, Issuer: goal.BySettlement, Cond: x.Cond, Reward: x.Reward,
		Mode: goal.Pooled, Lifetime: goal.Season, Turnover: goal.Expire}
}

// customsDay posts each custom not yet held this season once the season
// reaches its day, scaled from a full season to this one's length.
func customsDay(g *Game, day, t int64) error {
	c, ok := g.clock()
	if !ok {
		return nil
	}
	e := g.Emergence
	sd := c.Day(day)
	for _, rec := range e.Customs {
		if rec.Held >= e.Season || sd < max(1, rec.Day*c.Days/max(g.storyDays(), 1)) {
			continue
		}
		if err := g.holdCustom(rec, t); err != nil {
			return err
		}
	}
	return nil
}

// holdCustom posts a custom's goal for the season with its reward moved
// from the settlement's treasury, or skips the season when the treasury
// is short of it.
func (g *Game) holdCustom(rec *emerge.CustomRec, t int64) error {
	e := g.Emergence
	rec.Held = e.Season
	if rec.Place < 0 || rec.Place >= len(g.Places) {
		return nil
	}
	var s GoalSpec
	if err := json.Unmarshal(rec.Spec, &s); err != nil {
		return err
	}
	name := g.promotionShown(rec.ID)
	h := g.SettlementHex(rec.Place)
	subjects := []fact.Ref{promotionRef(rec.ID), arc.SettlementRef(rec.Place)}
	treasury := TreasuryPool(rec.Place)
	if have := g.Ledger.Of(treasury, ledger.Coin); have < s.Reward {
		_, err := g.worldFact(h, factCustomSkipped, subjects, nil, fact.S("id", rec.ID), fact.S("name", name), fact.N("short", s.Reward-have))
		return err
	}
	x := &Goal{Title: s.Title, Note: s.Note, Issuer: goal.Ref{Kind: goal.BySettlement, ID: goal.SettlementRef(rec.Place)}, Scope: goal.Settlement,
		Board: rec.Place, Cond: s.Cond, Reward: s.Reward, Mode: s.Mode, Lifetime: s.Lifetime, Turnover: s.Turnover, Posted: t, State: goal.Live}
	g.openGoal(x)
	if s.Reward > 0 {
		key := ledger.SubKey("custom", rec.ID, strconv.FormatInt(e.Season, decimal))
		if err := g.post(ledger.Move(key, "custom", t, treasury, goalPool(x.ID), ledger.Coin, s.Reward)); err != nil {
			return err
		}
	}
	posted, err := g.worldFact(h, "goal.posted", []fact.Ref{goalRef(x.ID)}, nil, fact.S("verb", x.Cond.Verb), fact.S("issuer", goal.BySettlement),
		fact.N("reward", x.Reward), fact.N("settlement", int64(rec.Place)))
	if err != nil {
		return err
	}
	_, err = g.worldFact(h, factCustomHeld, append(subjects, goalRef(x.ID)), []fact.ID{posted}, fact.S("id", rec.ID), fact.S("name", name), fact.S("goal", x.ID))
	return err
}
