package api

// House kinds (GDD 14): a server's staff and admin commands, sent on the
// player path with Admin or Staff set; crate-open and report are any
// player's. The operator kinds go through PathOperator.
const (
	ActStage         = "stage"
	ActStageEnd      = "stage-end"
	ActCrateOpen     = "crate-open"
	ActHousePin      = "house-pin"
	ActHouseUnpin    = "house-unpin"
	ActReport        = "report"
	ActModerate      = "moderate"
	ActHouseSettings = "house-settings"
	OpRename         = "rename"
	OpCaseClose      = "case-close"
)

// Refusal codes of the house, staging and moderation.
const (
	CodeHouseRole     = "house-role"
	CodeHouseScope    = "house-scope"
	CodePoolShort     = "pool-short"
	CodeStageLimit    = "stage-limit"
	CodeStageTemplate = "stage-template"
	CodeStagedLocal   = "staged-local"
	CodeStagedOwn     = "staged-own"
	CodeCrateCap      = "crate-cap"
	CodeNoStage       = "no-stage"
	CodeMuted         = "muted"
	CodeSuspended     = "suspended"
	CodeExcluded      = "excluded"
	CodeCaseLimit     = "case-limit"
)

// Roles a command speaks with (GDD 14.1), as House.Role and LogRow.Role
// read.
const (
	RolePlayer   = "player"
	RoleStaff    = "staff"
	RoleAdmin    = "admin"
	RoleOperator = "operator"
)

// HouseKind reports whether a kind is a server's staff or admin command;
// the gateway refuses every one.
func HouseKind(kind string) bool {
	switch kind {
	case ActStage, ActStageEnd, ActHousePin, ActHouseUnpin, ActModerate, ActHouseSettings:
		return true
	}
	return false
}

// Paths of the house. The bot reads a server's; operators read every
// server's log and the escalated cases.
const (
	PathHouse            = "/v1/house"     // ?server=&character=
	PathHouseLog         = "/v1/house/log" // ?server=&after=
	PathOperatorHouseLog = "/v1/operator/house/log"
	PathOperatorCases    = "/v1/operator/cases"
)

// StageOrder is a staging order (GDD 14.4): the stager chooses these; the
// sheets decide the rest. Opens is ticks from now; Days 0 takes the
// template's.
type StageOrder struct {
	Template   string `json:"template"`
	Settlement int    `json:"settlement"`
	At         Hex    `json:"at"`
	Hunt       string `json:"hunt,omitempty"`
	Contest    string `json:"contest,omitempty"`
	Pattern    string `json:"pattern,omitempty"`
	Opens      int64  `json:"opens,omitempty"`
	Days       int64  `json:"days,omitempty"`
}

// CaseOrder is a player's report: a name ref, goal:<id> or post:<link>,
// and one of the five reasons.
type CaseOrder struct {
	Ref    string `json:"ref"`
	Reason string `json:"reason"`
}

// ModerateOrder is a moderation action (GDD 14.6). Days is a hold's
// length, 0 until lifted; Case is the case it answers.
type ModerateOrder struct {
	Action string `json:"action"`
	Ref    string `json:"ref,omitempty"`
	Days   int64  `json:"days,omitempty"`
	Case   string `json:"case,omitempty"`
}

// RenameOrder is an operator's global rename; an empty Name restores the
// plain generated name.
type RenameOrder struct {
	Ref  string `json:"ref"`
	Name string `json:"name,omitempty"`
}

// HouseSettings change only what one server sees (GDD 14.7). Quiet hours
// are minutes past midnight UTC; equal ends mean none.
type HouseSettings struct {
	Channels   []Channel `json:"channels,omitempty"`
	StaffRoles []string  `json:"staffRoles,omitempty"` // Discord role ids
	AlarmRoles []string  `json:"alarmRoles,omitempty"`
	HideNames  bool      `json:"hideNames,omitempty"`
	Narrated   bool      `json:"narrated,omitempty"`
	QuietFrom  int64     `json:"quietFrom,omitempty"`
	QuietTo    int64     `json:"quietTo,omitempty"`
}

// Channel is the Discord channel the game posts one kind to: chronicle,
// events, market, board or log.
type Channel struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

