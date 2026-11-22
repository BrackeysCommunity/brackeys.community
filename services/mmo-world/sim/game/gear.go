package game

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/market"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
)

// Held is an item a settlement's trader bought from a character, kept so
// its resale can name the first sale (GDD 4.18).
type Held struct {
	Item   string  `json:"item"`
	NPC    string  `json:"npc"`
	From   string  `json:"from"` // the character who sold it
	Paid   int64   `json:"paid"`
	Bought fact.ID `json:"bought"`
}

func (g *Game) kinds() market.Kinds { return g.Kinds.Kind }

// unworn is a carried item a character may part with: in the pack and
// not worn.
func unworn(c *Char, id string) (*item.Instance, error) {
	in := c.C.Item(id)
	if in == nil || c.C.Worn(id) {
		return nil, refuse(BadArgs, "%s carries no unworn %s", c.C.ID, id)
	}
	return in, nil
}

// list puts a carried item up at a fixed price, its item in escrow.
func (g *Game) list(c *Char, cmd Command) error {
	n, err := g.marketHere(c)
	if err != nil {
		return err
	}
	in, err := unworn(c, cmd.Item)
	if err != nil {
		return err
	}
	if cmd.Price <= 0 {
		return refuse(BadArgs, "a listing needs a price")
	}
	if err := g.roomForOrder(c); err != nil {
		return err
	}
	acc := ledger.Char(c.C.ID)
	l := g.newListing(n, acc, in, cmd.Price)
	if err := g.escrowItem(acc, ledger.SubKey(cmd.Key, "escrow"), l.ID, in); err != nil {
		return err
	}
	if _, err := g.fact(c, "gear.listed", g.Tick(), fact.S("item", in.ID), fact.S("kind", in.Kind), fact.N("price", cmd.Price)); err != nil {
		return err
	}
	return g.offer(l, cmd.Key)
}

// newListing is a listing placed now.
func (g *Game) newListing(n int, seller string, in *item.Instance, price int64) market.Listing {
	id, seq := g.nextID("l-")
	return market.Listing{ID: id, Settlement: n, Seller: seller, Item: in, Price: price, Placed: g.Tick(), Expires: g.expiry(), Seq: seq}
}

// offer lists an item and sells it to the gear order that takes it, if
// any.
func (g *Game) offer(l market.Listing, key string) error {
	m := g.Market
	if i := market.Pair(m.Wants, l, g.kinds(), func(w market.Want) bool { return g.mayTradeGear(l, w.Buyer) == nil }); i >= 0 {
		w, _ := m.takeWant(m.Wants[i].ID)
		return g.sellListing(l, w.Buyer, ledger.EscrowPool(w.ID), w.Price, ledger.SubKey(key, "fill"))
	}
	m.Listings = append(m.Listings, l)
	m.opened(l.Seller, 1)
	return nil
}

// want posts a buy order for gear: a kind, or any kind of a slot, with a
// floor. Its coin waits in escrow; it buys at once the cheapest listing it
// takes.
func (g *Game) want(c *Char, cmd Command) error {
	n, err := g.marketHere(c)
	if err != nil {
		return err
	}
	if cmd.Price <= 0 || (cmd.Material == "" && cmd.Slot == "") {
		return refuse(BadArgs, "a gear order needs a kind or a slot, and a price")
	}
	if err := g.gearOrderValid(cmd); err != nil {
		return err
	}
	if err := g.roomForOrder(c); err != nil {
		return err
	}
	if err := g.afford(c, ledger.Coin, "", cmd.Price); err != nil {
		return err
	}
	acc := ledger.Char(c.C.ID)
	id, seq := g.nextID("w-")
	w := market.Want{ID: id, Settlement: n, Buyer: acc, Kind: cmd.Material, Slot: cmd.Slot, Price: cmd.Price, Placed: g.Tick(), Expires: g.expiry(), Seq: seq}
	if cmd.Floor != nil {
		w.Floor = *cmd.Floor
	}
	if err := g.escrow(c, cmd.Key, id, ledger.Coin, cmd.Price); err != nil {
		return err
	}
	if _, err := g.fact(c, "gear.wanted", g.Tick(), fact.S("kind", w.Kind), fact.S("slot", w.Slot), fact.N("price", w.Price)); err != nil {
		return err
	}
	m := g.Market
	if i := market.Cheapest(m.Listings, w, g.kinds(), func(l market.Listing) bool { return g.mayTradeGear(l, acc) == nil }); i >= 0 {
		l, _ := m.takeListing(m.Listings[i].ID)
		return g.sellListing(l, acc, ledger.EscrowPool(id), w.Price, ledger.SubKey(cmd.Key, "fill"))
	}
	m.Wants = append(m.Wants, w)
	m.opened(w.Buyer, 1)
	return nil
}

