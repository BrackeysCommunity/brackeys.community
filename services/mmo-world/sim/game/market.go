package game

import (
	"cmp"
	"fmt"
	"iter"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/econ"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/faucet"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/guild"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/market"
	"jams.team/mmo-world/sim/sheets"
)

// Commands of the market (GDD 10.3).
const (
	Bid      = "bid"      // post a buy order; what does not fill rests
	Ask      = "ask"      // post a sell order; what does not fill rests
	Take     = "take"     // buy now at the best asks, up to a price
	Withdraw = "withdraw" // take back an open order, listing or gear order
	List     = "list"     // list an item at a fixed price
	Want     = "want"     // post a buy order for gear, with a floor
	Purchase = "purchase" // buy a listing
	Give     = "give"     // hand coin, goods or an item to someone here
	SellItem = "sell-item"
)

// Market is every settlement's books, listings and gear orders, the
// faucet, and what the weekly report and the forum read.
type Market struct {
	Books    []*market.Book   `json:"books"` // by settlement, then material
	Listings []market.Listing `json:"listings"`
	Wants    []market.Want    `json:"wants"`
	Seq      int64            `json:"seq"`
	Faucet   faucet.State     `json:"faucet"`
	// Trader is what each open settlement's trader may still spend on
	// items today, by settlement.
	Trader  []int64  `json:"trader"`
	Week    Week     `json:"week"`
	Reports []Report `json:"reports"`
	// Notable are today's most valuable trades by settlement; Yesterday,
	// the day just closed, is what the forum posts.
	Notable   []Trade `json:"notable"`
	Yesterday []Trade `json:"yesterday"`
	Held      []Held  `json:"held"`
}

// Trade is one fill as the forum and the lists show it.
type Trade struct {
	Settlement int    `json:"settlement"`
	Tick       int64  `json:"tick"`
	Material   string `json:"material,omitempty"`
	Kind       string `json:"kind,omitempty"` // a listing's item kind
	Units      int64  `json:"units"`
	Price      int64  `json:"price"`
	Buyer      string `json:"buyer"`
	Seller     string `json:"seller"`
	Fact       int64  `json:"fact"`
}

// Coin is what a trade moved.
func (t Trade) Coin() int64 { return t.Units * t.Price }

// structural: owners of orders that are not characters, and the standing
// a keepers' order moves.
const (
	ownerFaction  = "faction:"
	ownerKeepers  = "keepers"
	standingPlace = "place:"
)

func factionOwner(fi int) string    { return ownerFaction + strconv.Itoa(fi) }
func keepersOwner(h hex.Hex) string { return ownerKeepers + ":" + h.Ref() }

// ownerOf reads a factionOwner or keepersOwner back: the faction, or
// econ.Keepers.
func ownerOf(acc string) (fi int, ok bool) {
	if ref, found := strings.CutPrefix(acc, ownerFaction); found {
		fi, err := strconv.Atoi(ref)
		return fi, err == nil && fi >= 0
	}
	if strings.HasPrefix(acc, ownerKeepers+":") {
		return econ.Keepers, true
	}
	return 0, false
}

// standingKey is the standing a faction's order, or an NPC's choice,
// moves: the faction's, or for the keepers the settlement's.
func standingKey(fi int, h hex.Hex) string {
	if fi >= 0 {
		return factionOwner(fi)
	}
	return standingPlace + h.Ref()
}

// parseStandingKey reads a standingKey back: a faction, or the keepers
// (econ.Keepers) of a place.
func parseStandingKey(key string) (fi int, place hex.Hex, ok bool) {
	if ref, found := strings.CutPrefix(key, ownerFaction); found {
		fi, err := strconv.Atoi(ref)
		return fi, hex.Hex{}, err == nil && fi >= 0
	}
	if ref, found := strings.CutPrefix(key, standingPlace); found {
		_, err := fmt.Sscanf(ref, "%d,%d", &place.Q, &place.R)
		return econ.Keepers, place, err == nil
	}
	return 0, hex.Hex{}, false
}

func (g *Game) mp(id string) int64 { return g.r.Values.Param(id) }

