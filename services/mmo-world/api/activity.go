package api

// Paths on the world service's Activity listener. Discord's proxy puts
// /.proxy in front; the listener strips it.
const (
	PathActivityToken  = "/api/activity/token"
	PathActivitySocket = "/api/activity/ws"
	PathActivityLog    = "/api/activity/log"
)

// What Discord's proxy puts in front of every path, and the placeholder
// the Activity's build leaves for the application id.
const (
	ActivityProxyPrefix  = "/.proxy"
	ActivityClientIDMark = "__DISCORD_CLIENT_ID__"
)

// The frames of the Activity's socket.
const (
	FrameHello    = "hello"
	FrameLook     = "look"
	FrameIntent   = "intent"
	FramePassHint = "pass-hint"
	FramePing     = "ping"
	FrameState    = "state"
	FrameReply    = "reply"
	FrameHint     = "hint"
	FrameBye      = "bye"
	FramePong     = "pong"
)

// Why the gateway tells a socket to go.
const (
	ByeExpired     = "expired"
	ByeReplaced    = "replaced"
	ByeNoCharacter = "no-character"
	ByeBadHello    = "bad-hello"
	ByeSlow        = "slow"
)

// Machine actions, as the Activity sends them. POST /v1/actions takes the
// bench's; a countdown's are the Activity's alone.
const (
	ActMachineArm   = "machine-arm"
	ActMachineSolve = "machine-solve"
	ActBenchSolve   = "bench-solve"
	ActBenchLesson  = "bench-lesson"
)

// ActivityKinds are the writes the Activity may send; everything else is
// done in chat. A party's picks, fork choices and hunt presses are one
// command from either surface.
var ActivityKinds = []string{ActPress, ActMachineArm, ActMachineSolve, ActBenchSolve, ActBenchLesson,
	ActPartyPick, ActDungeonPush, ActDungeonLeave, ActHuntPress, ActDeckSwap}

// ActivityOnly reports whether a kind is refused in chat: a countdown is
// ended by the Activity's gateway, so it is armed and solved only there.
func ActivityOnly(kind string) bool { return kind == ActMachineArm || kind == ActMachineSolve }

// Refusal codes the machine rules give.
const (
	CodeNoMachine    = "no-machine"
	CodeMachineArmed = "machine-armed"
	CodeLockedDown   = "locked-down"
	CodeNoLesson     = "no-lesson"
)

// Where a machine is; a party's are MachineParty, MachineFork and
// MachineGuardian.
const (
	MachineBeat    = "beat"
	MachinePouch   = "pouch"
	MachineBench   = "bench"
	MachinePattern = "pattern" // a pattern's point
)

// PuzzleMove is one input, in milliseconds since the first touch. Seat is
// the hand that made it on a party machine; the gateway stamps it.
type PuzzleMove struct {
	At   int64 `json:"at"`
	A    int64 `json:"a"`
	B    int64 `json:"b,omitempty"`
	C    int64 `json:"c,omitempty"`
	Seat int64 `json:"seat,omitempty"`
}

// PuzzleLog is what a client sends for a machine: its inputs and the
// millisecond it stopped at.
type PuzzleLog struct {
	Moves []PuzzleMove `json:"moves"`
	End   int64        `json:"end,omitempty"`
}

// PuzzleClue says fuse Before is pulled before fuse After.
type PuzzleClue struct {
	Before int64 `json:"before"`
	After  int64 `json:"after"`
}

