package sheets

import "jams.team/mmo-world/sim/fixed"

// ---- Economy ----

// RefValue is a tier's reference value (GDD 10.10): a material's value is
// the base scaled by its vector total against the median.
type RefValue struct {
	ID     string `json:"id" unit:"id"`
	Tier   int64  `json:"tier" unit:"tier" min:"1"`
	Base   int64  `json:"base" unit:"coin" min:"1"`
	Median int64  `json:"median" unit:"pts" min:"1"`
}

// StandingBand is what standing with a faction does to its orders' price
// (GDD 5.4): from this standing up to the next band's.
type StandingBand struct {
	ID      string `json:"id" unit:"id"`
	From    int64  `json:"from" unit:"standing" min:"-100" max:"100"`
	Price   int64  `json:"price" unit:"percent" doc:"Added to the order's price, against it."`
	Refuses bool   `json:"refuses,omitempty" unit:"flag" doc:"The faction will not buy from the character."`
}

// RouteRisk is the chance an ambush springs on entering a tile, by the
// threat of its region or a gauge line it is past (GDD 10.7). Bands are in
// order, safest first; cover raises a tile one band.
type RouteRisk struct {
	ID     string  `json:"id" unit:"id"`
	Name   string  `json:"name" unit:"text" doc:"The odds as a card names them."`
	Threat int64   `json:"threat" unit:"gauge" min:"0" doc:"The band holds from this threat up."`
	Line   string  `json:"line,omitempty" unit:"text" doc:"A gauge line effect that puts a region in this band whatever its threat."`
	Chance fixed.F `json:"chance" unit:"chance" min:"0" max:"1"`
}

// ---- Items ----

// Start is one of the three things a new character can choose to have
// carried (GDD 3.1): a recipe made at the start, worn in a slot.
type Start struct {
	ID      string       `json:"id" unit:"id"`
	Wear    string       `json:"wear" unit:"enum" enum:"hand|off-hand" doc:"The kit slot it starts in."`
	Process string       `json:"process" unit:"ref" ref:"items.processes"`
	Method  string       `json:"method" unit:"ref" ref:"items.methods"`
	Slot    string       `json:"slot" unit:"ref" ref:"items.slots"`
	Inputs  []StartInput `json:"inputs" unit:"parts"`
	// Exploit is the exploit a deck starts loaded with.
	Exploit []StartInput `json:"exploit,omitempty" unit:"parts" doc:"Composed into the exploit a deck holds."`
	// Skill and Practice are the practice a new character starts with.
	Skill    string `json:"skill" unit:"text"`
	Practice int64  `json:"practice" unit:"level" min:"0" doc:"Tier 1's expected practice (fights.tiers), so a first outing is winnable."`
	Doc      string `json:"doc,omitempty" unit:"text"`
}

// StartInput is one line of a start's recipe.
type StartInput struct {
	Material string `json:"material" unit:"ref" ref:"items.materials"`
	Qty      int64  `json:"qty" unit:"goods" min:"1"`
}

// ---- Tiles ----

// Trigger is a rule that reads tile or character data when a character
// arrives, explores, gathers or meets someone (GDD 8.6).
type Trigger struct {
	ID        string  `json:"id" unit:"id"`
	On        string  `json:"on" unit:"enum" enum:"arrive|explore|gather|meet"`
	Chance    fixed.F `json:"chance" unit:"chance" min:"0" max:"1"`
	Magnitude int64   `json:"magnitude" unit:"row" doc:"In the unit named by the unit column."`
	Unit      string  `json:"unit" unit:"enum" enum:"quantity"`
	Window    int64   `json:"window,omitempty" unit:"ticks" min:"0" doc:"How far back what it reads may lie."`
	Tag       string  `json:"tag,omitempty" unit:"tag" ref:"tags.vocabulary" doc:"The tag it sets, for a rule to read."`
	Doc       string  `json:"doc,omitempty" unit:"text"`
}

// ---- NPCs ----

// NPCRole is one role slot a place fills with a resident (GDD 4.18).
type NPCRole struct {
	ID    string   `json:"id" unit:"id"`
	Place string   `json:"place" unit:"enum" enum:"starting-settlement|player-settlement|city|faction-holding|structure|caravan|road"`
	Role  string   `json:"role" unit:"text"`
	Count int64    `json:"count" unit:"count" min:"1"`
	Works string   `json:"works,omitempty" unit:"text" doc:"Where its route takes it: market, forge, wall, road."`
	Tags  []string `json:"tags,omitempty" unit:"tags" ref:"tags.vocabulary" doc:"What a wanderer of this role favours, by biome or site."`
	// Rooted roles never move home: their place cannot run without them.
	Rooted bool `json:"rooted,omitempty" unit:"flag" doc:"Its place cannot spare it: it never moves home when the place grows crowded."`
}

// Topic is what an NPC can bring up (GDD 4.18): a predicate over its
// memory and knowledge, and two to four choices with their effects. A
// memory topic fires on an entry about the player of its kind; the rest
// read what the NPC knows of the world.
type Topic struct {
	ID      string        `json:"id" unit:"id"`
	When    string        `json:"when" unit:"enum" enum:"first-meeting|memory|resold|sold-on|crowding|longer-road|gossip|news|trouble|promise-kept|promise-broken|rival|weather|pattern|moved-away|corruption"`
	Entry   string        `json:"entry,omitempty" unit:"enum" enum:"greeted|asked|slighted|helped|wronged|traded|fought" doc:"The memory entry a memory topic reads."`
	Also    string        `json:"also,omitempty" unit:"enum" enum:"greeted|asked|slighted|helped|wronged|traded|fought" doc:"A second entry the topic needs as well; both add their salience."`
	AtLeast int64         `json:"atLeast,omitempty" unit:"row" doc:"The predicate's threshold, in its unit column."`
	Unit    string        `json:"unit,omitempty" unit:"enum" enum:"quantity"`
	Weight  int64         `json:"weight" unit:"weight" min:"0" max:"100" doc:"Salience before memory adds to it."`
	Choices []TopicChoice `json:"choices" unit:"parts"`
	Line    string        `json:"line" unit:"text" doc:"The templated line: {npc}, {role}, {thing}, {place}, {n} and {unit} come from fields."`
}

// Gossip is how an NPC passes on one kind of a neighbour's memory (GDD
// 4.18). A kind with no row is never passed on.
type Gossip struct {
	ID   string `json:"id" unit:"id" doc:"The kind of memory entry it voices."`
	Line string `json:"line" unit:"text" doc:"The templated line: {neighbour}, {who}, {thing} and {n} come from the entry."`
}

// TopicChoice is one choice on a topic, what taking it does, and what the
// NPC remembers of it.
type TopicChoice struct {
	ID       string `json:"id" unit:"id"`
	Effect   string `json:"effect" unit:"enum" enum:"none|standing|coin|discount|rumour|goal"`
	Standing int64  `json:"standing,omitempty" unit:"standing"`
	Coin     int64  `json:"coin,omitempty" unit:"coin" doc:"Positive: the NPC pays from its purse; negative: the player pays it."`
	Remember string `json:"remember,omitempty" unit:"enum" enum:"greeted|asked|slighted|helped|wronged|traded|fought"`
	Weight   int64  `json:"weight,omitempty" unit:"weight" min:"0" max:"100" doc:"The salience the memory starts at."`
	Line     string `json:"line" unit:"text"`
}