// newMarket is an empty market.
func (g *Game) newMarket() *Market {
	return &Market{Books: []*market.Book{}, Listings: []market.Listing{}, Wants: []market.Want{}, Faucet: faucet.New(g.r.Faucet),
		Reports: []Report{}, Notable: []Trade{}, Yesterday: []Trade{}, Held: []Held{}, Week: newWeek(g.World.Day)}
}

// MarketAt is the open settlement with a market on a tile, or false.
func (g *Game) MarketAt(h hex.Hex) (int, bool) {
	n, ok := g.SettlementAt(h)
	return n, ok && g.HasStructure(h, structureMarket)
}

// marketHere is the settlement whose market a character stands in.
func (g *Game) marketHere(c *Char) (int, error) {
	if err := canTrade(c); err != nil {
		return 0, err
	}
	n, ok := g.MarketAt(c.C.At)
	if !ok {
		return 0, refuse(NotHere, "there is no market here")
	}
	if g.Market == nil {
		return 0, refuse(NotHere, "the market opens with the next world day")
	}
	return n, nil
}

// Book is a settlement's book for a material, made empty if need be.
func (g *Game) Book(settlement int, material string) *market.Book {
	m := g.Market
	i, ok := slices.BinarySearchFunc(m.Books, bookKey{settlement, material}, cmpBook)
	if !ok {
		m.Books = slices.Insert(m.Books, i, &market.Book{Settlement: settlement, Material: material, Bids: []market.Order{}, Asks: []market.Order{}})
	}
	return m.Books[i]
}

// BookOf is a settlement's book for a material, or nil.
func (g *Game) BookOf(settlement int, material string) *market.Book {
	if g.Market == nil {
		return nil
	}
	i, ok := slices.BinarySearchFunc(g.Market.Books, bookKey{settlement, material}, cmpBook)
	if !ok {
		return nil
	}
	return g.Market.Books[i]
}

type bookKey struct {
	settlement int
	material   string
}

func cmpBook(b *market.Book, k bookKey) int {
	return cmp.Or(cmp.Compare(b.Settlement, k.settlement), cmp.Compare(b.Material, k.material))
}

func (g *Game) nextID(prefix string) (string, int64) {
	g.Market.Seq++
	return prefix + strconv.FormatInt(g.Market.Seq, decimal), g.Market.Seq
}

// expiry is when an order, listing or gear order placed now runs out.
func (g *Game) expiry() int64 { return g.Tick() + g.mp("order-days")*sheets.TicksPerDay }

// tradable reports whether a material has books: provisions or a known
// material.
func (g *Game) tradable(material string) bool {
	a := ledger.Goods(material)
	return a == ledger.Provisions || g.isMaterial(a)
}

// Kinds of open order besides a book's bids and asks.
const (
	OpenListing = "listing"
	OpenWant    = "want"
)

// Open is one of an account's open orders, listings or gear orders.
type Open struct {
	ID         string
	Owner      string
	Kind       string // a book side, OpenListing or OpenWant
	Settlement int
	Material   string // a book's
	ItemKind   string // a listing's item's, or a gear order's
	Slot       string // a gear order's
	Price      int64
	Units      int64
	Expires    int64
	Escrow     int64 // coin held in escrow
}

// Open are an account's open orders, listings and gear orders, in that
// order; an empty acc yields every open order.
func (g *Game) Open(acc string) iter.Seq[Open] { return g.opens(acc, true) }

