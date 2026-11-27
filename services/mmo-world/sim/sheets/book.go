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
	Beats        []BeatKind    `sheet:"fights.beats" doc:"The kinds of beat."`
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

	NPCTraits  []NPCTrait  `sheet:"npcs.traits" doc:"Traits notables and other NPCs draw from."`
	NPCRoles   []NPCRole   `sheet:"npcs.roles" doc:"Role slots each place fills with residents, and the roles wanderers take."`
	Topics     []Topic     `sheet:"npcs.topics" doc:"What an NPC can bring up, when, and the choices it offers (GDD 4.18)."`
	Gossip     []Gossip    `sheet:"npcs.gossip" doc:"How a neighbour's memory is passed on, by its kind (GDD 4.18)."`
	NPCParams  []Param     `sheet:"npcs.params" doc:"Memory, salience, routes, crowding, moving home and disposition."`
	Leanings   []Leaning   `sheet:"npcs.leanings" doc:"The odds an NPC leans upright or crooked, by its home's faction or its role (GDD 4.18)."`
	BandShifts []BandShift `sheet:"npcs.band-shifts" doc:"What a character's alignment band adds to an NPC's disposition, by the NPC's leaning (GDD 4.18)."`

	Archetypes      []Archetype  `sheet:"factions.archetypes" doc:"Faction archetypes, what they buy and tend to do."`
	Moves           []Move       `sheet:"factions.moves" doc:"The daily moves a faction can score."`
	MoveWeights     []MoveWeight `sheet:"factions.move-weights" doc:"How each archetype scores each move."`
	FactionParams   []Param      `sheet:"factions.params" doc:"Loose cells for factions."`
	SyndicateParams []Param      `sheet:"factions.syndicate" doc:"The syndicate's cells: fences, the back room, standing, jobs and the informer (GDD 4.5)."`

	FactWeights []FactWeight `sheet:"story.fact-weights" doc:"Weight of each fact kind, 0 to 100."`
	StoryParams []Param      `sheet:"story.params" doc:"Pacing, deadlines, the chronicle's cut-off."`

	Pacing         []Pacing         `sheet:"story.pacing" doc:"How many arcs of each scope run at once and how long each rests (GDD 12.4)."`
	SeasonDays     []SeasonDay      `sheet:"story.days" doc:"The season's day bands, for a season of story.params season-days (GDD 12.6)."`
	Arcs           []ArcRow         `sheet:"story.arcs" doc:"Arc templates: when each is cast, its cast, stages, sides and effects (GDD 12.9)."`
	Troubles       []TroubleRow     `sheet:"story.troubles" doc:"Settlement troubles: when each comes, what holds it off and what it damages (GDD 12.5, 12.10)."`
	Occasions      []OccasionRow    `sheet:"story.occasions" doc:"Settlement occasions: when each comes and what it brings (GDD 12.5)."`
	PatternPuzzles []PatternPuzzle  `sheet:"story.pattern-puzzles" doc:"What each pattern's puzzle is and what solving it opens (GDD 4.13)."`
	Caches         []Cache          `sheet:"story.caches" doc:"Goods a solved pattern or a won side opens."`
	FactionCities  []FactionCityRow `sheet:"story.faction-cities" doc:"Each faction archetype's city station and what it does there (GDD 4.8)."`

	EconomyParams []Param        `sheet:"economy.params" doc:"Fees, the faucet, the stabiliser, limits."`
	RefValues     []RefValue     `sheet:"economy.reference" doc:"Each tier's base value and median vector total (GDD 10.10)."`
	Standing      []StandingBand `sheet:"economy.standing" doc:"What standing does to a faction order's price (GDD 5.4)."`
	RouteRisks    []RouteRisk    `sheet:"economy.route-risk" doc:"Ambush chance per tile entered, by threat (GDD 10.7)."`

	GoalParams []Param `sheet:"goals.params" doc:"Listing fees, limits, thresholds."`
	Words      []Word  `sheet:"goals.words" doc:"Words a goal's title or note may not hold; operators hide what gets past them."`

	AlignParams []Param     `sheet:"alignment.params" doc:"Alignment's range, depth and daily caps, and what an NPC can know of it (GDD 5.10)."`
	AlignBands  []AlignBand `sheet:"alignment.bands" doc:"The alignment bands, lowest first (GDD 5.10)."`
	AlignActs   []AlignAct  `sheet:"alignment.acts" doc:"The acts that move alignment, and by how much (GDD 5.10)."`

	TheftKinds  []TheftKind `sheet:"theft.kinds" doc:"The ways to steal, and to run from the watch: beats, witness and haul (GDD 6.5)."`
	TheftParams []Param     `sheet:"theft.params" doc:"The witness formula, standing lost, hot goods, Wanted, stores and betrayal (GDD 6.5)."`

	Traces          []Trace        `sheet:"emergence.traces" doc:"GDD 13.1's traces, what each is counted on and how fast it fades."`
	Promotions      []PromotionRow `sheet:"emergence.promotions" doc:"GDD 13.2's lines: what a trace must reach, and within how long, to become part of the world."`
	Adaptations     []Adaptation   `sheet:"emergence.adaptations" doc:"What a creature variant resists when a region adapts to a style, and the material it makes new (GDD 13.2, 13.3)."`
	Camps           []CampRow      `sheet:"emergence.camps" doc:"The tier-1 station a camp on each site kind gains."`
	LegendTraits    []LegendTrait  `sheet:"emergence.legend-traits" doc:"The traits a legend may carry."`
	EmergenceParams []Param        `sheet:"emergence.params" doc:"Decay keeping, roads, tolls, caravans, adaptation, legends and the measures."`

	LiveOpsParams    []Param         `sheet:"liveops.params" doc:"Pool cap and refill, prices, the staged xp allowance."`
	LiveOpsTemplates []StageTemplate `sheet:"liveops.templates" doc:"What a server's staff and admins may stage, what it costs and what it rolls (GDD 14.4)."`
	LiveOpsDrops     []DropRow       `sheet:"liveops.drops" doc:"The tables staged crates, prizes and hauls roll, as staged goods (GDD 14.4)."`
	LiveOpsContests  []ContestRow    `sheet:"liveops.contests" doc:"Contests a staging posts as Each goals, and those a fair runs (GDD 14.3)."`

	Vocabulary []Vocab   `sheet:"tags.vocabulary" doc:"Every tag."`
	Measures   []Measure `sheet:"tags.measures" doc:"Numbers a rule can test or scale."`
	Rules      []RuleRow `sheet:"tags.rules" doc:"The rules, in the order they are tried."`

	Terrain        []Terrain       `sheet:"map.terrain" doc:"Terrain kinds: travel, sight, cover."`
	Biomes         []BiomeBand     `sheet:"map.biomes" doc:"Which terrain an elevation and moisture make."`
	Noise          []NoiseLayer    `sheet:"map.noise" doc:"The noise layers generation reads."`
	BiomeVariants  []BiomeVariant  `sheet:"map.biome-variants" doc:"Biomes that appear only past a distance."`
	Ecotones       []Ecotone       `sheet:"map.ecotones" doc:"What the fade between two land biomes holds."`
	Landmarks      []Landmark      `sheet:"map.landmarks" doc:"Features a region's highest free tile can hold."`
	RegionWeights  []RegionWeight  `sheet:"map.region-weights" doc:"Size classes of region centres and their shares."`
	Shapes         []Shape         `sheet:"map.shapes" doc:"The shapes patterns are laid in."`
	Patterns       []PatternRule   `sheet:"map.patterns" doc:"Patterns: shapes laid on the map before noise, with things on their points."`
	MapParams      []Param         `sheet:"map.params" doc:"Loose cells for generation."`
	Dungeons       []DungeonKind   `sheet:"map.dungeons" doc:"Dungeon kinds: where each stands, how deep it runs, what lives and what machines stand in it (GDD 4.9)."`
	Forks          []Fork          `sheet:"map.forks" doc:"The ways down from a fork, and the tags each adds to the floor below (GDD 4.9)."`
	Depths         []Depth         `sheet:"map.depths" doc:"How many floors a dungeon runs to, by its entrance's seed tier."`
	ContentWeights []ContentWeight `sheet:"map.content-weights" doc:"How a tile's history shifts the weights its content is drawn with (GDD 4.17)."`
	SiteKinds      []SiteKind      `sheet:"map.site-kinds" doc:"What a site slot holds, drawn at the tile's first reach (GDD 4.17)."`
	StockBands     []StockBand     `sheet:"map.stock-bands" doc:"How much of node-stock a tile's material starts with (GDD 4.17)."`
	PinLimits      []PinLimit      `sheet:"map.pin-limits" doc:"What each role may pin, how far and how often (GDD 14.5)."`

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
	MapStyle     []MapStyle    `sheet:"pack.map-style" doc:"The live map's colours, glyphs and patterns (GDD 4.11)."`
	MapView      []Param       `sheet:"pack.map-view" doc:"The live map's numbers: the last-seen dim, the zoom levels, the ecotone blend, the busy bands."`
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
func (b *Book) Rows(d Def) reflect.Value { return reflect.ValueOf(b).Elem().Field(d.field) }

