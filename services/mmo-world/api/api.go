// Package api is the world service's HTTP contract: the request and reply
// types every client speaks. packages/mmo-api is generated from it by
// tygo, so the bot and the site never hand-write a mirror. Paths carry
// the version; a change that breaks a client takes a new one, and the
// world service deploys before its clients.
package api

// Version is the API version every path starts with (/v1/...).
const Version = 1

// Paths, under the version prefix.
const (
	PathActions   = "/v1/actions"
	PathOptions   = "/v1/options"
	PathPreview   = "/v1/preview"
	PathTiles     = "/v1/tiles"
	PathCharacter = "/v1/character"
	PathPlace     = "/v1/place"
	PathOperator  = "/v1/operator"
	PathHealth    = "/healthz"
	// PathForget takes a ForgetRequest, behind the forget token or the API
	// token: the only path the forget token opens (GDD 14.9).
	PathForget = "/v1/forget"
)

// Operator paths, behind the operator token.
const (
	PathOperatorCharacter = "/v1/operator/character"
	PathOperatorTile      = "/v1/operator/tile"
	PathOperatorAudit     = "/v1/operator/audit"
	PathOperatorDigest    = "/v1/operator/digest"
	PathOperatorReset     = "/v1/operator/reset"
	PathOperatorClock     = "/v1/operator/clock"
	// PathOperatorTicks takes ?after=<tick> and answers TickTimes.
	PathOperatorTicks = "/v1/operator/ticks"
)

// Action kinds a player sends; operators send the operator kinds through
// PathOperator.
const (
	ActCreate  = "create"
	ActStep    = "step"
	ActTravel  = "travel"
	ActGather  = "gather"
	ActRest    = "rest"
	ActCancel  = "cancel"
	ActExplore = "explore"
	ActPress   = "press"
	ActForget  = "forget" // forgets the pressing player's character (GDD 14.9)
	OpCorrect  = "correct"
	OpGrant    = "grant"
	OpBan      = "ban"
	OpUnban    = "unban"
	// OpMachine stands a character before a machine: Asset is the family,
	// Units the level.
	OpMachine = "set-machine"
)

// Hex is an axial tile coordinate.
type Hex struct {
	Q int64 `json:"q"`
	R int64 `json:"r"`
}

// Part is one line of a why: what it adds, in its unit.
type Part struct {
	Label string `json:"label"`
	Value int64  `json:"value"`
	Unit  string `json:"unit"`
}

// Why is everything behind a modifier a player sees (GDD 8.4): the parts
// that add up, the tag rules that fired, and the band before and after
// them where there is one.
type Why struct {
	Parts    []Part   `json:"parts"`
	Rules    []string `json:"rules,omitempty"`
	BandFrom string   `json:"bandFrom,omitempty"`
	BandTo   string   `json:"bandTo,omitempty"`
	Notes    []string `json:"notes,omitempty"`
}

// ActionRequest is one press. InteractionID is Discord's interaction id
// (or the Activity's equivalent), with no '/': the same id twice writes
// once. Version is the character's row version the client last saw; a
// stale one is refused with the current version. Create names the Discord
// user instead of a character.
type ActionRequest struct {
	InteractionID string `json:"interactionId"`
	DiscordID     string `json:"discordId,omitempty"`
	CharacterID   string `json:"characterId,omitempty"`
	Version       int64  `json:"version"`
	Kind          string `json:"kind"`
	Dir           int    `json:"dir,omitempty"`
	To            *Hex   `json:"to,omitempty"`
	Material      string `json:"material,omitempty"`
	Ticks         int64  `json:"ticks,omitempty"`
	Option        string `json:"option,omitempty"`
	// The solo loop's fields (GDD 3.1, 6).
	Units  int64   `json:"units,omitempty"`
	Asset  string  `json:"asset,omitempty"`
	Item   string  `json:"item,omitempty"`
	Slot   string  `json:"slot,omitempty"`
	Recipe *Recipe `json:"recipe,omitempty"`
	Stop   *Stop   `json:"stop,omitempty"`
	NPC    string  `json:"npc,omitempty"`
	Server string  `json:"server,omitempty"`
	// The market's fields (GDD 10.3): an order's price each, the character
	// given to, and a gear order's floor.
	Price  int64  `json:"price,omitempty"`
	Target string `json:"target,omitempty"`
	Floor  *Floor `json:"floor,omitempty"`
	// Goals, guilds and classes (GDD 4.8, 11): a name or note, a goal
	// posted, and whether the player is one of its server's admins.
	Note  string    `json:"note,omitempty"`
	Goal  *GoalSpec `json:"goal,omitempty"`
	Admin bool      `json:"admin,omitempty"`
	// Machine is what a machine action carries (GDD 7.11).
	Machine *MachineIntent `json:"machine,omitempty"`
	// Along is the Haul goal whose shared route a travel follows.
	Along string `json:"along,omitempty"`
	// BackRoom works a craft in a den's back room; ForSide sends a waylay's
	// haul to the prey side the character backs (GDD 4.5, 6.5).
	BackRoom bool `json:"backRoom,omitempty"`
	ForSide  bool `json:"forSide,omitempty"`
	// Staff marks a member its server counts as staff: Moderate Members, or
	// a role its settings name (GDD 14.1).
	Staff bool `json:"staff,omitempty"`
	// Staged sends a market command to the staged book here (GDD 10.8).
	Staged bool `json:"staged,omitempty"`
	// The house kinds' orders. A house-pin's As, For and Label are ignored:
	// the world takes them from the command.
	Stage    *StageOrder    `json:"stage,omitempty"`
	Case     *CaseOrder     `json:"case,omitempty"`
	Moderate *ModerateOrder `json:"moderate,omitempty"`
	Settings *HouseSettings `json:"settings,omitempty"`
	Pin      *PinOrder      `json:"pin,omitempty"`
}

