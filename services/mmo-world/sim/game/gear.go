package game

import (
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/econ"
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

// list puts a carried item up at a fixed price, in escrow, and sells it
// at once to the best gear order it meets.
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
	id, seq := g.nextID("l-")
	if err := g.post(ledger.Txn{Key: ledger.SubKey(cmd.Key, "escrow"), Kind: "escrow", Tick: g.Tick(), Legs: itemLegs(in, acc, EscrowOf(id))}); err != nil {
		return err
	}
	c.C.Drop(in.ID)
	l := market.Listing{ID: id, Settlement: n, Seller: acc, Item: in, Price: cmd.Price, Placed: g.Tick(), Expires: g.Tick() + g.mp("order-days")*sheets.TicksPerDay, Seq: seq}
	if _, err := g.fact(c, "gear.listed", g.Tick(), fact.S("item", in.ID), fact.S("kind", in.Kind), fact.N("price", cmd.Price)); err != nil {
		return err
	}
	return g.offer(l, cmd.Key)
}

// offer lists an item and sells it to the gear order that takes it, if
// any.
func (g *Game) offer(l market.Listing, key string) error {
	m := g.Market
	if i := market.Pair(m.Wants, l, g.kinds()); i >= 0 {
		w := m.Wants[i]
		m.Wants = slices.Delete(m.Wants, i, i+1)
		return g.sellListing(l, w.Buyer, EscrowOf(w.ID), w.Price, ledger.SubKey(key, "fill"))
	}
	m.Listings = append(m.Listings, l)
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
	if err := g.roomForOrder(c); err != nil {
		return err
	}
	if have := g.balance(c, ledger.Coin); have < cmd.Price {
		return refuse(BadArgs, "that takes %d coin in escrow; %s has %d coin", cmd.Price, c.C.ID, have)
	}
	acc := ledger.Char(c.C.ID)
	id, seq := g.nextID("w-")
	w := market.Want{ID: id, Settlement: n, Buyer: acc, Kind: cmd.Material, Slot: cmd.Slot, Price: cmd.Price, Placed: g.Tick(),
		Expires: g.Tick() + g.mp("order-days")*sheets.TicksPerDay, Seq: seq}
	if cmd.Floor != nil {
		w.Floor = *cmd.Floor
	}
	if err := g.receive(c, ledger.Move(ledger.SubKey(cmd.Key, "escrow"), "escrow", g.Tick(), acc, EscrowOf(id), ledger.Coin, cmd.Price)); err != nil {
		return err
	}
	if _, err := g.fact(c, "gear.wanted", g.Tick(), fact.S("kind", w.Kind), fact.S("slot", w.Slot), fact.N("price", w.Price)); err != nil {
		return err
	}
	m := g.Market
	if i := market.Cheapest(m.Listings, w, g.kinds()); i >= 0 {
		l := m.Listings[i]
		m.Listings = slices.Delete(m.Listings, i, i+1)
		return g.sellListing(l, acc, EscrowOf(id), w.Price, ledger.SubKey(cmd.Key, "fill"))
	}
	m.Wants = append(m.Wants, w)
	return nil
}

// purchase buys a listing outright.
func (g *Game) purchase(c *Char, cmd Command) error {
	n, err := g.marketHere(c)
	if err != nil {
		return err
	}
	m := g.Market
	i := slices.IndexFunc(m.Listings, func(l market.Listing) bool { return l.ID == cmd.Item && l.Settlement == n })
	if i < 0 {
		return refuse(NotHere, "no listing %q here", cmd.Item)
	}
	l := m.Listings[i]
	acc := ledger.Char(c.C.ID)
	if l.Seller == acc {
		return refuse(BadArgs, "that is your own listing")
	}
	if have := g.balance(c, ledger.Coin); have < l.Price {
		return refuse(BadArgs, "that costs %d coin; %s has %d coin", l.Price, c.C.ID, have)
	}
	m.Listings = slices.Delete(m.Listings, i, i+1)
	return g.sellListing(l, acc, acc, l.Price, cmd.Key)
}

