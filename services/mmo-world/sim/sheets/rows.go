package sheets

import "jams.team/mmo-world/sim/fixed"

// Column tags on every row field:
//
//	unit  the column's unit (see Units); required on every column
//	ref   the sheet whose ids this column holds
//	min, max, enum ("a|b|c"), doc
//
// A column whose unit is "row" is in the unit named by the row's own
// "unit" column (a params sheet).

// Param is one named scalar. Each area keeps its loose cells in a
// "<area>.params" sheet of these.
type Param struct {
	ID    string  `json:"id" unit:"id"`
	Value fixed.F `json:"value" unit:"row" doc:"In the unit named by the unit column."`
	Unit  string  `json:"unit" unit:"enum" enum:"quantity" doc:"One of the quantity units."`
	// Choices make a choice cell: its value, a count, indexes them.
	Choices []string `json:"choices,omitempty" unit:"text" doc:"A choice cell's choices; the value is the index of the one taken."`
	Doc     string   `json:"doc,omitempty" unit:"text"`
}

// Target is a sentence a designer would say, as a row the Report run reads.
type Target struct {
	ID        string `json:"id" unit:"id"`
	Text      string `json:"text" unit:"text"`
	Runs      string `json:"runs" unit:"text" doc:"The harness runs that hold it."`
	HoldsFrom string `json:"holdsFrom" unit:"enum" enum:"MM1|MM2|MM3|MM4|MM5|MM6|MM7|MM8|MM8a|MM9|MM10|MM11|MM12|MM13|MM14"`
}

// ---- Items ----

type Axis struct {
	ID string `json:"id" unit:"id"`
}

// Vector is the eight affinity axes, in points.
type Vector struct {
	Edge    int64 `json:"edge" unit:"pts" min:"0"`
	Weight  int64 `json:"weight" unit:"pts" min:"0"`
	Flex    int64 `json:"flex" unit:"pts" min:"0"`
	Conduct int64 `json:"conduct" unit:"pts" min:"0"`
	Heat    int64 `json:"heat" unit:"pts" min:"0"`
	Ward    int64 `json:"ward" unit:"pts" min:"0"`
	Reach   int64 `json:"reach" unit:"pts" min:"0"`
	Bond    int64 `json:"bond" unit:"pts" min:"0"`
}

// Slice is the vector in field order, which the Check run holds to
// items.axes's order.
func (v Vector) Slice() []int64 {
	return []int64{v.Edge, v.Weight, v.Flex, v.Conduct, v.Heat, v.Ward, v.Reach, v.Bond}
}

type Material struct {
	ID     string   `json:"id" unit:"id"`
	Tier   int64    `json:"tier" unit:"tier" min:"1"`
	Tags   []string `json:"tags" unit:"tags" ref:"tags.vocabulary"`
	Vector Vector   `json:"vector" unit:"pts"`
}

type Tier struct {
	ID              string `json:"id" unit:"id"`
	Tier            int64  `json:"tier" unit:"tier" min:"1"`
	Budget          int64  `json:"budget" unit:"pts" min:"1"`
	LevelCap        int64  `json:"levelCap" unit:"level" min:"1"`
	GainAtCap       int64  `json:"gainAtCap" unit:"percent" min:"0"`
	BladeDurability int64  `json:"bladeDurability" unit:"durability" min:"1"`
}

type Process struct {
	ID       string   `json:"id" unit:"id"`
	Stations []string `json:"stations" unit:"enum" enum:"forge|bench|still|loom"`
	Traits   []string `json:"traits" unit:"refs" ref:"items.traits" doc:"The process's trait table, for quirks and milestone picks."`
}

// Method tilts a process's result: up to two axes by a percentage each.
type Method struct {
	ID             string `json:"id" unit:"id"`
	Process        string `json:"process" unit:"ref" ref:"items.processes"`
	AxisA          string `json:"axisA,omitempty" unit:"ref" ref:"items.axes"`
	TiltA          int64  `json:"tiltA,omitempty" unit:"percent"`
	AxisB          string `json:"axisB,omitempty" unit:"ref" ref:"items.axes"`
	TiltB          int64  `json:"tiltB,omitempty" unit:"percent"`
	DurabilityCost int64  `json:"durabilityCost,omitempty" unit:"durability" min:"0"`
}

