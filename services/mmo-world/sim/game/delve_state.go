package game

import (
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/party"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/tags"
	"jams.team/mmo-world/sim/tally"
)

// Commands of parties, dungeons and hunts (GDD 4.9, 7.5, 7.6).
const (
	PartyInvite  = "party-invite"
	PartyJoin    = "party-join"
	PartyLeave   = "party-leave"
	PartyPick    = "party-pick"
	PartyWindow  = "party-window" // the pick-window clock's, never a player's
	Follow       = "follow"
	Unfollow     = "unfollow"
	DungeonPush  = "dungeon-push"
	DungeonLeave = "dungeon-leave"
	DungeonName  = "dungeon-name"
	KeyMake      = "key-make"
	HuntPress    = "hunt-press"
	DeckSwap     = "deck-swap"
	FollowTrack  = "follow-track"
	// HuntStart is an operator's, and acts on the world: it names no
	// character. HideName is an operator's on a dungeon's namer.
	HuntStart = "hunt-start"
	HideName  = "hide-name"
)

// Refusal codes the party, dungeon and hunt rules give.
const (
	NotInParty = "not-in-party"
	InParty    = "in-party"
	PartyFull  = "party-full"
	OutOfReach = "out-of-reach"
	NoInvite   = "no-invite"
	Picked     = "picked"
	NotDue     = "not-due"
	NoFork     = "no-fork"
	NoWay      = "no-way"
	Chose      = "chose"
	Named      = "named"
	BadName    = "bad-name"
	NotLeader  = "not-leader"
	NoKeyMaker = "no-key-maker"
	Short      = "short"
	NoHunt     = "no-hunt"
	Pressed    = "pressed"
	OpenHunt   = "open-hunt"
	NoSuchRow  = "no-such-row"
	NoSlot     = "no-slot"
	Swapped    = "swapped"
	NoTrack    = "no-track"
	RivalWon   = "rival-won"
	NoRoute    = "no-route"
	Used       = "used"
)

// Where a party's machine is: a beat's, a fork's, or a guardian mark's.
const (
	SourceParty    = "party"
	SourceFork     = "fork"
	SourceGuardian = "guardian"
)

// WorldLevel reports whether a command acts on the world rather than on
// a character: it names none, and its result carries none.
func WorldLevel(kind string) bool { return kind == HuntStart }

// Delve is what parties, shared encounters and live hunts make of the
// world. Game embeds it, so its fields sit beside the Society's.
type Delve struct {
	Parties []*party.Party `json:"parties,omitempty"`
	Shared  []*Shared      `json:"shared,omitempty"`
	Hunts   []*Hunt        `json:"hunts,omitempty"`
	// Invites are lone characters' invitations: the party forms when one
	// is taken.
	Invites    []party.Invite `json:"invites,omitempty"`
	NextParty  int64          `json:"nextParty,omitempty"`
	NextShared int64          `json:"nextShared,omitempty"`
	NextHunt   int64          `json:"nextHunt,omitempty"`
}

// Shared is one encounter several characters are in. Each member's
// Char.Fight carries Shared and the same *fight.Encounter (aliased on
// Attach from the first member's row). It outlives its encounter while a
// fork waits on its members.
type Shared struct {
	ID      string        `json:"id"` // "sh-<n>"
	Party   string        `json:"party,omitempty"`
	Hex     hex.Hex       `json:"hex"`
	Floor   int64         `json:"floor,omitempty"`
	Members []string      `json:"members"` // seat order: the party's join order, those present at the start
	Picks   []HeldPick    `json:"picks,omitempty"`
	Opened  int64         `json:"opened,omitempty"` // service ms of the first choice of this beat or fork
	Machine *PartyMachine `json:"machine,omitempty"`
	Fork    *ForkState    `json:"fork,omitempty"`
	Movers  []string      `json:"movers,omitempty"` // seats that moved on the machine, from the solve
	// LostRace is the context whose solve took a fork machine this one
	// was racing for, until it is armed again.
	LostRace string `json:"lostRace,omitempty"`
	// Last is the beat it resolved last, for the members' views. It is
	// not state: a reload forgets it, and no rule reads it.
	Last *LastBeat `json:"-"`
}