// opens is Open, leaving Escrow 0 unless escrow is set.
func (g *Game) opens(acc string, escrow bool) iter.Seq[Open] {
	m := g.Market
	coin := func(id string) int64 {
		if !escrow {
			return 0
		}
		return g.Ledger.Of(ledger.EscrowPool(id), ledger.Coin)
	}
	return func(yield func(Open) bool) {
		if m == nil {
			return
		}
		for _, b := range m.Books {
			for o := range b.Orders() {
				if (acc == "" || o.Owner == acc) && !yield(Open{ID: o.ID, Owner: o.Owner, Kind: string(o.Side), Settlement: b.Settlement, Material: b.Material, Price: o.Price, Units: o.Qty,
					Expires: o.Expires, Escrow: coin(o.ID)}) {
					return
				}
			}
		}
		for _, l := range m.Listings {
			if (acc == "" || l.Seller == acc) && !yield(Open{ID: l.ID, Owner: l.Seller, Kind: OpenListing, Settlement: l.Settlement, ItemKind: l.Item.Kind, Price: l.Price, Units: 1,
				Expires: l.Expires, Escrow: coin(l.ID)}) {
				return
			}
		}
		for _, w := range m.Wants {
			if (acc == "" || w.Buyer == acc) && !yield(Open{ID: w.ID, Owner: w.Buyer, Kind: OpenWant, Settlement: w.Settlement, ItemKind: w.Kind, Slot: w.Slot, Price: w.Price, Units: 1,
				Expires: w.Expires, Escrow: coin(w.ID)}) {
				return
			}
		}
	}
}

// OpenOrders counts a character's open orders, listings and gear orders.
func (g *Game) OpenOrders(c *Char) int64 { return count(g.opens(ledger.Char(c.C.ID), false)) }

func count[T any](seq iter.Seq[T]) int64 {
	var n int64
	for range seq {
		n++
	}
	return n
}

func (g *Game) roomForOrder(c *Char) error {
	if most := g.charScale(c, "order-limit", g.mp("open-orders")); g.OpenOrders(c) >= most {
		return refuse(Busy, "%s already holds %d open orders", c.C.ID, most)
	}
	return nil
}

// order posts a limit order for a character and matches it; an order that
// must fill now (keep false) gives back what did not.
func (g *Game) order(c *Char, cmd Command, side market.Side, keep bool) error {
	n, err := g.marketHere(c)
	if err != nil {
		return err
	}
	if !g.tradable(cmd.Material) {
		return refuse(BadArgs, "nothing called %q trades here", cmd.Material)
	}
	if cmd.Units <= 0 || cmd.Price < 0 || (keep && cmd.Price == 0) {
		return refuse(BadArgs, "an order needs units and a price")
	}
	if keep {
		if err := g.roomForOrder(c); err != nil {
			return err
		}
	}
	acc := ledger.Char(c.C.ID)
	price := cmd.Price
	if side == market.Bid && price == 0 {
		price = sweep(g.BookOf(n, cmd.Material), acc, cmd.Units)
	}
	if side == market.Ask && price == 0 {
		price = 1
	}
	asset, units := ledger.Goods(cmd.Material), cmd.Units
	if side == market.Bid {
		coin, ok := times(units, price)
		if !ok || coin == 0 {
			return refuse(BadArgs, "nothing to buy at that price")
		}
		asset, units = ledger.Coin, coin
	}
	if err := g.afford(c, asset, cmd.Material, units); err != nil {
		return err
	}
	b := g.Book(n, cmd.Material)
	id, seq := g.nextID("o-")
	o := market.Order{ID: id, Owner: acc, Side: side, Price: price, Qty: cmd.Units, Placed: g.Tick(), Expires: g.expiry(), Seq: seq}
	if err := g.escrow(c, cmd.Key, id, asset, units); err != nil {
		return err
	}
	b.Add(o)
	if _, err := g.fact(c, "order.placed", g.Tick(), fact.S("material", cmd.Material), fact.S("side", string(side)), fact.N("units", o.Qty), fact.N("price", o.Price)); err != nil {
		return err
	}
	if err := g.match(b, cmd.Key); err != nil {
		return err
	}
	if !keep {
		if _, ok := b.Remove(id); ok {
			return g.unescrow(id, acc, ledger.SubKey(cmd.Key, "rest"))
		}
	}
	return nil
}

// sweep is the highest ask a take must reach to buy units from others'
// asks, best first, or the farthest ask when they hold fewer; 0 for none.
func sweep(b *market.Book, buyer string, units int64) int64 {
	if b == nil {
		return 0
	}
	var price int64
	for _, o := range b.Asks {
		if o.Owner == buyer {
			continue
		}
		price = o.Price
		if units -= o.Qty; units <= 0 {
			break
		}
	}
	return price
}

