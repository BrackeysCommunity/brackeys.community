package game

import (
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/npc"
)

// Theft is an encounter's theft or flight from the watch, fixed when it
// begins, so the odds shown are the odds rolled (GDD 6.5).
type Theft struct {
	Kind    string `json:"kind"`   // lift|burgle|waylay|flee
	Victim  string `json:"victim"` // ref string
	NPC     string `json:"npc,omitempty"`
	Caravan string `json:"caravan,omitempty"`
	Faction string `json:"faction,omitempty"` // the victim's standing key
	Source  string `json:"source"`            // the ledger account the haul leaves
	Witness int64  `json:"witness"`           // per cent
	// Parts are the witness formula's parts, in per cent.
	Parts []fight.Part `json:"parts"`
	// Coin, Goods and Item are the planned haul, and Worth its worth.
	Coin  int64        `json:"coin,omitempty"`
	Goods []item.Spoil `json:"goods,omitempty"`
	Item  string       `json:"item,omitempty"`
	// Listing is an NPC's listing the item is lifted from.
	Listing string `json:"listing,omitempty"`
	Worth   int64  `json:"worth"`
	// Side is the prey side's goal a waylay feeds.
	Side  string  `json:"side,omitempty"`
	Place int     `json:"place"` // settlement index, -1 none
	At    hex.Hex `json:"at"`
	// Failed: a beat was lost, so the theft is caught.
	Failed bool `json:"failed,omitempty"`
}

// Syndicate is what the syndicate has done to the world: its dens' moves.
// It is nil until the first move, so an older world digests as it did.
type Syndicate struct {
	Moves []DenMove `json:"moves,omitempty"`
}

// DenMove is a den's fence moving to a new settlement on a world day.
type DenMove struct {
	Fence string  `json:"fence"`
	From  hex.Hex `json:"from"`
	To    hex.Hex `json:"to"`
	Day   int64   `json:"day"`
	Cause string  `json:"cause"`
}

// Command kinds of theft, the watch and the syndicate.
const (
	Steal   = "steal"
	Fence   = "fence"
	PayFine = "pay-fine"
	Flee    = "flee"
)

// Theft kinds, the theft.kinds rows.
const (
	KindLift   = "lift"
	KindBurgle = "burgle"
	KindWaylay = "waylay"
	KindFlee   = "flee"
)

// Refusal codes of theft, the watch and the syndicate.
const (
	NoTarget       = "no-target"
	NothingToSteal = "nothing-to-steal"
	StoppedCode    = "stopped-by-watch"
	NotStopped     = "not-stopped"
	ShortCode      = Short
	NotHot         = "not-hot"
	HotGoods       = "hot-goods"
	FenceHidden    = "fence-hidden"
	FenceSpent     = "fence-spent"
	NotMade        = "not-made"
	NoDen          = "no-den"
	HostileCode    = "hostile"
	NotABacker     = "not-a-backer"
)

// Fact kinds of alignment, theft, the watch and the syndicate.
const (
	factAlignment    = "alignment.moved"
	factTheft        = "theft.made"
	factWatchStopped = "watch.stopped"
	factWatchPaid    = "watch.paid"
	factWatchFled    = "watch.fled"
	factWatchCaught  = "watch.caught"
	factFenceBought  = "fence.bought"
	factFenceCame    = "fence.came"
	factLaundered    = "craft.laundered"
	factMade         = "syndicate.made"
	factUnmade       = "syndicate.unmade"
	factJobPosted    = "syndicate.posted"
	factBetrayed     = "character.betrayed"
	factDenMoved     = "den.moved"
)

// crimeCommands run the command kinds act's own switch does not know,
// registered by the files that build them. A handler checks everything
// before it changes anything, so a refusal leaves the game as it was.
var crimeCommands = map[string]func(g *Game, c *Char, cmd Command) error{}

// crimeEffects run the story effect kinds run's own switch does not know.
var crimeEffects = map[string]func(x effect) error{}

// meetHooks run at every meeting in talk, after the meeting is recorded.
var meetHooks []func(g *Game, c *Char, n *npc.NPC, t int64) error
