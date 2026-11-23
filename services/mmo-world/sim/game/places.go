package game

import (
	"errors"
	"slices"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/settle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// Commands of settlements (GDD 4.8, 4.16).
const (
	Found   = "found"   // charter a settlement on this tile for the character's guild
	Charter = "charter" // take over a starting settlement nobody runs
	Raise   = "raise"   // post the pooled goals that raise a structure a tier
	Mend    = "mend"    // repair a structure with materials carried
)

// Place is an open settlement as the game holds it.
type Place = settle.Settlement

// syncPlaces adds the starting settlements the world has opened since the
// last call, each to the guild waiting longest for one.
func (g *Game) syncPlaces() {
	have := 0
	for _, p := range g.Places {
		if p.Lattice >= 0 {
			have++
		}
	}
	for n := have; n < g.World.Opened; n++ {
		p := &Place{N: len(g.Places), Hex: g.r.Gen.Settlement(n).Hex, Lattice: n, Founded: g.Tick()}
		for _, st := range g.r.Book.Starting {
			p.Structures = append(p.Structures, settle.Structure{Kind: st.Structure, Tier: st.Tier, Condition: g.r.Settle.ConditionMax, Built: g.Tick(), Used: g.Tick()})
		}
		g.Places = append(g.Places, p)
		if i := slices.IndexFunc(g.Guilds, func(gd *Guild) bool { return gd.Waiting }); i >= 0 {
			gd := g.Guilds[i]
			gd.Waiting = false
			p.Guild = gd.G.ID
			// Those who arrived while it waited call the new settlement home.
			for _, m := range gd.G.Members {
				if c := g.Char(m.Char); c != nil {
					c.C.Home = goal.SettlementRef(p.N)
				}
			}
		}
	}
}

// Settlements are the open settlements' tiles, in opening order.
func (g *Game) Settlements() []hex.Hex {
	out := make([]hex.Hex, len(g.Places))
	for i, p := range g.Places {
		out[i] = p.Hex
	}
	return out
}

// SettlementHex is the tile of an open settlement by its index.
func (g *Game) SettlementHex(n int) hex.Hex { return g.Places[n].Hex }

// SettlementAt is the open settlement on a tile, or false.
func (g *Game) SettlementAt(h hex.Hex) (int, bool) {
	i := slices.IndexFunc(g.Places, func(p *Place) bool { return p.Hex == h })
	return i, i >= 0
}

// IsSettlement reports whether a tile holds a settlement: one the world
// was made with, or one a guild founded.
func (g *Game) IsSettlement(h hex.Hex) bool {
	return g.slot(h) == gen.PlaceSettlement || g.PlaceAt(h) != nil
}

// SiteAt is what stands on a tile: the world's site, a pin's once the
// tile is reached, or a founded settlement.
func (g *Game) SiteAt(h hex.Hex) string {
	if g.PlaceAt(h) != nil {
		return gen.PlaceSettlement
	}
	return g.slot(h)
}

// PlaceAt is the open settlement on a tile, or nil.
func (g *Game) PlaceAt(h hex.Hex) *Place {
	if n, ok := g.SettlementAt(h); ok {
		return g.Places[n]
	}
	return nil
}

// Stations are the open stations a settlement's tile holds, or a camp's
// where no settlement stands.
func (g *Game) Stations(h hex.Hex) []Station {
	p := g.PlaceAt(h)
	if p == nil {
		return g.campStations(h)
	}
	var out []Station
	for _, s := range p.Structures {
		if row := g.r.structures[s.Kind]; row != nil && row.Station && !s.Closed() {
			out = append(out, Station{Kind: s.Kind, Tier: s.Tier})
		}
	}
	return out
}

// HasStructure reports whether an open settlement on a tile holds an
// open structure of a kind.
func (g *Game) HasStructure(h hex.Hex, kind string) bool {
	p := g.PlaceAt(h)
	return p != nil && p.Open(kind)
}

// TreasuryPool is the ledger pool a settlement's treasury is.
func TreasuryPool(n int) string { return ledger.TreasuryPool(n) }

// marketFee is the fee on a sale of coin at a settlement: the market's,
// raised while a raid's stake runs there and cut at a faction city's
// exchange, never more than the sale.
func (g *Game) marketFee(settlement int, coin int64) int64 {
	fee := g.r.Values.Fee(coin)
	if g.Story != nil && settlement >= 0 && settlement < len(g.Places) {
		fee = fixed.PercentFloor(fee, g.feeShare(settlement, g.Tick()))
		fee = min(fixed.PercentFloor(fee, g.cityFeeCut(settlement)), coin)
	}
	return fee
}

// StructureCap is the highest tier a structure rises to at a settlement:
// a city's stations reach the city's cap.
func (g *Game) StructureCap(n int, row *sheets.Structure) int64 {
	return settle.CapFor(row, g.r.Settle, g.isCity(n))
}

// feeLegs sinks a seller's market fee; a guild's settlement keeps its
// share in the treasury (GDD 4.8).
func (g *Game) feeLegs(settlement int, seller string, fee int64) []ledger.Leg {
	if fee <= 0 {
		return nil
	}
	if settlement < 0 || settlement >= len(g.Places) || g.Places[settlement].Guild == "" {
		return ledger.Pair(seller, ledger.ToFees, ledger.Coin, fee)
	}
	kept := fixed.PercentFloor(fee, g.sp("fee-share"))
	legs := ledger.Pair(seller, TreasuryPool(settlement), ledger.Coin, kept)
	if fee > kept {
		legs = append(legs, ledger.Pair(seller, ledger.ToFees, ledger.Coin, fee-kept)...)
	}
	return ledger.Merge(legs)
}

// charterPlan is a charter on a character's tile as the rules decide it:
// the guild that would hold it, the starting settlement it would take
// (nil to found a new one), and what it costs.
type charterPlan struct {
	guild *Guild
	take  *Place
	coin  int64
	goods []sheets.CostLine
}

// charterOf plans a charter on the character's tile for its guild, or
// refuses (GDD 4.8). The plan carries the cost even when it refuses, for
// CharterAt to show; a Reeve's Founder lowers it.
func (g *Game) charterOf(c *Char) (charterPlan, error) {
	pct := g.charScale(c, "charter-cost", fixed.Hundredths)
	plan := charterPlan{coin: fixed.PercentFloor(g.sp("charter-coin"), pct), goods: []sheets.CostLine{
		{Tag: tagTimber, Quantity: fixed.PercentFloor(g.sp("charter-timber"), pct)}, {Tag: tagStone, Quantity: fixed.PercentFloor(g.sp("charter-stone"), pct)}}}
	gd, err := g.officerOf(c)
	if err != nil {
		return plan, err
	}
	plan.guild = gd
	if !gd.G.Full(g.r.Guild) {
		return plan, refuse(BadArgs, "a guild needs %d members to charter a settlement", g.r.Guild.Least)
	}
	h := c.C.At
	if p := g.PlaceAt(h); p != nil {
		switch {
		case p.Ruined != 0:
			return plan, refuse(Ruined, "this settlement lies in ruins")
		case p.Guild != "":
			return plan, refuse(NotHere, "a guild already runs this settlement")
		}
		plan.take = p
		if v, ok := g.World.GaugeAt(h, "prosperity"); !ok || v < g.sp("charter-prosperity") {
			return plan, refuse(NotHere, "a charter here needs %d prosperity in the region", g.sp("charter-prosperity"))
		}
	} else {
		switch {
		case !g.freeGround(h):
			return plan, refuse(NotHere, "a settlement needs a free, passable tile")
		case !settle.FarEnough(h, g.allSettlements(h), g.r.Settle):
			return plan, refuse(NotHere, "a settlement stands at least %d tiles from any other", g.r.Settle.FoundDistance)
		case g.overrun(h):
			return plan, refuse(NotHere, "nobody charters in an overrun region")
		}
	}
	if g.Ledger.Of(gd.Pool(), ledger.Coin) < plan.coin {
		return plan, refuse(BadArgs, "the charter takes %d coin from the treasury", plan.coin)
	}
	if _, short, missing := g.takeLines(g.holdings(c), plan.goods); short != nil {
		return plan, tooFew(c, *short, missing)
	}
	return plan, nil
}

// structural: the goods a charter is paid in.
const (
	tagTimber = "timber"
	tagStone  = "stone"
)

// freeGround reports whether a tile is passable and holds no site.
func (g *Game) freeGround(h hex.Hex) bool {
	return g.slot(h) == "" && g.r.Gen.Passable(g.r.Gen.Baseline(h).Terrain)
}

// foundSettlement charters a settlement on the character's tile for its
// guild (GDD 4.8).
func (g *Game) foundSettlement(c *Char, cmd Command) error {
	plan, err := g.charterOf(c)
	switch {
	case err != nil:
		return err
	case plan.take != nil:
		return refuse(NotHere, "a settlement already stands here")
	}
	name := cmd.Note
	if err := g.named("settlement", name); err != nil {
		return err
	}
	gd, h, n := plan.guild, c.C.At, len(g.Places)
	if err := g.payCharter(c, plan, cmd.Key, TreasuryPool(n)); err != nil {
		return err
	}
	p := &Place{N: n, Hex: h, Lattice: -1, Name: name, Guild: gd.G.ID, Founded: g.Tick()}
	for _, row := range settle.Charter(g.r.Book.Structures) {
		p.Raise(row, g.Tick(), g.r.Settle)
	}
	g.Places = append(g.Places, p)
	g.Market.Trader = append(g.Market.Trader, 0)
	_, err = g.factWith(c, []fact.Ref{guildRef(gd.G.ID)}, "settlement.founded", g.Tick(), append([]fact.Datum{fact.S("name", name), fact.N("settlement", int64(n))}, fact.At(h)...)...)
	return err
}

// charter takes a starting settlement nobody runs for the character's
// guild (GDD 4.8).
func (g *Game) charter(c *Char, cmd Command) error {
	plan, err := g.charterOf(c)
	switch {
	case err != nil:
		return err
	case plan.take == nil:
		return refuse(NotHere, "only a starting settlement is taken by charter")
	}
	gd, p := plan.guild, plan.take
	if err := g.payCharter(c, plan, cmd.Key, TreasuryPool(p.N)); err != nil {
		return err
	}
	p.Guild = gd.G.ID
	_, err = g.factWith(c, []fact.Ref{guildRef(gd.G.ID)}, "settlement.chartered", g.Tick(), append([]fact.Datum{fact.N("settlement", int64(p.N))}, fact.At(p.Hex)...)...)
	return err
}

// payCharter moves a planned charter's goods from the character, sunk
// into the tile, and its coin from the guild's treasury into the
// settlement's. Founding is the whole guild's act: the coin is outside its
// officer's day.
func (g *Game) payCharter(c *Char, plan charterPlan, key, treasury string) error {
	if err := g.payLines(c, key, "charter", plan.goods, ledger.ToBuild); err != nil {
		return err
	}
	t := ledger.Move(ledger.SubKey(key, "charter-coin"), "charter", g.Tick(), plan.guild.Pool(), treasury, ledger.Coin, plan.coin)
	return g.post(t)
}

// holdings is what a character has to pay with: its coin, then its
// materials in the order it carries them.
func (g *Game) holdings(c *Char) []ledger.Balance {
	acc := ledger.Char(c.C.ID)
	out := []ledger.Balance{{Account: acc, Asset: ledger.Coin, Units: c.C.Coin}}
	for _, s := range c.C.Goods {
		out = append(out, ledger.Balance{Account: acc, Asset: ledger.Material(s.Material), Units: s.Qty})
	}
	return out
}

// pays reports whether a holding pays toward a cost line: coin for a line
// with no tag, else goods holding the tag.
func (g *Game) pays(asset, tag string) bool {
	if tag == "" {
		return asset == ledger.Coin
	}
	m, ok := ledger.GoodsOf(asset)
	return ok && g.materialHas(m, tag)
}

// takeLines are the legs taking each cost line from holdings, in the
// order they are held, no holding spent twice. short is the first line
// they cannot cover and missing how much of it they lack.
func (g *Game) takeLines(held []ledger.Balance, lines []sheets.CostLine) (legs []ledger.Leg, short *sheets.CostLine, missing int64) {
	held = slices.Clone(held)
	for i, l := range lines {
		need := l.Quantity
		for j := range held {
			h := &held[j]
			if need == 0 {
				break
			}
			if h.Units <= 0 || !g.pays(h.Asset, l.Tag) {
				continue
			}
			n := min(need, h.Units)
			legs = append(legs, ledger.Leg{Account: h.Account, Asset: h.Asset, Units: -n})
			h.Units -= n
			need -= n
		}
		if need > 0 {
			return nil, &lines[i], need
		}
	}
	return legs, nil, 0
}

// heldOfTag is what holdings hold toward a cost line of a tag.
func (g *Game) heldOfTag(held []ledger.Balance, tag string) int64 {
	var n int64
	for _, h := range held {
		if g.pays(h.Asset, tag) {
			n += h.Units
		}
	}
	return n
}

// tooFew refuses a cost a character cannot cover.
func tooFew(c *Char, l sheets.CostLine, missing int64) error {
	if l.Tag == "" {
		return refuse(BadArgs, "that takes %d coin", l.Quantity)
	}
	return refuse(BadArgs, "that takes %d goods of %s; %s carries %d goods too few", l.Quantity, l.Tag, c.C.ID, missing)
}

// payLines takes each cost line from what a character carries into a
// sink; it refuses with nothing moved if the character carries too
// little.
func (g *Game) payLines(c *Char, key, kind string, lines []sheets.CostLine, sink string) error {
	takes, short, missing := g.takeLines(g.holdings(c), lines)
	if short != nil {
		return tooFew(c, *short, missing)
	}
	var legs []ledger.Leg
	for _, l := range takes {
		legs = append(legs, ledger.Pair(l.Account, sink, l.Asset, -l.Units)...)
	}
	if len(legs) == 0 {
		return nil
	}
	return g.postAll(ledger.Txn{Key: ledger.SubKey(key, kind), Kind: kind, Tick: g.Tick(), Legs: ledger.Merge(legs)})
}

// materialHas reports whether a material, or provisions, holds a tag.
func (g *Game) materialHas(material, tag string) bool {
	if tags, ok := g.r.matTags[material]; ok {
		return slices.Contains(tags, tag)
	}
	m, ok := g.foundReg.Get(material)
	return ok && slices.Contains(m.Tags, tag)
}

// allSettlements are the tiles a new settlement on h must keep its
// distance from: the open ones and any starting settlement of the
// lattice within that distance, opened or not.
func (g *Game) allSettlements(h hex.Hex) []hex.Hex {
	out := g.Settlements()
	for _, o := range hex.DiscAt(h, g.r.Settle.FoundDistance-1) {
		if g.r.Gen.Baseline(o).Site == gen.PlaceSettlement {
			out = append(out, o)
		}
	}
	return out
}

// overrun reports whether a tile's region is overrun.
func (g *Game) overrun(h hex.Hex) bool {
	r := g.World.RegionAt(h)
	return r >= 0 && g.World.Overrun(r)
}

// sp is a settlements sheet cell.
func (g *Game) sp(id string) int64 { return sheets.IntParam(g.r.Book.SettlementParams, id) }

// mend repairs a structure at the character's settlement with the
// materials its condition needs (GDD 4.16); any member of the running
// guild, or anyone at a settlement nobody runs, may.
func (g *Game) mend(c *Char, cmd Command) error {
	p := g.PlaceAt(c.C.At)
	if p == nil {
		return refuse(NotHere, "there is no settlement here")
	}
	if p.Ruined != 0 {
		return refuse(Ruined, "nothing here is mended: it lies in ruins")
	}
	if gd := g.GuildOf(p.Guild); gd != nil && c.C.Guild != p.Guild && len(gd.G.Members) > 0 {
		return refuse(NotHere, "only %s's members repair here", gd.G.Name)
	}
	st, row := p.Get(cmd.Slot), g.r.structures[cmd.Slot]
	if st == nil || row == nil {
		return refuse(BadArgs, "no %q stands here", cmd.Slot)
	}
	missing := g.r.Settle.ConditionMax - st.Condition
	points := min(missing, max(cmd.Units, 1))
	if st.Closed() {
		// A closed structure is charged its reopening whatever is asked, so
		// it gets what that buys.
		points = min(missing, max(points, settle.ReopenPoints(g.r.Settle)))
	}
	if points <= 0 {
		return refuse(BadArgs, "the %s needs no repair", cmd.Slot)
	}
	if err := g.payLines(c, cmd.Key, "repair", g.repairCost(p, row, *st, points), ledger.ToBuild); err != nil {
		return err
	}
	p.Mend(cmd.Slot, points, g.r.Settle)
	_, err := g.fact(c, "structure.repaired", g.Tick(), fact.S("structure", cmd.Slot), fact.N("points", points), fact.N("settlement", int64(p.N)))
	return err
}

// StructureRepair is what restoring points of a structure's condition takes.
func (g *Game) StructureRepair(p *Place, kind string, points int64) []sheets.CostLine {
	st, row := p.Get(kind), g.r.structures[kind]
	if st == nil || row == nil {
		return nil
	}
	return g.repairCost(p, row, *st, points)
}

// repairCost is what a repair takes at a settlement: sickness there makes
// it dearer (GDD 12.5).
func (g *Game) repairCost(p *Place, row *sheets.Structure, st settle.Structure, points int64) []sheets.CostLine {
	lines := settle.Repair(row, st, points, g.r.Settle)
	if g.Story == nil {
		return lines
	}
	if share := g.sickShare(p.N, g.Tick()); share != fixed.Hundredths {
		lines = settle.Scaled(lines, share)
	}
	return lines
}

// placesTurn is the settlements' world day: neglect wears what nobody
// used, and a closed structure is a fact. A settlement no guild runs is
// kept by its keepers.
func (g *Game) placesTurn(t int64) error {
	for _, p := range g.Places {
		if p.Guild == "" {
			continue
		}
		for _, kind := range p.Neglect(t, g.r.Settle) {
			if _, err := g.worldFact(p.Hex, "structure.closed", nil, nil, fact.S("structure", kind), fact.N("settlement", int64(p.N))); err != nil {
				return err
			}
		}
	}
	return nil
}

// tradeDay raises each region's prosperity by the coin its settlements'
// books traded on the world day just closed (GDD 4.3), up to a day's cap.
// It runs once the books close, so the world's day pulls the gauge back
// toward its baseline after the rise.
func (g *Game) tradeDay(day int64) {
	if g.Market == nil {
		return
	}
	per, most := g.sp("prosperity-coin"), g.sp("prosperity-trade-cap")
	coin := map[int]int64{}
	at := map[int]hex.Hex{}
	var order []int
	for _, b := range g.Market.Books {
		if b.Settlement < 0 || b.Settlement >= len(g.Places) || g.Places[b.Settlement].Ruined != 0 || len(b.Days) == 0 {
			continue
		}
		d := b.Days[len(b.Days)-1]
		if d.Day != day || d.Coin <= 0 {
			continue
		}
		h := g.SettlementHex(b.Settlement)
		r := g.World.RegionAt(h)
		if r < 0 {
			continue
		}
		if _, ok := at[r]; !ok {
			at[r] = h
			order = append(order, r)
		}
		coin[r] += d.Coin
	}
	slices.Sort(order)
	for _, r := range order {
		if by := min(coin[r]/max(per, 1), most); by > 0 {
			g.Pending = append(g.Pending, world.Action{Kind: world.ActProsper, Hex: at[r], Units: by})
		}
	}
}

// used marks a settlement's structures used now, and with them every
// structure nobody operates or whose system is not built yet.
func (g *Game) used(h hex.Hex, kinds ...string) {
	p := g.PlaceAt(h)
	if p == nil {
		return
	}
	t := g.Tick()
	for _, kind := range kinds {
		p.Use(kind, t)
	}
	for i := range g.r.Book.Structures {
		if row := &g.r.Book.Structures[i]; row.Standing || row.Waits != "" {
			p.Use(row.ID, t)
		}
	}
}

// uses are the structures a command uses where its character stands;
// crafting marks its own station.
var uses = map[string][]string{
	Sell: {structureMarket}, Bid: {structureMarket}, Ask: {structureMarket}, Take: {structureMarket},
	List: {structureMarket}, Want: {structureMarket}, Purchase: {structureMarket}, SellItem: {structureMarket},
	Buy: {structureMarket, structureStable}, Feed: {structureStable},
	Rest:     {structureGranary},
	PostGoal: {structureBoard}, Pledge: {structureBoard}, DeliverGoal: {structureBoard}, TakeHaul: {structureBoard}, Raise: {structureBoard},
	BackSide: {structureBoard}, CityRaise: {structureBoard},
	Deposit: {structureStorehouse}, Draw: {structureStorehouse}, Work: {structureStorehouse},
	BenchSolve: {structureTinker}, BenchLesson: {structureTinker},
}

// walled reports whether a tile is a settlement with a wall standing, for
// Hold fast.
func (g *Game) walled(h hex.Hex) bool { return g.HasStructure(h, structureWall) }

// structural: structures the game reads by kind.
const (
	structureWall       = "wall"
	structureGranary    = "granary"
	structureBoard      = "notice-board"
	structureStorehouse = "storehouse"
	structureTinker     = "tinker-bench"
)

// CharterView is whether a character's tile can be chartered for its guild
// and what it costs (GDD 4.8); Fields is a Surveyor's view of the tile.
type CharterView struct {
	Can    bool
	Why    string
	Take   bool
	Coin   int64
	Goods  []sheets.CostLine
	Fields map[string]int64
}

// CharterAt reads what founding or taking a settlement on the
// character's tile would take, and why not if it cannot.
func (g *Game) CharterAt(c *Char) CharterView {
	plan, err := g.charterOf(c)
	out := CharterView{Can: err == nil, Take: plan.take != nil, Coin: plan.coin, Goods: plan.goods}
	var ref *Refused
	if errors.As(err, &ref) {
		out.Why = ref.Msg
	}
	if g.charScale(c, "sees-fields", 0) > 0 {
		out.Fields = g.r.Gen.Baseline(c.C.At).Fields()
	}
	return out
}

// RaiseWaits is the milestone a raise of a structure at a settlement waits
// for, or "": nobody pays to raise what no rule reads yet, the whole
// structure or a tier past the one that stands.
func RaiseWaits(p *Place, row *sheets.Structure) string {
	switch {
	case row.Waits != "":
		return row.Waits
	case row.TiersWait != "" && p.Get(row.ID) != nil:
		return row.TiersWait
	}
	return ""
}

// Raising reports whether a structure has a raise open at a settlement.
func (g *Game) Raising(settlement int, structure string) bool {
	return g.raising(settlement, structure)
}