// Slot is a Shape template. Axes it does not name carry at Carry.
type Slot struct {
	ID              string  `json:"id" unit:"id"`
	Edge            fixed.F `json:"edge,omitempty" unit:"ratio" min:"0"`
	Weight          fixed.F `json:"weight,omitempty" unit:"ratio" min:"0"`
	Flex            fixed.F `json:"flex,omitempty" unit:"ratio" min:"0"`
	Conduct         fixed.F `json:"conduct,omitempty" unit:"ratio" min:"0"`
	Heat            fixed.F `json:"heat,omitempty" unit:"ratio" min:"0"`
	Ward            fixed.F `json:"ward,omitempty" unit:"ratio" min:"0"`
	Reach           fixed.F `json:"reach,omitempty" unit:"ratio" min:"0"`
	Bond            fixed.F `json:"bond,omitempty" unit:"ratio" min:"0"`
	StrongestOther  fixed.F `json:"strongestOther,omitempty" unit:"ratio" min:"0" doc:"Multiplier on the strongest axis the template does not name (a charm)."`
	DurabilityRatio fixed.F `json:"durabilityRatio" unit:"ratio" min:"0" doc:"Durability against a blade's at the same tier."`
}

// Multipliers are the slot's axis multipliers in Vector's order.
func (s Slot) Multipliers() []fixed.F {
	return []fixed.F{s.Edge, s.Weight, s.Flex, s.Conduct, s.Heat, s.Ward, s.Reach, s.Bond}
}

type Trait struct {
	ID      string   `json:"id" unit:"id"`
	Tag     string   `json:"tag" unit:"tag" ref:"tags.vocabulary"`
	Favours []string `json:"favours" unit:"text" doc:"Record keys (event:tag) that make a milestone offer this trait; the busiest key wins."`
	Strong  bool     `json:"strong,omitempty" unit:"flag" doc:"Inscribe's deep method draws only strong traits, its shallow method only the rest."`
}

// AxisTag gives a tag to anything holding at least a share of its tier's
// budget on one axis, so the tag means the same at every tier.
type AxisTag struct {
	ID            string `json:"id" unit:"id"`
	Axis          string `json:"axis" unit:"ref" ref:"items.axes"`
	ShareOfBudget int64  `json:"shareOfBudget" unit:"percent" min:"1" max:"100"`
	Tag           string `json:"tag" unit:"tag" ref:"tags.vocabulary"`
}

// Resonance: two bound components each at or above Threshold on both
// axes give the trait.
type Resonance struct {
	ID        string `json:"id" unit:"id"`
	AxisA     string `json:"axisA" unit:"ref" ref:"items.axes"`
	AxisB     string `json:"axisB" unit:"ref" ref:"items.axes"`
	Threshold int64  `json:"threshold" unit:"pts" min:"0"`
	Trait     string `json:"trait" unit:"ref" ref:"items.traits"`
}

// ---- Growth ----

type LevelStep struct {
	ID        string `json:"id" unit:"id"`
	Level     int64  `json:"level" unit:"level" min:"1"`
	XPToNext  int64  `json:"xpToNext" unit:"xp" min:"0"`
	XPSoFar   int64  `json:"xpSoFar" unit:"xp" min:"0"`
	Milestone bool   `json:"milestone,omitempty" unit:"flag"`
}

type DeedXP struct {
	ID string `json:"id" unit:"id"`
	XP int64  `json:"xp" unit:"xp" min:"0"`
}

// ---- Fights ----

type OddsBand struct {
	ID     string  `json:"id" unit:"id"`
	Rank   int64   `json:"rank" unit:"count" doc:"Bands in order; a shift of one band moves one rank."`
	Chance fixed.F `json:"chance" unit:"chance" min:"0" max:"1"`
	Rolled bool    `json:"rolled" unit:"flag" doc:"False for Certain, which never rolls."`
}

// ---- Wear ----

type Durability struct {
	ID         string `json:"id" unit:"id"`
	Slot       string `json:"slot" unit:"ref" ref:"items.slots"`
	Tier       string `json:"tier" unit:"ref" ref:"items.tiers"`
	Durability int64  `json:"durability" unit:"durability" min:"1"`
}

// ---- World ----

type Gauge struct {
	ID          string `json:"id" unit:"id"`
	Max         int64  `json:"max" unit:"gauge" min:"1"`
	DailyRise   int64  `json:"dailyRise" unit:"gauge" doc:"Change per world day with nobody acting; negative falls toward the baseline and stops there."`
	PullPercent int64  `json:"pullPercent" unit:"percent" min:"0" max:"100" doc:"Share of the gap to baseline closed each world day."`
	Wobble      int64  `json:"wobble" unit:"gauge" min:"0" doc:"A keyed draw moves the gauge by up to this either way each world day, so nothing settles for good."`
}

