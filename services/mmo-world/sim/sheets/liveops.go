package sheets

import (
	"slices"
	"strconv"
)

// Rows for a server's staging (GDD 14.3, 14.4): what each template is and
// costs, what crates, prizes and hauls roll, and the contests a board runs.

// StageTemplate is one thing a server's staff or admins may stage.
type StageTemplate struct {
	ID       string   `json:"id" unit:"id"`
	Kind     string   `json:"kind" unit:"enum" enum:"contest|hardship|drop|hunt|fair|vault|pattern"`
	Points   int64    `json:"points" unit:"event-points" min:"0" doc:"What staff pay from the pool; admins pay nothing."`
	Staff    bool     `json:"staff,omitempty" unit:"flag" doc:"Staff may stage it."`
	Tier     int64    `json:"tier,omitempty" unit:"tier" min:"0"`
	Crates   int64    `json:"crates,omitempty" unit:"count" min:"0"`
	Table    string   `json:"table,omitempty" unit:"id" doc:"The liveops.drops table its crates, prizes or haul roll."`
	Trouble  string   `json:"trouble,omitempty" unit:"ref" ref:"story.troubles"`
	Family   string   `json:"family,omitempty" unit:"ref" ref:"puzzles.families"`
	Level    int64    `json:"level,omitempty" unit:"level" min:"0"`
	Patterns []string `json:"patterns,omitempty" unit:"refs" ref:"story.pattern-puzzles"`
	Days     int64    `json:"days" unit:"days" min:"1"`
	Note     string   `json:"note" unit:"text"`
}

// The template kinds.
const (
	StageContest  = "contest"
	StageHardship = "hardship"
	StageDrop     = "drop"
	StageHunt     = "hunt"
	StageFair     = "fair"
	StageVault    = "vault"
	StagePattern  = "pattern"
)

// DropRow is one line of a drop table: a crate, a prize or a haul rolls one
// line by weight, then a quantity from min to max.
type DropRow struct {
	ID       string `json:"id" unit:"id"`
	Table    string `json:"table" unit:"id"`
	Material string `json:"material" unit:"ref" ref:"items.materials"`
	Weight   int64  `json:"weight" unit:"weight" min:"1"`
	Min      int64  `json:"min" unit:"goods" min:"1"`
	Max      int64  `json:"max" unit:"goods" min:"1"`
}

// ContestRow is a contest's condition, posted as an Each goal (GDD 14.3).
type ContestRow struct {
	ID     string `json:"id" unit:"id"`
	Verb   string `json:"verb" unit:"enum" enum:"defeat|make|reach"`
	Count  int64  `json:"count" unit:"count" min:"1"`
	Target string `json:"target" unit:"text" doc:"defeat: a creatures.archetypes id; make: a tags.vocabulary tag; reach: a distance in tiles from the settlement."`
	Most   int64  `json:"most" unit:"count" min:"1" doc:"Winners, at most goals.params each-cap."`
	Prize  string `json:"prize" unit:"id" doc:"The liveops.drops table each winner rolls."`
	Fair   bool   `json:"fair,omitempty" unit:"flag" doc:"A fair runs it."`
	Days   int64  `json:"days" unit:"days" min:"1"`
	Note   string `json:"note" unit:"text"`
}

// The contest verbs, as goal conditions name them.
const (
	ContestDefeat = "defeat"
	ContestMake   = "make"
	ContestReach  = "reach"
)

// DropTable is a drop table's lines, in sheet order.
func (b *Book) DropTable(table string) []DropRow {
	var out []DropRow
	for _, d := range b.LiveOpsDrops {
		if d.Table == table {
			out = append(out, d)
		}
	}
	return out
}

// FairContests are the contests a fair runs, in sheet order.
func (b *Book) FairContests() []ContestRow {
	var out []ContestRow
	for _, c := range b.LiveOpsContests {
		if c.Fair {
			out = append(out, c)
		}
	}
	return out
}

// ReachTiles is a reach contest's distance in tiles.
func (c ContestRow) ReachTiles() (int64, bool) {
	n, err := strconv.ParseInt(c.Target, base10, bitSize)
	return n, err == nil && n > 0
}