// purchase buys a listing outright.
func (g *Game) purchase(c *Char, cmd Command) error {
	n, err := g.marketHere(c)
	if err != nil {
		return err
	}
	here := g.ListingsAt(n)
	i := slices.IndexFunc(here, func(l market.Listing) bool { return l.ID == cmd.Item })
	if i < 0 {
		return refuse(NotHere, "no listing %q here", cmd.Item)
	}
	l := here[i]
	acc := ledger.Char(c.C.ID)
	if l.Seller == acc {
		return refuse(BadArgs, "that is your own listing")
	}
	if err := g.mayTradeGear(l, acc); err != nil {
		return err
	}
	if have := g.balance(c, ledger.Coin); have < l.Price {
		return refuse(BadArgs, "that costs %d coin; %s has %d coin", l.Price, c.C.ID, have)
	}
	g.Market.takeListing(l.ID)
	return g.sellListing(l, acc, acc, l.Price, cmd.Key)
}

// gearOrderValid refuses a gear order no item could ever fill: a kind or
// a slot nothing has, or a floor below nothing.
func (g *Game) gearOrderValid(cmd Command) error {
	if cmd.Material != "" {
		if _, ok := g.Kinds.Kind(cmd.Material); !ok {
			return refuse(BadArgs, "no item kind %q", cmd.Material)
		}
	}
	if cmd.Slot != "" && !slices.ContainsFunc(g.r.Book.Slots, func(x sheets.Slot) bool { return x.ID == cmd.Slot }) {
		return refuse(BadArgs, "no slot %q", cmd.Slot)
	}
	if f := cmd.Floor; f != nil && (f.Durability < 0 || f.Level < 0) {
		return refuse(BadArgs, "a floor cannot be negative")
	}
	return nil
}

// mayTradeGear reports why a sale between two characters would take a
// young one past its cap (GDD 10.9).
func (g *Game) mayTradeGear(l market.Listing, buyer string) error {
	return g.checkGive(l.Seller, buyer, g.ItemValue(l.Item), l.Price, 1, false)
}

// sellListing settles a listing: the item to the buyer, the listing's
// price from payer (the buyer, or a gear order's escrow) to the seller
// less the fee, and the rest of an escrow back to the buyer.
func (g *Game) sellListing(l market.Listing, buyer, payer string, paid int64, key string) error {
	if err := g.checkGive(l.Seller, buyer, g.ItemValue(l.Item), l.Price, 1, true); err != nil {
		return err
	}
	s := sale{goods: itemLegs(l.Item, ledger.EscrowPool(l.ID), buyer), payer: payer, seller: l.Seller, buyer: buyer, coin: l.Price, txn: "gear",
		kind: "gear.sold", settlement: l.Settlement, row: Trade{Kind: l.Item.Kind, Units: 1, Price: l.Price}, item: l.Item}
	if payer != buyer {
		s.back = paid - l.Price
	}
	s.data = func(fee int64) []fact.Datum {
		return []fact.Datum{fact.S("item", l.Item.ID), fact.S("kind", l.Item.Kind), fact.N("price", l.Price), fact.N("fee", fee)}
	}
	fid, fee, err := g.settleSale(s, key)
	if err != nil {
		return err
	}
	if c := g.charOf(l.Seller); c != nil {
		c.C.Earned.Bump("gear", l.Price-fee)
	}
	return g.resold(l, buyer, fid, fee)
}

