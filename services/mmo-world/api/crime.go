package api

// Action kinds of theft and the watch (GDD 6.5, 4.5). A steal names its
// theft kind in Option, the NPC lifted from in NPC and the caravan waylaid
// in Target; ForSide sends a waylay's haul to the prey side the character
// backs. A fence sale names Material and Units, or Item. Pay-fine and flee
// take nothing: they answer the watch holding the character. A craft with
// BackRoom set works a den's back room.
const (
	ActSteal   = "steal"
	ActFence   = "fence"
	ActPayFine = "pay-fine"
	ActFlee    = "flee"
)

// Theft kinds, the theft.kinds rows. Flee is the run from the watch.
const (
	TheftLift   = "lift"
	TheftBurgle = "burgle"
	TheftWaylay = "waylay"
	TheftFlee   = "flee"
)

// Alignment bands, the alignment.bands rows, worst first (GDD 5.10).
const (
	BandNotorious  = "notorious"
	BandCrooked    = "crooked"
	BandUnremarked = "unremarked"
	BandDecent     = "decent"
	BandUpright    = "upright"
)

// Leanings an NPC holds (GDD 4.18).
const (
	LeaningUpright = "upright"
	LeaningCrooked = "crooked"
	LeaningNone    = "none"
)

// Moods an NPC holds toward a character, from its disposition; none is "".
const (
	MoodWarm    = "warm"
	MoodCold    = "cold"
	MoodHostile = "hostile"
)

// CondWanted is set while the watch wants the character somewhere.
const CondWanted = "wanted"

// Refusal codes of theft, the watch and the syndicate. A fine the
// character cannot pay is CodeShort.
const (
	CodeNoTarget       = "no-target"
	CodeNothingToSteal = "nothing-to-steal"
	CodeStoppedByWatch = "stopped-by-watch"
	CodeNotStopped     = "not-stopped"
	CodeNotHot         = "not-hot"
	CodeHotGoods       = "hot-goods"
	CodeFenceHidden    = "fence-hidden"
	CodeFenceSpent     = "fence-spent"
	CodeNotMade        = "not-made"
	CodeNoDen          = "no-den"
	CodeHostile        = "hostile"
	CodeNotABacker     = "not-a-backer"
)

// Alignment is where a character stands (GDD 5.10). GoodToday is the
// good it has gained this world day, against Numbers.GoodDay. Made: the
// syndicate has made it one of its own.
type Alignment struct {
	Value     int64  `json:"value"`
	Band      string `json:"band"`
	GoodToday int64  `json:"goodToday"`
	Made      bool   `json:"made"`
}

// Grudge is a faction the character betrayed: With is its standing key,
// Name what it is called, Ends the world day the grudge ends.
type Grudge struct {
	With string `json:"with"`
	Name string `json:"name"`
	Ends int64  `json:"ends"`
}

// HotGoods are stolen goods the character holds: units of a material, or
// an item by id. Victim is who they were taken from, in words; Days the
// world days the mark has left; Reach the tiles from here to where they
// were taken (beyond Numbers.HotReach they may be listed and sold).
type HotGoods struct {
	Material string `json:"material,omitempty"`
	Item     string `json:"item,omitempty"`
	Units    int64  `json:"units"`
	Victim   string `json:"victim"`
	Days     int64  `json:"days"`
	Reach    int64  `json:"reach"`
}

// WantedIn is one theft the watch wants the character for: whom it robbed,
// in words, the settlements whose watch stops it, the coin paying it off
// costs, and the world days it has left.
type WantedIn struct {
	Victim string   `json:"victim"`
	Places []string `json:"places"`
	Fine   int64    `json:"fine"`
	Days   int64    `json:"days"`
}

// WatchStop is the watch holding the character at a settlement's gate:
// it pays the fine or flees. CanPay: it holds the coin the fine takes.
type WatchStop struct {
	Settlement int    `json:"settlement"`
	Name       string `json:"name"`
	Fine       int64  `json:"fine"`
	CanPay     bool   `json:"canPay"`
}

// Theft is a theft or a flight from the watch as its encounter shows it,
// fixed when it began. Witness is the per cent chance a won theft is seen,
// shown before every press, and WitnessWhy its parts in per cent. Coin,
// Haul and Item are what is planned (Item is the item's name); Caught is
// set once a beat has failed. ForSide is the prey side's goal a waylay's
// haul feeds.
type Theft struct {
	Kind       string  `json:"kind"`
	Victim     string  `json:"victim"`
	Witness    int64   `json:"witness"`
	WitnessWhy Why     `json:"witnessWhy"`
	Worth      int64   `json:"worth"`
	Coin       int64   `json:"coin,omitempty"`
	Haul       []Goods `json:"haul,omitempty"`
	Item       string  `json:"item,omitempty"`
	Flee       bool    `json:"flee,omitempty"`
	Caught     bool    `json:"caught,omitempty"`
	ForSide    string  `json:"forSide,omitempty"`
}

// StealTarget is something the character could steal here now: a steal
// sends Kind, and NPC or Caravan. Name is the victim in words, Worth the
// planned haul's coin and Witness the per cent chance it is seen. ForSide
// is the prey side's goal a waylay could feed, for its backer.
type StealTarget struct {
	Kind    string `json:"kind"`
	NPC     string `json:"npc,omitempty"`
	Caravan string `json:"caravan,omitempty"`
	Name    string `json:"name"`
	Worth   int64  `json:"worth"`
	Witness int64  `json:"witness"`
	ForSide string `json:"forSide,omitempty"`
}

// BandEdges are where the alignment bands begin: at or below Notorious
// and Crooked, at or above Decent and Upright; between is unremarked.
type BandEdges struct {
	Notorious int64 `json:"notorious"`
	Crooked   int64 `json:"crooked"`
	Decent    int64 `json:"decent"`
	Upright   int64 `json:"upright"`
}