// OperatorRequest is an operator's correction, grant or ban: recorded as
// a fact and replayed like any action. A world-level kind (OpHuntStart)
// names no character.
type OperatorRequest struct {
	InteractionID string `json:"interactionId"`
	CharacterID   string `json:"characterId"`
	Kind          string `json:"kind"`
	Asset         string `json:"asset,omitempty"`
	Units         int64  `json:"units,omitempty"`
	Note          string `json:"note"`
	// Target is the goal an operator hides.
	Target string `json:"target,omitempty"`
	// To is the tile a hunt opens on, or the dungeon whose name is hidden.
	To *Hex `json:"to,omitempty"`
	// Pin is what a pin kind carries.
	Pin *PinOrder `json:"pin,omitempty"`
	// Epoch is what a season-epoch takes, and Arc what an arc-cast casts.
	Epoch *Epoch    `json:"epoch,omitempty"`
	Arc   *ArcOrder `json:"arc,omitempty"`
	// Rename is what a rename sets.
	Rename *RenameOrder `json:"rename,omitempty"`
}

// ActionReply is what an accepted press did. Duplicate is true when the
// interaction had already been applied: the reply is the stored one.
type ActionReply struct {
	Duplicate bool      `json:"duplicate"`
	Tick      int64     `json:"tick"`
	Character Character `json:"character"`
	Facts     []Fact    `json:"facts"`
	Pressed   []Pressed `json:"pressed,omitempty"`
	// Machine is the fact a move log became, on a machine action.
	Machine *PuzzleResult `json:"machine,omitempty"`
	// Points are the event points the command spent from a staff pool.
	Points int64 `json:"points,omitempty"`
}

// Refusal is a press the rules turned down; nothing changed. Version is
// the character's current one, for a client that pressed a stale card.
type Refusal struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Version int64  `json:"version,omitempty"`
}

// Refusal codes the service adds.
const (
	CodeStale     = "stale"
	CodeBadJSON   = "bad-request"
	CodeNotFound  = "not-found"
	CodeForbidden = "forbidden"
	CodeInternal  = "internal"
	CodeSecondPC  = "second-character"
)

// Refusal codes the rules give.
const (
	CodeNoSuchCharacter = "no-such-character"
	CodeBusy            = "busy"
	CodeBadArgs         = "bad-arguments"
	CodeNotHere         = "not-here"
	CodeBanned          = "banned"
	CodeNoEncounter     = "no-encounter"
	CodeNeedsActivity   = "needs-activity"
	CodeDown            = "down"
	// CodeForgotten is a character that was forgotten and acts no more.
	CodeForgotten = "forgotten"
)

// Character condition IDs.
const (
	CondDown    = "down"
	CondWounded = "wounded"
	CondHungry  = "hungry"
)

// Goods are units of a material a character carries. Staged goods are
// listed apart from clean ones, by where they were staged.
type Goods struct {
	Material string    `json:"material"`
	Units    int64     `json:"units"`
	Staged   *StagedAt `json:"staged,omitempty"`
}

// Skill is a skill and its level.
type Skill struct {
	ID    string `json:"id"`
	Level int64  `json:"level"`
}

// Mount is a character's mount: its item id, kind and level.
type Mount struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	Level int64  `json:"level"`
}