// afford refuses unless a character holds units of an asset to put in
// escrow; what names a material for the refusal.
func (g *Game) afford(c *Char, asset, what string, units int64) error {
	have := g.balance(c, asset)
	switch {
	case have >= units:
		return nil
	case asset == ledger.Coin:
		return refuse(BadArgs, "that takes %d coin in escrow; %s has %d coin", units, c.C.ID, have)
	default:
		return refuse(BadArgs, "%s does not carry %d %s", c.C.ID, units, what)
	}
}

// escrow moves units of an asset a character holds into an order's escrow.
func (g *Game) escrow(c *Char, key, id, asset string, units int64) error {
	return g.postAll(ledger.Move(ledger.SubKey(key, "escrow"), "escrow", g.Tick(), ledger.Char(c.C.ID), ledger.EscrowPool(id), asset, units))
}

// escrowItem moves an item from an account into a listing's escrow,
// taking it from the character's pack when the account is one.
func (g *Game) escrowItem(from, key, id string, in *item.Instance) error {
	return g.postAll(ledger.Txn{Key: key, Kind: "escrow", Tick: g.Tick(), Legs: itemLegs(in, from, ledger.EscrowPool(id))}, in)
}

// unescrow gives everything an order's escrow holds back to its owner;
// the item a listing escrows goes back into the owner's pack.
func (g *Game) unescrow(id, owner, key string, moved ...*item.Instance) error {
	pool := ledger.EscrowPool(id)
	var legs []ledger.Leg
	for _, x := range g.Ledger.Held(pool) {
		legs = append(legs, ledger.Pair(pool, owner, x.Asset, x.Units)...)
	}
	if len(legs) == 0 {
		return nil
	}
	return g.postAll(ledger.Txn{Key: key, Kind: "escrow-back", Tick: g.Tick(), Legs: legs}, moved...)
}

// postAll posts a transaction and syncs each character it touches,
// bumping its version; moved items follow their legs between packs.
func (g *Game) postAll(t ledger.Txn, moved ...*item.Instance) error {
	if err := g.post(t); err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, l := range t.Legs {
		if c := g.charOf(l.Account); c != nil {
			hold(c.C, l.Asset, l.Units)
			if !seen[l.Account] {
				seen[l.Account] = true
				g.touch(c)
			}
		}
	}
	for _, in := range moved {
		for _, l := range t.Legs {
			c := g.charOf(l.Account)
			switch {
			case c == nil || l.Asset != ledger.Item(in.ID):
			case l.Units < 0:
				c.C.Drop(in.ID)
			default:
				c.C.Pack = append(c.C.Pack, in)
			}
		}
	}
	return nil
}

// charOf is the character an account belongs to, or nil.
func (g *Game) charOf(acc string) *Char {
	id, ok := ledger.CharOf(acc)
	if !ok {
		return nil
	}
	return g.Char(id)
}

// match fills a book and settles each fill.
func (g *Game) match(b *market.Book, key string) error {
	fills := market.Match(b, g.Tick(), func(bid, ask market.Order) bool { return g.mayNotTrade(b, bid, ask) })
	for i, f := range fills {
		if err := g.settle(b, f, ledger.SubKey(key, "fill", strconv.Itoa(i))); err != nil {
			return err
		}
	}
	return nil
}

// mayNotTrade reports a pair that may not trade: an owner with itself, a
// seller the faction will not buy from, or a young character past its
// cap (see capped, which counts what it lets through).
func (g *Game) mayNotTrade(b *market.Book, bid, ask market.Order) bool {
	if bid.Owner == ask.Owner {
		return true
	}
	if bid.Faction != nil {
		_, buys := g.factionPays(ask.Owner, *bid.Faction, b.Settlement, 0)
		return !buys
	}
	return g.capped(b.Material, bid, ask, market.Price(bid, ask), min(bid.Qty, ask.Qty))
}

