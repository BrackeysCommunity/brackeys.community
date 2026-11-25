package game

import (
	"fmt"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/tile"
)

// Roles a command speaks with (GDD 14.1).
const (
	RolePlayer   = "player"
	RoleStaff    = "staff"
	RoleAdmin    = "admin"
	RoleOperator = "operator"
)

// House kinds: a server's staff and admin commands, sent on the player
// path by the acting member's character with Command.Admin or Staff.
const (
	Staging    = "stage"          // Command.Stage
	StagingEnd = "stage-end"      // Command.Target: a live stage of this server's
	HousePin   = "house-pin"      // Command.Pin; As, For and Label come from the command
	HouseUnpin = "house-unpin"    // Command.Pin.Pin
	Moderate   = "moderate"       // Command.Moderate
	SetHouse   = "house-settings" // Command.Settings; admins only
)

// Player kinds of the house: crates and reports.
const (
	CrateOpen  = "crate-open" // Command.Target: a drop's stage id
	ReportCase = "report"     // Command.Case
)

// Operator kinds of the house; both act on the world and name no character.
const (
	Rename    = "rename"     // Command.Rename
	CaseClose = "case-close" // Command.Target: "<server>/<case id>"
)

// Refusal codes.
const (
	HouseRoleCode = "house-role"  // not staff or admin of the command's server
	HouseScope    = "house-scope" // not a settlement the server's guild runs, or outside its region
	PoolShort     = "pool-short"
	StageLimit    = "stage-limit"
	StageTemplate = "stage-template" // no such template, or not one staff may stage
	StagedLocal   = "staged-local"
	StagedOwn     = "staged-own"
	CrateCap      = "crate-cap"
	NoStage       = "no-stage"
	Muted         = "muted"
	Suspended     = "suspended"
	Excluded      = "excluded"
	CaseLimit     = "case-limit"
)

// House is one server's own: what it sees, its staff pools, its
// moderation. Changed only by recorded commands.
type House struct {
	Server   string        `json:"server"`
	Settings HouseSettings `json:"settings"`
	Pools    []Pool        `json:"pools,omitempty"`
	Cases    []Case        `json:"cases,omitempty"`
	NextCase int64         `json:"nextCase,omitempty"`
	Masks    []string      `json:"masks,omitempty"`  // name refs read as generated here
	Hidden   []string      `json:"hidden,omitempty"` // goal ids whose title and note read as generated here
	Holds    []Hold        `json:"holds,omitempty"`
}

// HouseSettings change only what one server sees (GDD 14.7).
type HouseSettings struct {
	Channels   []Channel `json:"channels,omitempty"`
	StaffRoles []string  `json:"staffRoles,omitempty"` // Discord role ids
	AlarmRoles []string  `json:"alarmRoles,omitempty"`
	HideNames  bool      `json:"hideNames,omitempty"`
	Narrated   bool      `json:"narrated,omitempty"`
	QuietFrom  int64     `json:"quietFrom,omitempty"` // minutes past midnight UTC; equal to QuietTo: none
	QuietTo    int64     `json:"quietTo,omitempty"`
}

// Channel is the Discord channel the game posts one kind to.
type Channel struct {
	Kind string `json:"kind"` // chronicle, events, market, board, log
	ID   string `json:"id"`
}

// Pool is a settlement's staff pool, in event points (GDD 14.3).
type Pool struct {
	Settlement int   `json:"settlement"` // Place.N
	Points     int64 `json:"points"`
}

// Case is one reported thing in the queue.
type Case struct {
	ID     string   `json:"id"`     // case-<n>
	Ref    string   `json:"ref"`    // a name ref, goal:<id> or post:<link>
	Reason string   `json:"reason"` // abuse, name, spam, cheating, other
	By     []string `json:"by"`     // reporting characters, first first
	Tick   int64    `json:"tick"`
	State  string   `json:"state"` // open, acted, dismissed, escalated, closed
	Action string   `json:"action,omitempty"`
}

