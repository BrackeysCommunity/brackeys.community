package emerge

import (
	"errors"
	"fmt"
	"slices"

	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/sheets"
)

// LineRow is one emergence.promotions row read for the game.
type LineRow struct {
	Count, Distinct, PerCharacter, WindowDays, Percent, Heavy int64
	Trace, Tag                                                string
}

// Lines are the promotion lines by emergence.promotions id.
type Lines map[string]LineRow

// Line is the promotion line of a type.
func (l Lines) Line(t Type) LineRow { return l[string(t)] }

// Params are emergence.params, read once.
type Params struct {
	KeepDays, RoadEnterTicks, RoadInReach, RoadPatrolRisk, PatrolDays, TollCoin, TollDays, CutDays,
	RaidCaravanShare, RoutePathMost, CaravanDays, CaravanLoad, CaravanThreat, RoadWarLoad, RoadWarDays,
	PatternRoadMost, AdaptRate, AdaptFade, AdaptFloor, ResistAt, ResistBands, VariantResistBands,
	VariantShare, FoundTierStep, LegendsKept, LegendPostedShare, LegendRestDays, RenownWeight,
	RenameDays, StagedKept, MeasureWeeks, PerActive, OpposedContributors, MastersLine, MastersEase int64
}

func (p *Params) cells() []struct {
	id string
	v  *int64
} {
	return []struct {
		id string
		v  *int64
	}{
		{"keep-days", &p.KeepDays}, {"road-enter-ticks", &p.RoadEnterTicks}, {"road-in-reach", &p.RoadInReach},
		{"road-patrol-risk", &p.RoadPatrolRisk}, {"patrol-days", &p.PatrolDays}, {"toll-coin", &p.TollCoin},
		{"toll-days", &p.TollDays}, {"cut-days", &p.CutDays}, {"raid-caravan-share", &p.RaidCaravanShare},
		{"route-path-most", &p.RoutePathMost}, {"caravan-days", &p.CaravanDays}, {"caravan-load", &p.CaravanLoad},
		{"caravan-threat", &p.CaravanThreat}, {"road-war-load", &p.RoadWarLoad}, {"road-war-days", &p.RoadWarDays},
		{"pattern-road-most", &p.PatternRoadMost}, {"adapt-rate", &p.AdaptRate}, {"adapt-fade", &p.AdaptFade},
		{"adapt-floor", &p.AdaptFloor}, {"resist-at", &p.ResistAt}, {"resist-bands", &p.ResistBands},
		{"variant-resist-bands", &p.VariantResistBands}, {"variant-share", &p.VariantShare},
		{"found-tier-step", &p.FoundTierStep}, {"legends-kept", &p.LegendsKept},
		{"legend-posted-share", &p.LegendPostedShare}, {"legend-rest-days", &p.LegendRestDays},
		{"renown-weight", &p.RenownWeight}, {"rename-days", &p.RenameDays}, {"staged-kept", &p.StagedKept},
		{"measure-weeks", &p.MeasureWeeks}, {"per-active", &p.PerActive},
		{"opposed-contributors", &p.OpposedContributors}, {"masters-line", &p.MastersLine},
		{"masters-ease", &p.MastersEase},
	}
}

// ParamIDs are the emergence.params ids Params reads.
func ParamIDs() []string {
	var p Params
	out := []string{}
	for _, c := range p.cells() {
		out = append(out, c.id)
	}
	return out
}

// Rules are the emergence sheets compiled: lines, params, decays, styles.
type Rules struct {
	Lines  Lines
	P      Params
	Decay  map[string]Decay // by trace id
	Styles StyleBook
	Adapt  []sheets.Adaptation

	// Axes are items.axes in vector order; MaxTier the highest items.tiers
	// tier; Tags each creatures.variants row's creature tag.
	Axes    []string
	MaxTier int64
	Tags    map[string]string
}

// lineIDs are the promotion rows the game reads.
var lineIDs = slices.Concat(Types, []Type{Masters})

// Compile reads the emergence sheets into Rules, or every problem found.
func Compile(b *sheets.Book) (*Rules, error) {
	var errs []error
	r := &Rules{Lines: Lines{}, Decay: map[string]Decay{}, Styles: NewStyleBook(b), Tags: map[string]string{}}

	byID := map[string]sheets.Param{}
	for _, p := range b.EmergenceParams {
		byID[p.ID] = p
	}
	for _, c := range r.P.cells() {
		p, ok := byID[c.id]
		if !ok {
			errs = append(errs, fmt.Errorf("emergence.params: no %s", c.id))
			continue
		}
		if fixed.FromInt(p.Value.Int()) != p.Value {
			errs = append(errs, fmt.Errorf("emergence.params: %s is not a whole number", c.id))
			continue
		}
		*c.v = p.Value.Int()
	}

	for _, t := range b.Traces {
		r.Decay[t.ID] = NewDecay(t.DecayPercent, r.P.KeepDays)
	}
	for _, id := range TraceIDs {
		if _, ok := r.Decay[id]; !ok {
			errs = append(errs, fmt.Errorf("emergence.traces: no %s", id))
		}
	}

	for _, row := range b.Promotions {
		r.Lines[row.ID] = LineRow{
			Count: row.Count, Distinct: row.Distinct, PerCharacter: row.PerCharacter,
			WindowDays: row.WindowDays, Percent: row.Percent, Heavy: row.Heavy,
			Trace: row.Trace, Tag: row.Tag,
		}
	}
	for _, t := range lineIDs {
		if _, ok := r.Lines[string(t)]; !ok {
			errs = append(errs, fmt.Errorf("emergence.promotions: no %s", t))
		}
	}

	for _, a := range b.Axes {
		r.Axes = append(r.Axes, a.ID)
	}
	for _, t := range b.Tiers {
		r.MaxTier = max(r.MaxTier, t.Tier)
	}
	for _, v := range b.CreatureVariants {
		r.Tags[v.ID] = v.Tag
	}
	r.Adapt = slices.Clone(b.Adaptations)
	for _, a := range r.Adapt {
		// Derive gives the found material the row's own id as its tag.
		if tag, ok := r.Tags[a.ID]; !ok || tag != a.ID {
			errs = append(errs, fmt.Errorf("emergence.adaptations: %s needs a creatures.variants row whose tag is its id", a.ID))
		}
		for _, ax := range []string{a.Up, a.Down} {
			if ax != "" && !slices.Contains(r.Axes, ax) {
				errs = append(errs, fmt.Errorf("emergence.adaptations: %s names no axis %s", a.ID, ax))
			}
		}
	}
	if len(errs) > 0 {
		return nil, errors.Join(errs...)
	}
	return r, nil
}

// Row is an adaptation row by id.
func (r *Rules) Row(id string) (sheets.Adaptation, bool) {
	i := slices.IndexFunc(r.Adapt, func(a sheets.Adaptation) bool { return a.ID == id })
	if i < 0 {
		return sheets.Adaptation{}, false
	}
	return r.Adapt[i], true
}

// Found is the material an adaptation row makes of a base drop.
func (r *Rules) Found(base sheets.Material, row string) (sheets.Material, bool) {
	a, ok := r.Row(row)
	if !ok {
		return sheets.Material{}, false
	}
	return Derive(base, a, r.Axes, r.P.FoundTierStep, r.MaxTier), true
}
