package game

import (
	"math"
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/craft"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/guild"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/market"
	"jams.team/mmo-world/sim/sheets"
)

// Commands of the solo loop (GDD 3.1, 6).
const (
	Sell   = "sell"
	Buy    = "buy"
	Feed   = "feed"
	Equip  = "equip"
	Craft  = "craft"
	Repair = "repair"
	Pick   = "pick"
	Forage = "forage"
	Crawl  = "crawl"
)

// start gives a new character the one thing it chose to have carried:
// made from its start row at tier 1, level 1, with nobody as its maker.
func (g *Game) start(c *Char, key, choice string) error {
	row, err := g.startRow(choice)
	if err != nil {
		return err
	}
	in, err := g.startItem(row.Process, row.Method, row.Slot, row.Inputs, "start-"+c.C.ID)
	if err != nil {
		return err
	}
	if row.Exploit != nil {
		x, err := g.startItem(item.Compose, composeMethod, "", row.Exploit, "start-"+c.C.ID+"-exploit")
		if err != nil {
			return err
		}
		in.Exploit = x
	}
	for _, x := range []*item.Instance{in, in.Exploit} {
		if x == nil {
			continue
		}
		if err := g.post(ledger.Move(ledger.SubKey(key, "start", x.ID), "start", g.Tick(), ledger.FromStart, ledger.Char(c.C.ID), ledger.Item(x.ID), 1)); err != nil {
			return err
		}
	}
	c.C.Carry(row.Wear, 0, in)
	c.Start = choice
	c.C.Practise(row.Skill, g.practiceUses(row.Practice), g.r.Growth.Params())
	_, err = g.fact(c, "character.started", g.Tick(), fact.S("start", choice), fact.S("kind", in.Kind))
	return err
}

// startRow is the start a new character chose, or a refusal.
func (g *Game) startRow(choice string) (*sheets.Start, error) {
	for i := range g.r.Book.Starts {
		if g.r.Book.Starts[i].ID == choice {
			return &g.r.Book.Starts[i], nil
		}
	}
	return nil, refuse(BadArgs, "no start %q", choice)
}

// practiceUses is the uses that take a skill from 0 to a level.
func (g *Game) practiceUses(level int64) int64 {
	per := sheets.IntParam(g.r.Growth.Params(), "practice-uses")
	return per * level * (level + 1) / halves
}

// structural: uses to a level sum an arithmetic series, halved.
const halves = 2

// structural: the one compose method.
const composeMethod = "ordered"

func (g *Game) startItem(process, method, slot string, inputs []sheets.StartInput, id string) (*item.Instance, error) {
	r := item.Recipe{Process: process, Method: method, Slot: slot}
	for _, x := range inputs {
		r.Inputs = append(r.Inputs, item.Input{Kind: x.Material, Qty: x.Qty})
	}
	k, err := g.r.Fight.D.Derive(r, g.r.firstTier())
	if err != nil {
		return nil, err
	}
	g.nameKind(k, "")
	return item.NewInstance(id, k, ""), nil
}

func (r *Rules) firstTier() int64 { return r.Book.Tiers[0].Tier }

// Station is a station on a tile: its kind and tier.
type Station = craft.Station

// StationFor is the highest-tier station on a tile a process is done at.
func (g *Game) StationFor(h hex.Hex, process string) (Station, bool) {
	var best Station
	ok := false
	for _, s := range g.Stations(h) {
		if slices.Contains(g.r.processStations[process], s.Kind) && (!ok || s.Tier > best.Tier) {
			best, ok = s, true
		}
	}
	return best, ok
}

// FactionOrder is a faction's or the keepers' buy order standing on a
// tile today.
type FactionOrder struct {
	Faction  int // econ.Keepers for the keepers
	Material string
	Price    int64 // coin each, before standing
	Qty      int64 // units still wanted
}

// FactionOrders are today's faction and keepers' buy orders on a tile;
// none off an open settlement.
func (g *Game) FactionOrders(h hex.Hex) []FactionOrder {
	n, ok := g.SettlementAt(h)
	if !ok {
		return nil
	}
	var out []FactionOrder
	for _, b := range g.BooksAt(n) {
		for _, o := range b.Bids {
			if o.Faction != nil {
				out = append(out, FactionOrder{Faction: *o.Faction, Material: b.Material, Price: o.Price, Qty: o.Qty})
			}
		}
	}
	return out
}

// structural: the starting structures the loop looks for by kind.
const (
	structureMarket = "market"
	structureStable = "stable"
)