// PuzzleLayout is a machine as it is drawn. It carries no level, tier,
// place or generation key; Key is a party version's extra array. In a
// seat's dealt view an element it is not shown is Unseen.
type PuzzleLayout struct {
	Family string       `json:"family"`
	Size   int64        `json:"size"`
	Decoys int64        `json:"decoys"`
	Target []int64      `json:"target,omitempty"`
	Glyph  []int64      `json:"glyph,omitempty"`
	Order  []int64      `json:"order,omitempty"`
	False  []int64      `json:"false,omitempty"`
	Turn   []int64      `json:"turn,omitempty"`
	Walls  []int64      `json:"walls,omitempty"`
	Tiles  []int64      `json:"tiles,omitempty"`
	Clues  []PuzzleClue `json:"clues,omitempty"`
	Start  int64        `json:"start"`
	Goal   int64        `json:"goal"`
	Range  int64        `json:"range,omitempty"`
	Step   int64        `json:"step,omitempty"`
	Par    []int64      `json:"par,omitempty"`
	Init   []int64      `json:"init,omitempty"`
	Track  []int64      `json:"track,omitempty"`
	Shape  int64        `json:"shape,omitempty"`
	Party  string       `json:"party,omitempty"`
	Seats  int64        `json:"seats,omitempty"`
	Window int64        `json:"window,omitempty"` // ms
	Pass   int64        `json:"pass,omitempty"`
	Key    []int64      `json:"key,omitempty"`
	Code   []int64      `json:"code,omitempty"`
}

// Unseen is an element of a dealt view the seat is not shown.
const Unseen = -1 << 31

// PuzzleResult is the one fact a move log became.
type PuzzleResult struct {
	Solved  bool   `json:"solved"`
	Clean   bool   `json:"clean"`
	Master  bool   `json:"master,omitempty"`
	Late    bool   `json:"late,omitempty"`
	At      int64  `json:"at"`
	Haywire string `json:"haywire,omitempty"`
}

// MachineIntent is what a machine action carries.
type MachineIntent struct {
	Source  string     `json:"source,omitempty"` // beat, pouch or bench
	Pouch   string     `json:"pouch,omitempty"`
	Family  string     `json:"family,omitempty"` // the bench's rig
	Level   int64      `json:"level,omitempty"`
	Compact bool       `json:"compact,omitempty"`
	Teach   bool       `json:"teach,omitempty"` // leave a bench solve as a lesson
	Log     *PuzzleLog `json:"log,omitempty"`
}

// TokenRequest trades the Embedded App SDK's authorize code for a session.
// Dev names a Discord user outright, on a disposable world with dev
// sign-in on.
type TokenRequest struct {
	Code string `json:"code,omitempty"`
	Dev  string `json:"dev,omitempty"`
}

// TokenReply is a gateway session and who it signs in.
type TokenReply struct {
	Session     string `json:"session"`
	Expires     int64  `json:"expires"` // unix seconds
	DiscordID   string `json:"discordId"`
	CharacterID string `json:"characterId,omitempty"`
}

// Viewer is what a client says of its screen: a phone's caps, and the
// bench rig or pouch it has open.
type Viewer struct {
	Compact bool   `json:"compact,omitempty"`
	Family  string `json:"family,omitempty"`
	Level   int64  `json:"level,omitempty"`
	Pouch   string `json:"pouch,omitempty"`
}

// Context is the game context a seat is bound to: a Context* kind and its
// id, the character for solo, else the party or the hunt.
type Context struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

// ClientMessage is one frame to the gateway; T is a client Frame* name.
type ClientMessage struct {
	T      string       `json:"t"`
	Seq    int64        `json:"seq,omitempty"`
	Hello  *ClientHello `json:"hello,omitempty"`
	Look   *Viewer      `json:"look,omitempty"`
	Intent *Intent      `json:"intent,omitempty"`
	Hint   *PuzzleMove  `json:"hint,omitempty"`
	Move   *PuzzleMove  `json:"move,omitempty"`
}

// ClientHello opens a socket: the session token, the Activity instance and the screen.
type ClientHello struct {
	Session  string `json:"session"`
	Instance string `json:"instance"`
	Viewer   Viewer `json:"viewer"`
}

// Intent is a write. The gateway fills in the character and makes the
// idempotency key from ID.
type Intent struct {
	ID      string         `json:"id"`
	Version int64          `json:"version"`
	Kind    string         `json:"kind"`
	Option  string         `json:"option,omitempty"`
	Machine *MachineIntent `json:"machine,omitempty"`
	Target  string         `json:"target,omitempty"` // a hunt-press's hunt
	Item    string         `json:"item,omitempty"`   // a deck-swap's deck
}

