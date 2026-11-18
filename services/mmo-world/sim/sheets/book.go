// Package sheets holds every tuning number the sim reads. A sheet is a JSON
// file of rows with stable ids, one Go row type per sheet, one JSON Schema
// per sheet generated from that type, and a unit on every column.
//
// The sim never reads files: the harness or the world service hands Load
// the bytes, and Load decodes them with unknown fields refused.
package sheets

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

// Book is every sheet, one field each. The struct tag names the sheet and
// says what it is; the area is the part before the dot.
type Book struct {
	Targets []Target `sheet:"meta.targets" doc:"The targets the Report run measures (GDD 18.3)."`

	Axes       []Axis      `sheet:"items.axes" doc:"The eight affinity axes, in vector order."`
	Materials  []Material  `sheet:"items.materials" doc:"Base materials and their authored vectors."`
	Tiers      []Tier      `sheet:"items.tiers" doc:"Budgets, level caps and blade durability by tier."`
	Processes  []Process   `sheet:"items.processes" doc:"The six processes, their stations and trait tables."`
	Methods    []Method    `sheet:"items.methods" doc:"Each process's methods and how they tilt the result."`
	Slots      []Slot      `sheet:"items.slots" doc:"Shape templates."`
	Traits     []Trait     `sheet:"items.traits" doc:"Traits and the tag each gives."`
	AxisTags   []AxisTag   `sheet:"items.axis-tags" doc:"Tags an item gains from a high axis."`
	Resonance  []Resonance `sheet:"items.resonance" doc:"Traits that appear when bound components cross thresholds together."`
	ItemParams []Param     `sheet:"items.params" doc:"Loose cells for derivation."`

	LevelCurve   []LevelStep `sheet:"growth.level-curve" doc:"Derived from growth.params; never edited by hand."`
	XPByDeed     []DeedXP    `sheet:"growth.xp-by-deed" doc:"Experience for each deed that matters."`
	GrowthParams []Param     `sheet:"growth.params" doc:"Level curve shape, practice, maturity."`

	OddsBands   []OddsBand `sheet:"fights.odds-bands" doc:"The six odds bands (GDD 2.3)."`
	FightParams []Param    `sheet:"fights.params" doc:"Loose cells for encounters."`

	Durability []Durability `sheet:"wear.durability" doc:"Durability by slot and tier."`
	WearParams []Param      `sheet:"wear.params" doc:"Repair and salvage rates."`

	Gauges      []Gauge       `sheet:"world.gauges" doc:"The five region gauges."`
	GaugeLines  []GaugeLine   `sheet:"world.gauge-lines" doc:"Thresholds that change what a region does."`
	Weather     []WeatherKind `sheet:"world.weather" doc:"Weather system kinds."`
	WorldParams []Param       `sheet:"world.params" doc:"Loose cells for the world tick."`

	Archetypes    []Archetype  `sheet:"factions.archetypes" doc:"Faction archetypes, what they buy and tend to do."`
	Moves         []Move       `sheet:"factions.moves" doc:"The daily moves a faction can score."`
	MoveWeights   []MoveWeight `sheet:"factions.move-weights" doc:"How each archetype scores each move."`
	FactionParams []Param      `sheet:"factions.params" doc:"Loose cells for factions."`

	FactWeights []FactWeight `sheet:"story.fact-weights" doc:"Weight of each fact kind, 0 to 100."`
	StoryParams []Param      `sheet:"story.params" doc:"Pacing, deadlines, the chronicle's cut-off."`

	EconomyParams []Param `sheet:"economy.params" doc:"Fees, the faucet, the stabiliser, limits."`

	GoalParams []Param `sheet:"goals.params" doc:"Listing fees, limits, thresholds."`

	Traces []Trace `sheet:"emergence.traces" doc:"Trace decay and promotion lines."`

	LiveOpsParams []Param `sheet:"liveops.params" doc:"Pool cap and refill, prices, the staged xp allowance."`

	Vocabulary []Vocab   `sheet:"tags.vocabulary" doc:"Every tag."`
	Measures   []Measure `sheet:"tags.measures" doc:"Numbers a rule can test or scale."`
	Rules      []RuleRow `sheet:"tags.rules" doc:"The rules, in the order they are tried."`

	Terrain       []Terrain      `sheet:"map.terrain" doc:"Terrain kinds: travel, sight, cover."`
	Biomes        []BiomeBand    `sheet:"map.biomes" doc:"Which terrain an elevation and moisture make."`
	Noise         []NoiseLayer   `sheet:"map.noise" doc:"The noise layers generation reads."`
	BiomeVariants []BiomeVariant `sheet:"map.biome-variants" doc:"Biomes that appear only past a distance."`
	Ecotones      []Ecotone      `sheet:"map.ecotones" doc:"What the fade between two land biomes holds."`
	RegionWeights []RegionWeight `sheet:"map.region-weights" doc:"Size classes of region centres and their shares."`
	Shapes        []Shape        `sheet:"map.shapes" doc:"The shapes patterns are laid in."`
	Patterns      []PatternRule  `sheet:"map.patterns" doc:"Patterns: shapes laid on the map before noise, with things on their points."`
	MapParams     []Param        `sheet:"map.params" doc:"Loose cells for generation."`

	TileCounters []TileCounter `sheet:"tiles.counters" doc:"Decay per tile counter."`
	FindRarities []FindRarity  `sheet:"tiles.find-rarities" doc:"Rarity of a trigger's find."`

	Creatures        []Creature        `sheet:"creatures.archetypes" doc:"Creature archetypes: tier, biomes, tags, drops."`
	CreatureVariants []CreatureVariant `sheet:"creatures.variants" doc:"Keyed tags that make a creature variant, by distance."`
	CreatureParams   []Param           `sheet:"creatures.params" doc:"Breeding, pressure, migration."`

	StructureCosts   []StructureCost `sheet:"settlements.structure-costs" doc:"What each structure costs per tier."`
	GuildWorks       []GuildWork     `sheet:"settlements.guild-works" doc:"What each guild work consumes."`
	SettlementParams []Param         `sheet:"settlements.params" doc:"Charter and city requirements."`

	MountSpeeds []MountSpeed `sheet:"mounts.speeds" doc:"Mount speed by terrain."`
	MountParams []Param      `sheet:"mounts.params" doc:"Load and upkeep."`

	Classes     []Class `sheet:"classes.classes" doc:"Classes and what unlocks them."`
	ClassParams []Param `sheet:"classes.params" doc:"Class levels and ability magnitudes."`

	PuzzleFamilies []PuzzleFamily `sheet:"puzzles.families" doc:"Machine puzzle families and where each appears."`
	Haywires       []Haywire      `sheet:"puzzles.haywire" doc:"What a machine does when its countdown runs out."`
	PuzzlePractice []PracticeGift `sheet:"puzzles.practice" doc:"What each level of a family's practice buys."`
	PuzzleParams   []Param        `sheet:"puzzles.params" doc:"Countdown scaling, practice gains, mastery, rewards, the solve model."`

	Names        []Name        `sheet:"pack.names" doc:"What the setting calls each thing."`
	NameParts    []NamePart    `sheet:"pack.name-parts" doc:"Pieces generated names are built from."`
	BannerLayers []BannerLayer `sheet:"pack.banner-layers" doc:"SVG layers banners are composed from."`
	Palette      []Palette     `sheet:"pack.palette" doc:"Banner colours and the tags that favour them."`
}

