package game

import (
	"fmt"
	"slices"

	"jams.team/mmo-world/sim/align"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// Act ids, the alignment.acts rows.
const (
	ActTheft       = "theft"
	ActBetrayal    = "betrayal"
	ActVowBroken   = "vow-broken"
	ActRescue      = "rescue"
	ActGoalMet     = "goal-met"
	ActTroubleHeld = "trouble-held"
	ActStoried     = "storied-return"
	ActInformed    = "informed"
	ActVowKept     = "vow-kept"
)

// Band ids, the alignment.bands rows.
const (
	bandNotorious  = "notorious"
	bandCrooked    = "crooked"
	bandUnremarked = "unremarked"
	bandDecent     = "decent"
	bandUpright    = "upright"
)

// AlignmentOf is a character's alignment; one never moved is 0.
func AlignmentOf(c *Char) int64 { return char.AlignmentValue(c.C) }

// Band is the alignment band a character stands in.
func (g *Game) Band(c *Char) string { return g.BandOf(AlignmentOf(c)) }

// BandOf is the alignment band a value lies in.
func (g *Game) BandOf(v int64) string { return align.BandOf(align.BandsOf(g.r.Book.AlignBands), v) }

// AlignParams are the alignment.params cells.
func (g *Game) AlignParams() align.Params { return align.ParamsOf(g.r.Book.AlignParams) }

// actRow is an alignment.acts row.
func (g *Game) actRow(act string) (sheets.AlignAct, bool) {
	i := slices.IndexFunc(g.r.Book.AlignActs, func(a sheets.AlignAct) bool { return a.ID == act })
	if i < 0 {
		return sheets.AlignAct{}, false
	}
	return g.r.Book.AlignActs[i], true
}

// actMove is the move an act's row asks; a theft's is priced on worth.
func (g *Game) actMove(act string, worth int64) int64 {
	row, _ := g.actRow(act)
	if row.PerCoin > 0 {
		return align.TheftMove(row.PerCoin, row.Least, worth)
	}
	return row.Move
}

// moveAlignment moves a character's alignment for an act, as the depth
// rule and the day's caps let it, and writes alignment.moved citing the
// act's fact. A public move is one NPCs may come to know of. It returns
// the move made; a move the caps leave at nothing changes and writes
// nothing (GDD 5.10).
func (g *Game) moveAlignment(c *Char, act string, asked int64, cause fact.ID, partner string, public bool, t int64) (int64, error) {
	row, ok := g.actRow(act)
	if !ok {
		return 0, fmt.Errorf("alignment: no act %q", act)
	}
	p := g.AlignParams()
	day := t / sheets.TicksPerDay
	paired := row.Paired && partner != ""
	value := AlignmentOf(c)
	var good, pair int64
	if a := c.C.Alignment; a != nil && a.Day == day {
		good = a.Good
		if i := slices.IndexFunc(a.Pairs, func(pg char.PairGood) bool { return pg.With == partner }); paired && i >= 0 {
			pair = a.Pairs[i].N
		}
	}
	move := align.Capped(p, align.Deepen(p, value, asked), good, pair, paired)
	delta := align.Clamp(p, value+move) - value
	if delta == 0 {
		return 0, nil
	}
	a := c.C.Align()
	if a.Day != day {
		a.Day, a.Good, a.Pairs = day, 0, nil
	}
	a.Value += delta
	if delta > 0 {
		a.Good += delta
		if paired {
			if i := slices.IndexFunc(a.Pairs, func(pg char.PairGood) bool { return pg.With == partner }); i >= 0 {
				a.Pairs[i].N += delta
			} else {
				a.Pairs = append(a.Pairs, char.PairGood{With: partner, N: delta})
			}
		}
	}
	shown := int64(0)
	if public {
		shown = 1
		a.Known = append(a.Known, char.Known{Tick: t, At: c.C.At, Region: g.World.RegionAt(c.C.At)})
		if over := len(a.Known) - int(p.KnownKept); over > 0 {
			a.Known = slices.Delete(a.Known, 0, over)
		}
	}
	data := []fact.Datum{fact.S("act", act), fact.N("asked", asked), fact.N("delta", delta), fact.N("value", a.Value),
		fact.S("band", g.BandOf(a.Value)), fact.N("public", shown)}
	if partner != "" {
		data = append(data, fact.S("partner", partner))
	}
	if _, err := g.factCaused(c, nil, factAlignment, t, cause, data...); err != nil {
		return 0, err
	}
	return delta, nil
}

// moveFor moves alignment by an act's own row.
func (g *Game) moveFor(c *Char, act string, cause fact.ID, partner string, t int64) error {
	_, err := g.moveAlignment(c, act, g.actMove(act, 0), cause, partner, true, t)
	return err
}

// factCaused writes a fact about a character, the others it names and
// the fact that caused it; a heavy one stays in the character's memory.
func (g *Game) factCaused(c *Char, also []fact.Ref, kind string, t int64, cause fact.ID, data ...fact.Datum) (fact.Fact, error) {
	region := ""
	if r := g.World.RegionAt(c.C.At); r >= 0 {
		region = world.RegionRef(r)
	}
	var causes []fact.ID
	if cause > 0 {
		causes = []fact.ID{cause}
	}
	f, err := g.r.weights.New(t, kind, region, append([]fact.Ref{char.Ref(c.C.ID)}, also...), causes, data...)
	if err != nil {
		return f, err
	}
	f.ID, err = g.Log.Append(f)
	if err == nil && f.Weight >= sheets.IntParam(g.r.Book.TileParams, "heavy-fact-weight") {
		c.C.Remember(f.ID, g.r.limits)
	}
	return f, err
}