// factionPays is what a faction's bid of coin pays a seller at a
// settlement after the seller's standing, or false where the faction will
// not buy from it.
func (g *Game) factionPays(seller string, fi, settlement int, coin int64) (int64, bool) {
	var standing int64
	if c := g.charOf(seller); c != nil {
		standing = c.C.Standing.Get(standingKey(fi, g.SettlementHex(settlement)))
	}
	pct, buys := g.r.Values.Standing(standing)
	if c := g.charOf(seller); c != nil {
		pct = g.charScale(c, "faction-pay", fixed.Hundredths+pct) - fixed.Hundredths
	}
	return fixed.PercentPlus(coin, pct), buys
}

// settle moves one fill through the ledger: goods from the ask's escrow
// to the buyer, coin from the bid's escrow (or the faucet) to the seller
// less the fee, and any price improvement back to the buyer.
func (g *Game) settle(b *market.Book, f market.Fill, key string) error {
	asset := ledger.Goods(b.Material)
	seller, buyer := f.Ask.Owner, f.Bid.Owner
	coin, ok := times(f.Qty, f.Price)
	if !ok {
		return fmt.Errorf("game: fill %s/%s overflows", f.Bid.ID, f.Ask.ID)
	}
	faction := f.Bid.Faction != nil
	s := sale{payer: ledger.EscrowPool(f.Bid.ID), seller: seller, buyer: buyer, txn: "fill", kind: "market.filled", settlement: b.Settlement,
		row: Trade{Material: b.Material, Units: f.Qty, Price: f.Price}, faction: faction}
	standing := coin
	if faction {
		coin, _ = g.factionPays(seller, *f.Bid.Faction, b.Settlement, coin)
		s.goods = ledger.Pair(ledger.EscrowPool(f.Ask.ID), ledger.ToFaction, asset, f.Qty)
		s.payer, s.kind = ledger.FromFaction, "order.filled"
	} else {
		s.goods = ledger.Pair(ledger.EscrowPool(f.Ask.ID), buyer, asset, f.Qty)
		s.back = max(0, (f.Bid.Price-f.Price)*f.Qty)
	}
	s.coin = coin
	s.data = func(fee int64) []fact.Datum {
		data := []fact.Datum{fact.S("material", b.Material), fact.N("units", f.Qty), fact.N("price", f.Price), fact.N("coin", coin), fact.N("fee", fee),
			fact.N("settlement", int64(b.Settlement))}
		if faction {
			data = append(data, fact.N("faction", int64(*f.Bid.Faction)))
		}
		return data
	}
	_, fee, err := g.settleSale(s, key)
	if err != nil {
		return err
	}
	b.Record(f)
	if c := g.charOf(seller); c != nil {
		c.C.Earned.Bump("market", coin-fee)
		if faction {
			g.soldTo(c, standingKey(*f.Bid.Faction, g.SettlementHex(b.Settlement)), standing)
			c.C.Earned.Bump("faction-order", coin-fee)
			if err := g.traded(c, g.SettlementHex(b.Settlement), b.Material, g.Tick()); err != nil {
				return err
			}
		}
	}
	return nil
}

// sale is one sale to settle: its goods legs, coin from payer to seller,
// any price improvement (back) from payer to buyer, and the fact and
// trade row it writes.
type sale struct {
	goods                []ledger.Leg
	payer, seller, buyer string
	coin, back           int64
	txn, kind            string // the transaction's kind and the fact's
	settlement           int
	data                 func(fee int64) []fact.Datum
	row                  Trade
	faction              bool
	item                 *item.Instance // an item the goods' legs move
}