// GaugeLine is a threshold that changes what a region does.
type GaugeLine struct {
	ID        string `json:"id" unit:"id"`
	Gauge     string `json:"gauge" unit:"ref" ref:"world.gauges"`
	AtLeast   int64  `json:"atLeast" unit:"gauge" min:"0"`
	ClearsAt  int64  `json:"clearsBelow,omitempty" unit:"gauge" min:"0" doc:"Stays in force until the gauge falls below this; 0 means at the line."`
	Effect    string `json:"effect" unit:"enum" enum:"ambush|raid|overrun|yields-halve|fire-and-panic|corrupted-nodes|caravans|spread|neighbour-pressure"`
	FactKind  string `json:"factKind,omitempty" unit:"ref" ref:"story.fact-weights" doc:"Fact written when the line is crossed."`
	Magnitude int64  `json:"magnitude,omitempty" unit:"gauge" doc:"For neighbour-pressure and spread: what one neighbour at the gauge's maximum adds per world day; a neighbour just over the line adds in proportion."`
}

// WeatherKind is a kind of weather system and what it does on the tiles
// under it (GDD 4.4).
type WeatherKind struct {
	ID           string   `json:"id" unit:"id"`
	Tag          string   `json:"tag" unit:"tag" ref:"tags.vocabulary" doc:"Every tile under the system carries it."`
	TileTags     []string `json:"tileTags,omitempty" unit:"tags" ref:"tags.vocabulary" doc:"Also added to the tile."`
	CreatureTags []string `json:"creatureTags,omitempty" unit:"tags" ref:"tags.vocabulary" doc:"Added to creatures under it."`
	EnterTicks   int64    `json:"enterTicks,omitempty" unit:"ticks" min:"0" doc:"Added to entering a tile under a system of enterAt strength or more."`
	EnterAt      int64    `json:"enterAt,omitempty" unit:"count" min:"0" max:"100"`
	CrossTicks   int64    `json:"crossTicks,omitempty" unit:"ticks" min:"0" doc:"Rivers and wet ground take this to enter; 0 leaves them as they are."`
	Sight        int64    `json:"sight,omitempty" unit:"tiles" min:"0" doc:"Sight falls to this; 0 leaves it."`
	HighSight    int64    `json:"highSight,omitempty" unit:"tiles" min:"0" doc:"Sight gained on high ground."`
	Scarcity     int64    `json:"scarcity,omitempty" unit:"gauge" doc:"Added each world day to a region's scarcity, scaled by its share of tiles under the system."`
	Regrowth     bool     `json:"stopsRegrowth,omitempty" unit:"flag" doc:"Plants stop regrowing under it."`
	BlockedLoss  int64    `json:"blockedLoss,omitempty" unit:"count" min:"0" doc:"Strength lost each tick its centre is blocked by high ground."`
	Note         string   `json:"note,omitempty" unit:"text"`
}

// WeatherForm weights which kind forms in a spine cell. A kind's weight
// is its first row whose terrain, season and lowness all match the
// cell's majority; a kind with no matching row does not form.
type WeatherForm struct {
	ID       string   `json:"id" unit:"id"`
	Kind     string   `json:"kind" unit:"ref" ref:"world.weather"`
	Terrains []string `json:"terrains,omitempty" unit:"refs" ref:"map.terrain" doc:"Empty matches any."`
	Season   string   `json:"season,omitempty" unit:"ref" ref:"world.seasons" doc:"Empty matches any."`
	Low      bool     `json:"low,omitempty" unit:"flag" doc:"Only where the cell's centre lies at or under low-elevation."`
	Weight   int64    `json:"weight" unit:"weight" min:"0" max:"100"`
}

// WeatherMeeting is what happens when two systems' footprints touch.
type WeatherMeeting struct {
	ID       string `json:"id" unit:"id"`
	Kind     string `json:"kind" unit:"ref" ref:"world.weather"`
	Meets    string `json:"meets" unit:"ref" ref:"world.weather"`
	Effect   string `json:"effect" unit:"enum" enum:"leave|end" doc:"leave: a new system of leaves forms where they met; end: the met system dies."`
	Leaves   string `json:"leaves,omitempty" unit:"ref" ref:"world.weather"`
	Strength int64  `json:"strength,omitempty" unit:"percent" min:"0" max:"100" doc:"leave: the new system's strength, as a share of kind's."`
}