// sellListing settles a listing: the item to the buyer, the listing's
// price from payer (the buyer, or a gear order's escrow) to the seller
// less the fee, and the rest of an escrow back to the buyer.
func (g *Game) sellListing(l market.Listing, buyer, payer string, paid int64, key string) error {
	t := g.Tick()
	fee := g.r.Values.Fee(l.Price)
	legs := itemLegs(l.Item, EscrowOf(l.ID), buyer)
	legs = append(legs, ledger.Pair(payer, l.Seller, ledger.Coin, l.Price)...)
	if back := paid - l.Price; back > 0 && payer != buyer {
		legs = append(legs, ledger.Pair(payer, buyer, ledger.Coin, back)...)
	}
	if fee > 0 {
		legs = append(legs, ledger.Pair(l.Seller, ledger.ToFees, ledger.Coin, fee)...)
	}
	var subjects []fact.Ref
	for _, acc := range []string{l.Seller, buyer} {
		if c := g.charOf(acc); c != nil {
			subjects = append(subjects, char.Ref(c.C.ID))
		}
	}
	h := g.r.Gen.Settlement(l.Settlement).Hex
	fid, err := g.worldFact(h, "gear.sold", subjects, nil, fact.S("item", l.Item.ID), fact.S("kind", l.Item.Kind), fact.N("price", l.Price), fact.N("fee", fee))
	if err != nil {
		return err
	}
	if err := g.postAll(ledger.Txn{Key: key, Kind: "gear", Tick: t, Fact: fid, Legs: ledger.Merge(legs)}); err != nil {
		return err
	}
	if c := g.charOf(buyer); c != nil {
		c.C.Pack = append(c.C.Pack, l.Item)
	}
	g.Market.Week.Fees += fee
	if g.charOf(l.Seller) != nil && g.charOf(buyer) != nil {
		g.Market.Week.Between += l.Price
	}
	g.notable(Trade{Settlement: l.Settlement, Tick: t, Kind: l.Item.Kind, Units: 1, Price: l.Price, Buyer: buyer, Seller: l.Seller, Fact: int64(fid)})
	return g.resold(l, buyer, fid)
}