// PriceFor is what a faction order pays a character, after standing, or
// false where the faction will not buy from it.
func (g *Game) PriceFor(c *Char, h hex.Hex, o FactionOrder) (int64, bool) {
	n, ok := g.SettlementAt(h)
	if !ok {
		return 0, false
	}
	return g.factionPays(ledger.Char(c.C.ID), o.Faction, n, o.Price)
}

// sell sells carried goods now to the best bids here, at no less than
// the price named (any, for none); what finds no buyer stays carried.
func (g *Game) sell(c *Char, cmd Command) error {
	if !cmd.Staged {
		if err := g.wanted(c, cmd.Material, market.Bid); err != nil {
			return err
		}
	}
	return g.order(c, cmd, market.Ask, false)
}

// take buys goods now from the best asks here, at no more than the price
// named (any, for none).
func (g *Game) take(c *Char, cmd Command) error {
	if !cmd.Staged {
		if err := g.wanted(c, cmd.Material, market.Ask); err != nil {
			return err
		}
	}
	return g.order(c, cmd, market.Bid, false)
}

// wanted refuses an order to fill now when the book here has nobody on
// the other side.
func (g *Game) wanted(c *Char, material string, side market.Side) error {
	n, err := g.marketHere(c)
	if err != nil {
		return err
	}
	b := g.BookOf(n, material)
	if b == nil || b.Depth(side) == 0 {
		if side == market.Bid {
			return refuse(NotHere, "nobody here buys %s", material)
		}
		return refuse(NotHere, "nobody here sells %s", material)
	}
	return nil
}

// buy is what the tile offers: the market's provisions, or the stable's
// mounts.
func (g *Game) buy(c *Char, cmd Command) error {
	if err := canTrade(c); err != nil {
		return err
	}
	if n, ok := g.SettlementAt(c.C.At); ok {
		if err := g.cityVendor(c, n); err != nil {
			return err
		}
	}
	offers := g.Offers(c.C.At)
	i := slices.IndexFunc(offers, func(o Offer) bool { return o.Asset == cmd.Asset })
	if i < 0 {
		if cmd.Asset == ledger.Provisions {
			return refuse(NotHere, "provisions are bought at a market")
		}
		if g.r.Mounts.Kind(cmd.Asset) == nil {
			return refuse(BadArgs, "nothing called %q is for sale", cmd.Asset)
		}
		return refuse(NotHere, "a stable here sells tier-%d mounts", g.r.firstTier())
	}
	o := offers[i]
	if cmd.Asset == ledger.Provisions {
		if cmd.Units <= 0 {
			return refuse(BadArgs, "buy at least one provision")
		}
		cost, ok := times(cmd.Units, o.Price)
		if !ok {
			return refuse(BadArgs, "the market holds fewer than %d provisions", cmd.Units)
		}
		return g.trade(c, cmd.Key, "trade.bought", ledger.Provisions, cmd.Units, cost, fact.S("asset", ledger.Provisions))
	}
	return g.giveMount(c, cmd.Key, cmd.Asset, func(id string) error {
		return g.trade(c, cmd.Key, "mount.bought", ledger.Item(id), 1, o.Price, fact.S("kind", cmd.Asset), fact.S("item", id))
	})
}

// giveMount gives a character a mount of a kind, once pay has posted its
// transaction for the mount's id.
func (g *Game) giveMount(c *Char, key, kind string, pay func(id string) error) error {
	if c.C.In(char.Mount, 0) != nil {
		return refuse(Busy, "%s already has a mount", c.C.ID)
	}
	id := "m-" + key
	if err := pay(id); err != nil {
		return err
	}
	c.C.Carry(char.Mount, 0, g.r.Mounts.NewMount(id, kind))
	return nil
}

// times is units at a price, or false when the product would overflow.
func times(units, price int64) (int64, bool) {
	if price > 0 && units > math.MaxInt64/price {
		return 0, false
	}
	return units * price, true
}

// canTrade reports why a character cannot trade, feed or talk: down, or
// in an encounter. A long action does not stop it; a journey through a
// settlement may sell on the way.
func canTrade(c *Char) error {
	if err := notDown(c); err != nil {
		return err
	}
	if c.Fight != nil {
		return refuse(Busy, "%s is in an encounter", c.C.ID)
	}
	return nil
}

func (g *Game) provisionsPrice() int64 { return g.r.Values.Param("provisions-price") }

func (g *Game) mountPrice(tier int64) int64 { return tier * g.r.Values.Param("mount-price") }

// Offer is something a tile's market or stable sells, at a price each.
type Offer struct {
	Asset string
	Price int64
}