// Season is one season of the world's year; seasons run in row order
// and repeat. Each has its own prevailing wind, keyed.
type Season struct {
	ID string `json:"id" unit:"id"`
}

// ---- Factions ----

type Archetype struct {
	ID    string   `json:"id" unit:"id"`
	Goal  string   `json:"goal" unit:"enum" enum:"hold|take|profit|cleanse|isolate"`
	Buys  []string `json:"buys" unit:"tags" ref:"tags.vocabulary"`
	Tags  []string `json:"tags" unit:"tags" ref:"tags.vocabulary" doc:"Disposition tags the faction carries."`
	Tends []string `json:"tends" unit:"refs" ref:"factions.moves"`
}

type Move struct {
	ID string `json:"id" unit:"id"`
}

// MoveWeight scores one move for one archetype:
// score = fit + need relieved × NeedWeight − risk × RiskWeight.
type MoveWeight struct {
	ID         string `json:"id" unit:"id"`
	Archetype  string `json:"archetype" unit:"ref" ref:"factions.archetypes"`
	Move       string `json:"move" unit:"ref" ref:"factions.moves"`
	Fit        int64  `json:"fit" unit:"count" doc:"Score points for fit to the archetype's goal."`
	NeedWeight int64  `json:"needWeight" unit:"percent"`
	RiskWeight int64  `json:"riskWeight" unit:"percent"`
	Note       string `json:"note,omitempty" unit:"text" doc:"Why the value is what it is; \"provisional\" marks a value the GDD does not give yet."`
}

// ---- Story ----

type FactWeight struct {
	ID     string `json:"id" unit:"id" doc:"The fact kind, with dots replaced by dashes."`
	Kind   string `json:"kind" unit:"text"`
	Weight int64  `json:"weight" unit:"weight" min:"0" max:"100"`
	Note   string `json:"note,omitempty" unit:"text" doc:"Why the value is what it is; \"provisional\" marks a value the GDD does not give yet."`
}

// ---- Emergence ----

type Trace struct {
	ID           string `json:"id" unit:"id"`
	DecayPercent int64  `json:"decayPercent" unit:"percent" min:"0" max:"100"`
	PromoteAt    int64  `json:"promoteAt" unit:"count" min:"1"`
}

// ---- Tags ----

type Vocab struct {
	ID   string `json:"id" unit:"id"`
	Kind string `json:"kind" unit:"enum" enum:"class|form|substance|property|state|origin|behaviour|disposition|weather|action|beat|condition|pairing|calling|ability"`
}

// Measure is a number a rule can test or scale: a gauge, a party size, a price.
type Measure struct {
	ID   string `json:"id" unit:"id"`
	Unit string `json:"unit" unit:"enum" enum:"quantity"`
}

type RuleRow struct {
	ID       string      `json:"id" unit:"id"`
	Subject  []string    `json:"subject" unit:"tags" ref:"tags.vocabulary" doc:"Tags the subject must hold."`
	Other    []string    `json:"other,omitempty" unit:"tags" ref:"tags.vocabulary" doc:"Tags what the subject is against or beside must hold."`
	Place    []string    `json:"place,omitempty" unit:"tags" ref:"tags.vocabulary" doc:"Tags the tile, its weather or its region must hold."`
	Anywhere []string    `json:"anywhere,omitempty" unit:"tags" ref:"tags.vocabulary" doc:"Tags any of the three may hold."`
	Lacks    []string    `json:"otherLacks,omitempty" unit:"tags" ref:"tags.vocabulary" doc:"Tags what the subject is against must not hold."`
	Measure  string      `json:"measure,omitempty" unit:"ref" ref:"tags.measures"`
	AtLeast  int64       `json:"atLeast,omitempty" unit:"measure" doc:"In the measure's unit."`
	Then     []EffectRow `json:"then" unit:"effects"`
}

type EffectRow struct {
	Kind    string `json:"kind" unit:"enum" enum:"add-tag|remove-tag|band|scale|add|join|end|score"`
	Target  string `json:"target,omitempty" unit:"enum" enum:"subject|other|place|yield"`
	Tag     string `json:"tag,omitempty" unit:"tag" ref:"tags.vocabulary"`
	Steps   int64  `json:"steps,omitempty" unit:"band-steps"`
	Measure string `json:"measure,omitempty" unit:"ref" ref:"tags.measures"`
	Percent int64  `json:"percent,omitempty" unit:"percent"`
	Count   int64  `json:"count,omitempty" unit:"count" doc:"join: creatures that join; add: what is added to the measure."`
	Beat    int64  `json:"beat,omitempty" unit:"beat" min:"0"`
	Score   int64  `json:"score,omitempty" unit:"pts" doc:"score: points added to an option's score."`
}

