package harness

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"golang.org/x/tools/go/analysis/checker"
	"golang.org/x/tools/go/packages"

	"jams.team/mmo-world/lint"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

// Result is one named check and what it found.
type Result struct {
	Name     string
	Problems []string
}

func (r Result) OK() bool { return len(r.Problems) == 0 }

// CheckOptions lets tests skip the slow source analysis.
type CheckOptions struct {
	SkipLint bool
}

// Check is the Check run: schemas, units, references, budgets, the pack,
// the rules, and the no-literals test (GDD 18.4).
func Check(root string, opt CheckOptions) []Result {
	var out []Result
	add := func(name string, problems []string) { out = append(out, Result{name, problems}) }

	files, err := ReadSheetFiles(root)
	if err != nil {
		add("read sheets", []string{err.Error()})
		return out
	}
	add("schemas are current", staleSchemas(root))
	add("every sheet has a file", missingSheets(files))
	add("rows match their schema", schemaViolations(root, files))

	book, err := sheets.Load(files)
	if err != nil {
		add("sheets load", splitErr(err))
		return out
	}
	add("sheets load", nil)
	add("units", unitProblems(book))
	add("budgets", budgetProblems(book))
	add("rules compile", ruleProblems(book))
	add("pack names everything shown", packProblems(book))
	if !opt.SkipLint {
		add("sim rules and no literals", lintProblems(root))
	}
	return out
}

func splitErr(err error) []string {
	return strings.Split(err.Error(), "\n")
}

func schemaPath(root, sheet string) string {
	return filepath.Join(root, SchemaDir, sheet+".schema.json")
}

func staleSchemas(root string) []string {
	var p []string
	for _, d := range sheets.Defs() {
		want, err := Schema(d)
		if err != nil {
			p = append(p, err.Error())
			continue
		}
		got, err := os.ReadFile(schemaPath(root, d.Name))
		if err != nil || !bytes.Equal(got, want) {
			p = append(p, d.Name+": schema is missing or stale; run `go run ./cmd/harness schema`")
		}
	}
	return p
}

// WriteSchemas regenerates every schema file.
func WriteSchemas(root string) error {
	dir := filepath.Join(root, SchemaDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	for _, d := range sheets.Defs() {
		b, err := Schema(d)
		if err != nil {
			return err
		}
		if err := os.WriteFile(schemaPath(root, d.Name), b, 0o644); err != nil {
			return err
		}
	}
	return nil
}

func missingSheets(files []sheets.File) []string {
	have := map[string]bool{}
	for _, f := range files {
		var env struct {
			Sheet string `json:"sheet"`
		}
		if json.Unmarshal(f.Data, &env) == nil {
			have[env.Sheet] = true
		}
	}
	var p []string
	for _, d := range sheets.Defs() {
		if !have[d.Name] {
			p = append(p, d.Name+": no file holds this sheet")
		}
	}
	return p
}

func schemaViolations(root string, files []sheets.File) []string {
	c := jsonschema.NewCompiler()
	var p []string
	for _, d := range sheets.Defs() {
		b, err := Schema(d)
		if err != nil {
			continue
		}
		doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(b))
		if err != nil {
			p = append(p, err.Error())
			continue
		}
		if err := c.AddResource(d.Name, doc); err != nil {
			p = append(p, err.Error())
		}
	}
	compiled := map[string]*jsonschema.Schema{}
	for _, f := range files {
		inst, err := jsonschema.UnmarshalJSON(bytes.NewReader(f.Data))
		if err != nil {
			p = append(p, f.Path+": "+err.Error())
			continue
		}
		var env struct {
			Sheet string `json:"sheet"`
		}
		_ = json.Unmarshal(f.Data, &env)
		if _, ok := sheets.DefByName(env.Sheet); !ok {
			p = append(p, fmt.Sprintf("%s: unknown sheet %q", f.Path, env.Sheet))
			continue
		}
		s, ok := compiled[env.Sheet]
		if !ok {
			s, err = c.Compile(env.Sheet)
			if err != nil {
				p = append(p, env.Sheet+": "+err.Error())
				continue
			}
			compiled[env.Sheet] = s
		}
		if err := s.Validate(inst); err != nil {
			p = append(p, f.Path+": "+strings.ReplaceAll(err.Error(), "\n", "; "))
		}
	}
	return p
}

func unitProblems(b *sheets.Book) []string {
	var p []string
	for _, group := range []struct {
		sheet string
		rows  []sheets.Param
	}{
		{"items.params", b.ItemParams}, {"growth.params", b.GrowthParams}, {"fights.params", b.FightParams},
		{"wear.params", b.WearParams}, {"world.params", b.WorldParams}, {"factions.params", b.FactionParams},
		{"story.params", b.StoryParams}, {"economy.params", b.EconomyParams}, {"goals.params", b.GoalParams},
		{"liveops.params", b.LiveOpsParams}, {"map.params", b.MapParams}, {"creatures.params", b.CreatureParams},
		{"settlements.params", b.SettlementParams}, {"mounts.params", b.MountParams}, {"classes.params", b.ClassParams},
	} {
		for _, r := range group.rows {
			if !slices.Contains(sheets.QuantityUnits, r.Unit) {
				p = append(p, fmt.Sprintf("%s %s: unit %q is not a quantity unit", group.sheet, r.ID, r.Unit))
			}
		}
	}
	measures := sheets.Lookup(b.Measures)
	for _, r := range b.Rules {
		if (r.Measure == "") != (r.AtLeast == 0) {
			p = append(p, fmt.Sprintf("tags.rules %s: measure and atLeast come together", r.ID))
		}
		if m, ok := measures[r.Measure]; ok && !slices.Contains(sheets.QuantityUnits, m.Unit) {
			p = append(p, fmt.Sprintf("tags.rules %s: measure %s has no quantity unit", r.ID, r.Measure))
		}
	}
	return p
}

