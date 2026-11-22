package api

// Paths of the solo loop's reads.
const (
	PathSheet    = "/v1/sheet"
	PathHere     = "/v1/here"
	PathAppraise = "/v1/appraise"
	PathRecipes  = "/v1/recipes"
	PathRecap    = "/v1/recap"
	PathNPC      = "/v1/npc"
	PathMap      = "/v1/map"
	PathLexicon  = "/v1/lexicon"
	PathMedia    = "/v1/media/"
	PathPlayer   = "/v1/player"
)

// Player is the character a Discord user plays, or "" before /play.
type Player struct {
	CharacterID string `json:"characterId"`
}

// Action kinds of the solo loop.
const (
	ActSell    = "sell"
	ActBuy     = "buy"
	ActFeed    = "feed"
	ActEquip   = "equip"
	ActCraft   = "craft"
	ActRepair  = "repair"
	ActPick    = "pick"
	ActForage  = "forage"
	ActCrawl   = "crawl"
	ActSearch  = "search"
	ActCache   = "cache"
	ActTalk    = "talk"
	ActChoose  = "choose"
	ActConsent = "consent"
	ActLook    = "look"
)

// Starts a new character can choose to have carried (GDD 3.1).
const (
	StartHook  = "hook"
	StartKnife = "knife"
	StartDeck  = "deck"
)

// Recipe is a craft's recipe as the card builds it from selects.
type Recipe struct {
	Process string  `json:"process"`
	Method  string  `json:"method"`
	Slot    string  `json:"slot,omitempty"`
	Inputs  []Goods `json:"inputs"`
}

// Stop holds a route's stop conditions (GDD 6.1).
type Stop struct {
	Threat     int64 `json:"threat,omitempty"`
	Provisions bool  `json:"provisions,omitempty"`
	Unknown    bool  `json:"unknown,omitempty"`
}

// Load is what a character carries against what it can.
type Load struct {
	Carried  int64 `json:"carried"`
	Capacity int64 `json:"capacity"`
}

// Item is one item as its owner sees it: the item's card.
type Item struct {
	ID         string   `json:"id"`
	Kind       string   `json:"kind"`
	Name       string   `json:"name"`
	Slot       string   `json:"slot,omitempty"`
	Worn       string   `json:"worn,omitempty"` // the kit slot it is in
	Tier       int64    `json:"tier"`
	Level      int64    `json:"level"`
	XP         int64    `json:"xp"`
	ToNext     int64    `json:"toNext"`
	Durability int64    `json:"durability"`
	Max        int64    `json:"max"`
	Dormant    bool     `json:"dormant,omitempty"`
	Axes       []Part   `json:"axes"`
	Traits     []string `json:"traits"`
	Picks      []string `json:"picks"`
	Offers     []string `json:"offers,omitempty"`
	Maker      string   `json:"maker,omitempty"`
	Mount      string   `json:"mount,omitempty"`
	Exploit    *Item    `json:"exploit,omitempty"`
	WearIn     []string `json:"wearIn"`          // kit slots it may be worn in
	Deck       bool     `json:"deck,omitempty"`  // accepts a loaded exploit
	Loads      bool     `json:"loads,omitempty"` // an exploit, loaded into a deck
	Sigil      string   `json:"sigil"`           // a media key
	Value      int64    `json:"value"`           // coin, at reference
	TraderPays int64    `json:"traderPays"`      // coin a settlement's trader pays for it, as worn
}

// Standing is standing with a faction or a place.
type Standing struct {
	With  string `json:"with"`
	Value int64  `json:"value"`
}

// Count is a named count, in its unit.
type Count struct {
	Key  string `json:"key"`
	N    int64  `json:"n"`
	Unit string `json:"unit"`
}

// Find is a trigger's find, with its rarity and chance in per cent.
type Find struct {
	Trigger string  `json:"trigger"`
	Rarity  string  `json:"rarity"`
	Chance  int64   `json:"chance"`
	Goods   []Goods `json:"goods,omitempty"`
	Item    string  `json:"item,omitempty"`
}

// Sheet is a character as /character shows it: kit, pack, practice,
// standing and record.
type Sheet struct {
	Character Character  `json:"character"`
	Start     string     `json:"start,omitempty"`
	Kit       []Item     `json:"kit"`
	Pack      []Item     `json:"pack"`
	Load      Load       `json:"load"`
	Standing  []Standing `json:"standing"`
	Record    []Count    `json:"record"`
	Finds     []Find     `json:"finds"`
	Owed      int64      `json:"owed,omitempty"` // provisions an unfed mount waits on
	Consent   Consent    `json:"consent"`
	// Vows are the character's own unpaid goals still up (GDD 11.7).
	Vows []Vow `json:"vows"`
}