// ---- Map ----

type Terrain struct {
	ID         string   `json:"id" unit:"id"`
	EnterTicks int64    `json:"enterTicks" unit:"ticks" min:"0" doc:"0 with passable false is impassable."`
	Passable   bool     `json:"passable" unit:"flag"`
	Sight      int64    `json:"sight" unit:"tiles" min:"0"`
	Cover      int64    `json:"cover" unit:"count" min:"0" max:"100"`
	Tags       []string `json:"tags" unit:"tags" ref:"tags.vocabulary"`
	PlaceTags  []string `json:"placeTags,omitempty" unit:"tags" ref:"tags.vocabulary" doc:"Tags a tile of this terrain carries as a place, for rules; not given to what is found there."`
	// Weather crossing the terrain: how long a system takes to cross a
	// tile against its pace, the strength it gains a tile, and whether its
	// centre may enter at all.
	WeatherPace  int64  `json:"weatherPace" unit:"percent" min:"1" doc:"A system's ticks per tile here, as a share of its pace."`
	WeatherGain  int64  `json:"weatherGain,omitempty" unit:"count" doc:"Strength a system gains entering a tile."`
	WeatherBlock bool   `json:"weatherBlock,omitempty" unit:"flag" doc:"A system's centre cannot enter."`
	Note         string `json:"note,omitempty" unit:"text" doc:"Why the value is what it is; \"provisional\" marks a value the GDD does not give yet."`
}

// NoiseLayer is one field of layered value noise.
type NoiseLayer struct {
	ID      string `json:"id" unit:"id"`
	Cell    int64  `json:"cell" unit:"tiles" min:"1" doc:"Lattice spacing of the first octave."`
	Octaves int64  `json:"octaves" unit:"count" min:"1"`
	Falloff int64  `json:"falloff" unit:"percent" min:"1" max:"100" doc:"Each octave's weight against the one before."`
	Max     int64  `json:"max" unit:"count" min:"1" doc:"The layer's values run 0 to max."`
	Note    string `json:"note,omitempty" unit:"text" doc:"Why the value is what it is; \"provisional\" marks a value the GDD does not give yet."`
}

// BiomeBand assigns terrain by elevation and moisture, first match wins.
type BiomeBand struct {
	ID           string `json:"id" unit:"id"`
	Terrain      string `json:"terrain" unit:"ref" ref:"map.terrain"`
	ElevationMin int64  `json:"elevationMin" unit:"count" min:"0" max:"100"`
	ElevationMax int64  `json:"elevationMax" unit:"count" min:"0" max:"100"`
	MoistureMin  int64  `json:"moistureMin" unit:"count" min:"0" max:"100"`
	MoistureMax  int64  `json:"moistureMax" unit:"count" min:"0" max:"100"`
	// MaterialTags are what a far material of this biome carries besides
	// its terrain's tags.
	MaterialTags []string `json:"materialTags,omitempty" unit:"tags" ref:"tags.vocabulary"`
	Note         string   `json:"note,omitempty" unit:"text" doc:"Why the value is what it is; \"provisional\" marks a value the GDD does not give yet."`
}

// Shape is a row in map.shapes: how a pattern lays its points (GDD 4.13).
type Shape struct {
	ID      string   `json:"id" unit:"id"`
	Kind    string   `json:"kind" unit:"enum" enum:"ring|triangle|line|cross|star|spiral|scatter|glyph"`
	Arms    int64    `json:"arms,omitempty" unit:"count" min:"0" max:"6" doc:"cross and star: lines out from the centre, spread over the six hex directions."`
	Step    int64    `json:"step,omitempty" unit:"tiles" min:"0" doc:"spiral: tiles between points along the winding; scatter: the least spacing."`
	Count   int64    `json:"count,omitempty" unit:"count" min:"0" doc:"scatter: how many points."`
	Offsets []Offset `json:"offsets,omitempty" unit:"tiles" doc:"glyph: the points as axial offsets from the centre, scaled by the pattern's size."`
	Note    string   `json:"note,omitempty" unit:"text"`
}

// Offset is an axial step on the hex grid.
type Offset struct {
	Q int64 `json:"q" unit:"tiles"`
	R int64 `json:"r" unit:"tiles"`
}

