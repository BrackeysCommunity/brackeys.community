package sheets_test

import (
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sim/sheets"
)

// The emergence sheets hold GDD 13's traces and lines, what adapting
// regions become, and the cells the game reads (GDD 13.1 to 13.5).
func TestEmergenceSheets(t *testing.T) {
	b := live(t)
	if len(b.Traces) != 8 || len(b.Promotions) != 9 || len(b.Camps) != len(b.SiteKinds) || len(b.LegendTraits) != 4 {
		t.Fatalf("%d traces, %d promotions, %d camps, %d legend traits", len(b.Traces), len(b.Promotions), len(b.Camps), len(b.LegendTraits))
	}
	for _, tr := range b.Traces {
		if want := map[bool]int64{true: 0, false: 10}[tr.ID == "mastery"]; tr.DecayPercent != want || tr.Note == "" {
			t.Errorf("trace %+v", tr)
		}
	}
	lines := sheets.Lookup(b.Promotions)
	for id, want := range map[string]sheets.PromotionRow{
		"road":    {Trace: "passage", Count: 60, Distinct: 20, WindowDays: 9},
		"camp":    {Trace: "clearing", Count: 40, WindowDays: 14},
		"haunt":   {Trace: "loss", Count: 30, WindowDays: 7, Tag: "pack"},
		"route":   {Trace: "haulage", Count: 2000, WindowDays: 14},
		"style":   {Trace: "reliance", Count: 20, Distinct: 20, PerCharacter: 10, WindowDays: 14},
		"variant": {Percent: 60},
		"legend":  {Count: 25, Heavy: 5},
		"custom":  {Count: 3},
		"masters": {Trace: "mastery", Count: 3, Distinct: 3},
	} {
		got := *lines[id]
		if got.Note == "" {
			t.Errorf("%s has no note", id)
		}
		got.ID, got.Note = "", ""
		if got != want {
			t.Errorf("%s: %+v, want %+v", id, got, want)
		}
	}

	adapt := sheets.Lookup(b.Adaptations)
	plated := adapt["plated"]
	if plated == nil || !slices.Equal(plated.Resists, []string{"keen", "edge-led", "hooked"}) || plated.Up != "ward" || plated.UpPercent != 200 || plated.Down != "flex" || plated.DownPoints != 2 {
		t.Errorf("plated %+v", plated)
	}
	// Every tag a style can be keyed on has a row to become, so no style
	// reaches only its axis's fallback.
	resisted := map[string]int{}
	for _, a := range b.Adaptations {
		if a.Note == "" {
			t.Errorf("%s has no note", a.ID)
		}
		for _, r := range a.Resists {
			resisted[r]++
		}
	}
	pairs, traits := []string{}, []string{}
	for _, p := range b.Pairings {
		pairs = append(pairs, p.TagA)
	}
	for _, tr := range b.Traits {
		traits = append(traits, tr.Tag)
	}
	substances := []string{}
	for _, v := range b.Vocabulary {
		if v.Kind == "substance" {
			substances = append(substances, v.ID)
		}
	}
	for _, k := range slices.Concat(pairs, traits, substances) {
		if resisted[k] != 1 {
			t.Errorf("%s is resisted by %d rows, want 1", k, resisted[k])
		}
	}

	stations := sheets.Lookup(b.Structures)
	for _, c := range b.Camps {
		if s := stations[c.Station]; s == nil || !s.Station || c.Note == "" {
			t.Errorf("camp %+v", c)
		}
	}
	for _, lt := range b.LegendTraits {
		if lt.Note == "" {
			t.Errorf("legend trait %s has no note", lt.ID)
		}
	}

	for id, want := range map[string]int64{
		"keep-days": 15, "road-enter-ticks": 1, "road-in-reach": 1, "road-patrol-risk": -1, "patrol-days": 7,
		"toll-coin": 2, "toll-days": 14, "cut-days": 3, "raid-caravan-share": 50, "route-path-most": 64,
		"caravan-days": 7, "caravan-load": 30, "caravan-threat": 800, "road-war-load": 2000, "road-war-days": 14,
		"pattern-road-most": 40, "adapt-rate": 12, "adapt-fade": 3, "adapt-floor": 20, "resist-at": 30,
		"resist-bands": 1, "variant-resist-bands": 2, "variant-share": 50, "found-tier-step": 1, "legends-kept": 16,
		"legend-posted-share": 75, "legend-rest-days": 14, "renown-weight": 60, "rename-days": 7, "staged-kept": 256,
		"measure-weeks": 12, "per-active": 500, "opposed-contributors": 3, "masters-line": 3, "masters-ease": 1,
	} {
		if got := sheets.IntParam(b.EmergenceParams, id); got != want {
			t.Errorf("emergence.params %s is %d, want %d", id, got, want)
		}
	}

	facts := map[string]int64{}
	for _, f := range b.FactWeights {
		facts[f.Kind] = f.Weight
	}
	for kind, want := range map[string]int64{
		"promotion": 70, "road.grew": 20, "road.cut": 60, "road.tolled": 60, "road.toll-paid": 20,
		"caravan.departed": 30, "caravan.arrived": 40, "caravan.robbed": 60, "caravan.lost": 70,
		"custom.held": 40, "custom.skipped": 40, "legend.laid": 70, "season.added": 70,
		"material.looted-first": 60, "promotion.renamed": 40, "emergence.started": 40,
	} {
		if facts[kind] != want {
			t.Errorf("%s weighs %d, want %d", kind, facts[kind], want)
		}
	}

	arcs := sheets.Lookup(b.Arcs)
	for id, when := range map[string]string{"the-road-war": "road-busy", "the-lost-caravan": "caravan-threatened", "the-rival-claims": "opposed-goals", "the-legend-wakes": "legend-near"} {
		if a := arcs[id]; a == nil || a.When != when || a.Scope != "region" || len(a.Stages) != 1 {
			t.Errorf("%s: %+v", id, a)
		}
	}

	classes := sheets.Lookup(b.Classes)
	for _, id := range []string{"router", "roadwarden"} {
		c := classes[id]
		if c == nil || !c.Hidden {
			t.Fatalf("%s is not a hidden class", id)
		}
		tiers := map[int64]int{}
		for _, a := range b.Abilities {
			if a.Class == id {
				tiers[a.Tier]++
				if len(a.Rules) != 1 || a.Reads == "" || a.Waits != "" {
					t.Errorf("%s: %+v", a.ID, a)
				}
			}
		}
		if tiers[1] != 2 || tiers[5] != 2 || tiers[10] != 2 || tiers[15] != 2 {
			t.Errorf("%s tiers %v", id, tiers)
		}
	}
	for _, c := range b.Classes {
		if c.Hidden != (c.ID == "router" || c.ID == "roadwarden") {
			t.Errorf("%s hidden %v", c.ID, c.Hidden)
		}
	}

	for _, pz := range b.PatternPuzzles {
		for _, o := range pz.Opens {
			if strings.HasPrefix(o.Waits, "MM10") || pz.ID == "frontier-spiral" && o.Kind == "road" && o.Waits != "" {
				t.Errorf("%s opens %s waiting for %q", pz.ID, o.Kind, o.Waits)
			}
		}
	}
	for _, fc := range b.FactionCities {
		if strings.HasPrefix(fc.Waits, "MM10") {
			t.Errorf("%s waits for %s", fc.ID, fc.Waits)
		}
	}

	parts := map[string]map[string]bool{}
	for _, np := range b.NameParts {
		if parts[np.List] == nil {
			parts[np.List] = map[string]bool{}
		}
		parts[np.List][strings.TrimPrefix(np.ID, np.List+"-")] = true
	}
	need := map[string][]string{"style-lead": b.IDs("items.axes"), "style-word": slices.Concat(traits, substances), "material-noun": substances,
		"custom-word": {"deliver", "make", "discover", "defeat", "reach", "haul", "hold", "back", "carry"}}
	for list, keys := range need {
		for _, k := range keys {
			if !parts[list][k] {
				t.Errorf("name-parts %s has no %s", list, k)
			}
		}
	}

	targets := 0
	for _, tg := range b.Targets {
		if tg.HoldsFrom == "MM10" && tg.Runs == "emergence" {
			targets++
		}
	}
	if targets != 4 {
		t.Errorf("%d emergence targets", targets)
	}
}