func budgetProblems(b *sheets.Book) []string {
	var p []string
	budget := map[int64]int64{}
	var prev sheets.Tier
	for i, t := range b.Tiers {
		budget[t.Tier] = t.Budget
		if i > 0 && (t.Tier != prev.Tier+1 || t.Budget <= prev.Budget || t.LevelCap <= prev.LevelCap) {
			p = append(p, fmt.Sprintf("items.tiers %s: tiers must count up with rising budgets and caps", t.ID))
		}
		prev = t
	}
	for _, m := range b.Materials {
		bud, ok := budget[m.Tier]
		if !ok {
			p = append(p, fmt.Sprintf("items.materials %s: no tier %d", m.ID, m.Tier))
			continue
		}
		v := m.Vector
		if total := v.Edge + v.Weight + v.Flex + v.Conduct + v.Heat + v.Ward + v.Reach + v.Bond; total > bud {
			p = append(p, fmt.Sprintf("items.materials %s: %d pts over its tier budget of %d pts", m.ID, total, bud))
		}
	}
	for i := 1; i < len(b.OddsBands); i++ {
		a, c := b.OddsBands[i-1], b.OddsBands[i]
		if c.Rank != a.Rank+1 || c.Chance <= a.Chance {
			p = append(p, fmt.Sprintf("fights.odds-bands %s: bands must rise by one rank and in chance", c.ID))
		}
	}
	gauges := sheets.Lookup(b.Gauges)
	for _, l := range b.GaugeLines {
		if g, ok := gauges[l.Gauge]; ok && (l.AtLeast > g.Max || l.ClearsAt > l.AtLeast) {
			p = append(p, fmt.Sprintf("world.gauge-lines %s: line outside its gauge, or clears above it", l.ID))
		}
	}
	for e := int64(0); e <= maxNoise(b, "elevation"); e++ {
		covered := false
		for _, bb := range b.Biomes {
			if e >= bb.ElevationMin && e <= bb.ElevationMax && bb.MoistureMin == 0 && bb.MoistureMax == maxNoise(b, "moisture") {
				covered = true
			}
		}
		if !covered {
			p = append(p, fmt.Sprintf("map.biomes: elevation %d has no band covering every moisture", e))
			break
		}
	}
	return p
}

func maxNoise(b *sheets.Book, id string) int64 {
	for _, n := range b.Noise {
		if n.ID == id {
			return n.Max
		}
	}
	return 0
}

func ruleProblems(b *sheets.Book) []string {
	if _, err := tags.Compile(b.Rules); err != nil {
		return splitErr(err)
	}
	return nil
}

// Shown things the setting must name.
var namedSheets = []string{
	"items.materials", "items.processes", "creatures.archetypes", "factions.archetypes",
	"map.terrain", "items.traits", "items.slots", "world.weather", "world.gauges",
	"puzzles.families",
}

func packProblems(b *sheets.Book) []string {
	named := map[string]bool{}
	for _, n := range b.Names {
		named[n.Ref] = true
	}
	var p []string
	for _, s := range namedSheets {
		for _, id := range b.IDs(s) {
			if !named[s+":"+id] {
				p = append(p, fmt.Sprintf("pack.names: nothing names %s:%s", s, id))
			}
		}
	}
	lists := map[string]int{}
	for _, np := range b.NameParts {
		lists[np.List]++
	}
	def, _ := sheets.DefByName("pack.name-parts")
	f, _ := def.Row.FieldByName("List")
	for _, l := range strings.Split(f.Tag.Get("enum"), "|") {
		if lists[l] == 0 {
			p = append(p, "pack.name-parts: list "+l+" is empty")
		}
	}
	layers := map[string]int{}
	for _, l := range b.BannerLayers {
		layers[l.Layer]++
	}
	for _, l := range []string{"field", "division", "ordinary", "charge"} {
		if layers[l] == 0 {
			p = append(p, "pack.banner-layers: no "+l+" layer")
		}
	}
	return p
}

// lintProblems runs the sim analyzers over sim/ from source.
func lintProblems(root string) []string {
	cfg := &packages.Config{Mode: packages.LoadAllSyntax, Dir: root, Tests: false}
	pkgs, err := packages.Load(cfg, "./sim/...")
	if err != nil {
		return []string{err.Error()}
	}
	var p []string
	packages.Visit(pkgs, nil, func(pkg *packages.Package) {
		for _, e := range pkg.Errors {
			p = append(p, e.Error())
		}
	})
	if len(p) > 0 {
		return p
	}
	g, err := checker.Analyze(lint.Analyzers(), pkgs, nil)
	if err != nil {
		return []string{err.Error()}
	}
	for act := range g.All() {
		if act.Err != nil {
			p = append(p, act.Err.Error())
		}
		for _, d := range act.Diagnostics {
			pos := act.Package.Fset.Position(d.Pos)
			rel, _ := filepath.Rel(root, pos.Filename)
			p = append(p, fmt.Sprintf("%s:%d: %s", rel, pos.Line, d.Message))
		}
	}
	slices.Sort(p)
	return slices.Compact(p)
}