// PatternRule is a row in map.patterns: a shape laid on the map with
// something standing on its points (GDD 4.13).
type PatternRule struct {
	ID     string `json:"id" unit:"id"`
	Shape  string `json:"shape" unit:"ref" ref:"map.shapes"`
	Size   int64  `json:"size" unit:"tiles" min:"1" doc:"A ring's radius, a triangle's side, a line's or an arm's length, a scatter's reach; a glyph's scale."`
	Anchor string `json:"anchor" unit:"enum" enum:"origin|starting-settlement|terrain|pattern|frontier"`
	// AnchorTerrain and ChunkShare: a terrain anchor is the highest tile of
	// that terrain in a chunk, in a share of chunks.
	AnchorTerrain string `json:"anchorTerrain,omitempty" unit:"ref" ref:"map.terrain" doc:"terrain: the terrain whose highest tile in a chunk anchors one instance."`
	ChunkShare    int64  `json:"chunkShare,omitempty" unit:"percent" min:"0" max:"100" doc:"terrain: the share of chunks that hold an instance."`
	AnchorPattern string `json:"anchorPattern,omitempty" unit:"ref" ref:"map.patterns" doc:"pattern: the rule whose instances anchor this one."`
	AnchorAt      string `json:"anchorAt,omitempty" unit:"enum" enum:"centre|points" doc:"pattern: one instance at the other's centre, or one at each of its points."`
	// PerRegions, MinDistance and MaxDistance: a frontier rule fires about
	// once per that many regions generated in its distance band.
	PerRegions     int64         `json:"perRegions,omitempty" unit:"count" min:"0" doc:"frontier: one instance per this many regions in the band."`
	MinDistance    int64         `json:"minDistance,omitempty" unit:"tiles" min:"0" doc:"frontier and terrain: the band's inner edge, from the origin."`
	MaxDistance    int64         `json:"maxDistance,omitempty" unit:"tiles" min:"0" doc:"frontier and terrain: the band's outer edge; 0 is no edge."`
	OffsetDistance int64         `json:"offsetDistance,omitempty" unit:"tiles" min:"0" doc:"How far the centre sits from the anchor."`
	OffsetBearing  int64         `json:"offsetBearing,omitempty" unit:"degrees" min:"0" max:"359" doc:"Which way, clockwise from east; the seed picks it when seedFree holds offset."`
	Parts          []PatternPart `json:"parts" unit:"parts"`
	Area           string        `json:"area,omitempty" unit:"text" doc:"The area of interest the shape encloses."`
	SeedFree       []string      `json:"seedFree" unit:"enum" enum:"rotation|mirror|which|jitter|offset|solution"`
	Note           string        `json:"note,omitempty" unit:"text" doc:"Why the value is what it is; \"provisional\" marks a value the GDD does not give yet."`
}

// PatternPart is what stands on some of a pattern's points.
type PatternPart struct {
	Place   string  `json:"place" unit:"enum" enum:"relay|pylon|vault|landmark|dungeon|beacon|faction-seat"`
	At      string  `json:"at" unit:"enum" enum:"corners|edges|every|centre|spaced|indices"`
	Count   int64   `json:"count,omitempty" unit:"count" min:"0" doc:"spaced: this many points evenly round the outline."`
	Indices []int64 `json:"indices,omitempty" unit:"count" doc:"indices: these points of the outline, in walk order."`
}

// RegionWeight is one size class of region centre. A tile joins the
// centre with the least squared distance less weight, so weight is in
// tiles squared; a centre draws its class by share.
type RegionWeight struct {
	ID     string `json:"id" unit:"id"`
	Weight int64  `json:"weight" unit:"count" doc:"Tiles squared taken off the squared distance; negative shrinks a region."`
	Share  int64  `json:"share" unit:"percent" min:"0" max:"100"`
	Note   string `json:"note,omitempty" unit:"text"`
}

// Landmark is a feature a region can stand on its highest free tile:
// something to name, rumour and steer by (GDD 4.10).
type Landmark struct {
	ID       string   `json:"id" unit:"id"`
	Terrains []string `json:"terrains" unit:"refs" ref:"map.terrain" doc:"Terrains it can stand on."`
}

// Ecotone is what the fade between two land biomes holds: a tag both
// tiles and finds there carry, beside "edge", and what its edge materials
// are made of.
type Ecotone struct {
	ID           string   `json:"id" unit:"id"`
	BiomeA       string   `json:"biomeA" unit:"ref" ref:"map.biomes"`
	BiomeB       string   `json:"biomeB" unit:"ref" ref:"map.biomes"`
	Tag          string   `json:"tag" unit:"tag" ref:"tags.vocabulary"`
	MaterialTags []string `json:"materialTags,omitempty" unit:"tags" ref:"tags.vocabulary"`
	Note         string   `json:"note,omitempty" unit:"text"`
}