// Long is the character's long action: due is the tick its next step
// comes, ends the tick it is expected to finish.
type Long struct {
	Kind     string `json:"kind"`
	Due      int64  `json:"due"`
	Ends     int64  `json:"ends"`
	Route    []Hex  `json:"route,omitempty"`
	Material string `json:"material,omitempty"`
	Left     int64  `json:"left,omitempty"`
}

// Character is a character as its owner sees it.
type Character struct {
	ID         string   `json:"id"`
	Version    int64    `json:"version"`
	At         Hex      `json:"at"`
	Coin       int64    `json:"coin"`
	Provisions int64    `json:"provisions"`
	Goods      []Goods  `json:"goods"`
	Conditions []string `json:"conditions"`
	Practice   []Skill  `json:"practice"`
	Mount      *Mount   `json:"mount,omitempty"`
	Long       *Long    `json:"long,omitempty"`
	InFight    bool     `json:"inFight"`
	Walked     int64    `json:"walked"`
	Banned     bool     `json:"banned,omitempty"`
	// Titles are the machine families it has mastered; Pouches the locked
	// pouches it carries; Armed whether a machine's countdown is running.
	Titles  []string `json:"titles,omitempty"`
	Pouches int64    `json:"pouches,omitempty"`
	Armed   bool     `json:"armed,omitempty"`
	// Floor is the dungeon floor it stands on; 0 is outside.
	Floor int64 `json:"floor,omitempty"`
	// Alignment is where it stands (GDD 5.10); Hot the stolen goods it
	// holds, Wanted the thefts the watch wants it for, and Stopped the
	// watch holding it at a gate.
	Alignment Alignment  `json:"alignment"`
	Hot       []HotGoods `json:"hot,omitempty"`
	Wanted    []WantedIn `json:"wanted,omitempty"`
	Stopped   *WatchStop `json:"stopped,omitempty"`
	// StagedXP is the experience staged fights have granted today.
	StagedXP int64 `json:"stagedXp,omitempty"`
}

// Move is a step in one of six directions: open or not, and what it
// costs, with its why.
type Move struct {
	Dir   int   `json:"dir"`
	To    Hex   `json:"to"`
	Open  bool  `json:"open"`
	Ticks int64 `json:"ticks"`
	Why   Why   `json:"why"`
}

// Option is one choice on a beat as a preview shows it: its odds band and
// stated risk, never the chance or the roll (GDD 7.3).
type Option struct {
	ID       string `json:"id"`
	Verb     string `json:"verb"`
	Kind     string `json:"kind"`
	Band     string `json:"band"`
	Risk     string `json:"risk"`
	RiskSize int64  `json:"riskSize"`
	Puzzle   bool   `json:"puzzle,omitempty"`
	Why      Why    `json:"why"`
}

// Fight is the beat a character faces. An ambush resolves with Default at
// the first tick after Due if its owner has not answered. Machine is the
// family on a Lock or Puzzle beat, which is worked in the Activity. A shared
// encounter lists its party, with who has picked, never what.
type Fight struct {
	ID       string        `json:"id"`
	Beat     int           `json:"beat"`
	Beats    int           `json:"beats"`
	Kind     string        `json:"kind"`
	Creature string        `json:"creature"`
	Ambush   bool          `json:"ambush"`
	Default  string        `json:"default,omitempty"`
	Due      int64         `json:"due,omitempty"`
	Options  []Option      `json:"options"`
	Machine  string        `json:"machine,omitempty"`
	Floor    int64         `json:"floor,omitempty"`
	Shared   bool          `json:"shared,omitempty"`
	Party    []PartyMember `json:"party,omitempty"`
	Hidden   bool          `json:"hidden,omitempty"`
	// CreatureName is the creature's name where the pack cannot know it,
	// as a region's variant; Variant is the variant row it is.
	CreatureName string `json:"creatureName,omitempty"`
	Variant      string `json:"variant,omitempty"`
	// Decks are those Second slot may swap in now: before the viewer's pick,
	// once a beat.
	Decks []DeckView `json:"decks,omitempty"`
	// Portrait is the creature's picture, a media key.
	Portrait string `json:"portrait,omitempty"`
	// Theft is set on a theft or a flight from the watch.
	Theft *Theft `json:"theft,omitempty"`
}

