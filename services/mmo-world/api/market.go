package api

// Paths of the market's reads (GDD 10.6).
const (
	PathMarket  = "/v1/market"
	PathHistory = "/v1/market/history"
	PathForum   = "/v1/market/forum"
	PathRisk    = "/v1/route-risk"
	// PathOperatorEconomy lists characters flagged for review and the
	// faucet.
	PathOperatorEconomy = "/v1/operator/economy"
)

// Action kinds of the market (GDD 10.3).
const (
	ActBid      = "bid"
	ActAsk      = "ask"
	ActTake     = "take"
	ActWithdraw = "withdraw"
	ActList     = "list"
	ActWant     = "want"
	ActPurchase = "purchase"
	ActGive     = "give"
	ActSellItem = "sell-item"
)

// Floor is what a gear buy order requires of an item.
type Floor struct {
	Durability int64  `json:"durability,omitempty"`
	Trait      string `json:"trait,omitempty"`
	Level      int64  `json:"level,omitempty"`
}

// Market is everything /market shows a character in a settlement: the
// eight lists of GDD 10.6. Material picks the book and its history.
type Market struct {
	Settlement int      `json:"settlement"`
	Name       string   `json:"name"`
	Material   string   `json:"material"`
	Book       BookView `json:"book"`
	// StagedBook is the material's staged book here, where one is open.
	StagedBook *BookView  `json:"stagedBook,omitempty"`
	Exchange   []Exchange `json:"exchange"`
	Movers     []Mover    `json:"movers"`
	Elsewhere  []Far      `json:"elsewhere"`
	Gear       []Listing  `json:"gear"`
	Wants      []GearWant `json:"wants"`
	Orders     []Order    `json:"orders"` // faction orders
	Mine       Mine       `json:"mine"`
	Report     *Report    `json:"report,omitempty"`
	Fee        int64      `json:"fee"`      // per cent of each fill, from the seller
	Limit      int64      `json:"limit"`    // open orders, listings and gear orders a character may hold
	Days       int64      `json:"days"`     // world days an order lasts
	PerPoint   int64      `json:"perPoint"` // coin sold to a faction for each standing point
	Banner     string     `json:"banner"`
}

// BookView is one book: its best levels each side.
type BookView struct {
	Material string  `json:"material"`
	Bids     []Level `json:"bids"`
	Asks     []Level `json:"asks"`
	Last     int64   `json:"last"`
	Value    int64   `json:"value"` // reference value, coin each
}

// Level is one price on a side of a book: units at a price, and whose.
type Level struct {
	Price int64  `json:"price"`
	Units int64  `json:"units"`
	Who   string `json:"who"`
}

// Exchange is one material's line on the exchange.
type Exchange struct {
	Material string `json:"material"`
	Last     int64  `json:"last"`   // coin
	Change   int64  `json:"change"` // per cent over the week
	Bid      int64  `json:"bid"`
	Ask      int64  `json:"ask"`
	Units    int64  `json:"units"` // traded this week
}

// Mover is a rise or fall and the fact behind it.
type Mover struct {
	Material string `json:"material"`
	Change   int64  `json:"change"` // per cent
	Last     int64  `json:"last"`
	Cause    string `json:"cause,omitempty"`
}

// Far is a price in another settlement and how old the news is.
type Far struct {
	Name  string `json:"name"`
	Price int64  `json:"price"`
	Age   int64  `json:"age"` // ticks
	Own   bool   `json:"own"`
	Known bool   `json:"known"`
}

// Listing is a piece of gear listed here.
type Listing struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	Slot       string `json:"slot"`
	Level      int64  `json:"level"`
	Picks      int64  `json:"picks"`
	Durability int64  `json:"durability"`
	Max        int64  `json:"max"`
	Maker      string `json:"maker"`
	Seller     string `json:"seller"`
	Price      int64  `json:"price"`
	Value      int64  `json:"value"`
	Mine       bool   `json:"mine"`
	Sigil      string `json:"sigil"`            // a media key
	Staged     bool   `json:"staged,omitempty"` // sold only here, to players
}

// GearWant is a buy order for gear standing here.
type GearWant struct {
	ID    string `json:"id"`
	What  string `json:"what"`
	Price int64  `json:"price"`
	Floor Floor  `json:"floor"`
	Mine  bool   `json:"mine"`
}

