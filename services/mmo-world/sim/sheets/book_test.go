package sheets_test

import (
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/sheets"
)

// The content and pin sheets hold what history draws from and what each
// role may stage (GDD 4.17, 14.5).
func TestContentSheets(t *testing.T) {
	b := live(t)
	if len(b.SiteKinds) != 6 || len(b.StockBands) != 5 || len(b.PinLimits) != 3 || len(b.ContentWeights) < 24 {
		t.Fatalf("%d site kinds, %d stock bands, %d pin limits, %d weights", len(b.SiteKinds), len(b.StockBands), len(b.PinLimits), len(b.ContentWeights))
	}
	tables := map[string]bool{}
	finds := 0
	for _, w := range b.ContentWeights {
		tables[w.Table] = true
		if w.Note == "" {
			t.Errorf("%s has no note", w.ID)
		}
		if w.Find != "" {
			finds++
		}
	}
	if len(tables) != 6 || finds == 0 {
		t.Fatalf("weights cover %d tables and %d find rows", len(tables), finds)
	}
	var percents, weights []int64
	for _, s := range b.StockBands {
		percents = append(percents, s.Percent)
		weights = append(weights, s.Weight)
	}
	if !slices.Equal(percents, []int64{90, 95, 100, 105, 110}) || !slices.Equal(weights, []int64{15, 20, 30, 20, 15}) {
		t.Fatalf("stock bands %v at %v", percents, weights)
	}
	limits := sheets.Lookup(b.PinLimits)
	for role, want := range map[string][2]int64{"designer": {0, 0}, "admin": {1, 0}, "staff": {2, 60}} {
		l := limits[role]
		if l == nil || l.ReachMax != 12 || l.PerDay != want[0] || l.Points != want[1] {
			t.Errorf("%s: %+v", role, l)
		}
	}
	if len(limits["designer"].Fields) != 7 || len(limits["admin"].Fields) != 4 {
		t.Errorf("designer fields %v, admin fields %v", limits["designer"].Fields, limits["admin"].Fields)
	}
	for id, want := range map[string]int64{
		"history-weight": 40, "history-radius": 6, "history-days": 28, "history-cell-kept": 32,
		"history-kind-most": 8, "history-holders-most": 3, "pins-per-cell": 8, "pins-in-reach-max": 8,
		"pin-days": 56, "pin-path-tiles": 48, "pin-label-max": 60, "lead-region-weight": 3,
		"lead-other-weight": 1, "content-trait-weight": 1,
	} {
		if got := sheets.IntParam(b.MapParams, id); got != want {
			t.Errorf("map.params %s is %d, want %d", id, got, want)
		}
	}
	facts := map[string]int64{}
	for _, f := range b.FactWeights {
		facts[f.Kind] = f.Weight
	}
	for kind, want := range map[string]int64{"pin.reserved": 10, "pin.edited": 10, "pin.withdrawn": 10, "pin.landed": 45, "world.content-frozen": 10} {
		if facts[kind] != want {
			t.Errorf("%s weighs %d, want %d", kind, facts[kind], want)
		}
	}
	targets := 0
	for _, tg := range b.Targets {
		if tg.Runs == "content" && tg.HoldsFrom == "MM8a" {
			targets++
		}
	}
	if targets != 6 {
		t.Errorf("%d content targets", targets)
	}
	named := map[string]bool{}
	for _, n := range b.Names {
		named[n.Ref] = true
	}
	for _, s := range []string{"map.site-kinds", "map.stock-bands"} {
		for _, id := range b.IDs(s) {
			if !named[s+":"+id] {
				t.Errorf("nothing names %s:%s", s, id)
			}
		}
	}
	if got := sheets.BandLines(b.GaugeLines, "threat"); !slices.Equal(got, []int64{600, 800, 900}) {
		t.Errorf("threat lines %v", got)
	}
	if got := sheets.BandLines(b.GaugeLines, "corruption"); !slices.Equal(got, []int64{500}) {
		t.Errorf("corruption lines %v", got)
	}
}