// Offers are what a tile sells: provisions at a market, first-tier mounts
// at a stable, at the prices buy charges; a faction's war-yard asks less
// for a mount.
func (g *Game) Offers(h hex.Hex) []Offer {
	var out []Offer
	if g.HasStructure(h, structureMarket) {
		out = append(out, Offer{Asset: ledger.Provisions, Price: g.provisionsPrice()})
	}
	if g.HasStructure(h, structureStable) {
		share := int64(fixed.Hundredths)
		if n, ok := g.SettlementAt(h); ok {
			share = g.mountShare(n)
		}
		for _, m := range g.r.Book.MountKinds {
			if m.Tier == g.r.firstTier() {
				out = append(out, Offer{Asset: m.ID, Price: fixed.PercentFloor(g.mountPrice(m.Tier), share)})
			}
		}
	}
	return out
}

// trade pays coin into the market's sink for units of an asset from its
// source, as one transaction behind one fact.
func (g *Game) trade(c *Char, key, kind, asset string, units, cost int64, data ...fact.Datum) error {
	acc := ledger.Char(c.C.ID)
	if have := g.balance(c, ledger.Coin); have < cost {
		return refuse(BadArgs, "that costs %d coin; %s has %d coin", cost, c.C.ID, have)
	}
	f, err := g.fact(c, kind, g.Tick(), append(data, fact.N("units", units), fact.N("coin", cost))...)
	if err != nil {
		return err
	}
	t := ledger.Txn{Key: key, Kind: "market", Tick: g.Tick(), Fact: f.ID,
		Legs: append(ledger.Pair(acc, ledger.ToMarket, ledger.Coin, cost), ledger.Pair(ledger.FromMarket, acc, asset, units)...)}
	if err := g.receive(c, t); err != nil {
		return err
	}
	c.C.Spent.Bump("market", cost)
	return nil
}

// feed pays a mount's unpaid upkeep from provisions; a fed mount carries
// again (GDD 6.2).
func (g *Game) feed(c *Char, cmd Command) error {
	if err := canTrade(c); err != nil {
		return err
	}
	if c.Owed == 0 {
		return refuse(BadArgs, "%s's mount is fed", c.C.ID)
	}
	if have := g.balance(c, ledger.Provisions); have < c.Owed {
		return refuse(BadArgs, "feeding takes %d provisions; %s has %d", c.Owed, c.C.ID, have)
	}
	if err := g.receive(c, ledger.Move(cmd.Key, "upkeep", g.Tick(), ledger.Char(c.C.ID), ledger.ToUpkeep, ledger.Provisions, c.Owed)); err != nil {
		return err
	}
	_, err := g.fact(c, "mount.fed", g.Tick(), fact.N("provisions", c.Owed))
	c.Owed = 0
	return err
}

// upkeep charges each mount its day: provisions for the day and the ticks
// ridden. What cannot be paid leaves the mount unfed until fed.
func (g *Game) upkeep(c *Char, t int64) (bool, error) {
	m := c.C.In(char.Mount, 0)
	if m == nil {
		return false, nil
	}
	owe := g.mountUpkeep(c, g.r.Mounts.Upkeep(1, c.Rode))
	if row, w := g.workHere(c, guild.GivesMountUpkeep, true); w != nil && owe > 0 {
		each := g.r.Values.Param("provisions-value")
		saved := spared(row, w, owe*each) / each
		g.workGave(w, saved*each)
		owe -= saved
	}
	changed := c.Rode != 0 || owe > 0
	c.Rode = 0
	pay := min(owe, c.C.Provisions)
	if pay > 0 {
		key := ledger.SubKey("tick", strconv.FormatInt(t, decimal), c.C.ID, "upkeep")
		if err := g.receive(c, ledger.Move(key, "upkeep", t, ledger.Char(c.C.ID), ledger.ToUpkeep, ledger.Provisions, pay)); err != nil {
			return false, err
		}
	}
	if pay < owe {
		c.Owed += owe - pay
		_, err := g.fact(c, "mount.unfed", t, fact.N("owed", c.Owed))
		return changed, err
	}
	return changed, nil
}

// Fed reports whether a character's mount will carry.
func (c *Char) Fed() bool { return c.Owed == 0 }

// WearIn is where an item of a kind's slot may be worn.
func WearIn(slot string) []string { return equipSlots[slot] }

// equipSlots says where a kind's slot may be worn.
var equipSlots = map[string][]string{
	"blade": {char.Hand, char.OffHand}, "tool": {char.Hand, char.OffHand}, "hook": {char.Hand, char.OffHand},
	"focus": {char.OffHand}, "plate": {char.Body}, "charm": {char.Charm},
}