// LastBeat is a shared beat as it resolved: every member's press.
type LastBeat struct {
	Beat    int64 // 1-based
	Pressed []fight.Pressed
}

// HeldPick is a member's held choice on a beat, unseen by the others until
// the beat resolves.
type HeldPick struct {
	Who    string `json:"who"`
	Option string `json:"option"`
}

// PartyMachine is a party's one machine: staged with Spec and Source
// alone, armed once Seats are set.
type PartyMachine struct {
	Source    string      `json:"source"` // "party", "fork" or "guardian"
	Spec      puzzle.Spec `json:"spec"`
	Seats     []string    `json:"seats"`
	Practice  int64       `json:"practice"`
	Countdown int64       `json:"countdown"` // ms
	At        int64       `json:"at"`        // service ms at the first touch
	Tick      int64       `json:"tick"`
	Rival     string      `json:"rival,omitempty"` // the other context on one fork machine
}

// Armed reports whether the machine's countdown is running.
func (m *PartyMachine) Armed() bool { return m != nil && len(m.Seats) > 0 }

// Deadline is when the countdown ends, on the service's clock.
func (m *PartyMachine) Deadline() int64 { return m.At + m.Countdown }

// ForkState is a fork while its members choose.
type ForkState struct {
	Floor   int64    `json:"floor"` // the floor the fork is below
	Choices []Choice `json:"choices,omitempty"`
	Open    []int64  `json:"open"` // ways open: 0, and 1 or 2 once earned
	Solved  bool     `json:"solved,omitempty"`
	Worked  bool     `json:"worked,omitempty"` // its machine was tried, so it is not armed again
}

// Choice is one member's push or leave at a fork.
type Choice struct {
	Who  string `json:"who"`
	Push bool   `json:"push,omitempty"`
	Way  int64  `json:"way,omitempty"`
}

// Hunt is a live hunt in the world.
type Hunt struct {
	H       *fight.Hunt  `json:"h"`
	Hex     hex.Hex      `json:"hex"`
	Region  string       `json:"region"`
	Why     string       `json:"why"`               // "spawn", "operator", or a caller's
	Pressed tally.Tally  `json:"pressed,omitempty"` // character → tick of its last press
	Rolled  []item.Spoil `json:"rolled,omitempty"`
	// Measures are the ones it opened under, put back on H when a saved
	// game is attached.
	Measures []tags.Measure `json:"measures,omitempty"`
}

// Delving is a character inside a dungeon.
type Delving struct {
	Dungeon string       `json:"dungeon"` // "q,r"
	Way     int64        `json:"way"`     // the way into this floor, −1 for floor 1
	Carried []item.Spoil `json:"carried,omitempty"`
	Climb   int64        `json:"climb,omitempty"` // floors still to climb when carried up
	// Fork is an open fork the delver stands at; Bonus percent more haul on
	// this floor, from a solved fork machine.
	Fork  *ForkState `json:"fork,omitempty"`
	Bonus int64      `json:"bonus,omitempty"`
}

// attachDelve makes a decoded Delve runnable: a shared encounter is one
// value again for all its members, and measures not saved with an
// encounter or a hunt are put back. Nothing digested changes.
func (g *Game) attachDelve() {
	for _, sh := range g.Shared {
		var e *fight.Encounter
		for _, id := range sh.Members {
			c := g.Char(id)
			if c == nil || c.Fight == nil || c.Fight.Shared != sh.ID {
				continue
			}
			if e == nil {
				e = c.Fight.E
			}
			c.Fight.E = e
		}
	}
	for _, h := range g.Hunts {
		if h.H != nil {
			h.H.Measures = h.Measures
		}
	}
}

// partyOf is the party a character is in, or nil.
func (g *Game) partyOf(c *Char) *party.Party {
	if c.Party == "" {
		return nil
	}
	return g.PartyByID(c.Party)
}

// PartyByID finds a party, or nil.
func (g *Game) PartyByID(id string) *party.Party {
	i := slices.IndexFunc(g.Parties, func(p *party.Party) bool { return p.ID == id })
	if i < 0 {
		return nil
	}
	return g.Parties[i]
}