// BiomeVariant is a biome that appears only past a distance: a stretch of
// its terrain, picked by its own noise, that reads as something new.
type BiomeVariant struct {
	ID          string `json:"id" unit:"id"`
	Terrain     string `json:"terrain" unit:"ref" ref:"map.terrain"`
	MinDistance int64  `json:"minDistance" unit:"tiles" min:"0" doc:"From the origin."`
	Cell        int64  `json:"cell" unit:"tiles" min:"1" doc:"Lattice spacing of the variant's noise."`
	Share       int64  `json:"share" unit:"percent" min:"0" max:"100" doc:"Share of the terrain's tiles past the distance that turn."`
	Note        string `json:"note,omitempty" unit:"text"`
}

// ---- Tiles ----

type TileCounter struct {
	ID           string `json:"id" unit:"id"`
	DecayPercent int64  `json:"decayPercent" unit:"percent" min:"0" max:"100"`
}

type FindRarity struct {
	ID     string  `json:"id" unit:"id"`
	Chance fixed.F `json:"chance" unit:"chance" min:"0" max:"1"`
}

// ---- Creatures ----

type Creature struct {
	ID     string   `json:"id" unit:"id"`
	Tier   int64    `json:"tier" unit:"tier" min:"1"`
	Biomes []string `json:"biomes" unit:"refs" ref:"map.terrain"`
	Tags   []string `json:"tags" unit:"tags" ref:"tags.vocabulary"`
	Drops  []string `json:"drops" unit:"refs" ref:"items.materials"`
}

// CreatureVariant is a tag a creature can carry past a distance, on top
// of its archetype and its biome's tags.
type CreatureVariant struct {
	ID          string `json:"id" unit:"id"`
	Tag         string `json:"tag" unit:"tag" ref:"tags.vocabulary"`
	MinDistance int64  `json:"minDistance" unit:"tiles" min:"0" doc:"From the origin."`
	Note        string `json:"note,omitempty" unit:"text"`
}

// ---- NPCs ----

// NPCTrait is a trait a notable or other NPC can carry. Two opposed
// traits are never drawn together.
type NPCTrait struct {
	ID      string `json:"id" unit:"id"`
	Opposes string `json:"opposes,omitempty" unit:"ref" ref:"npcs.traits"`
	Tag     string `json:"tag,omitempty" unit:"tag" ref:"tags.vocabulary" doc:"A tag rules can read."`
}

// ---- Settlements ----

// StartingStructure is what a starting settlement opens with (GDD 4.8).
type StartingStructure struct {
	ID        string `json:"id" unit:"id"`
	Structure string `json:"structure" unit:"enum" enum:"forge|bench|still|loom|market|notice-board|tinker-bench|stable|treasury"`
	Tier      int64  `json:"tier,omitempty" unit:"tier" min:"0" doc:"0 for a structure without tiers."`
	Note      string `json:"note,omitempty" unit:"text"`
}

// ---- Mounts ----

// MountKind is a mount the world can hold: its tier, the terrains it
// suits and the load it adds (GDD 6.2).
type MountKind struct {
	ID       string   `json:"id" unit:"id"`
	Tier     int64    `json:"tier" unit:"tier" min:"1"`
	Suits    []string `json:"suits" unit:"refs" ref:"map.terrain" doc:"Terrains where it lowers the cost of entering a tile."`
	RoadOnly bool     `json:"roadOnly,omitempty" unit:"flag" doc:"Suits road tiles only, where it buys load, not speed."`
	River    bool     `json:"river,omitempty" unit:"flag" doc:"Also suits river tiles, whatever their terrain (GDD 6.2)."`
	Load     int64    `json:"load" unit:"load" min:"0"`
}

// ---- Puzzles ----

