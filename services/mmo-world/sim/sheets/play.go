package sheets

import "jams.team/mmo-world/sim/fixed"

// Rows for items, growth, fights, wear, mounts and puzzles that the
// headless fight and craft read (GDD 5, 7, 9).

// ComposeRow says what one component of an exploit sets. The first
// component's row sets the state the exploit adds and whom it lands on;
// a later component's row lends a trait.
type ComposeRow struct {
	ID       string `json:"id" unit:"id"`
	Tag      string `json:"tag" unit:"tag" ref:"tags.vocabulary" doc:"A tag the component holds."`
	Position string `json:"position" unit:"enum" enum:"first|later"`
	State    string `json:"state,omitempty" unit:"ref" ref:"fights.states" doc:"first: the state the exploit adds."`
	Target   string `json:"target,omitempty" unit:"enum" enum:"creature|tile|caster|tagged" doc:"first: one creature, everything on the tile, the caster, or every creature holding onlyTag."`
	OnlyTag  string `json:"onlyTag,omitempty" unit:"tag" ref:"tags.vocabulary" doc:"tagged: the tag a creature needs; first: a tag the target needs, or the state does not land."`
	CastTag  string `json:"castTag,omitempty" unit:"tag" ref:"tags.vocabulary" doc:"first: the tag the exploit carries for pairings."`
	Trait    string `json:"trait,omitempty" unit:"ref" ref:"items.traits" doc:"later: the trait it lends."`
}

// Pairing: two tags held by different equipped items give a third,
// which rules read (GDD 9.8, in the loadout).
type Pairing struct {
	ID   string `json:"id" unit:"id"`
	TagA string `json:"tagA" unit:"tag" ref:"tags.vocabulary"`
	TagB string `json:"tagB" unit:"tag" ref:"tags.vocabulary"`
	Tag  string `json:"tag" unit:"tag" ref:"tags.vocabulary" doc:"Added to every option the paired items govern."`
}

// Offer is a milestone offer for a mount or an exploit (GDD 9.12).
type Offer struct {
	ID        string   `json:"id" unit:"id"`
	Effect    string   `json:"effect" unit:"enum" enum:"tick-saving|load|steady|route|call|trait|charge|echo"`
	Magnitude int64    `json:"magnitude,omitempty" unit:"row" doc:"In the unit named by the unit column."`
	Unit      string   `json:"unit,omitempty" unit:"enum" enum:"quantity"`
	Trait     string   `json:"trait,omitempty" unit:"ref" ref:"items.traits" doc:"trait: the trait the pick gives."`
	Favours   []string `json:"favours" unit:"text" doc:"Record keys (event:tag) that make this the offer."`
}

// MarginBand: a margin at or above AtLeast falls in Band, first match wins.
type MarginBand struct {
	ID      string `json:"id" unit:"id"`
	AtLeast int64  `json:"atLeast" unit:"pts"`
	Band    string `json:"band" unit:"ref" ref:"fights.odds-bands"`
}

type FightTier struct {
	ID               string `json:"id" unit:"id"`
	Tier             int64  `json:"tier" unit:"tier" min:"1"`
	BaseDifficulty   int64  `json:"baseDifficulty" unit:"pts" min:"0"`
	BeatsMin         int64  `json:"beatsMin" unit:"count" min:"1"`
	BeatsMax         int64  `json:"beatsMax" unit:"count" min:"1"`
	HuntHealth       int64  `json:"huntHealth" unit:"health" min:"1" doc:"A hunt's pool for one creature of this tier, before the hunt's own ratio."`
	ExpectedLevel    int64  `json:"expectedLevel" unit:"level" min:"1" doc:"The level of the gear a character fighting at this tier is expected to carry."`
	ExpectedPractice int64  `json:"expectedPractice" unit:"level" min:"0" doc:"The practice a character fighting at this tier is expected to have."`
	Note             string `json:"note,omitempty" unit:"text"`
}

// BeatKind is one of the nine kinds of beat (GDD 7.9).
type BeatKind struct {
	ID       string `json:"id" unit:"id"`
	Modifier int64  `json:"modifier" unit:"pts" doc:"Added to the creature tier's base difficulty."`
	Haul     int64  `json:"haul" unit:"goods" min:"0" doc:"Units of the creature's drops a won beat yields."`
	Puzzle   bool   `json:"puzzle,omitempty" unit:"flag" doc:"Resolved by a machine puzzle, not a roll."`
	Health   int64  `json:"health,omitempty" unit:"percent" min:"0" doc:"guardian: its pool, as a share of the tier's hunt health."`
	Ends     bool   `json:"ends,omitempty" unit:"flag" doc:"A failure here ends the encounter without a loss (the quarry escapes)."`
	Note     string `json:"note,omitempty" unit:"text"`
}

// BeatTag: each tag a site or creature holds adds weight to a beat kind.
type BeatTag struct {
	ID     string `json:"id" unit:"id"`
	Tag    string `json:"tag" unit:"tag" ref:"tags.vocabulary"`
	Beat   string `json:"beat" unit:"ref" ref:"fights.beats"`
	Weight int64  `json:"weight" unit:"weight" min:"0" max:"100"`
}