// unlist takes a listing down and gives its item back to the seller.
func (g *Game) unlist(i int, key string) error {
	m := g.Market
	l := m.Listings[i]
	m.Listings = slices.Delete(m.Listings, i, i+1)
	if err := g.postAll(ledger.Txn{Key: key, Kind: "escrow-back", Tick: g.Tick(), Legs: itemLegs(l.Item, EscrowOf(l.ID), l.Seller)}); err != nil {
		return err
	}
	if c := g.charOf(l.Seller); c != nil {
		c.C.Pack = append(c.C.Pack, l.Item)
	}
	return nil
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

// trader is a settlement's trader, saved on its first trade.
func (g *Game) trader(h hex.Hex) (*npc.NPC, bool) {
	for _, s := range g.r.NPC.Residents(gen.PlaceSettlement, h.Ref(), h) {
		if s.Role != roleTrader {
			continue
		}
		n := g.NPCs.Get(s.ID)
		if n == nil {
			n = g.NPCs.Save(s, g.Tick())
			old := n.Route
			g.r.NPC.LayRoute(n, g.Tick(), g.routeCost)
			g.NPCs.Routed(n, old)
		}
		return n, true
	}
	return nil, false
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
	tr, ok := g.trader(c.C.At)
	if !ok {
		return refuse(NotHere, "no trader here")
	}
	value := g.ItemValue(in)
	pay := g.TraderPays(in)
	m := g.Market
	if m.Trader[n] < pay {
		return refuse(Busy, "the trader has spent today's coin; it pays %d coin and has %d coin left", pay, m.Trader[n])
	}
	m.Trader[n] -= pay
	acc := ledger.Char(c.C.ID)
	purse := ledger.NPCPool(tr.Stub.ID)
	f, err := g.npcFact(c, tr, "npc.bought", g.Tick(), fact.S("item", in.ID), fact.S("kind", in.Kind), fact.N("coin", pay))
	if err != nil {
		return err
	}
	legs := append(itemLegs(in, acc, purse), ledger.Pair(ledger.FromFaction, acc, ledger.Coin, pay)...)
	if err := g.receive(c, ledger.Txn{Key: cmd.Key, Kind: "trader-bought", Tick: g.Tick(), Fact: f.ID, Legs: legs}); err != nil {
		return err
	}
	c.C.Drop(in.ID)
	m.Week.Faucet += pay
	m.Held = append(m.Held, Held{Item: in.ID, NPC: tr.Stub.ID, From: c.C.ID, Paid: pay, Bought: f.ID})
	g.note(tr, c, npc.Entry{Kind: "traded", Player: c.C.ID, Weight: g.r.NPC.Param("traded-weight"), Tick: g.Tick(), Fact: int64(f.ID), Thing: g.KindName(in.Kind)}, g.Tick())
	if err := g.NPCs.Touched(tr); err != nil {
		return err
	}
	id, seq := g.nextID("l-")
	if err := g.post(ledger.Txn{Key: ledger.SubKey(cmd.Key, "list"), Kind: "escrow", Tick: g.Tick(), Legs: itemLegs(in, purse, EscrowOf(id))}); err != nil {
		return err
	}
	return g.offer(market.Listing{ID: id, Settlement: n, Seller: purse, Item: in, Price: fixed.PercentOf(value, g.mp("trader-sells")), Placed: g.Tick(),
		Expires: g.Tick() + g.mp("order-days")*sheets.TicksPerDay, Seq: seq}, cmd.Key)
}

// KindName is what a kind is called, or its id before anyone named it.
func (g *Game) KindName(id string) string {
	if n := g.Kinds.Name(id); n != "" {
		return n
	}
	return id
}

// resold records, when a listing sold was an item a trader bought from a
// character, the resale against the first sale, what it made the trader,
// and its fortune if that crossed a step (GDD 4.18).
func (g *Game) resold(l market.Listing, buyer string, sale fact.ID) error {
	m := g.Market
	i := slices.IndexFunc(m.Held, func(h Held) bool { return h.Item == l.Item.ID && ledger.NPCPool(h.NPC) == l.Seller })
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
	profit := l.Price - g.r.Values.Fee(l.Price) - h.Paid
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
	if after/step > (after-l.Price+g.r.Values.Fee(l.Price))/step {
		ff, err := g.worldFact(tr.Stub.Home, "npc.fortune", []fact.Ref{npc.Ref(tr.Stub.ID)}, []fact.ID{fid}, fact.S("move", "rose"), fact.N("coin", after))
		if err != nil {
			return err
		}
		g.r.NPC.Remember(tr, npc.Entry{Kind: "fortune", Weight: g.r.NPC.Param("traded-weight"), Tick: t, Fact: int64(ff)}, t)
	}
	return g.NPCs.Touched(tr)
}

// NPC memory entries of its trade.
const (
	entryResold = "resold"
	entrySoldOn = "sold-on"
)

// OwnerName is who an account is, as the lists show it: a character's id,
// a trader by name, a faction by its name.
func (g *Game) OwnerName(acc string) string {
	if id, ok := strings.CutPrefix(acc, ledger.Holder); ok {
		return id
	}
	if id, ok := strings.CutPrefix(acc, ledger.Pool+"npc:"); ok {
		if n := g.NPCs.Get(id); n != nil {
			return n.Stub.Name
		}
	}
	if i, ok := strings.CutPrefix(acc, ownerFaction); ok {
		if fi, err := strconv.Atoi(i); err == nil {
			return g.FactionName(fi)
		}
	}
	if strings.HasPrefix(acc, ownerKeepers) {
		return g.FactionName(econ.Keepers)
	}
	return acc
}
