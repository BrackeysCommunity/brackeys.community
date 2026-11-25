package game

import (
	"cmp"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/market"
)

// Staged goods trade only on their settlement's staged books, apart from
// its books, between players, with no fee (GDD 10.8). No faction, keeper
// or trader order is ever posted there, and no reader of prices, news or
// prosperity looks at them, so a staged trade moves coin between two
// characters and nothing else.

// structural: the id prefixes of a staged book's orders and a staged
// item's listings; their escrows are the staged homes the market adds to
// the guard.
const (
	stagedOrderPrefix   = "so-"
	stagedListingPrefix = "sl-"
)

func init() {
	stagedEscrows = append(stagedEscrows, func(_ *Game, acc string) bool {
		id, ok := strings.CutPrefix(acc, ledger.EscrowPool(""))
		return ok && (strings.HasPrefix(id, stagedOrderPrefix) || strings.HasPrefix(id, stagedListingPrefix))
	})
}

// StagedBook is a settlement's staged book for a material, made empty if
// need be.
func (g *Game) StagedBook(settlement int, material string) *market.Book {
	m := g.Market
	i, ok := slices.BinarySearchFunc(m.Staged, bookKey{settlement, material}, cmpBook)
	if !ok {
		m.Staged = slices.Insert(m.Staged, i, &market.Book{Settlement: settlement, Material: material, Bids: []market.Order{}, Asks: []market.Order{}})
	}
	return m.Staged[i]
}

// StagedBookOf is a settlement's staged book for a material, or nil.
func (g *Game) StagedBookOf(settlement int, material string) *market.Book {
	if g.Market == nil {
		return nil
	}
	i, ok := slices.BinarySearchFunc(g.Market.Staged, bookKey{settlement, material}, cmpBook)
	if !ok {
		return nil
	}
	return g.Market.Staged[i]
}

// StagedBooksAt are a settlement's staged books.
func (g *Game) StagedBooksAt(settlement int) []*market.Book {
	if g.Market == nil {
		return nil
	}
	var out []*market.Book
	for _, b := range g.Market.Staged {
		if b.Settlement == settlement {
			out = append(out, b)
		}
	}
	return out
}

// stagedServer is the server whose staging minted a settlement's staged
// goods: its latest stage there, else the server whose guild runs it.
func (g *Game) stagedServer(n int) string {
	if g.Live != nil {
		for i := len(g.Live.Stages) - 1; i >= 0; i-- {
			if st := g.Live.Stages[i]; st.Settlement == n {
				return st.Server
			}
		}
	}
	if n >= 0 && n < len(g.Places) {
		if gd := g.GuildOf(g.Places[n].Guild); gd != nil {
			return gd.G.Server
		}
	}
	return ""
}

// stampedBy stamps facts with server's staging stamp until the returned func restores the previous stamp; an empty server changes nothing.
func (g *Game) stampedBy(server string) (restore func()) {
	was := g.stagedBy
	if server != "" {
		g.stagedBy = serverStamp(server)
	}
	return func() { g.stagedBy = was }
}

// stagedFrom names the other settlements a character's staged units of a
// material come from, for a refusal.
func (g *Game) stagedFrom(c *Char, material string, except int) []string {
	var out []string
	for _, s := range c.C.Staged {
		if s.Material == material && s.At != except && s.Units > 0 {
			out = append(out, g.stagedPlace(s.At))
		}
	}
	return out
}

// stagedPlace is what a staged origin is called in a refusal.
func (g *Game) stagedPlace(n int) string {
	return cmp.Or(g.settlementName(n), "settlement "+strconv.Itoa(n))
}

// stagedHere refuses an ask of staged units a character does not carry
// from this settlement; units staged elsewhere trade only there.
func (g *Game) stagedHere(c *Char, n int, material string, units int64) error {
	if have := g.StagedHeld(c, n, material); have >= units {
		return nil
	}
	if from := g.stagedFrom(c, material, n); len(from) > 0 {
		return refuse(StagedLocal, "%s's staged %s are from %s: they trade only on the staged book there", c.C.ID, material, strings.Join(from, ", "))
	}
	return refuse(BadArgs, "%s does not carry %d %s staged here", c.C.ID, units, material)
}

