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

	Axes       []Axis       `sheet:"items.axes" doc:"The eight affinity axes, in vector order."`
	Materials  []Material   `sheet:"items.materials" doc:"Base materials and their authored vectors."`
	Tiers      []Tier       `sheet:"items.tiers" doc:"Budgets, level caps and blade durability by tier."`
	Processes  []Process    `sheet:"items.processes" doc:"The six processes, their stations and trait tables."`
	Methods    []Method     `sheet:"items.methods" doc:"Each process's methods and how they tilt the result."`
	Slots      []Slot       `sheet:"items.slots" doc:"Shape templates."`
	Traits     []Trait      `sheet:"items.traits" doc:"Traits and the tag each gives."`
	AxisTags   []AxisTag    `sheet:"items.axis-tags" doc:"Tags an item gains from a high axis."`
	Resonance  []Resonance  `sheet:"items.resonance" doc:"Traits that appear when bound components cross thresholds together."`
	Compose    []ComposeRow `sheet:"items.compose" doc:"What an exploit's components set: the first one's state and target, later ones' traits. The first row a component matches counts."`
	Pairings   []Pairing    `sheet:"items.pairings" doc:"Tags that pair across equipped items and exploits, and the tag the pairing gives."`
	ItemParams []Param      `sheet:"items.params" doc:"Loose cells for derivation."`
	Starts     []Start      `sheet:"items.starts" doc:"The three things a new character can choose to have carried (GDD 3.1)."`

	LevelCurve    []LevelStep `sheet:"growth.level-curve" doc:"Derived from growth.params; never edited by hand."`
	XPByDeed      []DeedXP    `sheet:"growth.xp-by-deed" doc:"Experience for each deed that matters."`
	ExploitOffers []Offer     `sheet:"growth.exploit-offers" doc:"What an exploit's milestones offer besides its process's traits."`
	GrowthParams  []Param     `sheet:"growth.params" doc:"Level curve shape, practice, maturity."`

	OddsBands    []OddsBand    `sheet:"fights.odds-bands" doc:"The six odds bands (GDD 2.3)."`
	Margins      []MarginBand  `sheet:"fights.margins" doc:"Which band a margin falls in."`
	FightTiers   []FightTier   `sheet:"fights.tiers" doc:"Per creature tier: base difficulty, beats, hunt health, and the expected character the Battle run fields."`
	Beats        []BeatKind    `sheet:"fights.beats" doc:"The nine kinds of beat."`
	BeatTags     []BeatTag     `sheet:"fights.beat-tags" doc:"How a site's and a creature's tags choose its beats."`
	Options      []OptionRow   `sheet:"fights.options" doc:"Which options each tag offers, and what governs and risks each."`
	States       []StateRow    `sheet:"fights.states" doc:"The states that last for beats."`
	TraitEffects []TraitEffect `sheet:"fights.trait-effects" doc:"What a trait does that a band or score rule cannot say."`
	Hunts        []Hunt        `sheet:"fights.hunts" doc:"Hunts: a creature's health pool, window and spoils."`
	FightParams  []Param       `sheet:"fights.params" doc:"Loose cells for encounters, parties and delves."`

	Durability []Durability `sheet:"wear.durability" doc:"Durability by slot and tier."`
	WearParams []Param      `sheet:"wear.params" doc:"Repair and salvage rates."`

	Gauges      []Gauge          `sheet:"world.gauges" doc:"The five region gauges."`
	GaugeLines  []GaugeLine      `sheet:"world.gauge-lines" doc:"Thresholds that change what a region does."`
	Weather     []WeatherKind    `sheet:"world.weather" doc:"Weather system kinds and what each does on a tile."`
	WeatherForm []WeatherForm    `sheet:"world.weather-forms" doc:"Which weather kind forms where, by terrain and season."`
	Meetings    []WeatherMeeting `sheet:"world.weather-meetings" doc:"What two systems do when they meet."`
	Seasons     []Season         `sheet:"world.seasons" doc:"The seasons, in order; each has its own prevailing wind."`
	WorldParams []Param          `sheet:"world.params" doc:"Loose cells for the world tick."`

	NPCTraits []NPCTrait `sheet:"npcs.traits" doc:"Traits notables and other NPCs draw from."`
	NPCRoles  []NPCRole  `sheet:"npcs.roles" doc:"Role slots each place fills with residents, and the roles wanderers take."`
	Topics    []Topic    `sheet:"npcs.topics" doc:"What an NPC can bring up, when, and the choices it offers (GDD 4.18)."`
	Gossip    []Gossip   `sheet:"npcs.gossip" doc:"How a neighbour's memory is passed on, by its kind (GDD 4.18)."`
	NPCParams []Param    `sheet:"npcs.params" doc:"Memory, salience, routes, crowding and moving home."`

	Archetypes    []Archetype  `sheet:"factions.archetypes" doc:"Faction archetypes, what they buy and tend to do."`
	Moves         []Move       `sheet:"factions.moves" doc:"The daily moves a faction can score."`
	MoveWeights   []MoveWeight `sheet:"factions.move-weights" doc:"How each archetype scores each move."`
	FactionParams []Param      `sheet:"factions.params" doc:"Loose cells for factions."`

	FactWeights []FactWeight `sheet:"story.fact-weights" doc:"Weight of each fact kind, 0 to 100."`
	StoryParams []Param      `sheet:"story.params" doc:"Pacing, deadlines, the chronicle's cut-off."`

	EconomyParams []Param        `sheet:"economy.params" doc:"Fees, the faucet, the stabiliser, limits."`
	RefValues     []RefValue     `sheet:"economy.reference" doc:"Each tier's base value and median vector total (GDD 10.10)."`
	Standing      []StandingBand `sheet:"economy.standing" doc:"What standing does to a faction order's price (GDD 5.4)."`
	RouteRisks    []RouteRisk    `sheet:"economy.route-risk" doc:"Ambush chance per tile entered, by threat (GDD 10.7)."`

	GoalParams []Param `sheet:"goals.params" doc:"Listing fees, limits, thresholds."`
	Words      []Word  `sheet:"goals.words" doc:"Words a goal's title or note may not hold; operators hide what gets past them."`

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
	Landmarks     []Landmark     `sheet:"map.landmarks" doc:"Features a region's highest free tile can hold."`
	RegionWeights []RegionWeight `sheet:"map.region-weights" doc:"Size classes of region centres and their shares."`
	Shapes        []Shape        `sheet:"map.shapes" doc:"The shapes patterns are laid in."`
	Patterns      []PatternRule  `sheet:"map.patterns" doc:"Patterns: shapes laid on the map before noise, with things on their points."`
	MapParams     []Param        `sheet:"map.params" doc:"Loose cells for generation."`
	Dungeons      []DungeonKind  `sheet:"map.dungeons" doc:"Dungeon kinds: where each stands, how deep it runs, what lives and what machines stand in it (GDD 4.9)."`
	Forks         []Fork         `sheet:"map.forks" doc:"The ways down from a fork, and the tags each adds to the floor below (GDD 4.9)."`
	Depths        []Depth        `sheet:"map.depths" doc:"How many floors a dungeon runs to, by its entrance's seed tier."`

	TileCounters []TileCounter `sheet:"tiles.counters" doc:"Decay per tile counter."`
	FindRarities []FindRarity  `sheet:"tiles.find-rarities" doc:"Rarity of a trigger's find."`
	Triggers     []Trigger     `sheet:"tiles.triggers" doc:"What tile and character data set off, with chances and magnitudes (GDD 8.6)."`
	TileParams   []Param       `sheet:"tiles.params" doc:"Rings and limits on what a tile keeps."`

	Creatures        []Creature        `sheet:"creatures.archetypes" doc:"Creature archetypes: tier, biomes, tags, drops."`
	CreatureVariants []CreatureVariant `sheet:"creatures.variants" doc:"Keyed tags that make a creature variant, by distance."`
	CreatureParams   []Param           `sheet:"creatures.params" doc:"Breeding, pressure, migration."`

	Structures       []Structure         `sheet:"settlements.structures" doc:"The structures a settlement is made of: what each does and costs per tier (GDD 4.16)."`
	Starting         []StartingStructure `sheet:"settlements.starting" doc:"What a starting settlement opens with."`
	GuildWorks       []GuildWork         `sheet:"settlements.guild-works" doc:"What each guild work consumes and gives (GDD 4.14)."`
	SettlementParams []Param             `sheet:"settlements.params" doc:"Charter and city requirements."`

	MountKinds  []MountKind `sheet:"mounts.kinds" doc:"Mounts: tier, the terrains each suits, load."`
	MountOffers []Offer     `sheet:"mounts.offers" doc:"What a mount's milestones offer."`
	MountParams []Param     `sheet:"mounts.params" doc:"Load and upkeep."`

	Classes     []Class   `sheet:"classes.classes" doc:"Classes and what unlocks them (GDD 5.8)."`
	Abilities   []Ability `sheet:"classes.abilities" doc:"The seven trees: each ability, its tier and the rule it is (GDD 5.9)."`
	ClassParams []Param   `sheet:"classes.params" doc:"Class levels and how many may be active."`

	PuzzleFamilies []PuzzleFamily `sheet:"puzzles.families" doc:"Machine puzzle families and where each appears."`
	Haywires       []Haywire      `sheet:"puzzles.haywire" doc:"What a machine does when its countdown runs out."`
	PuzzlePractice []PracticeGift `sheet:"puzzles.practice" doc:"What each level of a family's practice buys."`
	PuzzleLayouts  []PuzzleLayout `sheet:"puzzles.layouts" doc:"How each family's layout grows with level."`
	PuzzleParams   []Param        `sheet:"puzzles.params" doc:"Countdown scaling, practice gains, mastery, rewards, the solve model."`
	PuzzleTuning   []PuzzleTuning `sheet:"puzzles.tuning" doc:"The numbers each family's generator and model read, by level."`
	PuzzleTitles   []PuzzleTitle  `sheet:"puzzles.titles" doc:"The title each family's masters hold."`
	PartyVersions  []PartyVersion `sheet:"puzzles.party" doc:"Families played by several hands on one machine: how big, what each seat is dealt, its window (GDD 7.11)."`
	PuzzleShapes   []PuzzleShape  `sheet:"puzzles.shapes" doc:"The looks each family's machine can take, and from which level (GDD 7.11)."`

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

// rows returns a sheet's rows as reflect values.
func (b *Book) rows(d Def) reflect.Value { return reflect.ValueOf(b).Elem().Field(d.field) }

// Params returns a sheet's rows when it is a params sheet.
func (b *Book) Params(d Def) ([]Param, bool) {
	if d.Row != reflect.TypeFor[Param]() {
		return nil, false
	}
	return b.rows(d).Interface().([]Param), true
}

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
	for _, p := range b.delveProblems() {
		errs = append(errs, errors.New(p))
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

// EnumValues is a column's allowed values from its enum tag ("a|b", or
// "quantity" for QuantityUnits); nil when it has none.
func EnumValues(f reflect.StructField) []string {
	switch e := f.Tag.Get("enum"); e {
	case "":
		return nil
	case "quantity":
		return QuantityUnits
	default:
		return strings.Split(e, "|")
	}
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
	enum := EnumValues(f)
	for _, s := range strs {
		if enum != nil && !slices.Contains(enum, s) {
			errs = append(errs, fmt.Errorf("%s: %q is not one of %s", at, s, strings.Join(enum, "|")))
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
