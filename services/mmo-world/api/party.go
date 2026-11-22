package api

// Paths of parties and hunts (GDD 7.5, 7.6). PathParties is the bot's
// alone.
const (
	PathParty   = "/v1/party"
	PathParties = "/v1/parties"
	PathHunts   = "/v1/hunts"
)

// Action kinds of parties, dungeons and hunts.
const (
	ActPartyInvite  = "party-invite"
	ActPartyJoin    = "party-join"
	ActPartyLeave   = "party-leave"
	ActPartyPick    = "party-pick"
	ActPartyWindow  = "party-window" // the pick-window clock's, never a player's
	ActFollow       = "follow"
	ActUnfollow     = "unfollow"
	ActDungeonPush  = "dungeon-push"
	ActDungeonLeave = "dungeon-leave"
	ActDungeonName  = "dungeon-name"
	ActKeyMake      = "key-make"
	ActHuntPress    = "hunt-press"
	ActDeckSwap     = "deck-swap"
	ActFollowTrack  = "follow-track"
	// OpHuntStart opens a hunt: Asset is the fights.hunts row, To the tile.
	// It acts on the world, so it names no character.
	OpHuntStart = "hunt-start"
	// OpHideName hides a dungeon's given name: To is the entrance.
	OpHideName = "hide-name"
	// OpReady brings a character's gear and practice to a tier's expected
	// levels: Units is the tier.
	OpReady = "set-ready"
)

// The ways down from a fork, as dungeon-push's Option names them.
const (
	WayOpen    = "way-0"
	WayMachine = "way-1"
	WayHidden  = "way-2"
)

// Machine sources a party plays.
const (
	MachineParty    = "party"
	MachineFork     = "fork"
	MachineGuardian = "guardian"
)

// Refusal codes the party, dungeon and hunt rules give.
const (
	CodeNotInParty = "not-in-party"
	CodeInParty    = "in-party"
	CodePartyFull  = "party-full"
	CodeOutOfReach = "out-of-reach"
	CodeNoInvite   = "no-invite"
	CodePicked     = "picked"
	CodeNotDue     = "not-due"
	CodeNoFork     = "no-fork"
	CodeNoWay      = "no-way"
	CodeChose      = "chose"
	CodeNamed      = "named"
	CodeBadName    = "bad-name"
	CodeNotLeader  = "not-leader"
	CodeNoKeyMaker = "no-key-maker"
	CodeShort      = "short"
	CodeNoHunt     = "no-hunt"
	CodePressed    = "pressed"
	CodeOpenHunt   = "open-hunt"
	CodeNoSuchRow  = "no-such-row"
	CodeNoSlot     = "no-slot"
	CodeSwapped    = "swapped"
	CodeNoTrack    = "no-track"
	CodeRivalWon   = "rival-won"
	CodeNoRoute    = "no-route"
	CodeUsed       = "used"
)

// CodePartyNotSeated is the gateway's own: a party machine arms only
// when every member present has a seat bound to the party.
const CodePartyNotSeated = "party-not-seated"

// The kinds of context a seat is bound to.
const (
	ContextSolo  = "solo"
	ContextParty = "party"
	ContextHunt  = "hunt"
)

// The frames a party machine's moves travel in.
const (
	FrameMove  = "move"  // client → gateway: one move; gateway → seats: one seated move
	FrameMoves = "moves" // gateway → a seat: the merged log so far, on return
)

// PartyView is the viewer's party, as the Activity draws it.
type PartyView struct {
	ID      string        `json:"id"`
	Leader  bool          `json:"leader"` // the viewer leads
	Members []PartyMember `json:"members"`
	Beat    *PartyBeat    `json:"beat,omitempty"`
	Last    *PartyResult  `json:"last,omitempty"`
}

// PartyMember is one member as the others see them: whether they have
// picked, never what.
type PartyMember struct {
	Name    string `json:"name"`
	You     bool   `json:"you,omitempty"`
	Here    bool   `json:"here"`
	Down    bool   `json:"down,omitempty"`
	Picked  bool   `json:"picked,omitempty"`
	Floor   int64  `json:"floor,omitempty"`
	Seat    int64  `json:"seat"` // -1 when not in the shared encounter
	Follows bool   `json:"follows,omitempty"`
}