// structural: the deck slot loads an exploit into the off-hand focus.
const slotDeck = "deck"

// Loads reports whether a kind loads into a deck rather than being worn.
func Loads(k *item.Kind) bool { return k.Exploit != nil }

// structural: a deck is an off-hand focus, the gear a fight reads an
// exploit from.
const slotFocus = "focus"

// IsDeck reports whether a kind is a deck an exploit loads into.
func IsDeck(k *item.Kind) bool { return k.Slot == slotFocus }

func (g *Game) isDeck(in *item.Instance) bool {
	k, ok := g.Kinds.Kind(in.Kind)
	return ok && IsDeck(k)
}

func (g *Game) equip(c *Char, cmd Command) error {
	if err := free(c); err != nil {
		return err
	}
	in := c.C.Item(cmd.Item)
	if in == nil {
		return refuse(BadArgs, "%s carries no %s", c.C.ID, cmd.Item)
	}
	k, ok := g.Kinds.Kind(in.Kind)
	if !ok {
		return refuse(BadArgs, "%s cannot be worn", cmd.Item)
	}
	if cmd.Slot == slotDeck {
		deck := c.C.In(char.OffHand, 0)
		if !Loads(k) || deck == nil || !g.isDeck(deck) {
			return refuse(BadArgs, "an exploit loads into a deck held in the off-hand")
		}
		if deck.Exploit != nil {
			c.C.Pack = append(c.C.Pack, deck.Exploit)
		}
		c.C.Drop(in.ID)
		deck.Exploit = in
	} else {
		if !slices.Contains(equipSlots[k.Slot], cmd.Slot) {
			return refuse(BadArgs, "a %s is not worn in the %s", k.Slot, cmd.Slot)
		}
		if err := c.C.Equip(cmd.Slot, int(cmd.Units), in.ID); err != nil {
			return refuse(BadArgs, "%s", err.Error())
		}
	}
	_, err := g.fact(c, "item.equipped", g.Tick(), fact.S("item", in.ID), fact.S("slot", cmd.Slot))
	return err
}

// Appraisal is what a craft would make, shown before committing.
type Appraisal struct {
	Ranges  craft.Ranges `json:"ranges"`
	Station Station      `json:"station"`
	Fee     int64        `json:"fee"`
	Name    string       `json:"name"`
	// Eye marks an appraiser with a Master's eye, who is shown Registered:
	// the kind is already in the registry, so making it discovers nothing.
	Eye        bool `json:"eye,omitempty"`
	Registered bool `json:"registered,omitempty"`
}

// Appraise shows a recipe's ranges to its crafter at the station the tile
// holds for its process (GDD 9.10).
func (g *Game) Appraise(c *Char, r item.Recipe) (Appraisal, error) {
	st, ok := g.StationFor(c.C.At, r.Process)
	if !ok {
		return Appraisal{}, refuse(NotHere, "no station here does %s", r.Process)
	}
	return g.appraiseAt(c, r, st, func(kind string) int64 { return g.feeFor(c, st, kind) })
}

// BackRoomAppraise shows a recipe's ranges in the back room of the den
// here, at the back room's fee (GDD 4.5).
func (g *Game) BackRoomAppraise(c *Char, r item.Recipe) (Appraisal, error) {
	st, err := g.backRoom(c, r.Process)
	if err != nil {
		return Appraisal{}, err
	}
	return g.appraiseAt(c, r, st, func(string) int64 { return g.BackRoomFee(c, st, r) })
}

// appraisal is a craft's appraisal where the command works it.
func (g *Game) appraisal(c *Char, r item.Recipe, backRoom bool) (Appraisal, error) {
	if backRoom {
		return g.BackRoomAppraise(c, r)
	}
	return g.Appraise(c, r)
}

func (g *Game) appraiseAt(c *Char, r item.Recipe, st Station, fee func(kind string) int64) (Appraisal, error) {
	if err := g.recipeOK(r); err != nil {
		return Appraisal{}, err
	}
	rg, err := g.r.Crafter.Appraise(r, st, c.C.Level(practiceCraft), c.C.ID)
	if err != nil {
		return Appraisal{}, refuse(BadArgs, "%s", err.Error())
	}
	name := g.Kinds.Name(rg.Kind)
	if name == "" {
		name = g.plainName(r)
	}
	eye := g.charScale(c, "sees-registered", 0) > 0
	return Appraisal{Ranges: g.narrowed(c, rg), Station: st, Fee: fee(rg.Kind), Name: name, Eye: eye, Registered: eye && rg.Known}, nil
}

