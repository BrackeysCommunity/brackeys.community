package game

import (
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/craft"
	"jams.team/mmo-world/sim/econ"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
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

// structural: the asset a forage yields and the market sells.
const assetProvisions = econ.Provisions

// start gives a new character the one thing it chose to have carried:
// made from its start row at tier 1, level 1, with nobody as its maker.
func (g *Game) start(c *Char, key, choice string) error {
	var row *sheets.Start
	for i := range g.r.Book.Starts {
		if g.r.Book.Starts[i].ID == choice {
			row = &g.r.Book.Starts[i]
		}
	}
	if row == nil {
		return refuse(BadArgs, "no start %q", choice)
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

// Stations are the stations a tile holds: a starting settlement's.
func (g *Game) Stations(h hex.Hex) []Station {
	if g.r.Gen.Baseline(h).Site != gen.PlaceSettlement {
		return nil
	}
	var out []Station
	for _, s := range g.r.Book.Starting {
		if s.Tier > 0 {
			out = append(out, Station{Kind: s.Structure, Tier: s.Tier})
		}
	}
	return out
}

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

// HasStructure reports whether a tile holds a starting structure of a kind.
func (g *Game) HasStructure(h hex.Hex, kind string) bool {
	if g.r.Gen.Baseline(h).Site != gen.PlaceSettlement {
		return false
	}
	return slices.ContainsFunc(g.r.Book.Starting, func(s sheets.StartingStructure) bool { return s.Structure == kind })
}

// Orders are the faction buy orders on a tile: a starting settlement's.
func (g *Game) Orders(h hex.Hex) []econ.Order {
	if !g.HasStructure(h, structureMarket) {
		return nil
	}
	archs := make([]string, len(g.World.Factions))
	for i, f := range g.World.Factions {
		archs[i] = f.Archetype
	}
	return g.r.Values.Orders(archs)
}

// structural: the starting structures the loop looks for by kind.
const (
	structureMarket = "market"
	structureStable = "stable"
)

func (g *Game) sell(c *Char, cmd Command) error {
	if c.Fight != nil {
		return refuse(Busy, "%s is in an encounter", c.C.ID)
	}
	i := slices.IndexFunc(g.Orders(c.C.At), func(o econ.Order) bool { return o.Material == cmd.Material })
	if i < 0 {
		return refuse(NotHere, "no faction here buys %s", cmd.Material)
	}
	o := g.Orders(c.C.At)[i]
	asset := ledger.Material(o.Material)
	if o.Material == assetProvisions {
		asset = ledger.Provisions
	}
	if cmd.Units <= 0 || g.Ledger.Of(ledger.Char(c.C.ID), asset) < cmd.Units {
		return refuse(BadArgs, "%s does not carry %d %s", c.C.ID, cmd.Units, o.Material)
	}
	coin := o.Price * cmd.Units
	fee := g.r.Values.Fee(coin)
	f, err := g.fact(c, "order.filled", g.Tick(), fact.S("material", o.Material), fact.N("units", cmd.Units),
		fact.N("price", o.Price), fact.N("coin", coin), fact.N("fee", fee), fact.N("faction", int64(o.Faction)))
	if err != nil {
		return err
	}
	acc := ledger.Char(c.C.ID)
	t := ledger.Txn{Key: cmd.Key, Kind: "faction-order", Tick: g.Tick(), Fact: f.ID, Legs: []ledger.Leg{
		{Account: acc, Asset: asset, Units: -cmd.Units}, {Account: ledger.ToFaction, Asset: asset, Units: cmd.Units},
		{Account: ledger.FromFaction, Asset: ledger.Coin, Units: -coin}, {Account: acc, Asset: ledger.Coin, Units: coin},
	}}
	if fee > 0 {
		t.Legs = append(t.Legs, ledger.Leg{Account: acc, Asset: ledger.Coin, Units: -fee}, ledger.Leg{Account: ledger.ToFees, Asset: ledger.Coin, Units: fee})
	}
	if err := g.receive(c, t); err != nil {
		return err
	}
	c.C.Earned.Bump("faction-order", coin-fee)
	return g.traded(c, o.Material, g.Tick())
}

// buy is the market's provisions, or the stable's mounts.
func (g *Game) buy(c *Char, cmd Command) error {
	if c.Fight != nil {
		return refuse(Busy, "%s is in an encounter", c.C.ID)
	}
	if cmd.Asset == assetProvisions {
		if !g.HasStructure(c.C.At, structureMarket) {
			return refuse(NotHere, "provisions are bought at a market")
		}
		if cmd.Units <= 0 {
			return refuse(BadArgs, "buy at least one provision")
		}
		cost := cmd.Units * g.r.Values.Param("provisions-price")
		return g.trade(c, cmd.Key, "trade.bought", ledger.Provisions, cmd.Units, cost, fact.S("asset", assetProvisions))
	}
	m := g.r.Mounts.Kind(cmd.Asset)
	if m == nil {
		return refuse(BadArgs, "nothing called %q is for sale", cmd.Asset)
	}
	if !g.HasStructure(c.C.At, structureStable) || m.Tier != g.r.firstTier() {
		return refuse(NotHere, "a stable here sells tier-%d mounts", g.r.firstTier())
	}
	if c.C.In(char.Mount, 0) != nil {
		return refuse(Busy, "%s already has a mount", c.C.ID)
	}
	id := "m-" + cmd.Key
	if err := g.trade(c, cmd.Key, "mount.bought", ledger.Item(id), 1, m.Tier*g.r.Values.Param("mount-price"), fact.S("kind", m.ID), fact.S("item", id)); err != nil {
		return err
	}
	c.C.Carry(char.Mount, 0, g.r.Mounts.NewMount(id, m.ID))
	return nil
}

// trade pays coin into the market's sink for units of an asset from its
// source, as one transaction behind one fact.
func (g *Game) trade(c *Char, key, kind, asset string, units, cost int64, data ...fact.Datum) error {
	acc := ledger.Char(c.C.ID)
	if c.C.Coin < cost {
		return refuse(BadArgs, "that costs %d coin; %s has %d coin", cost, c.C.ID, c.C.Coin)
	}
	f, err := g.fact(c, kind, g.Tick(), append(data, fact.N("units", units), fact.N("coin", cost))...)
	if err != nil {
		return err
	}
	t := ledger.Txn{Key: key, Kind: "market", Tick: g.Tick(), Fact: f.ID, Legs: []ledger.Leg{
		{Account: acc, Asset: ledger.Coin, Units: -cost}, {Account: ledger.ToMarket, Asset: ledger.Coin, Units: cost},
		{Account: ledger.FromMarket, Asset: asset, Units: -units}, {Account: acc, Asset: asset, Units: units},
	}}
	if err := g.receive(c, t); err != nil {
		return err
	}
	c.C.Spent.Bump("market", cost)
	return nil
}

// feed pays a mount's unpaid upkeep from provisions; a fed mount carries
// again (GDD 6.2).
func (g *Game) feed(c *Char, cmd Command) error {
	if c.Owed == 0 {
		return refuse(BadArgs, "%s's mount is fed", c.C.ID)
	}
	if c.C.Provisions < c.Owed {
		return refuse(BadArgs, "feeding takes %d provisions; %s has %d", c.Owed, c.C.ID, c.C.Provisions)
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
func (g *Game) upkeep(c *Char, t int64) error {
	m := c.C.In(char.Mount, 0)
	if m == nil {
		return nil
	}
	owe := g.r.Mounts.Upkeep(1, c.Rode)
	c.Rode = 0
	pay := min(owe, c.C.Provisions)
	if pay > 0 {
		key := ledger.SubKey("tick", strconv.FormatInt(t, decimal), c.C.ID, "upkeep")
		if err := g.receive(c, ledger.Move(key, "upkeep", t, ledger.Char(c.C.ID), ledger.ToUpkeep, ledger.Provisions, pay)); err != nil {
			return err
		}
	}
	if pay < owe {
		c.Owed += owe - pay
		_, err := g.fact(c, "mount.unfed", t, fact.N("owed", c.Owed))
		return err
	}
	return nil
}

// Fed reports whether a character's mount will carry.
func (c *Char) Fed() bool { return c.Owed == 0 }

// equipSlots says where a kind's slot may be worn.
var equipSlots = map[string][]string{
	"blade": {char.Hand, char.OffHand}, "tool": {char.Hand, char.OffHand}, "hook": {char.Hand, char.OffHand},
	"focus": {char.OffHand}, "plate": {char.Body}, "charm": {char.Charm},
}

// structural: the deck slot loads an exploit into the off-hand focus.
const slotDeck = "deck"

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
		if k.Exploit == nil || deck == nil {
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
}

// Appraise shows a recipe's ranges to its crafter at the station the tile
// holds for its process (GDD 9.10).
func (g *Game) Appraise(c *Char, r item.Recipe) (Appraisal, error) {
	st, ok := g.StationFor(c.C.At, r.Process)
	if !ok {
		return Appraisal{}, refuse(NotHere, "no station here does %s", r.Process)
	}
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
	return Appraisal{Ranges: rg, Station: st, Fee: g.stationFee(st), Name: name}, nil
}

// structural: the practice a craft trains.
const practiceCraft = "craft"

func (g *Game) stationFee(st Station) int64 { return st.Tier * g.r.Values.Param("station-fee") }

// recipeOK holds recipes the chat cards can build: base materials only,
// a method of the process, and a slot unless it composes.
func (g *Game) recipeOK(r item.Recipe) error {
	if len(r.Inputs) == 0 {
		return refuse(BadArgs, "a recipe needs inputs")
	}
	for _, in := range r.Inputs {
		if _, ok := g.r.Fight.D.Material(in.Kind); !ok || in.Qty <= 0 {
			return refuse(BadArgs, "%q is not a material", in.Kind)
		}
	}
	if r.Process != item.Compose && r.Slot == "" && r.Process != item.Alloy {
		return refuse(BadArgs, "%s needs a slot", r.Process)
	}
	return nil
}

func (g *Game) craftCmd(c *Char, cmd Command) error {
	if err := free(c); err != nil {
		return err
	}
	if cmd.Recipe == nil {
		return refuse(BadArgs, "a craft needs a recipe")
	}
	r := *cmd.Recipe
	ap, err := g.Appraise(c, r)
	if err != nil {
		return err
	}
	acc := ledger.Char(c.C.ID)
	for _, in := range r.Inputs {
		if g.Ledger.Of(acc, ledger.Material(in.Kind)) < in.Qty {
			return refuse(BadArgs, "the recipe takes %d %s", in.Qty, in.Kind)
		}
	}
	if c.C.Coin < ap.Fee {
		return refuse(BadArgs, "the %s's fee is %d coin", ap.Station.Kind, ap.Fee)
	}
	t := g.Tick()
	res, facts, err := g.r.Crafter.Craft(craft.Order{Recipe: r, Station: ap.Station, By: c.C.ID, Tick: t, Press: cmd.Key})
	if err != nil {
		return refuse(BadArgs, "%s", err.Error())
	}
	for _, f := range facts {
		if _, err := g.Log.Append(f); err != nil {
			return err
		}
	}
	if res.Discovered {
		g.nameKind(res.Kind, c.C.ID)
		c.C.Discovered = append(c.C.Discovered, res.Kind.ID)
		c.C.Discoveries++
	}
	legs := []ledger.Leg{}
	if ap.Fee > 0 {
		legs = append(legs, ledger.Leg{Account: acc, Asset: ledger.Coin, Units: -ap.Fee}, ledger.Leg{Account: ledger.ToFees, Asset: ledger.Coin, Units: ap.Fee})
	}
	for _, s := range res.Consumed {
		legs = append(legs, ledger.Leg{Account: acc, Asset: ledger.Material(s.Material), Units: -s.Qty}, ledger.Leg{Account: ledger.ToCraft, Asset: ledger.Material(s.Material), Units: s.Qty})
	}
	if res.Instance != nil {
		legs = append(legs, ledger.Leg{Account: ledger.FromCraft, Asset: ledger.Item(res.Instance.ID), Units: -1}, ledger.Leg{Account: acc, Asset: ledger.Item(res.Instance.ID), Units: 1})
	}
	for _, s := range res.Salvage {
		legs = append(legs, ledger.Leg{Account: ledger.FromSalvage, Asset: ledger.Material(s.Material), Units: -s.Qty}, ledger.Leg{Account: acc, Asset: ledger.Material(s.Material), Units: s.Qty})
	}
	if err := g.receive(c, ledger.Txn{Key: cmd.Key, Kind: "craft", Tick: t, Legs: mergeLegs(legs)}); err != nil {
		return err
	}
	if res.Instance != nil {
		c.C.Pack = append(c.C.Pack, res.Instance)
	}
	c.C.Crafts.Bump(r.Process, 1)
	c.C.Practise(practiceCraft, 1, g.r.Growth.Params())
	if tool := c.C.In(char.Hand, 0); tool != nil && res.ToolXP > 0 {
		return g.levelled(c, tool, res.ToolXP, t)
	}
	return nil
}

// mergeLegs sums legs on the same account and asset, dropping any that
// come to nothing, so a craft that consumes and salvages one material
// posts once.
func mergeLegs(legs []ledger.Leg) []ledger.Leg {
	var out []ledger.Leg
	for _, l := range legs {
		i := slices.IndexFunc(out, func(o ledger.Leg) bool { return o.Account == l.Account && o.Asset == l.Asset })
		if i < 0 {
			out = append(out, l)
			continue
		}
		out[i].Units += l.Units
	}
	return slices.DeleteFunc(out, func(l ledger.Leg) bool { return l.Units == 0 })
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
	return Cost{Coin: g.stationFee(st), Material: m, Units: n}
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
	if c.C.Coin < coin {
		return refuse(BadArgs, "that costs %d coin", coin)
	}
	if units > 0 && g.Ledger.Of(acc, ledger.Material(material)) < units {
		return refuse(BadArgs, "that takes %d %s", units, material)
	}
	var legs []ledger.Leg
	if coin > 0 {
		legs = append(legs, ledger.Leg{Account: acc, Asset: ledger.Coin, Units: -coin}, ledger.Leg{Account: ledger.ToFees, Asset: ledger.Coin, Units: coin})
	}
	if units > 0 {
		legs = append(legs, ledger.Leg{Account: acc, Asset: ledger.Material(material), Units: -units}, ledger.Leg{Account: ledger.ToCraft, Asset: ledger.Material(material), Units: units})
	}
	if len(legs) == 0 {
		return nil
	}
	return g.receive(c, ledger.Txn{Key: key, Kind: kind, Tick: g.Tick(), Legs: legs})
}

// ForageYield is the provisions one tick of foraging finds on a tile: the
// sheet's least, rising with fertility to its most, plus one by water
// (GDD 6.4).
func (g *Game) ForageYield(h hex.Hex) int64 {
	b := g.r.Gen.Baseline(h)
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
	cmd.Material = assetProvisions
	return g.gather(c, cmd)
}

// crawl starts crawling out of a lost fight: a long action that ends
// down and leaves the character wounded (GDD 5.5).
func (g *Game) crawl(c *Char, cmd Command) error {
	if !c.C.Has(char.Down, g.Tick()) {
		return refuse(BadArgs, "%s is not down", c.C.ID)
	}
	if c.Long != nil || c.Fight != nil {
		return refuse(Busy, "%s is busy", c.C.ID)
	}
	t := g.Tick()
	n := g.r.wp("crawl-ticks")
	c.Long = &Long{Kind: Crawl, Key: cmd.Key, Started: t, Due: t + n, Ends: t + n}
	return nil
}

func (g *Game) crawled(c *Char, t int64) error {
	c.Long = nil
	c.C.Clear(char.Down)
	c.C.Set(char.Wounded, t+g.r.wp("wound-days")*sheets.TicksPerDay)
	_, err := g.fact(c, "character.crawled", t)
	return err
}

// Carried is the load a character carries: one per unit of goods.
func (c *Char) Carried() int64 { return item.Total(c.C.Goods) }

// Capacity is what a character can carry before it is laden: an unfed
// mount carries nothing.
func (g *Game) Capacity(c *Char) int64 {
	load := c.C.Load(&g.Kinds, g.r.Mounts, g.r.Book.TraitEffects)
	if !c.Fed() {
		load -= g.r.Mounts.Load(c.C.In(char.Mount, 0))
	}
	return load
}

// Laden reports whether a character carries over what it can.
func (g *Game) Laden(c *Char) bool { return c.Carried() > g.Capacity(c) }
