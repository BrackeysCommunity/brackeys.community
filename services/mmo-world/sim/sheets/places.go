package sheets

// ---- Settlements ----

// CostLine is goods of a material tag, or coin: one line of a cost.
type CostLine struct {
	Tag      string `json:"tag,omitempty" unit:"tag" ref:"tags.vocabulary" doc:"Any material with this tag counts; empty for coin."`
	Quantity int64  `json:"quantity" unit:"goods" min:"1" doc:"Goods, or coin when the tag is empty."`
}

// Structure is one of the structures a settlement is made of (GDD 4.16).
type Structure struct {
	ID        string     `json:"id" unit:"id"`
	Does      string     `json:"does" unit:"text"`
	Station   bool       `json:"station,omitempty" unit:"flag" doc:"A crafting station: its tier caps what is made there."`
	MaxTier   int64      `json:"maxTier" unit:"tier" min:"1" doc:"1 for a structure that is not tiered."`
	Charter   bool       `json:"charter,omitempty" unit:"flag" doc:"Built at tier 1 by the charter."`
	First     []CostLine `json:"first,omitempty" unit:"parts" doc:"What tier 1 costs, when the charter does not build it."`
	Each      []CostLine `json:"each,omitempty" unit:"parts" doc:"What each tier up costs."`
	Per       int64      `json:"per,omitempty" unit:"count" min:"0" doc:"What a tier adds: kinds a book lists, load stored, provisions held, mounts housed."`
	Standing  bool       `json:"standing,omitempty" unit:"flag" doc:"Nobody operates it: it counts as used whenever anything in its settlement is."`
	Waits     string     `json:"waits,omitempty" unit:"text" doc:"The milestone whose system reads what it does, if not yet built: goals do not raise it."`
	TiersWait string     `json:"tiersWait,omitempty" unit:"text" doc:"The milestone whose system reads what a tier up adds, if not yet built: it is raised once and no further."`
}

// GuildWork is a standing bonus a guild switches on at its settlement
// (GDD 4.14).
type GuildWork struct {
	ID    string     `json:"id" unit:"id"`
	Uses  []CostLine `json:"uses" unit:"parts" doc:"Consumed from the bank each world day; coin from the treasury."`
	Gives string     `json:"gives" unit:"enum" enum:"station-fee|threat|rest|raid-defence|market-fee|mount-upkeep"`
	By    int64      `json:"by" unit:"count" doc:"How much it gives: per cent off a station fee or upkeep, threat a day, rest ticks, percentage points off the market fee."`
	Needs string     `json:"needs,omitempty" unit:"ref" ref:"settlements.structures" doc:"A structure the settlement must hold."`
	Waits string     `json:"waits,omitempty" unit:"text" doc:"The milestone whose system reads what it gives, if not yet built."`
}

// ---- Classes ----

// Requirement is one threshold of a class's unlock: a practice level, a
// deed counted on the character, or crafts of a process.
type Requirement struct {
	Kind string `json:"kind" unit:"enum" enum:"practice|deed|crafts"`
	ID   string `json:"id" unit:"text" doc:"The practice skill, deed or process."`
	At   int64  `json:"at" unit:"count" min:"1"`
}

// Class is a class a character earns by what it practised (GDD 5.8).
type Class struct {
	ID     string        `json:"id" unit:"id"`
	Unlock []Requirement `json:"unlock" unit:"parts"`
	Skill  string        `json:"skill" unit:"text" doc:"The practice whose level raises the class level."`
	Tag    string        `json:"tag" unit:"tag" ref:"tags.vocabulary" doc:"The tag the class gives the character."`
	Leans  string        `json:"leans" unit:"text"`
	Hidden bool          `json:"hidden,omitempty" unit:"flag" doc:"A class found after launch: off the card until someone crosses it (GDD 5.8)."`
}

// Ability is one entry of a class's tree (GDD 5.9): the tag it gives,
// which tags.rules rows read that tag, or which command or measure of
// the game reads it.
type Ability struct {
	ID    string   `json:"id" unit:"id"`
	Class string   `json:"class" unit:"ref" ref:"classes.classes"`
	Tier  int64    `json:"tier" unit:"level" min:"1" doc:"The class level that opens its tier: 1, 5, 10 or 15."`
	Name  string   `json:"name" unit:"text"`
	Text  string   `json:"text" unit:"text"`
	Rules []string `json:"rules,omitempty" unit:"refs" ref:"tags.rules" doc:"The rules whose subject holds the ability's tag."`
	Reads string   `json:"reads,omitempty" unit:"text" doc:"The game measure or command that reads the tag, when a rule cannot."`
	Waits string   `json:"waits,omitempty" unit:"text" doc:"The milestone whose system it changes, when that is not built yet."`
}

// ---- Goals ----

// Word is a word the goals' word list refuses; a stem refuses every word
// it begins.
type Word struct {
	ID   string `json:"id" unit:"id"`
	Stem bool   `json:"stem,omitempty" unit:"flag"`
}
