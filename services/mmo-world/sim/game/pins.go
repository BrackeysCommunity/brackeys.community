package game

import (
	"errors"
	"slices"

	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/world"
)

// Pin commands, and the freeze of a world from before content was drawn
// from history (GDD 4.17, 14.4, 14.5). All four are an operator's and act
// on the world.
const (
	PinReserve    = "pin-reserve"
	PinEdit       = "pin-edit"
	PinWithdraw   = "pin-withdraw"
	ContentFreeze = "content-freeze"
)

// PinCmd is what a pin command carries.
type PinCmd struct {
	At    hex.Hex  `json:"at"`
	Reach int64    `json:"reach,omitempty"`
	Fix   tile.Fix `json:"fix"`
	As    string   `json:"as,omitempty"`  // designer (""), admin, staff
	For   string   `json:"for,omitempty"` // admin, staff: the character placing it
	Label string   `json:"label,omitempty"`
	Pin   string   `json:"pin,omitempty"` // withdraw
}

// pinReserve, pinEdit and pinWithdraw stage, edit or withdraw a pin. The
// game's checks and the world's all run before anything changes, so a
// refusal leaves the game as it was.
func (g *Game) pinReserve(cmd Command) error {
	p, by, err := g.pinTarget(cmd)
	if err != nil {
		return err
	}
	return g.placePin(p.At, p.Reach, p.Fix, by, false)
}

func (g *Game) pinEdit(cmd Command) error {
	p, by, err := g.pinTarget(cmd)
	if err != nil {
		return err
	}
	return g.placePin(p.At, p.Reach, p.Fix, by, true)
}

// placePin reserves an unreached tile or edits a reached one, once the
// world's checks pass. An edit sent with no reach reaches as little as
// any pin may.
func (g *Game) placePin(at hex.Hex, reach int64, fix tile.Fix, by world.PinBy, edit bool) error {
	if err := g.groundOverBoard(at, fix.Ground); err != nil {
		return err
	}
	if !edit {
		_, err := g.World.Reserve(g.Log, at, reach, fix, by)
		return refusedFrom(err)
	}
	if fix.Replans() && g.delvedAt(at) {
		return refuse(world.CodePinEntered, "the dungeon on %s has been entered", at.Ref())
	}
	if fix.Replans() && g.reachGoalAt(at) {
		return refuse(world.CodePinEntered, "an open goal reaches into the dungeon on %s", at.Ref())
	}
	_, err := g.World.EditPin(g.Log, at, max(reach, 1), fix, by)
	return refusedFrom(err)
}

// groundOverBoard refuses ground over a pattern board's point or clue,
// stored or the scaffold's: boards live in the story, where the world's
// pin checks do not look.
func (g *Game) groundOverBoard(at hex.Hex, f *tile.GroundFix) error {
	if f == nil || g.Story == nil {
		return nil
	}
	for _, h := range world.PatchOf(at, f) {
		if b, _, ok := g.pointAt(h); ok {
			return refuse(world.CodePinGround, "%s lies on the pattern board %s", h.Ref(), b.ID)
		}
		if bs, _ := g.cluesAt(h); len(bs) > 0 {
			return refuse(world.CodePinGround, "%s lies on the pattern board %s", h.Ref(), bs[0].ID)
		}
	}
	return nil
}

func init() {
	registerHouse(HousePin, housePin)
	registerHouse(HouseUnpin, houseUnpin)
}

