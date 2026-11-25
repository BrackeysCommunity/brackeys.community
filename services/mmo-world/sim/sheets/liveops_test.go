package sheets_test

import (
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/sheets"
)

// The staging sheets hold the cells GDD 14.3 to 14.5 set and the design's
// templates, tables and contests.
func TestLiveOpsSheets(t *testing.T) {
	b := live(t)
	for id, want := range map[string]int64{
		"pool-cap": 400, "pool-refill": 20, "pool-per-active": 4, "staged-xp": 150, "crate-cap": 3,
		"stage-lead-days": 7, "stage-days-max": 7, "live-stages-most": 24, "queue-kept": 200,
		"reports-per-day": 5, "hold-days-max": 56, "ground-check-tiles": 12,
	} {
		if got := sheets.IntParam(b.LiveOpsParams, id); got != want {
			t.Errorf("liveops.params %s is %d, want %d", id, got, want)
		}
	}
	if len(b.LiveOpsParams) != 12 {
		t.Errorf("%d liveops cells", len(b.LiveOpsParams))
	}

	type tpl struct {
		kind          string
		points        int64
		staff         bool
		tier, crates  int64
		table, detail string
		days          int64
	}
	want := map[string]tpl{
		"contest":    {"contest", 30, true, 0, 0, "", "", 3},
		"storm":      {"hardship", 40, true, 0, 0, "prize-hardship", "shortage", 1},
		"scare":      {"hardship", 40, true, 0, 0, "prize-hardship", "panic", 1},
		"drill":      {"hardship", 40, true, 0, 0, "prize-hardship", "raid", 1},
		"drop-small": {"drop", 60, true, 0, 40, "crate-small", "", 2},
		"hunt-2":     {"hunt", 80, true, 2, 0, "", "", 2},
		"fair":       {"fair", 120, true, 0, 40, "crate-small", "", 1},
		"hunt-3":     {"hunt", 140, true, 3, 0, "", "", 2},
		"drop-large": {"drop", 150, true, 0, 120, "crate-large", "", 2},
		"vault":      {"vault", 60, true, 0, 0, "vault-haul", "", 2},
		"pattern":    {"pattern", 0, false, 0, 0, "pattern-cache", "", 7},
	}
	if len(b.LiveOpsTemplates) != len(want) {
		t.Fatalf("%d templates", len(b.LiveOpsTemplates))
	}
	for _, r := range b.LiveOpsTemplates {
		w, ok := want[r.ID]
		got := tpl{r.Kind, r.Points, r.Staff, r.Tier, r.Crates, r.Table, r.Trouble, r.Days}
		if !ok || got != w {
			t.Errorf("liveops.templates %s is %+v, want %+v", r.ID, got, w)
		}
	}
	tpls := sheets.Lookup(b.LiveOpsTemplates)
	if v := tpls["vault"]; v.Family == "" || v.Level != 2 {
		t.Errorf("vault %+v", v)
	}

	tables := map[string]bool{}
	materials := sheets.Lookup(b.Materials)
	for _, d := range b.LiveOpsDrops {
		tables[d.Table] = true
		if m := materials[d.Material]; m == nil || m.Tier > 2 {
			t.Errorf("liveops.drops %s: %s is not a tier 1 or 2 material", d.ID, d.Material)
		}
	}
	for _, tb := range []string{"crate-small", "crate-large", "prize-contest", "prize-hardship", "vault-haul", "pattern-cache"} {
		if !tables[tb] || len(b.DropTable(tb)) == 0 {
			t.Errorf("no liveops.drops table %s", tb)
		}
	}
	if len(tables) != 6 {
		t.Errorf("%d drop tables", len(tables))
	}

	if len(b.LiveOpsContests) < 3 || len(b.FairContests()) < 2 {
		t.Errorf("%d contests, %d at a fair", len(b.LiveOpsContests), len(b.FairContests()))
	}

	facts := map[string]int64{}
	for _, f := range b.FactWeights {
		facts[f.Kind] = f.Weight
	}
	for kind, w := range map[string]int64{
		"staged.ordered": 10, "staged.opened": 50, "staged.closed": 30, "crate.opened": 5, "vault.taken": 40, "name.renamed": 10,
	} {
		if facts[kind] != w {
			t.Errorf("%s weighs %d, want %d", kind, facts[kind], w)
		}
	}

	targets := sheets.Lookup(b.Targets)
	for id, runs := range map[string]string{
		"staged-goods-local": "economy, search", "staged-xp-cap": "search", "terrain-pins-hold": "terrain", "staging-stays-local": "economy, search",
	} {
		if tg := targets[id]; tg == nil || tg.Runs != runs || tg.HoldsFrom != "MM12" {
			t.Errorf("meta.targets %s: %+v", id, tg)
		}
	}
}

