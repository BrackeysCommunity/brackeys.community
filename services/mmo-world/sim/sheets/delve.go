package sheets

import (
	"maps"
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/fixed"
)

// Rows for dungeons, forks and the machines several hands play
// (GDD 4.9, 7.11).

// DungeonKind is one kind of dungeon: the place that stands it, how deep
// it runs, the tags on its floors, what lives there and what machines
// guard its forks. Its guardian is the fights.hunts row whose kind names
// it.
type DungeonKind struct {
	ID        string   `json:"id" unit:"id"`
	Place     string   `json:"place" unit:"enum" enum:"dungeon|relay" doc:"The pattern place that stands one."`
	Share     int64    `json:"share" unit:"percent" min:"0" max:"100" doc:"Its share of the dungeons that place stands, drawn under dungeon.kind."`
	FloorsMin int64    `json:"floorsMin" unit:"count" min:"1" doc:"map.depths' draw is held to this and floorsMax."`
	FloorsMax int64    `json:"floorsMax" unit:"count" min:"1"`
	Up        bool     `json:"up,omitempty" unit:"flag" doc:"Its floors go up: a card says level, not floor; the rules are the same."`
	Tags      []string `json:"tags" unit:"tags" ref:"tags.vocabulary" doc:"Site tags on every floor."`
	Creatures []string `json:"creatures" unit:"refs" ref:"creatures.archetypes" doc:"What its floors draw from at the stepped tier; a tier with none here draws from the tier's archetypes."`
	Families  []string `json:"families" unit:"refs" ref:"puzzles.families" doc:"What a fork machine is drawn from."`
	Note      string   `json:"note,omitempty" unit:"text"`
}

// Fork is one way down from a fork: the tags it adds to the floor below.
// The pack names it.
type Fork struct {
	ID     string   `json:"id" unit:"id"`
	Kinds  []string `json:"kinds" unit:"refs" ref:"map.dungeons" doc:"The dungeon kinds whose forks offer it."`
	Tags   []string `json:"tags" unit:"tags" ref:"tags.vocabulary" doc:"One to three tags the floor it leads to gains."`
	Weight int64    `json:"weight" unit:"weight" min:"1" max:"100" doc:"How often it is drawn against the kind's other ways."`
	Note   string   `json:"note,omitempty" unit:"text"`
}

// Depth weights how many floors a dungeon runs to, by its entrance's seed
// tier. A row holds from its tier up to the next row's.
type Depth struct {
	ID      string        `json:"id" unit:"id"`
	Tier    int64         `json:"tier" unit:"tier" min:"1"`
	Weights []FloorWeight `json:"weights" unit:"parts" doc:"Each floor count's weight, drawn under dungeon.floors."`
	Note    string        `json:"note,omitempty" unit:"text"`
}

// FloorWeight is one floor count's weight in a Depth.
type FloorWeight struct {
	Floors int64 `json:"floors" unit:"count" min:"1"`
	Weight int64 `json:"weight" unit:"weight" min:"0" max:"100"`
}

// PartyVersion is a family played by several hands on one machine
// (GDD 7.11). The pack names it.
type PartyVersion struct {
	ID        string `json:"id" unit:"id"`
	Family    string `json:"family,omitempty" unit:"ref" ref:"puzzles.families" doc:"Empty: any family (two contexts racing for one machine)."`
	SizeBy    string `json:"sizeBy" unit:"enum" enum:"family|fixed|seats" doc:"family: the family's size at the level; fixed: size; seats: the family's size times the seats."`
	Size      int64  `json:"size,omitempty" unit:"count" min:"0" doc:"fixed: the machine's size."`
	Extra     int64  `json:"extra,omitempty" unit:"count" min:"0" doc:"Size added per seat past two."`
	Decoys    int64  `json:"decoys,omitempty" unit:"count" min:"0" doc:"Decoys added per seat past two."`
	Window    int64  `json:"window,omitempty" unit:"ms" min:"0" doc:"How close together moves of different seats must land."`
	Pass      int64  `json:"pass,omitempty" unit:"count" min:"0" doc:"Progress, in the version's own steps, before the roles pass on; a version on the clock counts milliseconds. 0: the roles never pass."`
	Countdown int64  `json:"countdown" unit:"percent" min:"1" doc:"Of the family's solo countdown."`
	Weight    int64  `json:"weight" unit:"weight" min:"0" max:"100" doc:"Against the family's other versions, drawn under puzzle.party-version; 0 is never drawn."`
	Deals     string `json:"deals" unit:"enum" enum:"whole|split" doc:"whole: every seat sees the machine; split: each seat is dealt its part."`
	Rate      int64  `json:"rate" unit:"percent" min:"0" doc:"Solve rate a seat past the first adds, from the version's own solver."`
	Note      string `json:"note,omitempty" unit:"text" doc:"Why the value is what it is; \"provisional\" marks a value the GDD does not give yet."`
}

// PuzzleShape is one look a family's machine can take (GDD 7.11). Shape 0
// is the family's first look; the pack names each.
type PuzzleShape struct {
	ID       string `json:"id" unit:"id"`
	Family   string `json:"family" unit:"ref" ref:"puzzles.families"`
	Shape    int64  `json:"shape" unit:"count" min:"0"`
	Weight   int64  `json:"weight" unit:"weight" min:"0" max:"100" doc:"Against the family's other shapes at the level, drawn under puzzle.shape."`
	MinLevel int64  `json:"minLevel" unit:"level" min:"1" doc:"The lowest level it is drawn at."`
	Range    int64  `json:"range,omitempty" unit:"count" min:"0" doc:"0: the family's."`
	PhoneMax int64  `json:"phoneMax,omitempty" unit:"count" min:"0" doc:"0: the family's."`
	Note     string `json:"note,omitempty" unit:"text"`
}