// settleSale posts a sale less the seller's fee, writes its fact and
// books it.
func (g *Game) settleSale(s sale, key string) (fact.ID, int64, error) {
	fee := g.r.Values.Fee(s.coin)
	if c := g.charOf(s.seller); c != nil && s.settlement >= 0 && s.settlement < len(g.Places) {
		if row, w := g.workAt(s.settlement, guild.GivesMarketFee, c); w != nil {
			saved := min(fee, spared(row, w, s.coin))
			fee -= saved
			g.workGave(w, saved)
		}
	}
	legs := append(slices.Clone(s.goods), ledger.Pair(s.payer, s.seller, ledger.Coin, s.coin)...)
	if s.back > 0 {
		legs = append(legs, ledger.Pair(s.payer, s.buyer, ledger.Coin, s.back)...)
	}
	legs = append(legs, g.feeLegs(s.settlement, s.seller, fee)...)
	fid, err := g.worldFact(g.SettlementHex(s.settlement), s.kind, g.traders(s.seller, s.buyer), nil, s.data(fee)...)
	if err != nil {
		return 0, 0, err
	}
	var moved []*item.Instance
	if s.item != nil {
		moved = append(moved, s.item)
	}
	if err := g.postAll(ledger.Txn{Key: key, Kind: s.txn, Tick: g.Tick(), Fact: fid, Legs: ledger.Merge(legs)}, moved...); err != nil {
		return 0, 0, err
	}
	row := s.row
	row.Settlement, row.Tick, row.Buyer, row.Seller, row.Fact = s.settlement, g.Tick(), s.buyer, s.seller, int64(fid)
	g.booked(row, s.coin, fee, s.faction)
	return fid, fee, nil
}

// traders are the characters among accounts, as fact subjects.
func (g *Game) traders(accs ...string) []fact.Ref {
	var out []fact.Ref
	for _, acc := range accs {
		if c := g.charOf(acc); c != nil {
			out = append(out, char.Ref(c.C.ID))
		}
	}
	return out
}

// booked counts a settled trade into the week, coin being what the buyer
// paid, and keeps it if notable.
func (g *Game) booked(t Trade, coin, fee int64, faction bool) {
	w := &g.Market.Week
	if t.Material != "" {
		w.traded(t.Material, t.Units)
	}
	switch {
	case faction:
		w.faucet(coin)
	case g.charOf(t.Buyer) != nil && g.charOf(t.Seller) != nil:
		w.between(coin)
	}
	w.fee(fee)
	g.notable(t)
}

// soldTo raises standing by one for each standing-coin of coin sold to a
// faction, carrying the remainder (GDD 5.4).
func (g *Game) soldTo(c *Char, key string, coin int64) {
	per := g.mp("standing-coin")
	before := c.Sold.Get(key)
	c.Sold.Bump(key, coin)
	if gain := (before+coin)/per - before/per; gain > 0 {
		gp := g.r.Growth.Params()
		c.C.AdjustStanding(key, gain, sheets.IntParam(gp, "standing-min"), sheets.IntParam(gp, "standing-max"))
	}
}

// withdraw takes back one of a character's open orders, listings or gear
// orders by id. The character must stand in that order's settlement, so
// withdrawing never moves escrow across the map.
func (g *Game) withdraw(c *Char, cmd Command) error {
	n, err := g.marketHere(c)
	if err != nil {
		return err
	}
	for o := range g.opens(ledger.Char(c.C.ID), false) {
		if o.ID != cmd.Item {
			continue
		}
		if o.Settlement != n {
			return refuse(NotHere, "that order stands in %s; withdraw it there", g.PlaceName(g.SettlementHex(o.Settlement)))
		}
		return g.closeOrder(o, cmd.Key)
	}
	return refuse(BadArgs, "no open order %q", cmd.Item)
}

// closeOrder takes an open order down and gives its escrow back to its owner;
// a trader's listing leaves the market instead.
func (g *Game) closeOrder(o Open, key string) error {
	m := g.Market
	switch o.Kind {
	case OpenListing:
		l, _ := m.takeListing(o.ID)
		if _, ok := ledger.NPCOf(l.Seller); ok {
			return g.retire(l, key)
		}
		return g.unescrow(o.ID, o.Owner, key, l.Item)
	case OpenWant:
		m.takeWant(o.ID)
	default:
		if b := g.BookOf(o.Settlement, o.Material); b != nil {
			b.Remove(o.ID)
		}
	}
	return g.unescrow(o.ID, o.Owner, key)
}