// Changed names the sheets whose rows differ between two books. A sheet
// that fails to marshal counts as changed.
func Changed(a, b *Book) []string {
	var out []string
	for _, d := range Defs() {
		ja, errA := json.Marshal(a.Rows(d).Interface())
		jb, errB := json.Marshal(b.Rows(d).Interface())
		if errA != nil || errB != nil || !bytes.Equal(ja, jb) {
			out = append(out, d.Name)
		}
	}
	return out
}

// Params returns a sheet's rows when it is a params sheet.
func (b *Book) Params(d Def) ([]Param, bool) {
	if d.Row != reflect.TypeFor[Param]() {
		return nil, false
	}
	return b.Rows(d).Interface().([]Param), true
}

// IDs returns every id in a sheet, in row order.
func (b *Book) IDs(sheet string) []string {
	d, ok := DefByName(sheet)
	if !ok {
		return nil
	}
	rs := b.Rows(d)
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
		rs := b.Rows(d)
		for i := range rs.Len() {
			row := rs.Index(i)
			where := d.Name + " " + row.FieldByName("ID").String()
			errs = append(errs, checkValue(row, where, has)...)
		}
	}
	for _, p := range slices.Concat(b.delveProblems(), b.contentProblems(), b.storyProblems(), b.emergenceProblems(), b.crimeProblems(), b.liveopsProblems()) {
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