// retire takes down a trader's listing that ran out unsold: the item
// leaves the market, and there is no resale left to name.
func (g *Game) retire(l market.Listing, key string) error {
	m := g.Market
	m.Held = slices.DeleteFunc(m.Held, func(h Held) bool { return h.Item == l.Item.ID })
	return g.post(ledger.Txn{Key: key, Kind: "retired", Tick: g.Tick(), Legs: itemLegs(l.Item, ledger.EscrowPool(l.ID), ledger.ToMarket)})
}

// ItemValue is what an item is worth: its kind's value, less its wear.
func (g *Game) ItemValue(in *item.Instance) int64 {
	k, ok := g.Kinds.Kind(in.Kind)
	if !ok {
		return 0
	}
	v := g.r.Values.Kind(&g.Kinds, k)
	if in.MaxDurability > 0 {
		v = fixed.Ratio(v*in.Durability, in.MaxDurability).Int()
	}
	return max(1, v)
}

// TraderPays is what a settlement's trader pays for an item.
func (g *Game) TraderPays(in *item.Instance) int64 {
	return fixed.PercentOf(g.ItemValue(in), g.mp("trader-buys"))
}

// traderStub is a settlement's trader as its residents name it.
func (g *Game) traderStub(h hex.Hex) (npc.Stub, bool) {
	for _, s := range g.r.NPC.Residents(gen.PlaceSettlement, h.Ref(), h, g.npcDraw(h)) {
		if s.Role == roleTrader {
			return s, true
		}
	}
	return npc.Stub{}, false
}

// trader is a settlement's trader, saved on its first trade.
func (g *Game) trader(s npc.Stub) *npc.NPC {
	n := g.NPCs.Get(s.ID)
	if n == nil {
		n = g.NPCs.Save(s, g.Tick())
		old := n.Route
		g.r.NPC.LayRoute(n, g.Tick(), g.routeCost)
		g.NPCs.Routed(n, old)
	}
	return n
}

// structural: the resident who buys and resells items.
const roleTrader = "settlement-trader"

// sellItem sells a carried item to the settlement's trader for a share of
// its value, paid from the day's faucet; the trader lists it for more.
func (g *Game) sellItem(c *Char, cmd Command) error {
	n, err := g.marketHere(c)
	if err != nil {
		return err
	}
	in, err := unworn(c, cmd.Item)
	if err != nil {
		return err
	}
	stub, ok := g.traderStub(c.C.At)
	if !ok {
		return refuse(NotHere, "no trader here")
	}
	value := g.ItemValue(in)
	pay := g.TraderPays(in)
	m := g.Market
	// A settlement opened today has no trader's coin until its first day turn.
	var left int64
	if n < len(m.Trader) {
		left = m.Trader[n]
	}
	if n >= len(m.Trader) || left < pay {
		return refuse(Busy, "the trader has spent today's coin; it pays %d coin and has %d coin left", pay, left)
	}
	tr := g.trader(stub)
	m.Trader[n] -= pay
	acc := ledger.Char(c.C.ID)
	purse := ledger.NPCPool(tr.Stub.ID)
	f, err := g.npcFact(c, tr, "npc.bought", g.Tick(), fact.S("item", in.ID), fact.S("kind", in.Kind), fact.N("coin", pay))
	if err != nil {
		return err
	}
	legs := append(itemLegs(in, acc, purse), ledger.Pair(ledger.FromFaction, acc, ledger.Coin, pay)...)
	if err := g.postAll(ledger.Txn{Key: cmd.Key, Kind: "trader-bought", Tick: g.Tick(), Fact: f.ID, Legs: legs}, in); err != nil {
		return err
	}
	m.Week.faucet(pay)
	c.C.Earned.Bump("trader", pay)
	m.Held = append(m.Held, Held{Item: in.ID, NPC: tr.Stub.ID, From: c.C.ID, Paid: pay, Bought: f.ID})
	g.note(tr, c, npc.Entry{Kind: "traded", Player: c.C.ID, Weight: g.r.NPC.Param("traded-weight"), Tick: g.Tick(), Fact: int64(f.ID), Thing: g.KindName(in.Kind)}, g.Tick())
	if err := g.NPCs.Touched(tr); err != nil {
		return err
	}
	l := g.newListing(n, purse, in, fixed.PercentOf(value, g.mp("trader-sells")))
	if err := g.escrowItem(purse, ledger.SubKey(cmd.Key, "list"), l.ID, in); err != nil {
		return err
	}
	return g.offer(l, cmd.Key)
}