// Options is everything a character can do now. Version is the row
// version an action built from it must name.
type Options struct {
	CharacterID string   `json:"characterId"`
	Version     int64    `json:"version"`
	Tick        int64    `json:"tick"`
	At          Hex      `json:"at"`
	Conditions  []string `json:"conditions"`
	Moves       []Move   `json:"moves"`
	Materials   []string `json:"materials"`
	GatherMin   int64    `json:"gatherMin"`
	GatherMax   int64    `json:"gatherMax"`
	Rest        bool     `json:"rest"`
	Explore     bool     `json:"explore"`
	Cancel      bool     `json:"cancel"`
	Long        *Long    `json:"long,omitempty"`
	Fight       *Fight   `json:"fight,omitempty"`
	Purse       Purse    `json:"purse"`
	Rescue      *Rescue  `json:"rescue,omitempty"`
	// Sides are the arc sides the character could back now.
	Sides []SideOption `json:"sides,omitempty"`
	// Steals are what the character could steal here now.
	Steals []StealTarget `json:"steals"`
}

// Rescue is a character's part in a rescue (GDD 11.6): whether it has
// called for help and at which settlement its Carry goal hangs, and whom
// it carries or is carried by.
type Rescue struct {
	Called    bool   `json:"called"`
	Home      string `json:"home"`
	Carrying  string `json:"carrying,omitempty"`
	CarriedBy string `json:"carriedBy,omitempty"`
	// CarryingHome is the settlement the character it carries is set down
	// at, rescued.
	CarryingHome string `json:"carryingHome,omitempty"`
}

// Purse is what a character holds and, in a market, the prices there:
// what a policy weighs before it trades.
type Purse struct {
	Coin       int64   `json:"coin"`
	Provisions int64   `json:"provisions"`
	Goods      []Goods `json:"goods"`
	Load       Load    `json:"load"`
	Hand       *Worn   `json:"hand,omitempty"` // what the main hand holds
	Market     bool    `json:"market"`         // standing in a market
	Provision  int64   `json:"provision"`      // coin a provision costs here, 0 where none are sold
	Quotes     []Quote `json:"quotes,omitempty"`
	Open       int64   `json:"open"` // open orders, listings and gear orders held
	Markets    []Hex   `json:"markets"`
	Items      []Worn  `json:"items"` // carried, not worn
	Mounted    bool    `json:"mounted"`
	Owed       int64   `json:"owed"` // provisions a mount is owed
	// Mounts are the mounts a stable here sells, and Listings the
	// cheapest gear listed here.
	Mounts   []Offer   `json:"mounts,omitempty"`
	Listings []Listing `json:"listings,omitempty"`
}

// Worn is an item's wear, its value, and what repairing it takes.
type Worn struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Value      int64  `json:"value"` // coin
	Repair     Goods  `json:"repair"`
	Durability int64  `json:"durability"`
	Max        int64  `json:"max"`
}

// Quote is one material's best prices here and its reference value.
type Quote struct {
	Material string `json:"material"`
	Bid      int64  `json:"bid"`
	BidUnits int64  `json:"bidUnits"`
	Ask      int64  `json:"ask"`
	Value    int64  `json:"value"`
	Staged   bool   `json:"staged,omitempty"` // the staged book's
}

// PreviewRequest asks for one option's band before pressing it.
type PreviewRequest struct {
	CharacterID string `json:"characterId"`
	Option      string `json:"option"`
}

// Pressed is a resolved press: the option, whether it succeeded, and why.
type Pressed struct {
	Option  string `json:"option"`
	Band    string `json:"band"`
	Success bool   `json:"success"`
	Why     Why    `json:"why"`
}

// Ref names a thing a fact is about: its kind and id.
type Ref struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

// Datum is one keyed value of a fact, a number or a string.
type Datum struct {
	Key string `json:"k"`
	N   int64  `json:"n,omitempty"`
	S   string `json:"s,omitempty"`
}

// Fact is a fact as clients render it: text is made from facts, never
// stored (GDD 12.1).
type Fact struct {
	ID       int64   `json:"id"`
	Tick     int64   `json:"tick"`
	Kind     string  `json:"kind"`
	Region   string  `json:"region,omitempty"`
	Subjects []Ref   `json:"subjects"`
	Data     []Datum `json:"data"`
	Weight   int64   `json:"weight"`
	// Causes are the ids of the facts it was caused by, where they are known.
	Causes []int64 `json:"causes,omitempty"`
	// Staged marks a fact an operator or placed content caused (GDD 14.5).
	Staged bool `json:"staged,omitempty"`
}

// TileQuery asks for the discovered tiles within Radius of Centre.
type TileQuery struct {
	Centre Hex   `json:"centre"`
	Radius int64 `json:"radius"`
}