// ServerMessage is one frame from the gateway; T is a server Frame* name.
type ServerMessage struct {
	T     string         `json:"t"`
	Seq   int64          `json:"seq,omitempty"`
	State *ActivityState `json:"state,omitempty"`
	Reply *IntentReply   `json:"reply,omitempty"`
	Hint  *PuzzleMove    `json:"hint,omitempty"`
	Bye   string         `json:"bye,omitempty"` // a Bye* reason
	Move  *PuzzleMove    `json:"move,omitempty"`
	Moves []PuzzleMove   `json:"moves,omitempty"`
}

// IntentReply is the world's answer to one intent.
type IntentReply struct {
	ID        string        `json:"id"`
	OK        bool          `json:"ok"`
	Duplicate bool          `json:"duplicate,omitempty"`
	Refusal   *Refusal      `json:"refusal,omitempty"`
	Facts     []Fact        `json:"facts,omitempty"`
	Pressed   []Pressed     `json:"pressed,omitempty"`
	Machine   *PuzzleResult `json:"machine,omitempty"`
}

// ActivityState is everything one viewer may see of their context, whole,
// each time it changes. Now is the server's clock when it was built.
type ActivityState struct {
	Tick      int64        `json:"tick"`
	Now       int64        `json:"now"` // unix ms
	Context   Context      `json:"context"`
	Character Character    `json:"character"`
	Place     ActivityHere `json:"place"`
	Fight     *Fight       `json:"fight,omitempty"`
	Machine   *MachineView `json:"machine,omitempty"`
	Bench     *BenchView   `json:"bench,omitempty"`
	Pouches   []PouchView  `json:"pouches,omitempty"`
	Last      *MachineDone `json:"last,omitempty"`
	Party     *PartyView   `json:"party,omitempty"`
	Floor     *FloorView   `json:"floor,omitempty"`
	Hunt      *HuntView    `json:"hunt,omitempty"`
	// Pattern is the pattern point the character stands on.
	Pattern *PatternPoint `json:"pattern,omitempty"`
	// Names are the names of found ids the state shows, "sheet:id" to name:
	// what the pack cannot know.
	Names map[string]string `json:"names,omitempty"`
}

// ActivityHere is the tile the character stands on, and how busy it is.
type ActivityHere struct {
	Tile Tile   `json:"tile"`
	Name string `json:"name,omitempty"`
	Busy int64  `json:"busy"` // characters here, the viewer included
}

// Reason is one line of a machine's why: a number with its unit, and the
// fact behind it.
type Reason struct {
	Label string `json:"label"`
	Value int64  `json:"value"`
	Unit  string `json:"unit"`
}

// What a haywire that puts a state on lasts: so many beats, or the rest
// of the encounter.
const (
	UnitBeats     = "beats"
	UnitEncounter = "encounter"
)

// HaywireLine is what a machine does when it fails. Unit is the row's own,
// or for a state one of the two above.
type HaywireLine struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Magnitude int64  `json:"magnitude"`
	Unit      string `json:"unit"`
	Tag       string `json:"tag,omitempty"`
}