// PartyOf is the party a character is in, or nil.
func (g *Game) PartyOf(c *Char) *party.Party { return g.partyOf(c) }

// sharedOf is the shared encounter or fork a character is among, from
// its start until it is dropped, or nil.
func (g *Game) sharedOf(c *Char) *Shared {
	for _, sh := range g.Shared {
		if slices.Contains(sh.Members, c.C.ID) {
			return sh
		}
	}
	return nil
}

// SharedOf is sharedOf for readers outside the sim.
func (g *Game) SharedOf(c *Char) *Shared { return g.sharedOf(c) }

// SharedByID finds a shared encounter, or nil.
func (g *Game) SharedByID(id string) *Shared {
	i := slices.IndexFunc(g.Shared, func(sh *Shared) bool { return sh.ID == id })
	if i < 0 {
		return nil
	}
	return g.Shared[i]
}

// HuntByID finds a live hunt, or nil.
func (g *Game) HuntByID(id string) *Hunt {
	i := slices.IndexFunc(g.Hunts, func(h *Hunt) bool { return h.H != nil && h.H.ID == id })
	if i < 0 {
		return nil
	}
	return g.Hunts[i]
}

// in are the members still in a shared encounter, gone or not yet: those
// whose fight is it, in seat order.
func (g *Game) in(sh *Shared) []*Char {
	var out []*Char
	for _, id := range sh.Members {
		if c := g.Char(id); c != nil && c.Fight != nil && c.Fight.Shared == sh.ID {
			out = append(out, c)
		}
	}
	return out
}

// upIn are the members in a shared encounter who are up and still in it,
// in seat order: who picks, and who sits at its machine.
func (g *Game) upIn(sh *Shared) []*Char {
	var out []*Char
	for _, c := range g.in(sh) {
		e := c.Fight.E
		if !slices.Contains(e.Down, c.C.ID) && !slices.Contains(e.Gone, c.C.ID) {
			out = append(out, c)
		}
	}
	return out
}

// encounterOf is a shared encounter's one encounter, or nil once it has
// ended.
func (g *Game) encounterOf(sh *Shared) *fight.Encounter {
	if in := g.in(sh); len(in) > 0 {
		return in[0].Fight.E
	}
	return nil
}

// newShared opens a shared encounter for members in seat order.
func (g *Game) newShared(p *party.Party, h hex.Hex, floor int64, members []*Char) *Shared {
	g.NextShared++
	sh := &Shared{ID: "sh-" + strconv.FormatInt(g.NextShared, decimal), Hex: h, Floor: floor}
	if p != nil {
		sh.Party = p.ID
	}
	for _, m := range members {
		sh.Members = append(sh.Members, m.C.ID)
	}
	g.Shared = append(g.Shared, sh)
	return sh
}

// leaveShared takes one member out of a shared encounter or fork, with
// any pick or choice it held; the last one out drops it.
func (g *Game) leaveShared(sh *Shared, c *Char) {
	sh.Members = slices.DeleteFunc(sh.Members, func(id string) bool { return id == c.C.ID })
	sh.Picks = slices.DeleteFunc(sh.Picks, func(p HeldPick) bool { return p.Who == c.C.ID })
	if sh.Fork != nil {
		sh.Fork.Choices = slices.DeleteFunc(sh.Fork.Choices, func(x Choice) bool { return x.Who == c.C.ID })
	}
	if c.Fight != nil && c.Fight.Shared == sh.ID {
		c.Fight = nil
	}
	if len(sh.Members) == 0 {
		g.dropShared(sh)
	}
}

// touchOnce is touch for a row the command or tick in hand may have moved
// already.
func (g *Game) touchOnce(c *Char) {
	if !slices.Contains(g.touched, c.C.ID) {
		g.touch(c)
	}
}

// saw notes characters whose view changed when their rows did not, so
// their viewers are told without their versions moving.
func (g *Game) saw(ids ...string) {
	for _, id := range ids {
		if !slices.Contains(g.seen, id) {
			g.seen = append(g.seen, id)
		}
	}
}