// PartyBeat is the shared encounter's open beat and its pick window.
type PartyBeat struct {
	Beat     int64  `json:"beat"` // 1-based
	Beats    int64  `json:"beats"`
	Kind     string `json:"kind"`
	Picked   int64  `json:"picked"`
	Present  int64  `json:"present"`
	Opened   int64  `json:"opened,omitempty"` // unix ms
	Due      int64  `json:"due,omitempty"`    // unix ms
	Cautious string `json:"cautious"`
	Mine     string `json:"mine,omitempty"`    // the viewer's own pick
	Waiting  bool   `json:"waiting,omitempty"` // the window waits on a machine
}

// PartyResult is the last beat the viewer's shared encounter resolved,
// every member's press the same for each of them.
type PartyResult struct {
	Beat    int64        `json:"beat"` // 1-based
	Pressed []PartyPress `json:"pressed"`
}

// PartyPress is one member's press on a resolved beat.
type PartyPress struct {
	Name    string `json:"name"`
	Option  string `json:"option"`
	Band    string `json:"band"`
	Success bool   `json:"success"`
}

// RivalView is another context working the same fork machine: the first
// solve to land takes it.
type RivalView struct {
	Name    string `json:"name"`            // the rival party's leader
	ArmedAt int64  `json:"armedAt"`         // unix ms
	Moves   int64  `json:"moves,omitempty"` // from the gateway's merged log
}

// DeckView is a deck carried in the pack that Second slot may swap in.
type DeckView struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// FloorView is the dungeon floor the viewer stands on, and its fork.
type FloorView struct {
	Dungeon string       `json:"dungeon"` // "q,r"
	Name    string       `json:"name,omitempty"`
	Kind    string       `json:"kind"`
	Up      bool         `json:"up,omitempty"`
	Floor   int64        `json:"floor"`
	Deepest int64        `json:"deepest"`          // the viewer's; never the count
	Bottom  bool         `json:"bottom,omitempty"` // only once the viewer stands on it
	Ways    []WayView    `json:"ways,omitempty"`
	Choices []ChoiceView `json:"choices,omitempty"`
	Opened  int64        `json:"opened,omitempty"` // unix ms
	Due     int64        `json:"due,omitempty"`    // unix ms
	Pool    []Goods      `json:"pool,omitempty"`   // Hoard sense only
	Haunted bool         `json:"haunted,omitempty"`
	Downed  []string     `json:"downed,omitempty"` // names down on this floor
	Placed  *Placed      `json:"placed,omitempty"`
}

// WayView is one way down from a fork.
type WayView struct {
	ID      string   `json:"id"` // a Way* id
	Name    string   `json:"name"`
	Tags    []string `json:"tags"`
	Open    bool     `json:"open"`
	Machine string   `json:"machine,omitempty"` // the family behind it
	Next    []string `json:"next,omitempty"`    // Mapper: the next floor's first beat's tags
	Votes   int64    `json:"votes"`
}

// ChoiceView is one member's choice at a fork: choices are open.
type ChoiceView struct {
	Name string `json:"name"`
	Push bool   `json:"push"`
	Way  string `json:"way,omitempty"`
}

// HuntView is the live hunt within the viewer's reach.
type HuntView struct {
	ID       string        `json:"id"`
	Name     string        `json:"name"`
	Creature string        `json:"creature"`
	Health   int64         `json:"health"`
	Max      int64         `json:"max"`
	Ends     int64         `json:"ends"`   // tick
	EndsIn   int64         `json:"endsIn"` // ticks
	Pressers []HuntPresser `json:"pressers"`
	Mine     int64         `json:"mine"`
	Share    int64         `json:"share"`  // percent of the spoils the viewer's removal is worth now
	Spoils   []Goods       `json:"spoils"` // the row's, the most each line can roll
	CanPress bool          `json:"canPress"`
	Options  []Option      `json:"options,omitempty"`
}

// HuntPresser is one character's part in a hunt: the health it removed.
type HuntPresser struct {
	Name    string `json:"name"`
	Removed int64  `json:"removed"`
	You     bool   `json:"you,omitempty"`
}

// SeatView is one seat of a party machine.
type SeatView struct {
	Seat  int64  `json:"seat"`
	Name  string `json:"name"`
	You   bool   `json:"you,omitempty"`
	Moved bool   `json:"moved,omitempty"`
	Here  bool   `json:"here"` // seated in the instance
}

// OpenWindow is a pick window the clock must close: at Due the named
// member sends party-window.
type OpenWindow struct {
	Shared    string `json:"shared"`
	Character string `json:"character"` // the first present member
	Opened    int64  `json:"opened"`    // unix ms
	Due       int64  `json:"due"`       // unix ms
}