// structural: the practice a craft trains.
const practiceCraft = "craft"

// StationFee is what working at a station costs.
func (g *Game) StationFee(st Station) int64 { return st.Tier * g.r.Values.Param("station-fee") }

// recipeOK holds recipes the chat cards can build: base materials only,
// a method of the process, and a slot unless it composes.
func (g *Game) recipeOK(r item.Recipe) error {
	if len(r.Inputs) == 0 {
		return refuse(BadArgs, "a recipe needs inputs")
	}
	for i, in := range r.Inputs {
		if _, ok := g.r.Fight.D.Material(in.Kind); !ok || in.Qty <= 0 {
			return refuse(BadArgs, "%q is not a material", in.Kind)
		}
		if slices.ContainsFunc(r.Inputs[:i], func(x item.Input) bool { return x.Kind == in.Kind }) {
			return refuse(BadArgs, "a recipe names %s once", in.Kind)
		}
	}
	if NeedsSlot(r.Process) && r.Slot == "" {
		return refuse(BadArgs, "%s needs a slot", r.Process)
	}
	return nil
}

// NeedsSlot reports whether a process makes a slot's item, so its recipe
// names one; composing and alloying do not.
func NeedsSlot(process string) bool { return process != item.Compose && process != item.Alloy }

func (g *Game) craftCmd(c *Char, cmd Command) error {
	if err := free(c); err != nil {
		return err
	}
	if cmd.Recipe == nil {
		return refuse(BadArgs, "a craft needs a recipe")
	}
	r := *cmd.Recipe
	ap, err := g.appraisal(c, r, cmd.BackRoom)
	if err != nil {
		return err
	}
	acc := ledger.Char(c.C.ID)
	var need []item.Spoil
	for _, in := range r.Inputs {
		need = item.AddSpoil(need, in.Kind, in.Qty)
	}
	origin, err := g.stagedOrigin(c, need)
	if err != nil {
		return err
	}
	if g.balance(c, ledger.Coin) < ap.Fee {
		return refuse(BadArgs, "the %s's fee is %d coin", ap.Station.Kind, ap.Fee)
	}
	t := g.Tick()
	res, facts, err := g.r.Crafter.Craft(craft.Order{Recipe: r, Station: ap.Station, By: c.C.ID, Tick: t, Press: cmd.Key})
	if err != nil {
		return refuse(BadArgs, "%s", err.Error())
	}
	if r.Process == item.Compose {
		g.spare(c, &res, int64(len(r.Inputs)))
	}
	// Clean units go first; what staged ones the craft takes keep their
	// origin in what it makes, its facts are the staging server's, and it
	// discovers nothing (GDD 14.5 rule 6).
	clean, staged := g.drawClean(c, res.Consumed)
	var mark *item.Stage
	if len(staged) > 0 {
		mark = &item.Stage{At: origin, Server: g.stagedServer(origin)}
		defer g.stampedBy(mark.Server)()
		defer g.stagedSpan(mark.Server)()
		if res.Discovered {
			facts = slices.DeleteFunc(facts, func(f fact.Fact) bool { return f.Kind == factKindDiscovered })
			res.Kind.FirstMaker = ""
			res.Discovered = false
			g.nameKind(res.Kind, "")
		}
	}
	if cmd.BackRoom {
		g.used(c.C.At)
	} else {
		if _, w, saved := g.feeSaved(c, ap.Station, ap.Ranges.Kind); saved > 0 {
			g.workGave(w, saved)
		}
		g.used(c.C.At, ap.Station.Kind)
	}
	for _, f := range facts {
		f.Data = append(f.Data, fact.At(c.C.At)...)
		if _, err := g.Log.Append(f); err != nil {
			return err
		}
	}
	if res.Failed {
		g.scrapYard(c, r, ap.Station, &res)
	}
	if add := g.charScale(c, "craft-salvage", 0); add > 0 {
		base := sheets.IntParam(g.r.Book.ItemParams, "failed-salvage")
		for i := range res.Salvage {
			res.Salvage[i].Qty += res.Salvage[i].Qty * add / max(base, 1)
		}
	}
	if res.Instance != nil {
		res.Instance.Stamp = g.charScale(c, "item-xp", fixed.Hundredths) - fixed.Hundredths
	}
	if res.Discovered {
		g.nameKind(res.Kind, c.C.ID)
		c.C.Discovered = append(c.C.Discovered, res.Kind.ID)
		c.C.Discoveries++
	}
	// Hot inputs carry their mark into what they make (GDD 6.5); the back
	// room takes them first and makes them clean.
	day := t / sheets.TicksPerDay
	var hot []char.HotLot
	var laundered int64
	restore := holdMarks(c, nil)
	if cmd.BackRoom {
		laundered = g.launder(c, clean, day)
	} else {
		for _, s := range clean {
			hot = append(hot, g.consumeHot(c, s.Material, s.Qty, day)...)
		}
	}
	legs := []ledger.Leg{}
	if ap.Fee > 0 {
		legs = append(legs, ledger.Pair(acc, ledger.ToFees, ledger.Coin, ap.Fee)...)
	}
	for _, s := range clean {
		legs = append(legs, ledger.Pair(acc, ledger.ToCraft, ledger.Material(s.Material), s.Qty)...)
	}
	for _, s := range staged {
		legs = append(legs, ledger.Pair(acc, ledger.ToCraft, ledger.Staged(origin, s.Material), s.Qty)...)
	}
	if res.Instance != nil {
		res.Instance.Staged = mark
		legs = append(legs, ledger.Pair(ledger.FromCraft, acc, ledger.Item(res.Instance.ID), 1)...)
	}
	for _, s := range res.Salvage {
		legs = append(legs, ledger.Pair(ledger.FromSalvage, acc, g.salvageAsset(mark, s.Material), s.Qty)...)
	}
	if err := g.receive(c, ledger.Txn{Key: cmd.Key, Kind: "craft", Tick: t, Legs: ledger.Merge(legs)}); err != nil {
		restore()
		return err
	}
	if hotMark, ok := latestMark(hot); ok {
		if res.Instance != nil {
			res.Instance.Hot = &hotMark
		}
		if mark == nil {
			g.markHot(c, res.Salvage, hotMark)
		}
	}
	if res.Instance != nil {
		c.C.Pack = append(c.C.Pack, res.Instance)
	}
	if cmd.BackRoom {
		if err := g.laundered(c, ap.Fee, laundered, res, t); err != nil {
			return err
		}
	}
	c.C.Crafts.Bump(r.Process, 1)
	c.C.Practise(practiceCraft, 1, g.r.Growth.Params())
	if tool := c.C.In(char.Hand, 0); tool != nil && res.ToolXP > 0 {
		return g.levelled(c, tool, res.ToolXP, t)
	}
	return nil
}