// Tile is a discovered tile. Undiscovered tiles are never returned, on
// any layer: weather over fog would leak terrain.
type Tile struct {
	Hex        Hex      `json:"hex"`
	Terrain    string   `json:"terrain"`
	Water      string   `json:"water"`
	Site       string   `json:"site,omitempty"`
	Landmark   string   `json:"landmark,omitempty"`
	Region     string   `json:"region"`
	Road       int64    `json:"road"`
	Structures []string `json:"structures,omitempty"`
	Weather    string   `json:"weather,omitempty"`
	Found      int64    `json:"found"` // the tick it was first entered
	SiteKind   string   `json:"siteKind,omitempty"`
	Placed     *Placed  `json:"placed,omitempty"`
	// RoadName is the named road the tile is on; Cut while it is cut, and
	// Toll the coin a crossing costs while it is tolled.
	RoadName string `json:"roadName,omitempty"`
	Cut      bool   `json:"cut,omitempty"`
	Toll     int64  `json:"toll,omitempty"`
	// Camp is the name of a camp on the site; Haunted, a haunt over it.
	Camp    string `json:"camp,omitempty"`
	Haunted bool   `json:"haunted,omitempty"`
}

// Tiles is the reply to a TileQuery.
type Tiles struct {
	Tick  int64  `json:"tick"`
	Tiles []Tile `json:"tiles"`
}

// Gauge is a region gauge with its band of the gauge's lines.
type Gauge struct {
	ID    string `json:"id"`
	Value int64  `json:"value"`
	Unit  string `json:"unit"`
}

// Place is a discovered tile and its region, as a hub card reads it.
type Place struct {
	Tick    int64    `json:"tick"`
	Tile    Tile     `json:"tile"`
	Gauges  []Gauge  `json:"gauges"`
	Holder  string   `json:"holder,omitempty"`
	Here    []string `json:"here"` // characters standing on the tile
	Explore bool     `json:"explore"`
	Rest    bool     `json:"rest"`
	Overrun bool     `json:"overrun,omitempty"`
	// The story here: a settlement's trouble or occasion, its city state,
	// whether it is a ruin, the pattern point on the tile, and whether the
	// core here is open.
	Trouble  *Trouble      `json:"trouble,omitempty"`
	Occasion *Occasion     `json:"occasion,omitempty"`
	City     *CityState    `json:"city,omitempty"`
	Ruined   bool          `json:"ruined,omitempty"`
	Pattern  *PatternPoint `json:"pattern,omitempty"`
	Open     bool          `json:"open,omitempty"`
}

// Health is the service's liveness and where the world is. Standby is a
// service waiting for another to give the world up: alive, not serving.
// Stalled is a world whose ticks keep failing or that no longer loads.
type Health struct {
	OK      bool   `json:"ok"`
	Standby bool   `json:"standby,omitempty"`
	Stalled bool   `json:"stalled,omitempty"`
	World   string `json:"world"`
	Tick    int64  `json:"tick"`
	Due     int64  `json:"due"`
	Version int    `json:"version"`
}

// Digest is the world's tick and digest.
type Digest struct {
	Tick   int64  `json:"tick"`
	Digest string `json:"digest"`
}

// Audit is the conservation check's discrepancies; none when it holds.
type Audit struct {
	Discrepancies []string `json:"discrepancies"`
}

// ResetRequest names the disposable world to wipe and found again.
type ResetRequest struct {
	World string `json:"world"`
}

// ResetReply is the founded world and its tick.
type ResetReply struct {
	World string `json:"world"`
	Tick  int64  `json:"tick"`
}

// ClockRequest sets a manual clock's due tick; the reply echoes it.
type ClockRequest struct {
	Due int64 `json:"due"`
}

// ForgetRequest asks the world to forget a Discord user's character (GDD
// 14.9). InteractionID makes a repeat write once.
type ForgetRequest struct {
	InteractionID string `json:"interactionId"`
	DiscordID     string `json:"discordId"`
}

// ForgetReply says whether a character was found and is forgotten, now or
// before, and whether its holdings have left it yet: they leave at the
// first tick it is free of fights, carries and caravans.
type ForgetReply struct {
	Forgotten bool `json:"forgotten"`
	Swept     bool `json:"swept"`
}

// TickTime is one tick's cost. StepMs is the whole step: the lock wait,
// Advance, the save and the map pass. Behind is due minus tick after it.
type TickTime struct {
	Tick      int64 `json:"tick"`
	AdvanceMs int64 `json:"advanceMs"`
	StepMs    int64 `json:"stepMs"`
	Behind    int64 `json:"behind"`
}

// TickTimes are the latest ticks' costs, oldest first, and the tick length
// they are read against.
type TickTimes struct {
	TickMs int64      `json:"tickMs"`
	Ticks  []TickTime `json:"ticks"`
}
