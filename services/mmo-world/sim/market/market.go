// Package market is one settlement's order book for one material (GDD
// 10.3): limit buys and sells matched by price and then by time, filled in
// part if need be. It moves no coin or goods itself; the game escrows them
// while an order is open and settles each Fill through the ledger.
package market

import (
	"cmp"
	"slices"
)

// Side is a buy or a sell.
type Side string

const (
	Bid Side = "bid"
	Ask Side = "ask"
)

// Order is a limit order resting in a book. Seq orders time: lower came
// first. Owner is the account that placed it; Faction is the index of the
// faction whose standing prices a fill, for a faction's buy order.
type Order struct {
	ID      string `json:"id"`
	Owner   string `json:"owner"`
	Side    Side   `json:"side"`
	Price   int64  `json:"price"` // coin each
	Qty     int64  `json:"qty"`   // units still wanted or offered
	Placed  int64  `json:"placed"`
	Expires int64  `json:"expires"`
	Seq     int64  `json:"seq"`
	Faction *int   `json:"faction,omitempty"`
}

// Fill is one match: Qty units at Price, the resting order's price.
type Fill struct {
	Bid    Order    `json:"bid"` // as it stood before the fill
	Ask    Order    `json:"ask"`
	Price  int64    `json:"price"`
	Qty    int64    `json:"qty"`
	Tick   int64    `json:"tick"`
	Closed []string `json:"closed,omitempty"` // orders the fill emptied
}

// Book is the open orders for one material at one settlement, each side
// sorted best first: bids high to low, asks low to high, then by time.
type Book struct {
	Settlement int     `json:"settlement"`
	Material   string  `json:"material"`
	Bids       []Order `json:"bids"`
	Asks       []Order `json:"asks"`
	// Last is the price of the last fill and LastTick when it was; Days
	// are closed world days, oldest first.
	Last     int64 `json:"last,omitempty"`
	LastTick int64 `json:"lastTick,omitempty"`
	Days     []Day `json:"days,omitempty"`
	Today    Day   `json:"today"` // the world day so far
}

func better(side Side) func(a, b Order) int {
	return func(a, b Order) int {
		p := cmp.Compare(a.Price, b.Price)
		if side == Bid {
			p = -p
		}
		return cmp.Or(p, cmp.Compare(a.Seq, b.Seq))
	}
}

func (b *Book) side(s Side) *[]Order {
	if s == Bid {
		return &b.Bids
	}
	return &b.Asks
}

// Add rests an order in its place on its side.
func (b *Book) Add(o Order) {
	list := b.side(o.Side)
	i, _ := slices.BinarySearchFunc(*list, o, better(o.Side))
	*list = slices.Insert(*list, i, o)
}

// Remove takes an order out by id.
func (b *Book) Remove(id string) (Order, bool) {
	for _, s := range []Side{Bid, Ask} {
		list := b.side(s)
		if i := slices.IndexFunc(*list, func(o Order) bool { return o.ID == id }); i >= 0 {
			o := (*list)[i]
			*list = slices.Delete(*list, i, i+1)
			return o, true
		}
	}
	return Order{}, false
}

// Expire takes out every order whose time is up at tick.
func (b *Book) Expire(tick int64) []Order {
	var out []Order
	for _, s := range []Side{Bid, Ask} {
		list := b.side(s)
		*list = slices.DeleteFunc(*list, func(o Order) bool {
			if o.Expires > tick {
				return false
			}
			out = append(out, o)
			return true
		})
	}
	return out
}

// Best is the best bid and ask price, 0 for an empty side.
func (b *Book) Best() (bid, ask int64) {
	if len(b.Bids) > 0 {
		bid = b.Bids[0].Price
	}
	if len(b.Asks) > 0 {
		ask = b.Asks[0].Price
	}
	return bid, ask
}

// Depth is every unit on a side.
func (b *Book) Depth(s Side) int64 {
	var n int64
	for _, o := range *b.side(s) {
		n += o.Qty
	}
	return n
}

// Match fills while the best bid meets the best ask, at the price of
// whichever order came first, and takes out what is filled. skip reports a
// pair that may not trade (an owner meeting itself, a seller a faction
// will not buy from); the bid it names is passed over for that ask.
func Match(b *Book, tick int64, skip func(bid, ask Order) bool) []Fill {
	var out []Fill
	for ai := 0; ai < len(b.Asks); {
		ask := b.Asks[ai]
		bi := slices.IndexFunc(b.Bids, func(bid Order) bool {
			return bid.Price >= ask.Price && (skip == nil || !skip(bid, ask))
		})
		if bi < 0 {
			ai++
			continue
		}
		bid := b.Bids[bi]
		f := Fill{Bid: bid, Ask: ask, Price: Price(bid, ask), Qty: min(bid.Qty, ask.Qty), Tick: tick}
		b.Bids[bi].Qty -= f.Qty
		b.Asks[ai].Qty -= f.Qty
		if b.Bids[bi].Qty == 0 {
			f.Closed = append(f.Closed, bid.ID)
			b.Bids = slices.Delete(b.Bids, bi, bi+1)
		}
		if b.Asks[ai].Qty == 0 {
			f.Closed = append(f.Closed, ask.ID)
			b.Asks = slices.Delete(b.Asks, ai, ai+1)
		}
		out = append(out, f)
	}
	return out
}

// Price is what a bid and an ask trade at: the price of whichever rested
// first.
func Price(bid, ask Order) int64 {
	if ask.Seq < bid.Seq {
		return ask.Price
	}
	return bid.Price
}