// Mine is a character's open orders, escrow and last ledger entries.
type Mine struct {
	Open    []Open  `json:"open"`
	Escrow  int64   `json:"escrow"` // coin in escrow
	Entries []Entry `json:"entries"`
	Young   bool    `json:"young"`
	Gave    int64   `json:"gave"` // coin given away today, while young
	Cap     int64   `json:"cap"`
}

// Open is one of a character's open orders, listings or gear orders.
type Open struct {
	ID      string `json:"id"`
	Where   string `json:"where"`
	What    string `json:"what"`
	Side    string `json:"side"` // bid, ask, listing, want
	Price   int64  `json:"price"`
	Units   int64  `json:"units"`
	Expires int64  `json:"expires"` // ticks left
}

// Entry is a ledger line of a character's: what moved, and why.
type Entry struct {
	Tick  int64  `json:"tick"`
	Kind  string `json:"kind"`
	Asset string `json:"asset"`
	Goods string `json:"goods,omitempty"` // the material or provisions moved; empty for coin or an item
	Units int64  `json:"units"`
}

// Report is the weekly ledger report (GDD 10.5).
type Report struct {
	Day       int64   `json:"day"`
	Supply    int64   `json:"supply"`
	Active    int64   `json:"active"`
	PerActive int64   `json:"perActive"`
	Low       int64   `json:"low"`
	High      int64   `json:"high"`
	Rate      int64   `json:"rate"`     // coin per active character per day
	Velocity  int64   `json:"velocity"` // hundredths of a coin changing hands per coin per day
	Faucet    int64   `json:"faucet"`
	Fees      int64   `json:"fees"`
	Top       []Goods `json:"top"`
	Every     int64   `json:"every"` // world days between reports
	Audit     int     `json:"audit"`
	Chart     string  `json:"chart,omitempty"`
	// Staged are each server's staged goods, apart from every line above.
	Staged []StagedLine `json:"staged,omitempty"`
}

// History is one material's price over time at a settlement, as a chart.
type History struct {
	Material string    `json:"material"`
	Name     string    `json:"name"`
	Days     []PricePt `json:"days"`
	Chart    string    `json:"chart"` // a media key
}

// PricePt is a world day's close and what traded.
type PricePt struct {
	Day   int64  `json:"day"`
	Close int64  `json:"close"`
	Units int64  `json:"units"`
	Cause string `json:"cause,omitempty"`
}

// Forum is each settlement's notable trades and movers of a world day,
// for the market forum (GDD 17.2).
type Forum struct {
	Day   int64       `json:"day"`
	Posts []ForumPost `json:"posts"`
}

// ForumPost is one settlement's day.
type ForumPost struct {
	Settlement int     `json:"settlement"`
	Name       string  `json:"name"`
	Banner     string  `json:"banner"` // a media key
	Trades     []Trade `json:"trades"`
	Movers     []Mover `json:"movers"`
}

// Trade is a notable fill.
type Trade struct {
	What  string `json:"what"`
	Units int64  `json:"units"`
	Price int64  `json:"price"`
	Coin  int64  `json:"coin"`
}

// RouteRisk is a route's danger and the haul it puts at risk (GDD 10.7).
type RouteRisk struct {
	To       string     `json:"to,omitempty"`
	Tiles    []TileRisk `json:"tiles"`
	Expected int64      `json:"expected"` // hundredths of an ambush
	Worst    string     `json:"worst"`
	Haul     int64      `json:"haul"` // coin at reference value
}

// TileRisk is one tile's band.
type TileRisk struct {
	At     Hex    `json:"at"`
	Band   string `json:"band"`
	Chance int64  `json:"chance"` // per cent
}

// Economy is the faucet and the flags an operator reviews (GDD 10.9).
type Economy struct {
	Active    int64     `json:"active"`
	Supply    int64     `json:"supply"`
	PerActive int64     `json:"perActive"`
	Rate      int64     `json:"rate"`
	Flagged   []Flagged `json:"flagged"`
}

// Flagged is a character an operator should look at, and why.
type Flagged struct {
	CharacterID string   `json:"characterId"`
	Flags       []string `json:"flags"`
	Streak      int64    `json:"streak"`
}