// OptionRow is one option a beat can offer: what must be held for it,
// what governs its score, and what it risks (GDD 7.2, 7.3).
type OptionRow struct {
	ID           string   `json:"id" unit:"id"`
	Verb         string   `json:"verb" unit:"tag" ref:"tags.vocabulary" doc:"The option's own tag, which rules read."`
	Beats        []string `json:"beats" unit:"refs" ref:"fights.beats" doc:"Beats that offer it; empty is every beat."`
	Slot         string   `json:"slot" unit:"enum" enum:"hand|off-hand|body|deck|none" doc:"The item whose axis governs it."`
	Needs        []string `json:"needs,omitempty" unit:"tags" ref:"tags.vocabulary" doc:"The item must hold one of these."`
	Axis         string   `json:"axis,omitempty" unit:"ref" ref:"items.axes" doc:"The governing axis; empty means the practice alone."`
	FallbackSlot string   `json:"fallbackSlot,omitempty" unit:"enum" enum:"hand|off-hand|body|deck|none" doc:"Governs when slot holds nothing."`
	FallbackAxis string   `json:"fallbackAxis,omitempty" unit:"ref" ref:"items.axes"`
	Practice     string   `json:"practice" unit:"text" doc:"The practice it adds: travel, fight, gather, lockpick, a process, or a puzzle family."`
	Risk         string   `json:"risk" unit:"enum" enum:"durability|wound|haul|first-strike|escape|coin|standing|ticks|none"`
	RiskSize     int64    `json:"riskSize,omitempty" unit:"count" min:"0" doc:"Durability, haul units, coin, standing or ticks lost."`
	Kind         string   `json:"kind" unit:"enum" enum:"win|cautious|way-out|cast"`
	Note         string   `json:"note,omitempty" unit:"text"`
}

// StateRow is a state that lasts for beats (GDD 7.10).
type StateRow struct {
	ID          string `json:"id" unit:"id"`
	Tag         string `json:"tag" unit:"tag" ref:"tags.vocabulary"`
	Beats       int64  `json:"beats" unit:"beat" min:"0" doc:"How long it lasts; 0 is the rest of the encounter."`
	Wear        int64  `json:"wear,omitempty" unit:"durability" min:"0" doc:"Durability a beat off the hand item of a character holding it; health a beat off a hunted creature."`
	EndsOn      string `json:"endsOn,omitempty" unit:"tag" ref:"tags.vocabulary" doc:"Ends at once when its holder gains this."`
	WoundsAtEnd bool   `json:"woundsAtEnd,omitempty" unit:"flag" doc:"Leaves its holder wounded when the encounter ends, unless bound."`
	HalvesNext  bool   `json:"halvesNext,omitempty" unit:"flag" doc:"The holder's next failed beat costs half."`
	Unanswered  bool   `json:"unanswered,omitempty" unit:"flag" doc:"While the creature holds it, only cautious and way-out options are offered."`
	Note        string `json:"note,omitempty" unit:"text"`
}

// TraitEffect is a trait's effect that is not a band or score rule.
type TraitEffect struct {
	ID        string `json:"id" unit:"id"`
	Tag       string `json:"tag" unit:"tag" ref:"tags.vocabulary" doc:"The trait's tag."`
	Effect    string `json:"effect" unit:"enum" enum:"arc|ignore-state|gather-units|state-beats|load|wear-on-fail|worst-band|on-hit-state|no-first-strike|ignore-risk|ward-first|wide|quiet"`
	Magnitude int64  `json:"magnitude,omitempty" unit:"row" doc:"In the unit named by the unit column."`
	Unit      string `json:"unit,omitempty" unit:"enum" enum:"quantity"`
	State     string `json:"state,omitempty" unit:"tag" ref:"tags.vocabulary" doc:"The state it ignores, extends or puts on a hit creature."`
	Place     string `json:"place,omitempty" unit:"tag" ref:"tags.vocabulary" doc:"Only where the encounter's place holds this."`
	Lacks     string `json:"lacks,omitempty" unit:"tag" ref:"tags.vocabulary" doc:"Not against a creature holding this."`
	Risk      string `json:"risk,omitempty" unit:"enum" enum:"durability|wound|haul|first-strike|escape|coin|standing|ticks|none"`
}

// Hunt is a creature with a pool many characters wear down (GDD 7.6).
type Hunt struct {
	ID          string  `json:"id" unit:"id"`
	Creature    string  `json:"creature" unit:"ref" ref:"creatures.archetypes"`
	HealthRatio fixed.F `json:"healthRatio" unit:"ratio" min:"0" doc:"Times the tier's hunt health."`
	WindowDays  int64   `json:"windowDays" unit:"days" min:"1"`
	Spoils      []Spoil `json:"spoils" unit:"goods"`
}

type Spoil struct {
	Material string `json:"material" unit:"ref" ref:"items.materials"`
	Quantity int64  `json:"quantity" unit:"goods" min:"1"`
}

// PuzzleLayout: how big a family's machine is at a level. Size is Base
// plus PerLevel a level above 1; decoys likewise.
type PuzzleLayout struct {
	ID            string  `json:"id" unit:"id"`
	Family        string  `json:"family" unit:"ref" ref:"puzzles.families"`
	Base          int64   `json:"base" unit:"count" min:"1" doc:"Wires, pins, dials, maze side, grid side, knobs, fuses or sequence length at level 1."`
	PerLevel      fixed.F `json:"perLevel" unit:"count" min:"0" doc:"Added per level above 1, rounded down."`
	Max           int64   `json:"max" unit:"count" min:"1"`
	DecoyBase     int64   `json:"decoyBase,omitempty" unit:"count" min:"0" doc:"Look-alike ports, false pins, reversals, decoy tiles, noise or redundant clues at level 1."`
	DecoyPerLevel fixed.F `json:"decoyPerLevel,omitempty" unit:"count" min:"0"`
	Range         int64   `json:"range,omitempty" unit:"count" min:"0" doc:"Values a dial, knob or symbol can take."`
	Note          string  `json:"note,omitempty" unit:"text"`
}