// Def describes one sheet.
type Def struct {
	Name  string
	Area  string
	Doc   string
	Row   reflect.Type
	field int
}

// Defs lists every sheet in Book order.
func Defs() []Def {
	t := reflect.TypeFor[Book]()
	out := make([]Def, 0, t.NumField())
	for i := range t.NumField() {
		f := t.Field(i)
		name := f.Tag.Get("sheet")
		area, _, _ := strings.Cut(name, ".")
		out = append(out, Def{Name: name, Area: area, Doc: f.Tag.Get("doc"), Row: f.Type.Elem(), field: i})
	}
	return out
}

// DefByName finds a sheet's definition.
func DefByName(name string) (Def, bool) {
	for _, d := range Defs() {
		if d.Name == name {
			return d, true
		}
	}
	return Def{}, false
}

// File is one sheet file's bytes and where it came from.
type File struct {
	Path string
	Data []byte
}

type envelope struct {
	Schema string          `json:"$schema"`
	Sheet  string          `json:"sheet"`
	Rows   json.RawMessage `json:"rows"`
}

// Load decodes every file into one Book and checks what a loader can:
// unknown sheets and fields, duplicate and malformed ids, ranges, enums
// and references. Several files may hold rows of one sheet.
func Load(files []File) (*Book, error) {
	var b Book
	var errs []error
	bv := reflect.ValueOf(&b).Elem()
	for _, f := range files {
		var env envelope
		dec := json.NewDecoder(bytes.NewReader(f.Data))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&env); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", f.Path, err))
			continue
		}
		def, ok := DefByName(env.Sheet)
		if !ok {
			errs = append(errs, fmt.Errorf("%s: unknown sheet %q", f.Path, env.Sheet))
			continue
		}
		rows := reflect.New(reflect.SliceOf(def.Row))
		rd := json.NewDecoder(bytes.NewReader(env.Rows))
		rd.DisallowUnknownFields()
		if err := rd.Decode(rows.Interface()); err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", f.Path, err))
			continue
		}
		dst := bv.Field(def.field)
		dst.Set(reflect.AppendSlice(dst, rows.Elem()))
	}
	if len(errs) > 0 {
		return nil, errors.Join(errs...)
	}
	if err := b.Validate(); err != nil {
		return nil, err
	}
	return &b, nil
}

var idPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// Rows returns a sheet's rows as reflect values.
func (b *Book) rows(d Def) reflect.Value { return reflect.ValueOf(b).Elem().Field(d.field) }