// Every name a staging sheet holds resolves to a row of the sheet it
// names, and nothing a drop rolls is provisions.
func TestLiveOpsReferences(t *testing.T) {
	b := live(t)
	tables := map[string]bool{}
	for _, d := range b.LiveOpsDrops {
		tables[d.Table] = true
		if d.Material == sheets.TagProvisions || slices.Contains(sheets.Lookup(b.Materials)[d.Material].Tags, sheets.TagProvisions) {
			t.Errorf("liveops.drops %s rolls provisions", d.ID)
		}
	}
	troubles := sheets.Lookup(b.Troubles)
	families := sheets.Lookup(b.PuzzleFamilies)
	patterns := sheets.Lookup(b.PatternPuzzles)
	shapes := sheets.Lookup(b.Shapes)
	for _, r := range b.LiveOpsTemplates {
		if r.Table != "" && !tables[r.Table] {
			t.Errorf("%s: table %s", r.ID, r.Table)
		}
		if r.Trouble != "" && troubles[r.Trouble] == nil {
			t.Errorf("%s: trouble %s", r.ID, r.Trouble)
		}
		if r.Family != "" && families[r.Family] == nil {
			t.Errorf("%s: family %s", r.ID, r.Family)
		}
		for _, p := range r.Patterns {
			if pp := patterns[p]; pp == nil || shapes[pp.Shape] == nil || pp.Size < 1 || pp.Points == "" {
				t.Errorf("%s: pattern %s is not one a layout can lay", r.ID, p)
			}
		}
	}
	creatures := sheets.Lookup(b.Creatures)
	vocab := sheets.Lookup(b.Vocabulary)
	var each goal.Limits
	each.EachCap = sheets.IntParam(b.GoalParams, "each-cap")
	for _, c := range b.LiveOpsContests {
		if !tables[c.Prize] {
			t.Errorf("%s: prize %s", c.ID, c.Prize)
		}
		if !slices.Contains(goal.Verbs, c.Verb) || c.Verb == goal.Haul || c.Most > each.EachCap {
			t.Errorf("%s: %s with %d winners is no Each goal", c.ID, c.Verb, c.Most)
		}
		switch c.Verb {
		case goal.Defeat:
			if creatures[c.Target] == nil {
				t.Errorf("%s: creature %s", c.ID, c.Target)
			}
		case goal.Make:
			if vocab[c.Target] == nil {
				t.Errorf("%s: tag %s", c.ID, c.Target)
			}
		case goal.Reach:
			if _, ok := c.ReachTiles(); !ok {
				t.Errorf("%s: distance %s", c.ID, c.Target)
			}
		}
	}
	f, _ := sheets.DefByName("liveops.contests")
	verb, _ := f.Row.FieldByName("Verb")
	for _, v := range sheets.EnumValues(verb) {
		if !slices.Contains([]string{goal.Defeat, goal.Make, goal.Reach}, v) {
			t.Errorf("contest verb %s is not one a staged goal takes", v)
		}
	}
}

// Load refuses staging sheets that do not hang together.
func TestLiveOpsProblems(t *testing.T) {
	files, err := sheetfs.ReadSheetFiles(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	const (
		templates = "sheets/liveops/templates.json"
		drops     = "sheets/liveops/drops.json"
		contests  = "sheets/liveops/contests.json"
	)
	for _, c := range []struct{ path, old, new, want string }{
		{templates, `"table": "crate-small",`, `"table": "crate-tiny",`, `drop-small: no liveops.drops table "crate-tiny"`},
		{templates, `"crates": 120,`, ``, "drop-large: needs crates"},
		{templates, `"tier": 2,`, ``, "hunt-2: needs a tier"},
		{templates, `"tier": 3,`, `"tier": 9,`, "hunt-3: tier 9 is not in fights.tiers"},
		{templates, `"trouble": "panic",`, ``, "scare: needs a trouble"},
		{templates, `"trouble": "panic",`, `"trouble": "flood",`, `"flood" is not an id in story.troubles`},
		{templates, `"family": "circuit",`, `"family": "lock-pins-x",`, `"lock-pins-x" is not an id in puzzles.families`},
		{templates, `"level": 2,`, ``, "vault: needs a family and a level"},
		{templates, `"second-triangle"`, `"triangle"`, "pattern: triangle is a scaffold pattern"},
		{templates, `"second-triangle"`, `"no-such"`, `"no-such" is not an id in story.pattern-puzzles`},
		{templates, `"points": 0,`, `"points": 0,
      "staff": true,`, "pattern: a pattern is staged by admins only"},
		{drops, `"min": 1,
      "max": 3`, `"min": 4,
      "max": 3`, "min lies over max"},
		{drops, `"material": "timber",`, `"material": "provisions",`, `"provisions" is not an id in items.materials`},
		{contests, `"target": "reed-rat",`, `"target": "marsh-dragon",`, `rat-cull: "marsh-dragon" is not an id in creatures.archetypes`},
		{contests, `"target": "12",`, `"target": "far",`, `far-walk: "far" is not a distance in tiles`},
		{contests, `"target": "blade",`, `"target": "provisions",`, `blade-smith: "provisions" is not a tag a made thing holds`},
		{contests, `"verb": "make",`, `"verb": "haul",`, `"haul" is not one of defeat|make|reach`},
		{contests, `"most": 5,`, `"most": 51,`, "hound-hunt: most is above goals.params each-cap"},
		{contests, `"prize": "prize-contest",`, `"prize": "prize-none",`, `no liveops.drops table "prize-none"`},
	} {
		mutated := slices.Clone(files)
		found := false
		for i, f := range mutated {
			if f.Path == c.path && strings.Contains(string(f.Data), c.old) {
				mutated[i].Data = []byte(strings.Replace(string(f.Data), c.old, c.new, 1))
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