// GuardianOf is the fights.hunts row that guards a dungeon kind's bottom.
func GuardianOf(hunts []Hunt, kind string) (*Hunt, bool) {
	for i := range hunts {
		if hunts[i].Kind == kind {
			return &hunts[i], true
		}
	}
	return nil, false
}

// DepthAt is the map.depths row that holds at a seed tier: the one with
// the highest tier at or under it.
func DepthAt(depths []Depth, tier int64) (*Depth, bool) {
	var out *Depth
	for i := range depths {
		if d := &depths[i]; d.Tier <= tier && (out == nil || d.Tier > out.Tier) {
			out = d
		}
	}
	return out, out != nil
}

// ChoiceParam is a choice cell's choice: its value indexes its choices.
func ChoiceParam(rows []Param, id string) string {
	for _, r := range rows {
		if r.ID == id {
			n := IntParam(rows, id)
			if n < 0 || n >= int64(len(r.Choices)) {
				panic("sheets: param " + id + " is not one of its choices")
			}
			return r.Choices[n]
		}
	}
	panic("sheets: no param " + id)
}

// delveProblems checks what a column tag cannot: the shapes of the new
// sheets and the cross-sheet links between dungeons, forks and hunts.
func (b *Book) delveProblems() []string {
	var p []string
	for _, d := range Defs() {
		rows, ok := b.Params(d)
		if !ok {
			continue
		}
		for _, r := range rows {
			if len(r.Choices) == 0 {
				continue
			}
			if n := r.Value.Floor(); r.Value != fixed.FromInt(n) || n < 0 || n >= int64(len(r.Choices)) {
				p = append(p, d.Name+" "+r.ID+": the value indexes none of its choices")
			}
		}
	}
	shares := map[string]int64{}
	for _, k := range b.Dungeons {
		shares[k.Place] += k.Share
		if k.FloorsMax < k.FloorsMin {
			p = append(p, "map.dungeons "+k.ID+": floorsMax under floorsMin")
		}
		if _, ok := GuardianOf(b.Hunts, k.ID); !ok {
			p = append(p, "map.dungeons "+k.ID+": no fights.hunts row guards it")
		}
		ways := 0
		for _, f := range b.Forks {
			if slices.Contains(f.Kinds, k.ID) {
				ways++
			}
		}
		if ways < forkWays {
			p = append(p, "map.dungeons "+k.ID+": fewer than "+strconv.Itoa(forkWays)+" map.forks rows offer it")
		}
	}
	for _, place := range slices.Sorted(maps.Keys(shares)) {
		if shares[place] != percent {
			p = append(p, "map.dungeons: the "+place+" kinds' shares do not sum to 100")
		}
	}
	for _, f := range b.Forks {
		if len(f.Tags) < 1 || len(f.Tags) > forkTagsMax {
			p = append(p, "map.forks "+f.ID+": a way holds one to three tags")
		}
	}
	guarded := map[string]int{}
	for _, h := range b.Hunts {
		if h.Kind != "" {
			guarded[h.Kind]++
		}
		for i, m := range h.Marks {
			if m <= 0 || m >= percent || (i > 0 && m >= h.Marks[i-1]) {
				p = append(p, "fights.hunts "+h.ID+": marks fall from under 100 to over 0")
				break
			}
		}
		if len(h.Marks) > 0 && h.Family == "" {
			p = append(p, "fights.hunts "+h.ID+": marks need a family")
		}
		if (h.SpawnChance == 0) != (h.SpawnLine == 0) {
			p = append(p, "fights.hunts "+h.ID+": spawnChance and spawnLine come together")
		}
	}
	for _, kind := range slices.Sorted(maps.Keys(guarded)) {
		if guarded[kind] > 1 {
			p = append(p, "fights.hunts: more than one row guards "+kind)
		}
	}
	for _, d := range b.Depths {
		for i, w := range d.Weights {
			if i > 0 && w.Floors != d.Weights[i-1].Floors+1 {
				p = append(p, "map.depths "+d.ID+": floor counts run up by one")
				break
			}
		}
	}
	shapes := map[string]map[int64]bool{}
	for _, s := range b.PuzzleShapes {
		if shapes[s.Family] == nil {
			shapes[s.Family] = map[int64]bool{}
		}
		if shapes[s.Family][s.Shape] {
			p = append(p, "puzzles.shapes "+s.ID+": a second row for its family's shape")
		}
		shapes[s.Family][s.Shape] = true
	}
	if len(b.PuzzleShapes) > 0 {
		for _, f := range b.PuzzleFamilies {
			if !shapes[f.ID][0] {
				p = append(p, "puzzles.shapes: no shape 0 for "+f.ID)
			}
		}
	}
	for _, v := range b.PartyVersions {
		if (v.SizeBy == "fixed") != (v.Size > 0) {
			p = append(p, "puzzles.party "+v.ID+": a size is fixed's, and fixed's alone")
		}
	}
	return p
}

// structural: a fork offers two ways and a hidden third, each of one to
// three tags; shares are out of a hundred.
const (
	forkWays    = 3
	forkTagsMax = 3
	percent     = 100
)
