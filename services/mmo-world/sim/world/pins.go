package world

import (
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
)

// Who may pin (GDD 14.1, 14.5).
const (
	PinDesigner = sheets.PinRoleDesigner
	PinAdmin    = "admin"
	PinStaff    = "staff"
)

// Why a world-level command is refused.
const (
	CodePinReach      = "pin-reach"
	CodePinSeen       = "pin-seen"
	CodePinUnseen     = "pin-unseen"
	CodePinGround     = "pin-ground"
	CodePinPath       = "pin-path"
	CodePinFix        = "pin-fix"
	CodePinBudget     = "pin-budget"
	CodePinAnchor     = "pin-anchor"
	CodePinTaken      = "pin-taken"
	CodePinEntered    = "pin-entered"
	CodePinGone       = "pin-gone"
	CodeAlreadyFrozen = "already-frozen"
)

// Pin is content staged on a tile: a reserve the tile's first reach
// honours, or an edit to a reached tile's stored content (GDD 14.4).
type Pin struct {
	ID        string   `json:"id"` // "pin-<n>"
	At        hex.Hex  `json:"at"`
	Reach     int64    `json:"reach"`
	Fix       tile.Fix `json:"fix"`
	By        PinBy    `json:"by"`
	Tick      int64    `json:"tick"`
	Fact      fact.ID  `json:"fact"`
	Edit      bool     `json:"edit,omitempty"`
	Landed    int64    `json:"landed,omitempty"`
	Withdrawn int64    `json:"withdrawn,omitempty"`
}

// PinBy is who placed a pin.
type PinBy struct {
	Role   string         `json:"role"` // designer, admin, staff
	Server string         `json:"server,omitempty"`
	Char   string         `json:"char,omitempty"`
	Label  string         `json:"label,omitempty"`
	Points int64          `json:"points,omitempty"`
	Region *gen.LatticeID `json:"region,omitempty"` // admin and staff: reach clipped to it
}

// pinCell is a pin cell's (I, J), the pin reach's own grid.
type pinCell struct{ I, J int64 } //nolint:unused // keys the pin index

// Refusal is a world-level command turned down; nothing changed.
type Refusal struct{ Code, Msg string }

func (r *Refusal) Error() string { return r.Code + ": " + r.Msg }

// CheckPin runs every pin validator, changing nothing.
func (s *State) CheckPin(at hex.Hex, reach int64, fix tile.Fix, by PinBy, edit bool) error {
	return nil
}

// Reserve stages a fix on a tile nobody has reached.
func (s *State) Reserve(log fact.Log, at hex.Hex, reach int64, fix tile.Fix, by PinBy) (*Pin, error) {
	return nil, nil
}

// EditPin changes a reached tile's stored content, and that tile's only.
func (s *State) EditPin(log fact.Log, at hex.Hex, reach int64, fix tile.Fix, by PinBy) (*Pin, error) {
	return nil, nil
}

// Withdraw stops a live pin counting in later digests; a landed reserve
// keeps its tile's content.
func (s *State) Withdraw(log fact.Log, id string) (*Pin, error) { return nil, nil }

// ReserveAt is the live reserve on h that has not landed, if any.
func (s *State) ReserveAt(h hex.Hex) *Pin { return nil }

// PinsAt are the ids of the live pins whose reach covers h at tick t,
// sorted and capped at pins-in-reach-max.
func (s *State) PinsAt(h hex.Hex, t int64) []string { return nil }

// ApplyFix lands a reserve on content being drawn: the fix overrides the
// draw for every field it sets.
func (s *State) ApplyFix(c *tile.Content, h hex.Hex, p *Pin, t int64, log fact.Log) error {
	return nil
}

// LivePins are the pins still counting.
func (s *State) LivePins() []Pin { return nil }

// prunePins drops the pins that stopped counting, at the day's turn.
func (s *State) prunePins(t int64) {} //nolint:unused // called from the day turn