// PartyState is GET /v1/party: the viewer's party, who is in reach to
// invite, the invitations held, and the open beat or fork in the viewer's
// own view.
type PartyState struct {
	Tick        int64         `json:"tick"`
	CharacterID string        `json:"characterId"`
	Version     int64         `json:"version"`
	Party       *PartyView    `json:"party,omitempty"`
	Reach       []Reachable   `json:"reach"`
	Invites     []PartyInvite `json:"invites"`
	Floor       *FloorView    `json:"floor,omitempty"`
	Fight       *Fight        `json:"fight,omitempty"`
	Thread      *PartyThread  `json:"thread,omitempty"`
	Hunt        *HuntView     `json:"hunt,omitempty"` // a live hunt in reach, as chat presses it
}

// Reachable is a character in party reach of the viewer.
type Reachable struct {
	CharacterID string `json:"characterId"`
	Name        string `json:"name"`
	InParty     bool   `json:"inParty,omitempty"` // in a party already: no invitation reaches it
}

// PartyInvite is an invitation the viewer holds.
type PartyInvite struct {
	Party       string `json:"party"`
	CharacterID string `json:"characterId"` // who invited; party-join's Target
	Name        string `json:"name"`
	Until       int64  `json:"until"` // tick
}

// PartyThread is what the bot needs to keep a party's thread: the
// members' Discord users, to add them.
type PartyThread struct {
	Party   string   `json:"party"`
	Members []string `json:"members"` // Discord ids, in join order
}

// Parties is GET /v1/parties: every open party, and those ended since the
// last tick, so the bot can open and close threads.
type Parties struct {
	Tick    int64        `json:"tick"`
	Parties []PartyBoard `json:"parties"`
}

// PartyBoard is one party as its thread card shows it to every member:
// who has picked or chosen, never what.
type PartyBoard struct {
	ID      string        `json:"id"`
	Members []BoardMember `json:"members"`
	Beat    *PartyBeat    `json:"beat,omitempty"` // Mine is never set
	Fork    *ForkBoard    `json:"fork,omitempty"`
	Opened  int64         `json:"opened,omitempty"` // unix ms
	Due     int64         `json:"due,omitempty"`    // unix ms
	Ended   bool          `json:"ended,omitempty"`
}

// BoardMember is one member on a party's thread card.
type BoardMember struct {
	CharacterID string `json:"characterId"`
	DiscordID   string `json:"discordId"`
	Name        string `json:"name"`
	Picked      bool   `json:"picked,omitempty"`
	Chose       bool   `json:"chose,omitempty"`
	Down        bool   `json:"down,omitempty"`
}

// ForkBoard is a party's open fork as every member may see it: the ways
// and their votes, with no member's own reads (Mapper, Hoard sense).
type ForkBoard struct {
	Dungeon string    `json:"dungeon"` // "q,r"
	Name    string    `json:"name,omitempty"`
	Kind    string    `json:"kind"`
	Up      bool      `json:"up,omitempty"`
	Floor   int64     `json:"floor"`
	Ways    []WayView `json:"ways"`
	Waiting bool      `json:"waiting,omitempty"` // the party's machine is armed, so the window waits
}

// HuntBoard is GET /v1/hunts: every live hunt, and those closed since the
// last tick, for the game channel's cards.
type HuntBoard struct {
	Tick int64 `json:"tick"`
	// Every is the least ticks between two edits of one card.
	Every int64      `json:"every"`
	Hunts []HuntCard `json:"hunts"`
}

// HuntCard is one hunt's card in the game channel. A closed hunt carries
// how it ended: slain with the roll and each presser's part, or left with
// the health it kept.
type HuntCard struct {
	ID       string        `json:"id"`
	Row      string        `json:"row"`
	Name     string        `json:"name"`
	Creature string        `json:"creature"`
	At       Hex           `json:"at"`
	Region   string        `json:"region"`
	Banner   string        `json:"banner,omitempty"` // the hunt tile's, a media key
	Health   int64         `json:"health"`
	Max      int64         `json:"max"`
	Ends     int64         `json:"ends"` // tick
	Pressers []HuntPresser `json:"pressers"`
	Spoils   []Goods       `json:"spoils"` // the row's, the most each line can roll
	Closed   bool          `json:"closed,omitempty"`
	Slain    bool          `json:"slain,omitempty"`
	Rolled   []Goods       `json:"rolled,omitempty"`
	Shares   []HuntShare   `json:"shares,omitempty"`
}

// HuntShare is one presser's part of a slain hunt's roll.
type HuntShare struct {
	Name    string  `json:"name"`
	Removed int64   `json:"removed"`
	Goods   []Goods `json:"goods"`
}