// Vow is a goal a character posted for no reward: its own word.
type Vow struct {
	Title string `json:"title"`
	// Broken: it vowed to hold off a thing and has not.
	Broken bool `json:"broken,omitempty"`
}

// Consent is who NPCs may name the character to (GDD 4.18).
type Consent struct {
	SameServer   bool `json:"sameServer"`
	OtherServers bool `json:"otherServers"`
}

// Consent settings an ActConsent names in Option, with Units 1 for on.
const (
	ConsentSame  = "same-server"
	ConsentOther = "other-servers"
)

// Station is a station on a tile.
type Station struct {
	Kind string `json:"kind"`
	Tier int64  `json:"tier"`
	Fee  int64  `json:"fee"` // coin
}

// Order is a standing faction buy order.
type Order struct {
	Faction  string `json:"faction"`
	Material string `json:"material"`
	Price    int64  `json:"price"`  // coin each
	Yours    int64  `json:"yours"`  // coin each to this character, after standing
	Wanted   int64  `json:"wanted"` // units still wanted today
	Refuses  bool   `json:"refuses,omitempty"`
	Fee      int64  `json:"fee"` // per cent of each fill
}

// Offer is something the market or the stable sells.
type Offer struct {
	Asset string `json:"asset"`
	Price int64  `json:"price"` // coin each
}

// Person is someone to talk to here.
type Person struct {
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	Role   string   `json:"role"`
	Kind   string   `json:"kind"`
	Traits []string `json:"traits"`
	Saved  bool     `json:"saved"`
	Visit  bool     `json:"visit"`
	// Called: it came to meet the character here, on its route.
	Called bool `json:"called,omitempty"`
}

// Trail is someone who passed recently, and where they stand now.
type Trail struct {
	Who   string `json:"who"`
	Ticks int64  `json:"ticks"` // ago
	Now   Hex    `json:"now"`
}

// Here is what a tile offers the character standing on it: its name,
// banner, stations, orders, people, trails and what has happened there.
type Here struct {
	Place     Place     `json:"place"`
	Name      string    `json:"name"`
	Banner    string    `json:"banner"` // a media key
	Stations  []Station `json:"stations"`
	Orders    []Order   `json:"orders"`
	Offers    []Offer   `json:"offers"`
	People    []Person  `json:"people"`
	Trails    []Trail   `json:"trails"`
	Search    bool      `json:"search"`
	Dungeon   string    `json:"dungeon,omitempty"` // open, cleared: the viewer's floor, else the first
	Materials []Stock   `json:"materials"`
	Forage    int64     `json:"forage"` // provisions a tick
	Recent    []Fact    `json:"recent"`
	Suggest   *Suggest  `json:"suggest,omitempty"`
	// Downed are characters down on this tile; the viewer could carry home
	// one who has called for help (GDD 11.6).
	Downed []Downed `json:"downed"`
	// Bench is set where a tinker's bench stands open (GDD 7.11).
	Bench *BenchHere `json:"bench,omitempty"`
	// Floor is the dungeon here as the viewer sees it: the floor it stands
	// on, the deepest it has reached, and its fork.
	Floor *FloorView `json:"floor,omitempty"`
}

// BenchHere is a tinker's bench as the place card states it: the
// character's bench uses today against the cap, and the lessons waiting.
type BenchHere struct {
	Uses    int64 `json:"uses"`
	UsesCap int64 `json:"usesCap"`
	Lessons int64 `json:"lessons"`
}

// Downed is a downed character: who, and whether it has called for help.
type Downed struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Called bool   `json:"called"`
	// Floor is the dungeon floor it lies on; 0 is outside. Only someone
	// on the same floor may carry it.
	Floor int64 `json:"floor,omitempty"`
}

// Suggest is the nearest site to explore: where, how far, and the first
// step toward it.
type Suggest struct {
	At    Hex   `json:"at"`
	Tiles int64 `json:"tiles"`
	Dir   int   `json:"dir"`
}

// Stock is a node's material and what it still holds.
type Stock struct {
	Material  string `json:"material"`
	Left      int64  `json:"left"`
	WorkedOut bool   `json:"workedOut"`
}

// AppraiseRequest asks what a recipe would make here.
type AppraiseRequest struct {
	CharacterID string `json:"characterId"`
	Recipe      Recipe `json:"recipe"`
}