// Hold is a mute, suspension or exclusion of one character here.
type Hold struct {
	Char string `json:"char"`
	Kind string `json:"kind"`           // mute, suspend, exclude
	Ends int64  `json:"ends,omitempty"` // first world day it no longer holds; 0 until lifted
	Case string `json:"case,omitempty"`
}

// ModerateCmd is a moderation action (GDD 14.6).
type ModerateCmd struct {
	Action string `json:"action"`         // mask, unmask, hide, unhide, mute, unmute, suspend, unsuspend, exclude, unexclude, escalate, dismiss
	Ref    string `json:"ref,omitempty"`  // a name ref, goal:<id>, or character:<id> for a hold
	Days   int64  `json:"days,omitempty"` // a hold's length; 0 until lifted
	Case   string `json:"case,omitempty"` // the case it answers
}

// CaseCmd is a player's report.
type CaseCmd struct {
	Ref    string `json:"ref"`
	Reason string `json:"reason"`
}

// RenameCmd is an operator's global rename; an empty Name restores the
// plain generated name.
type RenameCmd struct {
	Ref  string `json:"ref"`
	Name string `json:"name,omitempty"`
}

// HouseKind reports whether a kind is a server's staff or admin command.
// It is sent for the server rather than as the character's own play, so
// it neither counts as the character acting nor collects for it.
func HouseKind(kind string) bool {
	switch kind {
	case Staging, StagingEnd, HousePin, HouseUnpin, Moderate, SetHouse:
		return true
	}
	return false
}

// Logged reports whether an applied command of a kind goes in the public
// log: every house kind and every operator kind (GDD 14.8).
func Logged(kind string) bool { return HouseKind(kind) || Operator(kind) }

// House is a server's house, or nil if it has none.
func (g *Game) House(server string) *House {
	if i, ok := g.houseAt(server); ok {
		return g.Houses[i]
	}
	return nil
}

// houseFor is a server's house, made on first use.
func (g *Game) houseFor(server string) *House {
	i, ok := g.houseAt(server)
	if !ok {
		g.Houses = slices.Insert(g.Houses, i, &House{Server: server})
	}
	return g.Houses[i]
}

func (g *Game) houseAt(server string) (int, bool) {
	return slices.BinarySearchFunc(g.Houses, server, func(h *House, s string) int { return strings.Compare(h.Server, s) })
}

// RoleOf is the role a player-path command's flags make its sender.
// Admin implies every staff right.
func RoleOf(cmd Command) string {
	switch {
	case cmd.Admin:
		return RoleAdmin
	case cmd.Staff:
		return RoleStaff
	}
	return RolePlayer
}

// structural: the settlement a house command that names none passes.
const houseWide = -1

// houseRole is the role a house command speaks with for a settlement:
// admin or staff of cmd.Server, whose server guild runs it. Refused with
// house-role or house-scope, nothing changed. A settlement of houseWide
// asks only for the server's guild; house-settings, which installs that
// guild, asks for an admin and no guild.
func (g *Game) houseRole(cmd Command, settlement int) (role string, gd *Guild, err error) {
	role = RoleOf(cmd)
	if cmd.Server == "" || role == RolePlayer {
		return "", nil, refuse(HouseRoleCode, "%s is for a server's staff or admins", cmd.Kind)
	}
	if cmd.Kind == SetHouse && role != RoleAdmin {
		return "", nil, refuse(HouseRoleCode, "only a server's admins change its settings")
	}
	gd = g.ServerGuild(cmd.Server)
	if gd == nil {
		if cmd.Kind == SetHouse {
			return role, nil, nil
		}
		return "", nil, refuse(HouseScope, "server %s has no guild of its own yet", cmd.Server)
	}
	if settlement == houseWide {
		return role, gd, nil
	}
	if settlement < 0 || settlement >= len(g.Places) || g.Places[settlement].Guild != gd.G.ID {
		return "", nil, refuse(HouseScope, "settlement %d is not one %s runs", settlement, gd.G.Name)
	}
	return role, gd, nil
}