// takeListing removes a listing by id.
func (m *Market) takeListing(id string) (market.Listing, bool) {
	i := slices.IndexFunc(m.Listings, func(l market.Listing) bool { return l.ID == id })
	if i < 0 {
		return market.Listing{}, false
	}
	l := m.Listings[i]
	m.Listings = slices.Delete(m.Listings, i, i+1)
	return l, true
}

// takeWant removes a gear order by id.
func (m *Market) takeWant(id string) (market.Want, bool) {
	i := slices.IndexFunc(m.Wants, func(w market.Want) bool { return w.ID == id })
	if i < 0 {
		return market.Want{}, false
	}
	w := m.Wants[i]
	m.Wants = slices.Delete(m.Wants, i, i+1)
	return w, true
}

// Budgets are what the faucet spends at each open settlement today: the
// floor's worth of characters each, plus each active character's share at
// the settlement it last stood in, so coin enters where people trade and
// a settlement nobody plays from still has buyers for a hauler.
func (g *Game) Budgets() []int64 {
	weight := make([]int64, len(g.Places))
	for i := range weight {
		weight[i] = g.r.Faucet.Floor
	}
	for c := range g.activeChars() {
		if v, ok := c.lastVisit(); ok && v.Settlement < len(weight) {
			weight[v.Settlement]++
		}
	}
	out := make([]int64, len(weight))
	for i, w := range weight {
		out[i] = g.Market.Faucet.Budget(w)
	}
	return out
}

// Active counts characters that acted within active-days.
func (g *Game) Active() int64 { return count(g.activeChars()) }

// buyers are the world's factions as their orders see them.
func (g *Game) buyers() []econ.Buyer {
	full := sheets.IntParam(g.r.Book.FactionParams, "need-threshold")
	out := make([]econ.Buyer, len(g.World.Factions))
	for i, f := range g.World.Factions {
		b := econ.Buyer{Archetype: f.Archetype, Needs: map[string]int64{}, Gone: f.Fallen}
		if a := g.r.Values.Archetype(f.Archetype); a != nil && len(a.Buys) > 0 {
			b.Full = full / int64(len(a.Buys))
		}
		for _, n := range f.Needs {
			b.Needs[n.Tag] = n.Goods
		}
		b.AtWar = slices.ContainsFunc(f.Grudge, func(d int64) bool { return d > 0 })
		out[i] = b
	}
	return out
}

// postFactionOrders replaces every settlement's faction and keepers' buy
// orders with the day's, inside the faucet's budget (GDD 10.4).
func (g *Game) postFactionOrders(t int64) error {
	m := g.Market
	for _, b := range m.Books {
		b.Bids = slices.DeleteFunc(b.Bids, func(o market.Order) bool { return o.Faction != nil })
	}
	budgets := g.Budgets()
	wants := g.r.Values.Wants(g.buyers())
	shares := make([]faucet.Share, len(wants))
	for i, w := range wants {
		shares[i] = faucet.Share{Urgency: w.Urgency, Price: w.Price}
	}
	m.Trader = make([]int64, len(g.Places))
	for n, h := range g.Settlements() {
		if !g.HasStructure(h, structureMarket) {
			continue
		}
		budget := budgets[n] - g.bountyHeld(n)
		trader := fixed.PercentFloor(budget, g.mp("trader-share"))
		m.Trader[n] = trader
		qty := faucet.Plan(budget-trader, shares)
		for i, w := range wants {
			if qty[i] == 0 {
				continue
			}
			fi := w.Buyer
			owner := factionOwner(fi)
			if fi == econ.Keepers {
				owner = keepersOwner(h)
			}
			id, seq := g.nextID("f-")
			b := g.Book(n, w.Material)
			b.Add(market.Order{ID: id, Owner: owner, Side: market.Bid, Price: w.Price, Qty: qty[i], Placed: t, Expires: t + sheets.TicksPerDay, Seq: seq, Faction: &fi})
			if err := g.match(b, ledger.SubKey("day", strconv.FormatInt(t/sheets.TicksPerDay, decimal), strconv.Itoa(n), w.Material)); err != nil {
				return err
			}
		}
	}
	return nil
}