// MaterialName is what a material is called.
func (g *Game) MaterialName(id string) string { return g.r.Name("items.materials:" + id) }

// KindName is what a kind is called, or its id before anyone named it.
func (g *Game) KindName(id string) string {
	if n := g.Kinds.Name(id); n != "" {
		return n
	}
	return id
}

// resold notes a trader's resale of an item it bought from a character:
// the profit against the first sale, and the trader's fortune if that
// crossed a step (GDD 4.18). Other listings are left alone.
func (g *Game) resold(l market.Listing, buyer string, sale fact.ID, fee int64) error {
	m := g.Market
	seller, ok := ledger.NPCOf(l.Seller)
	if !ok {
		return nil
	}
	i := slices.IndexFunc(m.Held, func(h Held) bool { return h.Item == l.Item.ID && h.NPC == seller })
	if i < 0 {
		return nil
	}
	h := m.Held[i]
	m.Held = slices.Delete(m.Held, i, i+1)
	tr := g.NPCs.Get(h.NPC)
	from := g.Char(h.From)
	if tr == nil || from == nil {
		return nil
	}
	t := g.Tick()
	net := l.Price - fee
	profit := net - h.Paid
	fid, err := g.worldFact(tr.Stub.Home, "npc.resold", []fact.Ref{char.Ref(from.C.ID), npc.Ref(tr.Stub.ID)}, []fact.ID{h.Bought, sale},
		fact.S("item", h.Item), fact.N("paid", h.Paid), fact.N("price", l.Price), fact.N("profit", profit))
	if err != nil {
		return err
	}
	thing := g.KindName(l.Item.Kind)
	g.note(tr, from, npc.Entry{Kind: entryResold, Player: from.C.ID, Weight: g.r.NPC.Param("traded-weight"), Tick: t, Fact: int64(fid), Thing: thing, N: profit}, t)
	if g.charOf(buyer) != nil && buyer != ledger.Char(from.C.ID) {
		g.note(tr, from, npc.Entry{Kind: entrySoldOn, Player: from.C.ID, Weight: g.r.NPC.Param("traded-weight"), Tick: t, Fact: int64(fid), Thing: thing}, t)
	}
	step := g.mp("fortune-step")
	after := g.Ledger.Of(ledger.NPCPool(tr.Stub.ID), ledger.Coin)
	if after/step > (after-net)/step {
		ff, err := g.worldFact(tr.Stub.Home, "npc.fortune", []fact.Ref{npc.Ref(tr.Stub.ID)}, []fact.ID{fid}, fact.S("move", "rose"), fact.N("coin", after))
		if err != nil {
			return err
		}
		g.r.NPC.Remember(tr, npc.Entry{Kind: "fortune", Weight: g.r.NPC.Param("traded-weight"), Tick: t, Fact: int64(ff)}, t)
	}
	return g.NPCs.Touched(tr)
}

// Memory entries a trader keeps of its resales.
const (
	entryResold = "resold"
	entrySoldOn = "sold-on"
)

// OwnerName is who an account is, as the lists show it: a character's id,
// a trader by name, a faction by its name.
func (g *Game) OwnerName(acc string) string {
	if id, ok := ledger.CharOf(acc); ok {
		return id
	}
	if id, ok := ledger.NPCOf(acc); ok {
		if n := g.NPCs.Get(id); n != nil {
			return n.Stub.Name
		}
	}
	if fi, ok := ownerOf(acc); ok {
		return g.FactionName(fi)
	}
	return acc
}

// TradeName is what a trade's subject is called: a material, an item
// kind, or for a gear order of any kind, its slot.
func (g *Game) TradeName(material, kind, slot string) string {
	switch {
	case kind != "":
		return g.KindName(kind)
	case material != "":
		return cmp.Or(g.MaterialName(material), material)
	}
	return slot
}