// Appraisal is a recipe's ranges before committing (GDD 9.10): the quirk
// is never shown.
type Appraisal struct {
	Kind    string  `json:"kind"`
	Name    string  `json:"name"`
	Tier    int64   `json:"tier"`
	Slot    string  `json:"slot,omitempty"`
	Known   bool    `json:"known"`
	Axes    []Range `json:"axes"`
	Station Station `json:"station"`
	Inputs  []Goods `json:"inputs"`
	// Registered is a Master's eye's view (GDD 5.9): whether making the
	// recipe would discover nothing. Absent without the ability.
	Registered *bool `json:"registered,omitempty"`
}

// Range is an axis's appraised low and high, in pts.
type Range struct {
	Axis string `json:"axis"`
	Lo   int64  `json:"lo"`
	Hi   int64  `json:"hi"`
}

// Recipes is what the craft card builds recipes from, and the kinds the
// character knows.
type Recipes struct {
	Processes []Process `json:"processes"`
	Slots     []string  `json:"slots"`
	Known     []Known   `json:"known"`
}

// Process is a process, its methods and its stations.
type Process struct {
	ID        string   `json:"id"`
	Methods   []string `json:"methods"`
	Stations  []string `json:"stations"`
	NeedsSlot bool     `json:"needsSlot"` // its recipe names a slot
}

// Known is a kind the character made, discovered or carries.
type Known struct {
	Kind   string `json:"kind"`
	Name   string `json:"name"`
	Recipe Recipe `json:"recipe"`
	First  bool   `json:"first"` // they discovered it
}

// RecapLine is one line of what happened while away (GDD 3.3). Kind marks
// an arc that ended or a trouble at one of the character's places.
type RecapLine struct {
	Rule int    `json:"rule"`
	Kind string `json:"kind,omitempty"`
	Fact *Fact  `json:"fact,omitempty"`
	NPC  string `json:"npc,omitempty"`
}

// Kinds of recap line the story adds.
const (
	RecapArc     = "arc"
	RecapTrouble = "trouble"
)

// Recap is since you left.
type Recap struct {
	Since int64       `json:"since"`
	Tick  int64       `json:"tick"`
	Lines []RecapLine `json:"lines"`
	More  int         `json:"more"`
}

// Conversation is an NPC's topics for a character, voiced from
// templates, and its card.
type Conversation struct {
	NPC    Person  `json:"npc"`
	Topics []Topic `json:"topics"`
	Last   string  `json:"last,omitempty"`
	Met    int64   `json:"met"`
	Digest string  `json:"digest"`
	Banner string  `json:"banner"`
}

// Topic is one thing an NPC brings up.
type Topic struct {
	ID      string   `json:"id"`
	Line    string   `json:"line"`
	Own     bool     `json:"own"`
	Choices []Choice `json:"choices"`
}

// Choice is one answer and what it does.
type Choice struct {
	ID       string `json:"id"`
	Line     string `json:"line"`
	Effect   string `json:"effect"`
	Standing int64  `json:"standing,omitempty"`
	Coin     int64  `json:"coin,omitempty"`
}

// MapView is a crop of the hex map around a character (GDD 4.11, 16.4):
// the discovered tiles, and the picture of them with fog and weather.
type MapView struct {
	Tick   int64  `json:"tick"`
	Centre Hex    `json:"centre"`
	Radius int64  `json:"radius"`
	Tiles  []Tile `json:"tiles"`
	Image  string `json:"image"` // a media key
}

// Lexicon is what the setting calls things, by "sheet:id", the odds
// bands best first, and the rules' numbers the cards state.
type Lexicon struct {
	Names   map[string]string `json:"names"`
	Bands   []string          `json:"bands"`
	Starts  []string          `json:"starts"`
	Numbers Numbers           `json:"numbers"`
}

// Numbers are sheet values the cards state, so a retuned sheet never
// leaves a card saying the old number.
type Numbers struct {
	AmbushLine     int64 `json:"ambushLine"`     // threat
	OverrunLine    int64 `json:"overrunLine"`    // threat
	CrawlTicks     int64 `json:"crawlTicks"`     // ticks
	WoundedTicks   int64 `json:"woundedTicks"`   // ticks a wound adds to a long action
	FreeTicks      int64 `json:"freeTicks"`      // journey ticks before provisions are eaten
	StepMin        int64 `json:"stepMin"`        // ticks a tile
	StepMax        int64 `json:"stepMax"`        // ticks a tile
	BeatsMin       int64 `json:"beatsMin"`       // beats in a first-tier encounter
	BeatsMax       int64 `json:"beatsMax"`       // beats in a first-tier encounter
	RuinTroubles   int64 `json:"ruinTroubles"`   // troubles lost in a season that ruin a guild's settlement
	CityStationCap int64 `json:"cityStationCap"` // the tier a city's stations rise to
}