// IDs returns every id in a sheet, in row order.
func (b *Book) IDs(sheet string) []string {
	d, ok := DefByName(sheet)
	if !ok {
		return nil
	}
	rs := b.rows(d)
	out := make([]string, rs.Len())
	for i := range out {
		out[i] = rs.Index(i).FieldByName("ID").String()
	}
	return out
}

// Validate checks ids, ranges, enums and references across the book.
func (b *Book) Validate() error {
	var errs []error
	ids := map[string][]string{}
	for _, d := range Defs() {
		list := b.IDs(d.Name)
		sorted := slices.Clone(list)
		slices.Sort(sorted)
		for i, id := range sorted {
			if !idPattern.MatchString(id) {
				errs = append(errs, fmt.Errorf("%s: id %q is not lower-case words joined by dashes", d.Name, id))
			}
			if i > 0 && sorted[i-1] == id {
				errs = append(errs, fmt.Errorf("%s: duplicate id %q", d.Name, id))
			}
		}
		ids[d.Name] = sorted
	}
	has := func(sheet, id string) bool {
		_, ok := slices.BinarySearch(ids[sheet], id)
		return ok
	}
	for _, d := range Defs() {
		rs := b.rows(d)
		for i := range rs.Len() {
			row := rs.Index(i)
			where := d.Name + " " + row.FieldByName("ID").String()
			errs = append(errs, checkValue(row, where, has)...)
		}
	}
	return errors.Join(errs...)
}

func checkValue(v reflect.Value, where string, has func(sheet, id string) bool) []error {
	var errs []error
	t := v.Type()
	for i := range t.NumField() {
		f := t.Field(i)
		fv := v.Field(i)
		at := where + "." + jsonName(f)
		switch fv.Kind() {
		case reflect.Struct:
			if f.Type.NumMethod() == 0 && f.Type.PkgPath() == t.PkgPath() {
				errs = append(errs, checkValue(fv, at, has)...)
				continue
			}
		case reflect.Slice:
			if f.Type.Elem().Kind() == reflect.Struct {
				for j := range fv.Len() {
					errs = append(errs, checkValue(fv.Index(j), at+"["+strconv.Itoa(j)+"]", has)...)
				}
				continue
			}
		}
		errs = append(errs, checkCell(f, fv, at, has)...)
	}
	return errs
}

func checkCell(f reflect.StructField, v reflect.Value, at string, has func(sheet, id string) bool) []error {
	var errs []error
	var strs []string
	switch v.Kind() {
	case reflect.String:
		if v.String() != "" {
			strs = []string{v.String()}
		}
	case reflect.Slice:
		if v.Type().Elem().Kind() == reflect.String {
			strs = v.Interface().([]string)
		}
	case reflect.Int64:
		n := v.Int()
		if lo, ok := f.Tag.Lookup("min"); ok && n < bound(lo, v) {
			errs = append(errs, fmt.Errorf("%s: %s is below %s", at, cellString(v), lo))
		}
		if hi, ok := f.Tag.Lookup("max"); ok && n > bound(hi, v) {
			errs = append(errs, fmt.Errorf("%s: %s is above %s", at, cellString(v), hi))
		}
	}
	enum := f.Tag.Get("enum")
	if enum == "quantity" {
		enum = strings.Join(QuantityUnits, "|")
	}
	for _, s := range strs {
		if enum != "" && !slices.Contains(strings.Split(enum, "|"), s) {
			errs = append(errs, fmt.Errorf("%s: %q is not one of %s", at, s, enum))
		}
		switch ref := f.Tag.Get("ref"); ref {
		case "":
		case "*":
			sheet, id, ok := strings.Cut(s, ":")
			if !ok || !has(sheet, id) {
				errs = append(errs, fmt.Errorf("%s: %q does not resolve to a row", at, s))
			}
		default:
			if !has(ref, s) {
				errs = append(errs, fmt.Errorf("%s: %q is not an id in %s", at, s, ref))
			}
		}
	}
	return errs
}

// bound reads a min or max tag in the column's own representation, so a
// fixed-point column's "1" means 1.0.
func bound(tag string, v reflect.Value) int64 {
	if v.Type() == fixedType {
		f, err := parseFixed(tag)
		if err != nil {
			panic(fmt.Sprintf("sheets: bad bound %q", tag))
		}
		return int64(f)
	}
	n, err := strconv.ParseInt(tag, base10, bitSize)
	if err != nil {
		panic(fmt.Sprintf("sheets: bad bound %q", tag))
	}
	return n
}

func cellString(v reflect.Value) string {
	if s, ok := v.Interface().(fmt.Stringer); ok {
		return s.String()
	}
	return strconv.FormatInt(v.Int(), base10)
}

func jsonName(f reflect.StructField) string {
	name, _, _ := strings.Cut(f.Tag.Get("json"), ",")
	if name == "" {
		return f.Name
	}
	return name
}

// JSONName is the column's name in the sheet file.
func JSONName(f reflect.StructField) string { return jsonName(f) }

// structural: decimal parsing.
const (
	base10  = 10
	bitSize = 64
)