// Load refuses an emergence book whose sheets do not hang together.
func TestEmergenceProblems(t *testing.T) {
	adaptation := func(b *sheets.Book, id string) *sheets.Adaptation {
		return &b.Adaptations[slices.IndexFunc(b.Adaptations, func(a sheets.Adaptation) bool { return a.ID == id })]
	}
	line := func(b *sheets.Book, id string) *sheets.PromotionRow {
		return &b.Promotions[slices.IndexFunc(b.Promotions, func(p sheets.PromotionRow) bool { return p.ID == id })]
	}
	for _, c := range []struct {
		name, want string
		edit       func(*sheets.Book)
	}{
		{"an axis's lead tag no row resists", "emergence.adaptations: no row resists ward-led", func(b *sheets.Book) {
			a := adaptation(b, "fast")
			a.Resists = slices.DeleteFunc(a.Resists, func(s string) bool { return s == "ward-led" })
		}},
		{"a style row without perCharacter", "emergence.promotions style: perCharacter", func(b *sheets.Book) {
			line(b, "style").PerCharacter = 0
		}},
		{"a variant row without percent", "emergence.promotions variant: percent", func(b *sheets.Book) {
			line(b, "variant").Percent = 0
		}},
		{"a line with no window over a fading trace", "emergence.promotions road: a line over a fading trace", func(b *sheets.Book) {
			line(b, "road").WindowDays = 0
		}},
		{"a missing promotion row", "emergence.promotions: no row for custom", func(b *sheets.Book) {
			b.Promotions = slices.DeleteFunc(b.Promotions, func(p sheets.PromotionRow) bool { return p.ID == "custom" })
		}},
		{"a haunt tag no creature carries", `emergence.promotions haunt: no creatures.archetypes row carries "toll"`, func(b *sheets.Book) {
			line(b, "haunt").Tag = "toll"
		}},
		{"a trace twice", "emergence.traces: loss needs exactly one row, not 2", func(b *sheets.Book) {
			i := slices.IndexFunc(b.Traces, func(tr sheets.Trace) bool { return tr.ID == "clearing" })
			b.Traces[i].ID = "loss"
		}},
		{"a trace missing", "emergence.traces: renown needs exactly one row, not 0", func(b *sheets.Book) {
			b.Traces = slices.DeleteFunc(b.Traces, func(tr sheets.Trace) bool { return tr.ID == "renown" })
		}},
		{"a camp at a structure that is not a station", "emergence.camps den: wall is not a station", func(b *sheets.Book) {
			b.Camps[slices.IndexFunc(b.Camps, func(c sheets.CampRow) bool { return c.ID == "den" })].Station = "wall"
		}},
		{"an adaptation down its own up axis", "emergence.adaptations plated: down is another axis than up", func(b *sheets.Book) {
			adaptation(b, "plated").Down = "ward"
		}},
		{"no legend traits", "emergence.legend-traits: a legend draws its trait from at least one row", func(b *sheets.Book) {
			b.LegendTraits = nil
		}},
	} {
		t.Run(c.name, func(t *testing.T) {
			b := live(t)
			c.edit(b)
			err := b.Validate()
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Errorf("want %q, got %v", c.want, err)
			}
		})
	}
}