// PuzzleFamily is one kind of machine puzzle and where the world puts it.
type PuzzleFamily struct {
	ID        string   `json:"id" unit:"id"`
	Lockpick  bool     `json:"lockpick,omitempty" unit:"flag" doc:"Played as a Lock beat."`
	AppearsOn []string `json:"appearsOn" unit:"tags" ref:"tags.vocabulary" doc:"Tags that make the world pick this family."`
	Countdown int64    `json:"countdown" unit:"seconds" min:"1" doc:"At level 1, tier 1."`
	PerLevel  int64    `json:"perLevel" unit:"seconds" min:"0" doc:"Added per level above 1."`
	ScaleNote string   `json:"scaleNote" unit:"text" doc:"What a level adds to the machine."`
	Haywires  []string `json:"haywires" unit:"refs" ref:"puzzles.haywire" doc:"Effects a failure draws from."`
	SoloRate  fixed.F  `json:"soloRate" unit:"percent" min:"0" max:"100" doc:"Harness solve rate at practice 0, level 1, tier 1."`
	Note      string   `json:"note,omitempty" unit:"text"`
}

// Haywire is what a machine does when its countdown runs out.
type Haywire struct {
	ID        string `json:"id" unit:"id"`
	Effect    string `json:"effect" unit:"enum" enum:"shock|alarm|short|lockdown"`
	Magnitude int64  `json:"magnitude" unit:"row" doc:"In the unit named by the unit column."`
	Unit      string `json:"unit" unit:"enum" enum:"quantity"`
	Tag       string `json:"tag,omitempty" unit:"tag" ref:"tags.vocabulary"`
	Intro     bool   `json:"intro,omitempty" unit:"flag" doc:"What a character's first machine does, whatever its family lists."`
}

// PuzzleTuning is one number a family's generator or model reads, and how
// it moves with the machine's level: Base plus PerLevel a level above 1,
// rounded down, held between Min and Max.
type PuzzleTuning struct {
	ID       string  `json:"id" unit:"id" doc:"The family, a dash, the key."`
	Family   string  `json:"family" unit:"ref" ref:"puzzles.families"`
	Key      string  `json:"key" unit:"text" doc:"What the family calls the cell."`
	Base     int64   `json:"base" unit:"row" doc:"At level 1, in the unit named by the unit column."`
	PerLevel fixed.F `json:"perLevel,omitempty" unit:"row" doc:"Added per level above 1, rounded down."`
	Min      int64   `json:"min,omitempty" unit:"row" min:"0" doc:"A value never goes below this, or below 0."`
	Max      int64   `json:"max,omitempty" unit:"row" min:"0" doc:"A value never goes above this; 0 is no upper bound."`
	Unit     string  `json:"unit" unit:"enum" enum:"quantity"`
	Doc      string  `json:"doc" unit:"text"`
}

// PuzzleTitle is the title a family's masters hold; the pack names it.
type PuzzleTitle struct {
	ID     string `json:"id" unit:"id" doc:"The family's id."`
	Family string `json:"family" unit:"ref" ref:"puzzles.families"`
}

// PracticeGift is what a level of puzzle practice buys: information and
// time, never odds.
type PracticeGift struct {
	ID       string `json:"id" unit:"id"`
	Practice int64  `json:"practice" unit:"level" min:"1" max:"20"`
	Gives    string `json:"gives" unit:"enum" enum:"preview|countdown|hint|guide-line|partner-glimpse|mastery"`
	Percent  int64  `json:"percent,omitempty" unit:"percent" min:"0" doc:"For countdown: the extra time."`
}

// ---- The setting pack ----

// Name is what the setting calls a thing the sheets identify.
type Name struct {
	ID     string `json:"id" unit:"id"`
	Ref    string `json:"ref" unit:"ref" ref:"*" doc:"sheet:id of the thing named."`
	Name   string `json:"name" unit:"text"`
	Plural string `json:"plural,omitempty" unit:"text"`
}

// NamePart is one piece generated names are built from.
type NamePart struct {
	ID   string `json:"id" unit:"id"`
	List string `json:"list" unit:"enum" enum:"region-head|region-tail|notable-given|notable-family|faction-head|faction-tail|dungeon-head|dungeon-tail|settlement-head|settlement-tail"`
	Text string `json:"text" unit:"text"`
}

// BannerLayer is one SVG layer banners are composed from, on a 100 by 120
// viewBox.
type BannerLayer struct {
	ID    string   `json:"id" unit:"id"`
	Layer string   `json:"layer" unit:"enum" enum:"field|division|ordinary|charge"`
	Path  string   `json:"path" unit:"text" doc:"SVG path data."`
	Tags  []string `json:"tags" unit:"tags" ref:"tags.vocabulary" doc:"Tags that make this layer likelier for a holder."`
}

type Palette struct {
	ID   string   `json:"id" unit:"id"`
	Tags []string `json:"tags" unit:"tags" ref:"tags.vocabulary"`
	Hex  string   `json:"hex" unit:"text" doc:"#rrggbb"`
}
