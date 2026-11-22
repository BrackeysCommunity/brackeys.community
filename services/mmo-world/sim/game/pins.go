package game

import (
	"errors"
	"slices"

	"jams.team/mmo-world/sim/hex"
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

// pinCommand stages, edits or withdraws a pin. The world runs every
// validator before it changes anything, so a refusal leaves the game as
// it was.
func (g *Game) pinCommand(cmd Command) error {
	p := cmd.Pin
	if p == nil {
		return refuse(BadArgs, "%s carries a pin", cmd.Kind)
	}
	by, err := g.pinBy(p, cmd.Kind == PinWithdraw)
	if err != nil {
		return err
	}
	if cmd.Kind != PinWithdraw {
		// A starting settlement's tile is the world's own to refuse.
		if pl := g.PlaceAt(p.At); pl != nil && pl.Lattice < 0 {
			return refuse(world.CodePinGround, "%s holds a settlement", p.At.Ref())
		}
		if cmd.Kind == PinEdit && (p.Fix.Dungeon != "" || p.Fix.Floors != 0) && g.delvedAt(p.At) {
			return refuse(world.CodePinEntered, "the dungeon on %s has been entered", p.At.Ref())
		}
	}
	switch cmd.Kind {
	case PinReserve:
		_, err = g.World.Reserve(g.Log, p.At, p.Reach, p.Fix, by)
	case PinEdit:
		// An edit sent with no reach reaches as little as any pin may.
		_, err = g.World.EditPin(g.Log, p.At, max(p.Reach, 1), p.Fix, by)
	case PinWithdraw:
		if err = g.mayWithdraw(p.Pin, by); err == nil {
			_, err = g.World.Withdraw(g.Log, p.Pin)
		}
	default:
		err = refuse(BadArgs, "no pin command %q", cmd.Kind)
	}
	return refusedFrom(err)
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
	region := g.r.Gen.RegionOf(p.At)
	if !slices.ContainsFunc(g.Places, func(pl *Place) bool { return pl.Guild == gd.G.ID && g.r.Gen.RegionOf(pl.Hex) == region }) {
		return world.PinBy{}, refuse(world.CodePinAnchor, "%s runs no settlement in the region of %s", gd.G.Name, p.At.Ref())
	}
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