// stagedOrigin is the one settlement whose staged units a craft that
// needs goods would draw on, once the clean units carried run out; -1
// when clean units cover it. A craft that would need two origins' staged
// units is refused with staged-local, nothing changed.
func (g *Game) stagedOrigin(c *Char, need []item.Spoil) (int, error) {
	var short []item.Spoil
	for _, s := range need {
		clean, staged := g.Usable(c, s.Material)
		if s.Qty <= clean {
			continue
		}
		all := clean
		for _, x := range staged {
			all += x.Units
		}
		if all < s.Qty {
			return 0, refuse(BadArgs, "the recipe takes %d %s", s.Qty, s.Material)
		}
		short = append(short, item.Spoil{Material: s.Material, Qty: s.Qty - clean})
	}
	if len(short) == 0 {
		return -1, nil
	}
	for _, x := range c.C.Staged {
		if !slices.ContainsFunc(short, func(s item.Spoil) bool { return g.StagedHeld(c, x.At, s.Material) < s.Qty }) {
			return x.At, nil
		}
	}
	return 0, refuse(StagedLocal, "the recipe would take staged goods of two settlements: a craft keeps to one")
}

// drawClean splits what a craft consumes into the clean units carried,
// taken first, and the staged rest.
func (g *Game) drawClean(c *Char, consumed []item.Spoil) (clean, staged []item.Spoil) {
	for _, s := range consumed {
		have, _ := g.Usable(c, s.Material)
		if n := min(s.Qty, have); n > 0 {
			clean = item.AddSpoil(clean, s.Material, n)
		}
		if n := s.Qty - min(s.Qty, have); n > 0 {
			staged = item.AddSpoil(staged, s.Material, n)
		}
	}
	return clean, staged
}

// salvageAsset is what salvage of a material comes out as: staged at the
// origin of the staged thing it came from, else clean.
func (g *Game) salvageAsset(from *item.Stage, material string) string {
	if from != nil {
		return ledger.Staged(from.At, material)
	}
	return ledger.Material(material)
}

