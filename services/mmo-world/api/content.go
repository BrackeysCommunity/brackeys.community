package api

// Operator kinds of content and pins (GDD 4.17, 14.4). Each acts on the
// world, so it names no character.
const (
	// OpPinReserve stages a fix on a tile nobody has reached: Pin carries
	// the tile, the reach and the fix.
	OpPinReserve = "pin-reserve"
	// OpPinEdit changes a reached tile's stored content.
	OpPinEdit = "pin-edit"
	// OpPinWithdraw stops a live pin counting: Pin.Pin names it.
	OpPinWithdraw = "pin-withdraw"
	// OpContentFreeze stores the seed's content on a world from before
	// content came from history; the service sends it itself at open.
	OpContentFreeze = "content-freeze"
)

// Refusal codes of pins and the freeze.
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
	CodePinRoute      = "pin-route" // the re-laid corridors would move
	CodePinCut        = "pin-cut"   // tiles connected round the pin would part
	CodePinWorld      = "pin-world" // a chunk's digest moved; never expected
	CodeAlreadyFrozen = "already-frozen"
	CodeContentNative = "content-native"
)

// PathOperatorPins lists the live pins, to operators only.
const PathOperatorPins = "/v1/operator/pins"

// Placed says a place was staged, and by whom (GDD 14.5).
type Placed struct {
	By     string `json:"by"` // admins, staff
	Label  string `json:"label"`
	Points int64  `json:"points,omitempty"` // event points, staff only
}

// PinFix is what a pin sets; "" and 0 leave a field to the draw.
type PinFix struct {
	Site     string `json:"site,omitempty"`
	Landmark string `json:"landmark,omitempty"`
	SiteKind string `json:"siteKind,omitempty"`
	Dungeon  string `json:"dungeon,omitempty"`
	Floors   int64  `json:"floors,omitempty"`
	Lead     string `json:"lead,omitempty"`
	Stock    string `json:"stock,omitempty"` // a map.stock-bands row
	// Ground is a terrain pin's ground, over the scaffold where it lands.
	Ground *GroundFix `json:"ground,omitempty"`
}

// GroundFix sets a map.terrain row and an elevation, 0 for the tile's own,
// on a pin's tile or its tile and ring; water follows from the terrain.
type GroundFix struct {
	Terrain   string `json:"terrain"`
	Elevation int64  `json:"elevation,omitempty"`
	Ring      bool   `json:"ring,omitempty"`
}

// PinOrder is what a pin kind carries. As is "" or designer, admin or
// staff; For is the character an admin or staff pin is placed by, and
// Label its server's name.
type PinOrder struct {
	At    Hex    `json:"at"`
	Reach int64  `json:"reach,omitempty"`
	Fix   PinFix `json:"fix"`
	As    string `json:"as,omitempty"`
	For   string `json:"for,omitempty"`
	Label string `json:"label,omitempty"`
	Pin   string `json:"pin,omitempty"` // the pin a withdraw names
}

// Pin is a pin as an operator reads it.
type Pin struct {
	ID        string `json:"id"`
	At        Hex    `json:"at"`
	Reach     int64  `json:"reach"`
	Fix       PinFix `json:"fix"`
	As        string `json:"as"`
	Server    string `json:"server,omitempty"`
	Label     string `json:"label,omitempty"`
	Points    int64  `json:"points,omitempty"`
	Tick      int64  `json:"tick"`
	Landed    int64  `json:"landed,omitempty"`
	Withdrawn int64  `json:"withdrawn,omitempty"`
	Edit      bool   `json:"edit,omitempty"`
}

// Pins is the reply on PathOperatorPins.
type Pins struct {
	Pins []Pin `json:"pins"`
}