// House is one server's house as its staff and admins read it. Arrival is
// the settlement new players arrive at, -1 while there is none; Role is
// what the reading character's flags make it here.
type House struct {
	Server      string            `json:"server"`
	Label       string            `json:"label"` // the server guild's name
	Guild       string            `json:"guild,omitempty"`
	Arrival     int               `json:"arrival"`
	Settings    HouseSettings     `json:"settings"`
	Settlements []HouseSettlement `json:"settlements"`
	Templates   []StageTemplate   `json:"templates"`
	Hunts       []string          `json:"hunts"` // fights.hunts rows a hunt template may take
	Contests    []string          `json:"contests"`
	Stages      []StageView       `json:"stages"`
	Cases       []Case            `json:"cases,omitempty"` // staff and admins only
	Holds       []Hold            `json:"holds,omitempty"`
	Masks       []string          `json:"masks,omitempty"`
	Hidden      []string          `json:"hidden,omitempty"`
	Pins        []Pin             `json:"pins,omitempty"` // the server's live pins, staff and admins only
	Role        string            `json:"role"`
	StagedXP    int64             `json:"stagedXp"` // the daily allowance from staged fights
}

// HouseSettlement is a settlement the server's guild runs, with its staff
// pool in event points and the sites a staging may name.
type HouseSettlement struct {
	N       int         `json:"n"`
	Name    string      `json:"name"`
	Region  string      `json:"region"`
	Pool    int64       `json:"pool"`
	PoolCap int64       `json:"poolCap"`
	Refill  int64       `json:"refill"` // added at the next world day
	Sites   []HouseSite `json:"sites"`  // known sites in its region, nearest first
}

// HouseSite is a tile a staging may name.
type HouseSite struct {
	At   Hex    `json:"at"`
	Name string `json:"name"`
}

// StageTemplate is a liveops.templates row as a console offers it.
type StageTemplate struct {
	ID     string `json:"id"`
	Kind   string `json:"kind"` // contest, hardship, drop, hunt, fair, vault, pattern
	Points int64  `json:"points"`
	Staff  bool   `json:"staff"`
	Tier   int64  `json:"tier,omitempty"`
	Crates int64  `json:"crates,omitempty"`
	Days   int64  `json:"days"`
	// Patterns are the story.pattern-puzzles rows a pattern template lays.
	Patterns []string `json:"patterns,omitempty"`
}

// StageView is one staging, from its order to its close. Opens and Ends
// are ticks; Crates are those left.
type StageView struct {
	ID         string   `json:"id"`
	Template   string   `json:"template"`
	Kind       string   `json:"kind"`
	Placed     Placed   `json:"placed"`
	Settlement int      `json:"settlement"`
	Place      string   `json:"place"`
	At         Hex      `json:"at"`
	Opens      int64    `json:"opens"`
	Ends       int64    `json:"ends"`
	Open       bool     `json:"open,omitempty"`
	Closed     bool     `json:"closed,omitempty"`
	Hunt       string   `json:"hunt,omitempty"`
	Crates     int64    `json:"crates,omitempty"`
	Goals      []string `json:"goals,omitempty"`
	Taken      bool     `json:"taken,omitempty"`
}

// Case is one reported thing in a queue. State is open, acted, dismissed,
// escalated or closed; Server is set on the operator's read.
type Case struct {
	ID        string `json:"id"`
	Ref       string `json:"ref"`
	Reason    string `json:"reason"`
	State     string `json:"state"`
	Action    string `json:"action,omitempty"`
	Reporters int64  `json:"reporters"`
	Tick      int64  `json:"tick"`
	Server    string `json:"server,omitempty"`
}

// Hold is a mute, suspension or exclusion of one character on a server.
// Ends is the first world day it no longer holds, 0 until lifted.
type Hold struct {
	Char string `json:"char"`
	Kind string `json:"kind"`
	Ends int64  `json:"ends"`
	Case string `json:"case,omitempty"`
}

// LogRow is one line of the public log (GDD 14.8): who acted, with which
// role, and what the world says it did. At is unix ms.
type LogRow struct {
	ID        int64  `json:"id"`
	Server    string `json:"server"`
	Tick      int64  `json:"tick"`
	At        int64  `json:"at"`
	Character string `json:"character,omitempty"`
	Discord   string `json:"discord,omitempty"`
	Role      string `json:"role"`
	Kind      string `json:"kind"`
	What      string `json:"what"`
	Points    int64  `json:"points,omitempty"`
}

// HouseLog is a page of log rows after an id; Next is the id to ask after
// next.
type HouseLog struct {
	Rows []LogRow `json:"rows"`
	Next int64    `json:"next"`
}

// Cases is the reply on PathOperatorCases: escalated cases of every
// server.
type Cases struct {
	Cases []Case `json:"cases"`
}

// StagedAt marks goods or an item staged at a settlement: local to it.
type StagedAt struct {
	Settlement int    `json:"settlement"`
	Name       string `json:"name"`
}

// StagedLine is one server's staged goods on the weekly report: goods
// minted, held and spent, and coin traded on its staged books.
type StagedLine struct {
	Server string `json:"server"`
	Minted int64  `json:"minted"`
	Held   int64  `json:"held"`
	Spent  int64  `json:"spent"`
	Traded int64  `json:"traded"`
}
