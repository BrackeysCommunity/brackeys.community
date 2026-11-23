package sheets

import (
	"slices"
	"strconv"
)

// Rows for emergence: the traces play leaves, the lines that promote them,
// and what each promotion makes (GDD 13).

// Trace is one of GDD 13.1's traces and how fast it fades.
type Trace struct {
	ID           string `json:"id" unit:"enum" enum:"passage|clearing|loss|working|haulage|reliance|renown|mastery"`
	DecayPercent int64  `json:"decayPercent" unit:"percent" min:"0" max:"100" doc:"Lost a world day."`
	On           string `json:"on" unit:"enum" enum:"tile|site|node|pair|region|subject|settlement" doc:"What one trace is counted on."`
	Note         string `json:"note,omitempty" unit:"text"`
}

// PromotionRow is one of GDD 13.2's lines (a kind's line is its first craft).
type PromotionRow struct {
	ID           string `json:"id" unit:"enum" enum:"road|camp|haunt|route|style|variant|legend|custom|masters"`
	Trace        string `json:"trace,omitempty" unit:"ref" ref:"emergence.traces"`
	Count        int64  `json:"count" unit:"count" min:"0" doc:"Crossings, clearings, downs, load, characters, attempts or seasons the line needs."`
	Distinct     int64  `json:"distinct,omitempty" unit:"count" min:"0" doc:"Distinct characters among them."`
	PerCharacter int64  `json:"perCharacter,omitempty" unit:"count" min:"0" doc:"style: wins each character needs."`
	WindowDays   int64  `json:"windowDays,omitempty" unit:"days" min:"0"`
	Percent      int64  `json:"percent,omitempty" unit:"percent" min:"0" max:"100" doc:"variant: adaptation it passes."`
	Heavy        int64  `json:"heavy,omitempty" unit:"count" min:"0" doc:"legend: heavy facts naming an item in a season."`
	Tag          string `json:"tag,omitempty" unit:"tag" ref:"tags.vocabulary" doc:"haunt: the creature tag its new lead carries."`
	Note         string `json:"note,omitempty" unit:"text"`
}

// Adaptation is what a creatures.variants row becomes when a region adapts
// (GDD 13.2): what it resists and how it shifts the drop it makes new.
type Adaptation struct {
	ID         string   `json:"id" unit:"ref" ref:"creatures.variants"`
	Resists    []string `json:"resists" unit:"tags" ref:"tags.vocabulary"`
	Up         string   `json:"up" unit:"ref" ref:"items.axes"`
	UpPercent  int64    `json:"upPercent" unit:"percent" min:"100" doc:"The up axis of the found material, as a share of the base's."`
	Down       string   `json:"down,omitempty" unit:"ref" ref:"items.axes"`
	DownPoints int64    `json:"downPoints,omitempty" unit:"pts" min:"0"`
	Note       string   `json:"note,omitempty" unit:"text"`
}

// CampRow is the station a camp on a site kind gains.
type CampRow struct {
	ID      string `json:"id" unit:"ref" ref:"map.site-kinds"`
	Station string `json:"station" unit:"ref" ref:"settlements.structures"`
	Note    string `json:"note,omitempty" unit:"text"`
}

// LegendTrait is a trait a legend may carry, and the tag it gives.
type LegendTrait struct {
	ID   string `json:"id" unit:"id"`
	Tag  string `json:"tag" unit:"tag" ref:"tags.vocabulary"`
	Note string `json:"note,omitempty" unit:"text"`
}

// EmergenceParamIDs are the emergence.params cells the game reads.
var EmergenceParamIDs = []string{
	"keep-days", "road-enter-ticks", "road-in-reach", "road-patrol-risk", "patrol-days",
	"toll-coin", "toll-days", "cut-days", "raid-caravan-share", "route-path-most",
	"caravan-days", "caravan-load", "caravan-threat", "road-war-load", "road-war-days",
	"pattern-road-most", "adapt-rate", "adapt-fade", "adapt-floor", "resist-at",
	"resist-bands", "variant-resist-bands", "variant-share", "found-tier-step", "legends-kept",
	"legend-posted-share", "legend-rest-days", "renown-weight", "rename-days", "staged-kept",
	"measure-weeks", "per-active", "opposed-contributors", "masters-line", "masters-ease",
}

// structural: the promotion rows a cross-check reads a column of, and the
// suffix of an axis's lead tag.
const (
	promotionStyle   = "style"
	promotionVariant = "variant"
	promotionHaunt   = "haunt"
	ledSuffix        = "-led"
)

// emergenceProblems checks the emergence sheets against each other and
// the sheets they name.
func (b *Book) emergenceProblems() []string {
	var p []string
	seen := map[string]int{}
	for _, t := range b.Traces {
		seen[t.ID]++
	}
	for _, id := range enumOf[Trace]("ID") {
		if seen[id] != 1 {
			p = append(p, "emergence.traces: "+id+" needs exactly one row, not "+strconv.Itoa(seen[id]))
		}
	}

	lines := Lookup(b.Promotions)
	for _, id := range enumOf[PromotionRow]("ID") {
		if lines[id] == nil {
			p = append(p, "emergence.promotions: no row for "+id)
		}
	}
	if s := lines[promotionStyle]; s != nil && s.PerCharacter < 1 {
		p = append(p, "emergence.promotions style: perCharacter names the wins each character needs")
	}
	if v := lines[promotionVariant]; v != nil && v.Percent < 1 {
		p = append(p, "emergence.promotions variant: percent names the adaptation it passes")
	}
	if h := lines[promotionHaunt]; h != nil && !slices.ContainsFunc(b.Creatures, func(c Creature) bool { return slices.Contains(c.Tags, h.Tag) }) {
		p = append(p, "emergence.promotions haunt: no creatures.archetypes row carries "+strconv.Quote(h.Tag))
	}
	traces := Lookup(b.Traces)
	for _, l := range b.Promotions {
		if t := traces[l.Trace]; t != nil && t.DecayPercent > 0 && l.WindowDays < 1 {
			p = append(p, "emergence.promotions "+l.ID+": a line over a fading trace reads a window of at least a day")
		}
	}

	for _, a := range b.Axes {
		led := a.ID + ledSuffix
		if !slices.ContainsFunc(b.Adaptations, func(r Adaptation) bool { return slices.Contains(r.Resists, led) }) {
			p = append(p, "emergence.adaptations: no row resists "+led+", so a style led by "+a.ID+" has no variant to become")
		}
	}
	for _, r := range b.Adaptations {
		if len(r.Resists) == 0 {
			p = append(p, "emergence.adaptations "+r.ID+": a row resists at least one tag")
		}
		if r.Down == r.Up || (r.Down == "") != (r.DownPoints == 0) {
			p = append(p, "emergence.adaptations "+r.ID+": down is another axis than up, and comes with downPoints")
		}
	}

	structures := Lookup(b.Structures)
	for _, c := range b.Camps {
		if s := structures[c.Station]; s != nil && !s.Station {
			p = append(p, "emergence.camps "+c.ID+": "+c.Station+" is not a station")
		}
	}

	if len(b.LegendTraits) == 0 {
		p = append(p, "emergence.legend-traits: a legend draws its trait from at least one row")
	}

	params := Lookup(b.EmergenceParams)
	for _, id := range EmergenceParamIDs {
		if params[id] == nil {
			p = append(p, "emergence.params: no "+id)
		}
	}
	return p
}