// liveopsProblems holds the staging sheets to each other and to the sheets
// they name.
func (b *Book) liveopsProblems() []string {
	var p []string
	tables := map[string]bool{}
	for _, d := range b.LiveOpsDrops {
		tables[d.Table] = true
		at := "liveops.drops " + d.ID
		if d.Material == TagProvisions {
			p = append(p, at+": a drop is goods, never provisions")
		}
		if d.Min > d.Max {
			p = append(p, at+": min lies over max")
		}
	}
	table := func(at, t string) {
		if !tables[t] {
			p = append(p, at+": no liveops.drops table "+strconv.Quote(t))
		}
	}

	tiers := map[int64]bool{}
	for _, t := range b.FightTiers {
		tiers[t.Tier] = true
	}
	floors := map[string]bool{}
	for _, d := range b.Dungeons {
		for _, f := range d.Families {
			floors[f] = true
		}
	}
	laid := map[string]bool{}
	for _, pp := range b.PatternPuzzles {
		laid[pp.ID] = pp.Shape != ""
	}
	needs := func(at string, set bool, what string) {
		if !set {
			p = append(p, at+": needs "+what)
		}
	}
	never := func(at string, set bool, what string) {
		if set {
			p = append(p, at+": takes no "+what)
		}
	}
	for _, t := range b.LiveOpsTemplates {
		at := "liveops.templates " + t.ID
		if t.Table != "" {
			table(at, t.Table)
		}
		crates := t.Kind == StageDrop || t.Kind == StageFair
		rolls := crates || t.Kind == StageHardship || t.Kind == StageVault || t.Kind == StagePattern
		needs(at, !crates || t.Crates > 0, "crates")
		never(at, !crates && t.Crates != 0, "crates")
		needs(at, !rolls || t.Table != "", "a table")
		never(at, !rolls && t.Table != "", "table")
		needs(at, t.Kind != StageHunt || t.Tier > 0, "a tier")
		never(at, t.Kind != StageHunt && t.Tier != 0, "tier")
		if t.Kind == StageHunt && t.Tier > 0 && !tiers[t.Tier] {
			p = append(p, at+": tier "+strconv.FormatInt(t.Tier, base10)+" is not in fights.tiers")
		}
		needs(at, t.Kind != StageHardship || t.Trouble != "", "a trouble")
		never(at, t.Kind != StageHardship && t.Trouble != "", "trouble")
		needs(at, t.Kind != StageVault || t.Family != "" && t.Level > 0, "a family and a level")
		never(at, t.Kind != StageVault && (t.Family != "" || t.Level != 0), "family or level")
		if t.Kind == StageVault && t.Family != "" && !floors[t.Family] {
			p = append(p, at+": "+t.Family+" is not a family any map.dungeons floor uses")
		}
		needs(at, t.Kind != StagePattern || len(t.Patterns) > 0, "patterns")
		never(at, t.Kind != StagePattern && len(t.Patterns) > 0, "patterns")
		for _, pp := range t.Patterns {
			if shaped, known := laid[pp]; known && !shaped {
				p = append(p, at+": "+pp+" is a scaffold pattern; a staged one is laid by its shape")
			}
		}
		if t.Kind == StagePattern && t.Staff {
			p = append(p, at+": a pattern is staged by admins only")
		}
		if !t.Staff && t.Points != 0 {
			p = append(p, at+": only a template staff may stage costs points")
		}
	}

	eachCap, okCap := int64(0), false
	for _, r := range b.GoalParams {
		if r.ID == "each-cap" {
			eachCap, okCap = r.Value.Floor(), true
		}
	}
	if !okCap && len(b.LiveOpsContests) > 0 {
		p = append(p, "goals.params: no each-cap")
	}
	creatures := holds(b.Creatures)
	vocab := holds(b.Vocabulary)
	fairs := 0
	for _, c := range b.LiveOpsContests {
		at := "liveops.contests " + c.ID
		table(at, c.Prize)
		if okCap && c.Most > eachCap {
			p = append(p, at+": most is above goals.params each-cap")
		}
		if c.Fair {
			fairs++
		}
		switch c.Verb {
		case ContestDefeat:
			if !creatures(c.Target) {
				p = append(p, at+": "+strconv.Quote(c.Target)+" is not an id in creatures.archetypes")
			}
		case ContestMake:
			if !vocab(c.Target) || c.Target == TagProvisions {
				p = append(p, at+": "+strconv.Quote(c.Target)+" is not a tag a made thing holds")
			}
		case ContestReach:
			if _, ok := c.ReachTiles(); !ok {
				p = append(p, at+": "+strconv.Quote(c.Target)+" is not a distance in tiles")
			}
		}
	}
	if slices.ContainsFunc(b.LiveOpsTemplates, func(t StageTemplate) bool { return t.Kind == StageFair }) && fairs == 0 {
		p = append(p, "liveops.contests: a fair runs at least one contest")
	}
	return p
}