// housePin is a pin from a server's console (GDD 14.5): its admins and
// staff pin inside the region of a settlement its guild runs, under the
// guild's name, reserving an unreached tile or editing a reached one.
// Staff pay the staff row's event points from that settlement's pool at
// the order; nothing comes back on withdrawal.
func housePin(g *Game, c *Char, cmd Command) error {
	p := cmd.Pin
	if p == nil {
		return refuse(BadArgs, "%s carries a pin", cmd.Kind)
	}
	role, gd, err := g.houseRole(cmd, houseWide)
	if err != nil {
		return err
	}
	region := g.r.Gen.RegionOf(p.At)
	n, ok := g.regionSettlement(gd, p.At)
	if !ok {
		return refuse(HouseScope, "%s runs no settlement in the region of %s", gd.G.Name, p.At.Ref())
	}
	if err := g.notSettlement(p.At); err != nil {
		return err
	}
	var points int64
	if l := g.pinLimit(world.PinStaff); l != nil {
		points = l.Points
	}
	points, err = g.staffCost(cmd.Server, n, role, points, "a staff pin")
	if err != nil {
		return err
	}
	by := world.PinBy{Role: role, Server: cmd.Server, Char: c.C.ID, Label: gd.G.Name, Region: &region}
	if err := g.placePin(p.At, max(p.Reach, 1), p.Fix, by, g.World.Content(p.At) != nil); err != nil {
		return err
	}
	g.payPool(cmd.Server, n, points)
	return nil
}

// houseUnpin withdraws one of the server's own pins from its console:
// its admins any of them, its staff only a staff pin.
func houseUnpin(g *Game, _ *Char, cmd Command) error {
	p := cmd.Pin
	if p == nil || p.Pin == "" {
		return refuse(BadArgs, "%s names a pin", cmd.Kind)
	}
	role, _, err := g.houseRole(cmd, houseWide)
	if err != nil {
		return err
	}
	if i := slices.IndexFunc(g.World.Pins, func(x world.Pin) bool { return x.ID == p.Pin }); i >= 0 {
		by := g.World.Pins[i].By
		mine := by.Server == cmd.Server && slices.Contains([]string{world.PinAdmin, world.PinStaff}, by.Role)
		if err := houseOwns(role, mine, by.Role == world.PinStaff, p.Pin, "placed"); err != nil {
			return err
		}
	}
	_, err = g.World.Withdraw(g.Log, p.Pin)
	return refusedFrom(err)
}

// pinLimit is a role's map.pin-limits row, or nil.
func (g *Game) pinLimit(role string) *sheets.PinLimit {
	for i := range g.r.Book.PinLimits {
		if g.r.Book.PinLimits[i].Role == role {
			return &g.r.Book.PinLimits[i]
		}
	}
	return nil
}

func (g *Game) pinWithdraw(cmd Command) error {
	p := cmd.Pin
	if p == nil {
		return refuse(BadArgs, "%s carries a pin", cmd.Kind)
	}
	by, err := g.pinBy(p, true)
	if err != nil {
		return err
	}
	if err := g.mayWithdraw(p.Pin, by); err != nil {
		return err
	}
	_, err = g.World.Withdraw(g.Log, p.Pin)
	return refusedFrom(err)
}

// pinTarget is the pin a staging command carries and who it speaks for,
// once the ground it names may take a pin.
func (g *Game) pinTarget(cmd Command) (*PinCmd, world.PinBy, error) {
	p := cmd.Pin
	if p == nil {
		return nil, world.PinBy{}, refuse(BadArgs, "%s carries a pin", cmd.Kind)
	}
	by, err := g.pinBy(p, false)
	if err != nil {
		return nil, by, err
	}
	if err := g.notSettlement(p.At); err != nil {
		return nil, by, err
	}
	return p, by, nil
}

// regionSettlement is the index of a settlement gd runs in the region of at.
func (g *Game) regionSettlement(gd *Guild, at hex.Hex) (int, bool) {
	region := g.r.Gen.RegionOf(at)
	n := slices.IndexFunc(g.Places, func(pl *Place) bool { return pl.Guild == gd.G.ID && g.r.Gen.RegionOf(pl.Hex) == region })
	return n, n >= 0
}

// notSettlement refuses ground a guild-founded settlement holds; the world's
// placeTile refuses a starting one.
func (g *Game) notSettlement(at hex.Hex) error {
	if pl := g.PlaceAt(at); pl != nil && pl.Lattice < 0 {
		return refuse(world.CodePinGround, "%s holds a settlement", at.Ref())
	}
	return nil
}