// Load refuses a book whose content and pin sheets do not hang together.
func TestContentProblems(t *testing.T) {
	files, err := sheetfs.ReadSheetFiles(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	const (
		weights = "sheets/map/content-weights.json"
		limits  = "sheets/map/pin-limits.json"
		params  = "sheets/map/params.json"
	)
	for _, c := range []struct {
		path, old, new, want string
		all                  bool
	}{
		{weights, `"fact": "faction-raided",
      "shift": 40,`, `"fact": "faction-raided",
      "pins": true,
      "shift": 40,`, "battlefield-ruin-raided: a row holds exactly one condition", false},
		{weights, `"fact": "faction-raided",
      "shift": 40,`, `"shift": 40,`, "battlefield-ruin-raided: a row holds exactly one condition", false},
		{weights, `"row": "den",`, `"row": "bunker",`, "den-threat: bunker is not a row of the site table", false},
		{weights, `"row": "road-pilgrim",`, `"row": "settlement-keeper",`, "settlement-keeper is not a row of the role table", false},
		{weights, `"fact": "faction-raided",`, `"fact": "faction-traded",`, "faction.traded weighs under history-weight", false},
		{weights, `"fact": "faction-raided",`, `"fact": "pin-landed",`, "pin.landed is never indexed", false},
		{weights, `"band": 2,`, `"band": 4,`, "den-threat: band 4 is outside threat's 3 lines", false},
		{weights, `"fact": "holding-fell",`, `"fact": "holding-fell",
      "band": 1,`, "battlefield-ruin-fell: a band needs a gauge", false},
		{"sheets/map/site-kinds.json", `"edge-site"`, `"site"`, "no kind stands on edge-site slots", true},
		{"sheets/map/stock-bands.json", `"percent": 110,`, `"percent": 120,`, "the weighted mean percent is not 100", false},
		{limits, `"role": "staff",`, `"role": "admin",`, "role staff needs exactly one row", false},
		{limits, `"role": "staff",`, `"role": "admin",`, "staff: a limit's id is its role", false},
		{limits, `"role": "admin",
      "reachMax": 12,`, `"role": "admin",
      "reachMax": 13,`, "admin: reaches past the designer's", false},
		{limits, `"site-kind",
        "landmark",
        "lead"
      ],
      "note": "A server's`, `"site-kind",
        "landmark",
        "stock"
      ],
      "note": "A server's`, "admin: a staged pin sets no stock, dungeon or floors", false},
		{limits, `"perDay": 1,`, `"perDay": 1,
      "points": 5,`, "admin: only staff pins cost points", false},
		{params, `"id": "history-radius",
      "value": 6,`, `"id": "history-radius",
      "value": 0,`, "history-radius: a digest reads at least one tile", false},
		{params, `"id": "pins-per-cell",
      "value": 8,`, `"id": "pins-per-cell",
      "value": 7,`, "pins-per-cell: under pins-in-reach-max", false},
		{params, `"id": "pin-path-tiles",
      "value": 48,`, `"id": "pin-path-tiles",
      "value": 0,`, "pin-path-tiles: a pin's walk to known ground is bounded", false},
		{params, `"id": "history-weight",`, `"id": "history-floor",`, "map.params: no history-weight", false},
	} {
		mutated := slices.Clone(files)
		found := false
		for i, f := range mutated {
			if f.Path == c.path && strings.Contains(string(f.Data), c.old) {
				n := 1
				if c.all {
					n = -1
				}
				mutated[i].Data = []byte(strings.Replace(string(f.Data), c.old, c.new, n))
				found = true
			}
		}
		if !found {
			t.Fatalf("%s holds no %q", c.path, c.old)
		}
		_, err := sheets.Load(mutated)
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("want %q, got %v", c.want, err)
		}
	}
}