// MachineView is the machine a viewer may work. Level, Countdown, Why and
// Haywire are set at rest only for a viewer with the preview, and always
// once armed. A bench rig carries its Level and MaxPlay and none of the rest.
// On a party machine Layout is the viewer's seat's dealt view, and Movers
// counts the seats that have moved.
type MachineView struct {
	Source    string        `json:"source"`
	Pouch     string        `json:"pouch,omitempty"`
	Family    string        `json:"family"`
	Name      string        `json:"name"`
	Layout    PuzzleLayout  `json:"layout"`
	Inner     *PuzzleLayout `json:"inner,omitempty"` // a master's hidden panel
	Compact   bool          `json:"compact,omitempty"`
	Intro     bool          `json:"intro,omitempty"`
	Preview   bool          `json:"preview"`
	Level     int64         `json:"level,omitempty"`
	Countdown int64         `json:"countdown,omitempty"` // ms; never set at a bench
	MaxPlay   int64         `json:"maxPlay,omitempty"`   // ms a bench rig may be played for
	Why       []Reason      `json:"why,omitempty"`
	Haywire   *HaywireLine  `json:"haywire,omitempty"`
	Guide     *PuzzleMove   `json:"guide,omitempty"`
	Hints     []PuzzleMove  `json:"hints,omitempty"`
	CanPass   bool          `json:"canPass,omitempty"`
	Pass      *PuzzleMove   `json:"pass,omitempty"` // the move a master may pass on, while CanPass
	Armed     bool          `json:"armed"`
	ArmedAt   int64         `json:"armedAt,omitempty"`  // unix ms
	Deadline  int64         `json:"deadline,omitempty"` // unix ms, grace not included
	Grace     int64         `json:"grace,omitempty"`    // ms
	Due       int64         `json:"due,omitempty"`      // unix ms, grace included: when the server ends it
	Locked    int64         `json:"locked,omitempty"`   // ticks until a lockdown lifts
	Practice  PracticeLine  `json:"practice"`
	Party     string        `json:"party,omitempty"` // a party version
	Seat      int64         `json:"seat,omitempty"`
	Seats     []SeatView    `json:"seats,omitempty"`
	Movers    int64         `json:"movers,omitempty"`
	// Glimpse is the next seat's dealt view of a split machine, for a seat
	// whose practice gives it.
	Glimpse *PuzzleLayout `json:"glimpse,omitempty"`
	Rival   *RivalView    `json:"rival,omitempty"`
}

// PracticeLine is a family's practice: level, uses toward the next, and
// the uses the next needs.
type PracticeLine struct {
	Level int64  `json:"level"`
	Uses  int64  `json:"uses"`
	Need  int64  `json:"need"`
	Title string `json:"title,omitempty"`
}

// BenchFamily is one family a bench offers the viewer.
type BenchFamily struct {
	Family   string       `json:"family"`
	Name     string       `json:"name"`
	Practice PracticeLine `json:"practice"`
	MaxLevel int64        `json:"maxLevel"`
	Lessons  int64        `json:"lessons"` // waiting here from others
	Master   bool         `json:"master,omitempty"`
}

// BenchView is the bench where the viewer stands, with today's uses and caps.
type BenchView struct {
	Settlement string        `json:"settlement"`
	Families   []BenchFamily `json:"families"`
	Uses       int64         `json:"uses"` // bench uses today
	UsesCap    int64         `json:"usesCap"`
	Taken      int64         `json:"taken"` // lessons taken today
	TakenCap   int64         `json:"takenCap"`
	Given      int64         `json:"given"`
	GivenCap   int64         `json:"givenCap"`
}

// PouchView is a locked pouch the viewer carries.
type PouchView struct {
	ID     string  `json:"id"`
	Family string  `json:"family"`
	Name   string  `json:"name"`
	Goods  []Goods `json:"goods"`
	Locked int64   `json:"locked,omitempty"` // ticks until it can be tried again
}

// MachineDone is the machine a character last finished, kept until the
// next one is armed, so a reconnect after a haywire can show it.
type MachineDone struct {
	Source string       `json:"source"`
	Family string       `json:"family"`
	Level  int64        `json:"level"`
	Tick   int64        `json:"tick"`
	Result PuzzleResult `json:"result"`
}

// ArmedMachine is a countdown the gateway must enforce. Due is unix ms
// with the grace included; ArmedAt names the machine among a character's.
// Context is set on a party machine, whose merged log is kept by context.
type ArmedMachine struct {
	CharacterID string `json:"characterId"`
	ArmedAt     int64  `json:"armedAt"`
	Due         int64  `json:"due"`
	Context     string `json:"context,omitempty"`
}