// salvaged is the source and asset a fight's salvage leg mints: a staged
// item's salvage stays staged at its origin, and any other is minted as
// the applied stage mints.
func (g *Game) salvaged(sv fight.Salvaged, material string) (src, asset string) {
	if sv.Staged != nil {
		return ledger.FromSalvage, g.salvageAsset(sv.Staged, material)
	}
	return g.mintSource(ledger.FromSalvage), g.mintAsset(material)
}

// spare keeps back the components a Kindler's Tinder saves of a Compose,
// last first, never under the least a Compose orders.
func (g *Game) spare(c *Char, res *craft.Result, components int64) {
	least := sheets.IntParam(g.r.Book.ItemParams, "compose-min-inputs")
	keep := min(components-g.charScale(c, "compile-components", components), components-least)
	for i := len(res.Consumed) - 1; i >= 0 && keep > 0; i-- {
		if res.Consumed[i].Qty > 0 {
			res.Consumed[i].Qty--
			keep--
		}
	}
}

// levelled adds xp to an item and records its levels and milestones.
func (g *Game) levelled(c *Char, in *item.Instance, xp, t int64) error {
	k, ok := g.Kinds.Kind(in.Kind)
	if !ok {
		return nil
	}
	lv := g.r.Growth.AddXP(in, k, xp)
	if lv.To > lv.From {
		if _, err := g.fact(c, "item.levelled", t, fact.S("item", in.ID), fact.N("from", lv.From), fact.N("to", lv.To)); err != nil {
			return err
		}
	}
	return nil
}

// repair restores an item at a station that does its last process: coin
// per point restored and the units of its top input (GDD 6, 9.11).
func (g *Game) repair(c *Char, cmd Command) error {
	if err := free(c); err != nil {
		return err
	}
	in, k, st, err := g.atStation(c, cmd.Item)
	if err != nil {
		return err
	}
	cost := g.RepairCost(in, k)
	if cost.Points == 0 && !in.Dormant {
		return refuse(BadArgs, "%s is whole", in.ID)
	}
	if err := g.payStation(c, cmd.Key, "repair", cost.Coin, cost.Material, cost.Units); err != nil {
		return err
	}
	in.Repair()
	_, err = g.fact(c, "item.repaired", g.Tick(), fact.S("item", in.ID), fact.N("points", cost.Points), fact.S("station", st.Kind))
	return err
}

// Cost is what a repair or a pick takes: coin, and units of a material.
type Cost struct {
	Coin     int64  `json:"coin"`
	Material string `json:"material,omitempty"`
	Units    int64  `json:"units,omitempty"`
	Points   int64  `json:"points,omitempty"` // durability a repair restores
}

// RepairCost is what restoring an item costs.
func (g *Game) RepairCost(in *item.Instance, k *item.Kind) Cost {
	pts := in.MaxDurability - in.Durability
	return Cost{Coin: pts * g.r.Values.Param("repair-coin"), Material: g.r.Fight.D.TopInput(k), Units: item.RepairCost(in, g.r.Book.WearParams), Points: pts}
}

// PickCost is what taking a milestone pick costs at a station.
func (g *Game) PickCost(k *item.Kind, st Station) Cost {
	m, n := g.r.Growth.PickCost(k)
	return Cost{Coin: g.StationFee(st), Material: m, Units: n}
}

func (g *Game) pick(c *Char, cmd Command) error {
	if err := free(c); err != nil {
		return err
	}
	in, k, st, err := g.atStation(c, cmd.Item)
	if err != nil {
		return err
	}
	if !slices.Contains(in.Offers, cmd.Option) {
		return refuse(BadArgs, "%s has no offer %q", in.ID, cmd.Option)
	}
	cost := g.PickCost(k, st)
	if err := g.payStation(c, cmd.Key, "pick", cost.Coin, cost.Material, cost.Units); err != nil {
		return err
	}
	if err := g.r.Growth.Pick(in, k, cmd.Option); err != nil {
		return refuse(BadArgs, "%s", err.Error())
	}
	_, err = g.fact(c, "item.picked", g.Tick(), fact.S("item", in.ID), fact.S("pick", cmd.Option), fact.N("level", in.Level))
	return err
}

// atStation finds a carried item and the station on the tile that does
// its kind's last process.
func (g *Game) atStation(c *Char, id string) (*item.Instance, *item.Kind, Station, error) {
	in := c.C.Item(id)
	if in == nil {
		return nil, nil, Station{}, refuse(BadArgs, "%s carries no %s", c.C.ID, id)
	}
	k, ok := g.Kinds.Kind(in.Kind)
	if !ok {
		return nil, nil, Station{}, refuse(BadArgs, "%s is not made at a station", id)
	}
	st, ok := g.StationFor(c.C.At, k.Recipe.Process)
	if !ok {
		return nil, nil, Station{}, refuse(NotHere, "no station here does %s", k.Recipe.Process)
	}
	return in, k, st, nil
}