// stagedOrder posts a limit order on the staged book where a character
// stands and matches it; an order that must fill now (keep false) gives
// back what did not.
func (g *Game) stagedOrder(c *Char, cmd Command, side market.Side, keep bool) error {
	n, err := g.marketHere(c)
	if err != nil {
		return err
	}
	material := cmd.Material
	if !g.isMaterial(ledger.Material(material)) {
		return refuse(BadArgs, "nothing called %q trades on a staged book", material)
	}
	if cmd.Units <= 0 || cmd.Price < 0 || (keep && cmd.Price == 0) {
		return refuse(BadArgs, "an order needs units and a price")
	}
	acc := ledger.Char(c.C.ID)
	if !keep {
		if b := g.StagedBookOf(n, material); b == nil || b.Depth(other(side)) == 0 {
			return refuse(NotHere, "nobody here trades staged %s", material)
		}
	} else if err := g.roomForOrder(c); err != nil {
		return err
	}
	price := cmd.Price
	if side == market.Bid && price == 0 {
		price = sweep(g.StagedBookOf(n, material), acc, cmd.Units)
	}
	if side == market.Ask && price == 0 {
		price = 1
	}
	asset, units := ledger.Staged(n, material), cmd.Units
	if side == market.Bid {
		coin, ok := times(units, price)
		if !ok || coin == 0 {
			return refuse(BadArgs, "nothing to buy at that price")
		}
		asset, units = ledger.Coin, coin
		if err := g.afford(c, asset, material, units); err != nil {
			return err
		}
	} else if err := g.stagedHere(c, n, material, units); err != nil {
		return err
	}
	defer g.stampedBy(g.stagedServer(n))()
	id, seq := g.nextID(stagedOrderPrefix)
	if err := g.escrow(c, cmd.Key, id, asset, units); err != nil {
		return err
	}
	b := g.StagedBook(n, material)
	o := market.Order{ID: id, Owner: acc, Side: side, Price: price, Qty: cmd.Units, Placed: g.Tick(), Expires: g.expiry(), Seq: seq}
	b.Add(o)
	g.Market.opened(acc, 1)
	if _, err := g.fact(c, "order.placed", g.Tick(), fact.S("material", material), fact.S("side", string(side)), fact.N("units", o.Qty), fact.N("price", o.Price),
		fact.B("staged", true)); err != nil {
		return err
	}
	if err := g.stagedMatch(b, cmd.Key); err != nil {
		return err
	}
	if !keep {
		if _, ok := b.Remove(id); ok {
			g.Market.opened(acc, -1)
			return g.unescrow(id, acc, ledger.SubKey(cmd.Key, "rest"))
		}
	}
	return nil
}

// other is the side an order fills against.
func other(side market.Side) market.Side {
	if side == market.Bid {
		return market.Ask
	}
	return market.Bid
}

// stagedMatch fills a staged book between players and settles each fill;
// an owner never trades with itself, and a young character stays capped.
func (g *Game) stagedMatch(b *market.Book, key string) error {
	return g.fill(b, key, func(bid, ask market.Order) bool {
		return bid.Owner == ask.Owner || g.capped(b.Material, bid, ask, market.Price(bid, ask), min(bid.Qty, ask.Qty))
	}, g.stagedSettle)
}

// stagedSettle moves one staged fill: the staged units from the ask's
// escrow to the buyer, coin from the bid's escrow to the seller, any
// price improvement back to the buyer, and no fee.
func (g *Game) stagedSettle(b *market.Book, f market.Fill, key string) error {
	coin, ok := times(f.Qty, f.Price)
	if !ok {
		return fmt.Errorf("game: staged fill %s/%s overflows", f.Bid.ID, f.Ask.ID)
	}
	seller, buyer := f.Ask.Owner, f.Bid.Owner
	s := sale{goods: ledger.Pair(ledger.EscrowPool(f.Ask.ID), buyer, ledger.Staged(b.Settlement, b.Material), f.Qty), payer: ledger.EscrowPool(f.Bid.ID),
		seller: seller, buyer: buyer, coin: coin, back: max(0, (f.Bid.Price-f.Price)*f.Qty), txn: "fill", kind: "market.filled", settlement: b.Settlement,
		row: Trade{Material: b.Material, Units: f.Qty, Price: f.Price}, staged: true, server: g.stagedServer(b.Settlement)}
	s.data = func(int64) []fact.Datum {
		return []fact.Datum{fact.S("material", b.Material), fact.N("units", f.Qty), fact.N("price", f.Price), fact.N("coin", coin), fact.N("fee", 0),
			fact.N("settlement", int64(b.Settlement)), fact.B("staged", true)}
	}
	if _, _, err := g.settleSale(s, key); err != nil {
		return err
	}
	b.Record(f)
	return nil
}

// stagedTraded counts coin a server's staged books or listings moved
// this week.
func (w *Week) stagedTraded(server string, coin int64) { w.Staged.Bump(server, coin) }