// staffCost is what a staff order pays from a settlement's pool: points,
// refused when the pool holds less. Admins pay nothing.
func (g *Game) staffCost(server string, n int, role string, points int64, what string) (int64, error) {
	if role != RoleStaff {
		return 0, nil
	}
	if have := g.PoolOf(server, n); have < points {
		return 0, refuse(PoolShort, "%s costs %d event points and the pool holds %d", what, points, have)
	}
	return points, nil
}

// houseOwns refuses a house command on something its server did not
// make, or, for staff, something the server's admins made.
func houseOwns(role string, mine, staffMade bool, id, verb string) error {
	switch {
	case !mine:
		return refuse(HouseScope, "%s was not %s from this server", id, verb)
	case role == RoleStaff && !staffMade:
		return refuse(HouseRoleCode, "%s was %s by the server's admins", id, verb)
	}
	return nil
}

// houseFn applies a character-scoped house kind.
type houseFn func(g *Game, c *Char, cmd Command) error

// The registries the house's rules fill from their own files' init: character
// kinds, world kinds (rename, case-close), gates run before every
// character command, and hooks on each world tick and each world day.
var (
	houseCommands = map[string]houseFn{}
	houseWorld    = map[string]func(g *Game, cmd Command) error{}
	houseGates    []func(g *Game, c *Char, cmd Command) error
	houseTicks    []func(g *Game, tick int64) error
	houseDays     []func(g *Game, day int64) error
)

// registerHouse adds a character-scoped kind; two rules may not claim one.
func registerHouse(kind string, fn houseFn) {
	if _, dup := houseCommands[kind]; dup {
		panic("game: " + kind + " registered twice")
	}
	houseCommands[kind] = fn
}

// houseGate runs every gate on a character's command; the first refusal
// stops it.
func (g *Game) houseGate(c *Char, cmd Command) error {
	for _, gate := range houseGates {
		if err := gate(g, c, cmd); err != nil {
			return err
		}
	}
	return nil
}

// houseTick runs the tick hooks once the clock has moved to tick.
func (g *Game) houseTick(tick int64) error {
	for _, run := range houseTicks {
		if err := run(g, tick); err != nil {
			return err
		}
	}
	return nil
}

// houseDay runs the day hooks at a world day's turn.
func (g *Game) houseDay(day int64) error {
	for _, run := range houseDays {
		if err := run(g, day); err != nil {
			return err
		}
	}
	return nil
}

// houseWorldCommand runs rename or case-close through the rule that
// registered it; unregistered, it is refused as an unknown command.
func houseWorldCommand(kind string) func(*Game, Command) error {
	return func(g *Game, cmd Command) error {
		if run := houseWorld[kind]; run != nil {
			return run(g, cmd)
		}
		return refuse(BadArgs, "unknown command %q", kind)
	}
}

// spend notes event points the command in hand spent, for its result and
// the log.
func (g *Game) spend(points int64) { g.points += points }

// Spent is the event points the last applied command spent.
func (g *Game) Spent() int64 { return g.spent }

// LogWhat is a log row's summary of a command: pure, naming no character
// but by id, and every number with its unit.
func LogWhat(cmd Command) string {
	parts := []string{logHead(cmd)}
	switch cmd.Kind {
	case Staging:
		if s := cmd.Stage; s != nil {
			parts = append(parts, named([]field{{"hunt", s.Hunt}, {"contest", s.Contest}, {"pattern", s.Pattern}})...)
			if s.Opens > 0 {
				parts = append(parts, "opens in "+units(s.Opens, "tick", "ticks"))
			}
			if s.Days > 0 {
				parts = append(parts, units(s.Days, "day", "days"))
			}
		}
	case HousePin, PinReserve, PinEdit:
		if p := cmd.Pin; p != nil {
			if p.Reach > 0 {
				parts = append(parts, "reach "+units(p.Reach, "tile", "tiles"))
			}
			parts = append(parts, fixWhat(p.Fix)...)
			if p.Label != "" {
				parts = append(parts, strconv.Quote(p.Label))
			}
		}
	case Moderate:
		if m := cmd.Moderate; m != nil {
			switch m.Action {
			case ModMute, ModSuspend, ModExclude:
				if m.Days > 0 {
					parts = append(parts, units(m.Days, "day", "days"))
				} else {
					parts = append(parts, "until lifted")
				}
			}
			if m.Case != "" {
				parts = append(parts, m.Case)
			}
		}
	case SetHouse:
		if s := cmd.Settings; s != nil {
			parts = append(parts, units(int64(len(s.Channels)), "channel", "channels"), units(int64(len(s.StaffRoles)), "staff role", "staff roles"),
				units(int64(len(s.AlarmRoles)), "alarm role", "alarm roles"))
			if s.HideNames {
				parts = append(parts, "player names hidden")
			}
			if s.Narrated {
				parts = append(parts, "narrated")
			}
			if s.QuietFrom != s.QuietTo {
				parts = append(parts, "quiet "+clock(s.QuietFrom)+" to "+clock(s.QuietTo)+" UTC")
			}
		}
	case Correct:
		parts = append(parts, units(cmd.Units, "unit", "units")+" of "+cmd.Asset)
	case Grant:
		parts = append(parts, "mount "+cmd.Asset)
	}
	return strings.Join(parts, " · ")
}