// delvedAt reports whether anyone is on a floor of the dungeon at h or has
// reached one: a frozen native dungeon stores no floors for the world to see.
func (g *Game) delvedAt(h hex.Hex) bool {
	for _, c := range g.Chars {
		if c.C.At == h && c.C.Floor > 0 || DeepestFloor(c, h) > 0 {
			return true
		}
	}
	return false
}

// reachGoalAt reports whether an open Reach goal names the dungeon at h: its
// floor was checked against the plan an edit would change (GDD 11.2).
func (g *Game) reachGoalAt(h hex.Hex) bool {
	for _, x := range g.Goals {
		if !x.Open() || x.Cond.Verb != goal.Reach || x.Cond.Dungeon == "" {
			continue
		}
		if d, ok := hex.ParseRef(x.Cond.Dungeon); ok && d == h {
			return true
		}
	}
	return false
}

// pinBy is who a pin command speaks for. A designer is the operator,
// anywhere. An admin is an admin of its server's guild, and staff a
// member of it; either pins only inside the region of a settlement that
// guild runs, and its reach is clipped to that region. A withdrawal
// stands on no tile.
func (g *Game) pinBy(p *PinCmd, withdraw bool) (world.PinBy, error) {
	switch p.As {
	case "", world.PinDesigner:
		if p.For != "" || p.Label != "" {
			return world.PinBy{}, refuse(world.CodePinAnchor, "a designer's pin names no character and carries no label")
		}
		return world.PinBy{Role: world.PinDesigner}, nil
	case world.PinAdmin, world.PinStaff:
	default:
		return world.PinBy{}, refuse(world.CodePinAnchor, "no one pins as %q", p.As)
	}
	c := g.Char(p.For)
	if c == nil || c.Banned {
		return world.PinBy{}, refuse(world.CodePinAnchor, "no character %q to place it", p.For)
	}
	gd := g.GuildOf(c.C.Guild)
	if gd == nil || gd.G.Server == "" {
		return world.PinBy{}, refuse(world.CodePinAnchor, "%s is in no server's guild", c.C.ID)
	}
	m := gd.G.Member(c.C.ID)
	if m == nil || (p.As == world.PinAdmin && !m.Admin) {
		return world.PinBy{}, refuse(world.CodePinAnchor, "%s is not %s of %s", c.C.ID, anchorRole(p.As), gd.G.Name)
	}
	by := world.PinBy{Role: p.As, Server: gd.G.Server, Char: c.C.ID, Label: p.Label}
	if withdraw {
		return by, nil
	}
	if _, ok := g.regionSettlement(gd, p.At); !ok {
		return world.PinBy{}, refuse(world.CodePinAnchor, "%s runs no settlement in the region of %s", gd.G.Name, p.At.Ref())
	}
	region := g.r.Gen.RegionOf(p.At)
	by.Region = &region
	return by, nil
}

func anchorRole(as string) string {
	if as == world.PinAdmin {
		return "an admin"
	}
	return "a member"
}

// mayWithdraw holds a server to withdrawing its own pins; a designer may
// withdraw any. An unknown pin is the world's to refuse.
func (g *Game) mayWithdraw(id string, by world.PinBy) error {
	if by.Role == world.PinDesigner {
		return nil
	}
	i := slices.IndexFunc(g.World.Pins, func(p world.Pin) bool { return p.ID == id })
	if i >= 0 && g.World.Pins[i].By.Server != by.Server {
		return refuse(world.CodePinAnchor, "%s was not placed from this server", id)
	}
	return nil
}

// refusedFrom turns a world's refusal into the game's, keeping its code.
func refusedFrom(err error) error {
	var r *world.Refusal
	if errors.As(err, &r) {
		return &Refused{Code: r.Code, Msg: r.Msg}
	}
	return err
}
