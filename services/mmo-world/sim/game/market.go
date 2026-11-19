package game

import (
	"cmp"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/econ"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/faucet"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
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
	// Notable are the trades of today and yesterday a forum post names.
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

// structural: owners of orders that are not characters.
const (
	ownerFaction = "faction:"
	ownerKeepers = "keepers"
	escrowPrefix = ledger.Pool + "escrow:"
)

// EscrowOf is the pool an order, listing or gear order holds its escrow in.
func EscrowOf(id string) string { return escrowPrefix + id }

func (g *Game) mp(id string) int64 { return g.r.Values.Param(id) }

// ensureMarket makes the market the first time a game that has none acts,
// with the faction orders of the current world day.
func (g *Game) ensureMarket() error {
	if g.Market != nil {
		return nil
	}
	g.Market = &Market{Books: []*market.Book{}, Listings: []market.Listing{}, Wants: []market.Want{}, Faucet: faucet.New(g.r.Faucet),
		Reports: []Report{}, Notable: []Trade{}, Yesterday: []Trade{}, Held: []Held{}, Week: newWeek(g.World.Day)}
	return g.postFactionOrders(g.Tick())
}

// Settlements are the open starting settlements, in opening order.
func (g *Game) Settlements() []hex.Hex {
	out := make([]hex.Hex, g.World.Opened)
	for i := range out {
		out[i] = g.r.Gen.Settlement(i).Hex
	}
	return out
}

// SettlementAt is the open settlement on a tile, or false.
func (g *Game) SettlementAt(h hex.Hex) (int, bool) {
	for i, s := range g.Settlements() {
		if s == h {
			return i, true
		}
	}
	return 0, false
}

// HasMarket reports whether a tile is an open settlement with a market.
func (g *Game) HasMarket(h hex.Hex) bool {
	_, ok := g.SettlementAt(h)
	return ok && g.HasStructure(h, structureMarket)
}

// marketHere is the settlement whose market a character stands in.
func (g *Game) marketHere(c *Char) (int, error) {
	if err := canTrade(c); err != nil {
		return 0, err
	}
	if !g.HasMarket(c.C.At) {
		return 0, refuse(NotHere, "there is no market here")
	}
	n, _ := g.SettlementAt(c.C.At)
	return n, g.ensureMarket()
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

// assetOf is the ledger asset a book trades.
func assetOf(material string) string {
	if material == ledger.Provisions {
		return ledger.Provisions
	}
	return ledger.Material(material)
}

func (g *Game) tradable(material string) bool {
	return material == ledger.Provisions || g.isMaterial(ledger.Material(material))
}

// OpenOrders counts a character's open orders, listings and gear orders.
func (g *Game) OpenOrders(c *Char) int64 {
	if g.Market == nil {
		return 0
	}
	acc := ledger.Char(c.C.ID)
	var n int64
	for _, b := range g.Market.Books {
		for _, o := range append(slices.Clone(b.Bids), b.Asks...) {
			if o.Owner == acc {
				n++
			}
		}
	}
	for _, l := range g.Market.Listings {
		if l.Seller == acc {
			n++
		}
	}
	for _, w := range g.Market.Wants {
		if w.Buyer == acc {
			n++
		}
	}
	return n
}

func (g *Game) roomForOrder(c *Char) error {
	if most := g.mp("open-orders"); g.OpenOrders(c) >= most {
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
	asset := assetOf(cmd.Material)
	b := g.Book(n, cmd.Material)
	price := cmd.Price
	if side == market.Bid && price == 0 {
		if _, ask := b.Best(); ask > 0 {
			price = b.Asks[len(b.Asks)-1].Price
		}
	}
	if side == market.Ask && price == 0 {
		price = 1
	}
	id, seq := g.nextID("o-")
	o := market.Order{ID: id, Owner: acc, Side: side, Price: price, Qty: cmd.Units, Placed: g.Tick(), Expires: g.Tick() + g.mp("order-days")*sheets.TicksPerDay, Seq: seq}
	if side == market.Bid {
		coin, ok := times(o.Qty, o.Price)
		if !ok || coin == 0 {
			return refuse(BadArgs, "nothing to buy at that price")
		}
		if have := g.balance(c, ledger.Coin); have < coin {
			return refuse(BadArgs, "that takes %d coin in escrow; %s has %d coin", coin, c.C.ID, have)
		}
		if err := g.receive(c, ledger.Move(ledger.SubKey(cmd.Key, "escrow"), "escrow", g.Tick(), acc, EscrowOf(id), ledger.Coin, coin)); err != nil {
			return err
		}
	} else {
		if have := g.Ledger.Of(acc, asset); have < o.Qty {
			return refuse(BadArgs, "%s does not carry %d %s", c.C.ID, o.Qty, cmd.Material)
		}
		if err := g.receive(c, ledger.Move(ledger.SubKey(cmd.Key, "escrow"), "escrow", g.Tick(), acc, EscrowOf(id), asset, o.Qty)); err != nil {
			return err
		}
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

// unescrow gives everything an order's escrow holds back to its owner.
func (g *Game) unescrow(id, owner, key string) error {
	pool := EscrowOf(id)
	var legs []ledger.Leg
	for _, x := range g.Ledger.Held(pool) {
		legs = append(legs, ledger.Pair(pool, owner, x.Asset, x.Units)...)
	}
	if len(legs) == 0 {
		return nil
	}
	return g.postAll(ledger.Txn{Key: key, Kind: "escrow-back", Tick: g.Tick(), Legs: legs})
}

// postAll posts a transaction and keeps every character it moves in step,
// giving each a new version.
func (g *Game) postAll(t ledger.Txn) error {
	if err := g.post(t); err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, l := range t.Legs {
		if c := g.charOf(l.Account); c != nil {
			hold(c.C, l.Asset, l.Units)
			if !seen[l.Account] {
				seen[l.Account] = true
				c.Version++
			}
		}
	}
	return nil
}

// charOf is the character an account belongs to, or nil.
func (g *Game) charOf(acc string) *Char {
	id, ok := strings.CutPrefix(acc, ledger.Holder)
	if !ok {
		return nil
	}
	return g.Char(id)
}

// match fills a book and settles each fill.
func (g *Game) match(b *market.Book, key string) error {
	fills := market.Match(b, g.Tick(), func(bid, ask market.Order) bool { return g.mayNotTrade(b.Material, bid, ask) })
	for i, f := range fills {
		if err := g.settle(b, f, ledger.SubKey(key, "fill", strconv.Itoa(i))); err != nil {
			return err
		}
	}
	return nil
}

// mayNotTrade passes over pairs that may not trade: an owner with itself,
// a seller a faction will not buy from, and a young character past its
// cap. A pair it lets through is the next fill.
func (g *Game) mayNotTrade(material string, bid, ask market.Order) bool {
	if bid.Owner == ask.Owner {
		return true
	}
	if bid.Faction != nil {
		_, buys := g.r.Values.Standing(g.standingOf(ask.Owner, *bid.Faction, bid.Owner))
		return !buys
	}
	return g.capped(material, bid, ask, market.Price(bid, ask), min(bid.Qty, ask.Qty))
}

// factionKey is the standing a faction's order is priced by: the
// faction's, or the keepers' settlement's.
func (g *Game) factionKey(fi int, owner string) string {
	if fi >= 0 {
		return "faction:" + strconv.Itoa(fi)
	}
	return "place:" + owner[len(ownerKeepers)+1:]
}

// settle moves one fill through the ledger: goods from the ask's escrow
// to the buyer, coin from the bid's escrow (or the faucet) to the seller
// less the fee, and any price improvement back to the buyer.
func (g *Game) settle(b *market.Book, f market.Fill, key string) error {
	t := g.Tick()
	asset := assetOf(b.Material)
	seller, buyer := f.Ask.Owner, f.Bid.Owner
	coin, ok := times(f.Qty, f.Price)
	if !ok {
		return refuse(BadArgs, "a fill overflows")
	}
	var legs []ledger.Leg
	var standing int64
	if f.Bid.Faction != nil {
		pct, _ := g.r.Values.Standing(g.standingOf(seller, *f.Bid.Faction, f.Bid.Owner))
		coin = fixed.PercentPlus(coin, pct)
		legs = append(legs, ledger.Pair(EscrowOf(f.Ask.ID), ledger.ToFaction, asset, f.Qty)...)
		legs = append(legs, ledger.Pair(ledger.FromFaction, seller, ledger.Coin, coin)...)
		standing = coin
	} else {
		legs = append(legs, ledger.Pair(EscrowOf(f.Ask.ID), buyer, asset, f.Qty)...)
		legs = append(legs, ledger.Pair(EscrowOf(f.Bid.ID), seller, ledger.Coin, coin)...)
		if back := (f.Bid.Price - f.Price) * f.Qty; back > 0 {
			legs = append(legs, ledger.Pair(EscrowOf(f.Bid.ID), buyer, ledger.Coin, back)...)
		}
	}
	fee := g.r.Values.Fee(coin)
	if fee > 0 {
		legs = append(legs, ledger.Pair(seller, ledger.ToFees, ledger.Coin, fee)...)
	}
	fid, err := g.tradeFact(b, f, coin, fee, seller, buyer)
	if err != nil {
		return err
	}
	if err := g.postAll(ledger.Txn{Key: key, Kind: "fill", Tick: t, Fact: fid, Legs: ledger.Merge(legs)}); err != nil {
		return err
	}
	b.Record(f)
	g.Market.Week.fill(b.Material, f.Qty, coin, f.Bid.Faction != nil)
	g.Market.Week.Fees += fee
	g.notable(Trade{Settlement: b.Settlement, Tick: t, Material: b.Material, Units: f.Qty, Price: f.Price, Buyer: buyer, Seller: seller, Fact: int64(fid)})
	if c := g.charOf(seller); c != nil {
		c.C.Earned.Bump("market", coin-fee)
		if f.Bid.Faction != nil {
			g.soldTo(c, g.factionKey(*f.Bid.Faction, f.Bid.Owner), standing)
			c.C.Earned.Bump("faction-order", coin-fee)
			if err := g.traded(c, b.Material, t); err != nil {
				return err
			}
		}
	}
	return nil
}

// tradeFact writes the fill as a fact about the characters in it.
func (g *Game) tradeFact(b *market.Book, f market.Fill, coin, fee int64, seller, buyer string) (fact.ID, error) {
	data := []fact.Datum{fact.S("material", b.Material), fact.N("units", f.Qty), fact.N("price", f.Price), fact.N("coin", coin), fact.N("fee", fee),
		fact.N("settlement", int64(b.Settlement))}
	if f.Bid.Faction != nil {
		data = append(data, fact.N("faction", int64(*f.Bid.Faction)))
	}
	var subjects []fact.Ref
	for _, acc := range []string{seller, buyer} {
		if c := g.charOf(acc); c != nil {
			subjects = append(subjects, char.Ref(c.C.ID))
		}
	}
	kind := "market.filled"
	if f.Bid.Faction != nil {
		kind = "order.filled"
	}
	return g.worldFact(g.r.Gen.Settlement(b.Settlement).Hex, kind, subjects, nil, data...)
}

// standingOf is a seller's standing with the faction behind a bid.
func (g *Game) standingOf(seller string, fi int, owner string) int64 {
	c := g.charOf(seller)
	if c == nil {
		return 0
	}
	return c.C.Standing.Get(g.factionKey(fi, owner))
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

// withdraw takes back an open order, listing or gear order of a
// character's, by id.
func (g *Game) withdraw(c *Char, cmd Command) error {
	if err := canTrade(c); err != nil {
		return err
	}
	if g.Market == nil {
		return refuse(BadArgs, "no open order %q", cmd.Item)
	}
	acc := ledger.Char(c.C.ID)
	for _, b := range g.Market.Books {
		for _, o := range append(slices.Clone(b.Bids), b.Asks...) {
			if o.ID == cmd.Item && o.Owner == acc {
				b.Remove(o.ID)
				return g.unescrow(o.ID, acc, cmd.Key)
			}
		}
	}
	if i := slices.IndexFunc(g.Market.Listings, func(l market.Listing) bool { return l.ID == cmd.Item && l.Seller == acc }); i >= 0 {
		return g.unlist(i, cmd.Key)
	}
	if i := slices.IndexFunc(g.Market.Wants, func(w market.Want) bool { return w.ID == cmd.Item && w.Buyer == acc }); i >= 0 {
		w := g.Market.Wants[i]
		g.Market.Wants = slices.Delete(g.Market.Wants, i, i+1)
		return g.unescrow(w.ID, acc, cmd.Key)
	}
	return refuse(BadArgs, "no open order %q", cmd.Item)
}

// Budget is what the faucet spends at each open settlement today.
// Budgets are what the faucet spends at each open settlement today: the
// floor's worth of characters each, plus each active character's share at
// the settlement it last stood in, so coin enters where people trade and
// a settlement nobody plays from still has buyers for a hauler.
func (g *Game) Budgets() []int64 {
	since := g.Tick() - g.mp("active-days")*sheets.TicksPerDay
	weight := make([]int64, g.World.Opened)
	for i := range weight {
		weight[i] = g.r.Faucet.Floor
	}
	for _, c := range g.Chars {
		if c.Acted < since || c.Banned {
			continue
		}
		last := Visit{Settlement: -1, Tick: -1}
		for _, v := range c.Visits {
			if v.Tick > last.Tick && v.Settlement < len(weight) {
				last = v
			}
		}
		if last.Settlement >= 0 {
			weight[last.Settlement]++
		}
	}
	out := make([]int64, len(weight))
	for i, w := range weight {
		out[i] = g.Market.Faucet.Budget(w)
	}
	return out
}

// Active counts characters that acted within active-days.
func (g *Game) Active() int64 {
	_, n := g.ActiveCoin()
	return n
}

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
	m.Trader = make([]int64, g.World.Opened)
	for n, h := range g.Settlements() {
		if !g.HasStructure(h, structureMarket) {
			continue
		}
		budget := budgets[n]
		trader := fixed.PercentFloor(budget, g.mp("trader-share"))
		m.Trader[n] = trader
		qty := faucet.Plan(budget-trader, wants)
		for i, w := range wants {
			if qty[i] == 0 {
				continue
			}
			fi := w.Buyer
			owner := ownerFaction + strconv.Itoa(fi)
			if fi == econ.Keepers {
				owner = ownerKeepers + ":" + h.Ref()
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