// logHead is the first part of a log row: what was done and to what.
func logHead(cmd Command) string {
	switch cmd.Kind {
	case Staging:
		if s := cmd.Stage; s != nil {
			return fmt.Sprintf("stage %s at settlement %d on %s", s.Template, s.Settlement, s.At.Ref())
		}
	case StagingEnd:
		return "end " + cmd.Target
	case HousePin, PinReserve, PinEdit:
		if p := cmd.Pin; p != nil {
			return "pin " + p.At.Ref()
		}
	case HouseUnpin, PinWithdraw:
		if p := cmd.Pin; p != nil {
			return "withdraw pin " + p.Pin
		}
	case Moderate:
		if m := cmd.Moderate; m != nil {
			return strings.TrimSpace(m.Action + " " + strings.TrimPrefix(m.Ref, "character:"))
		}
	case SetHouse:
		return "settings"
	case Rename:
		if r := cmd.Rename; r != nil {
			if r.Name == "" {
				return "restore the generated name of " + r.Ref
			}
			return "rename " + r.Ref + " to " + strconv.Quote(r.Name)
		}
	case CaseClose:
		return "close " + cmd.Target
	case HideGoal:
		return "hide " + cmd.Target
	case HideName:
		if cmd.To != nil {
			return "hide the name at " + cmd.To.Ref()
		}
	case HuntStart:
		if cmd.To != nil {
			return "start hunt " + cmd.Asset + " on " + cmd.To.Ref()
		}
	case ArcCast:
		if cmd.Arc != nil {
			return "cast " + cmd.Arc.Template
		}
	}
	return strings.TrimSpace(cmd.Kind + " " + cmd.Char)
}

// fixWhat names what a pin's fix sets.
func fixWhat(f tile.Fix) []string {
	out := named([]field{{"site", f.Site}, {"landmark", f.Landmark}, {"site kind", f.SiteKind}, {"dungeon", f.Dungeon},
		{"lead", f.Lead}, {"stock", f.Stock}})
	if f.Floors > 0 {
		out = append(out, units(f.Floors, "floor", "floors"))
	}
	if gr := f.Ground; gr != nil {
		w := "ground " + gr.Terrain
		if gr.Ring {
			w += " and its ring"
		}
		out = append(out, w)
	}
	return out
}

// field is a named part of a summary.
type field struct{ name, value string }

// named writes the fields that are set, each as its name and value.
func named(fs []field) []string {
	var out []string
	for _, f := range fs {
		if f.value != "" {
			out = append(out, f.name+" "+f.value)
		}
	}
	return out
}

func units(n int64, one, many string) string {
	if n == 1 || n == -1 {
		return strconv.FormatInt(n, decimal) + " " + one
	}
	return strconv.FormatInt(n, decimal) + " " + many
}

// structural: a quiet hour is written as hours and minutes past midnight.
const minutesPerHour = 60

func clock(minutes int64) string {
	return fmt.Sprintf("%02d:%02d", minutes/minutesPerHour, minutes%minutesPerHour)
}