// payStation pays coin into the fees and units of a material into the
// craft sink, as one transaction.
func (g *Game) payStation(c *Char, key, kind string, coin int64, material string, units int64) error {
	acc := ledger.Char(c.C.ID)
	if g.balance(c, ledger.Coin) < coin {
		return refuse(BadArgs, "that costs %d coin", coin)
	}
	if units > 0 && g.Ledger.Of(acc, ledger.Material(material)) < units {
		return refuse(BadArgs, "that takes %d %s", units, material)
	}
	var legs []ledger.Leg
	if coin > 0 {
		legs = append(legs, ledger.Pair(acc, ledger.ToFees, ledger.Coin, coin)...)
	}
	if units > 0 {
		legs = append(legs, ledger.Pair(acc, ledger.ToCraft, ledger.Material(material), units)...)
	}
	if len(legs) == 0 {
		return nil
	}
	return g.receive(c, ledger.Txn{Key: key, Kind: kind, Tick: g.Tick(), Legs: legs})
}

func (g *Game) balance(c *Char, asset string) int64 {
	return g.Ledger.Of(ledger.Char(c.C.ID), asset)
}

// ForageYield is the provisions one tick of foraging finds on a tile: the
// sheet's least, rising with fertility to its most, plus one by water
// (GDD 6.4).
func (g *Game) ForageYield(h hex.Hex) int64 {
	b := g.World.Baseline(h)
	lo, hi := g.r.wp("forage-min"), g.r.wp("forage-max")
	n := lo + (hi-lo)*b.Fertility/fertilityScale
	if b.Water != gen.WaterNone {
		n++
	}
	return min(hi, n)
}

// structural: fertility runs 0 to 100.
const fertilityScale = 100

func (g *Game) forage(c *Char, cmd Command) error {
	cmd.Material = ledger.Provisions
	return g.gather(c, cmd)
}

// crawl starts crawling out of a lost fight: a long action that ends
// down and leaves the character wounded (GDD 5.5). Down on a dungeon's
// floor it takes crawl-per-floor more a floor, and ends at the entrance
// (GDD 4.9).
func (g *Game) crawl(c *Char, cmd Command) error {
	if !c.C.Has(char.Down, g.Tick()) {
		return refuse(BadArgs, "%s is not down", c.C.ID)
	}
	if c.Long != nil || c.Fight != nil {
		return refuse(Busy, "%s is busy", c.C.ID)
	}
	if c.CarriedBy != "" {
		g.setDown(g.Char(c.CarriedBy), c)
	}
	n := g.CrawlTicks(c)
	g.startLong(c, Crawl, cmd.Key, n, n)
	g.syncCall(c)
	return nil
}

// CrawlTicks is how long a downed character takes to crawl out.
func (g *Game) CrawlTicks(c *Char) int64 {
	return g.r.wp("crawl-ticks") + g.fp("crawl-per-floor")*c.C.Floor
}

func (g *Game) crawled(c *Char, t int64) error {
	c.Long = nil
	c.C.Clear(char.Down)
	c.C.Set(char.Wounded, t+g.r.wp("wound-days")*sheets.TicksPerDay)
	var data []fact.Datum
	if c.C.Floor > 0 {
		data = append(data, fact.N("floor", c.C.Floor))
		g.leaveFloorRecord(c)
		c.C.Floor, c.Delving = 0, nil
	}
	_, err := g.fact(c, "character.crawled", t, data...)
	return err
}

// Carried is the clean goods a character carries, one per unit; hauling
// deeds count only these.
func (c *Char) Carried() int64 { return item.Total(c.C.Goods) }

// Load is everything a character carries, staged units included.
func (c *Char) Load() int64 {
	n := c.Carried()
	for _, s := range c.C.Staged {
		n += s.Units
	}
	return n
}

// Capacity is what a character can carry before it is laden: an unfed
// mount carries nothing.
func (g *Game) Capacity(c *Char) int64 {
	load := g.charScale(c, "load", c.C.Load(&g.Kinds, g.r.Mounts, g.r.Book.TraitEffects))
	if !c.Fed() {
		load -= g.r.Mounts.Load(c.C.In(char.Mount, 0))
	}
	return load
}

// Laden reports whether a character carries over what it can.
func (g *Game) Laden(c *Char) bool { return c.Load() > g.Capacity(c) }
