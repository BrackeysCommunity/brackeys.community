package game

import (
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/settle"
	"jams.team/mmo-world/sim/sheets"
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
// last call, each to the guild waiting longest for one (D24).
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
					c.C.Home = "settlement:" + strconv.Itoa(p.N)
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
	return g.r.Gen.Baseline(h).Site == gen.PlaceSettlement || g.PlaceAt(h) != nil
}

// SiteAt is what stands on a tile: the world's site, or a founded
// settlement.
func (g *Game) SiteAt(h hex.Hex) string {
	if g.PlaceAt(h) != nil {
		return gen.PlaceSettlement
	}
	return g.r.Gen.Baseline(h).Site
}

// PlaceAt is the open settlement on a tile, or nil.
func (g *Game) PlaceAt(h hex.Hex) *Place {
	if n, ok := g.SettlementAt(h); ok {
		return g.Places[n]
	}
	return nil
}

// Stations are the open stations a settlement's tile holds.
func (g *Game) Stations(h hex.Hex) []Station {
	p := g.PlaceAt(h)
	if p == nil {
		return nil
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
func TreasuryPool(n int) string { return ledger.Pool + "treasury:" + strconv.Itoa(n) }

// feeLegs sinks a seller's market fee; a guild's settlement keeps its
// share in the treasury (GDD 4.8).
func (g *Game) feeLegs(settlement int, seller string, fee int64) []ledger.Leg {
	if fee <= 0 {
		return nil
	}
	if settlement < 0 || settlement >= len(g.Places) || g.Places[settlement].Guild == "" {
		return ledger.Pair(seller, ledger.ToFees, ledger.Coin, fee)
	}
	kept := fee * sheets.IntParam(g.r.Book.SettlementParams, "fee-share") / hundred
	legs := ledger.Pair(seller, TreasuryPool(settlement), ledger.Coin, kept)
	if fee > kept {
		legs = append(legs, ledger.Pair(seller, ledger.ToFees, ledger.Coin, fee-kept)...)
	}
	return ledger.Merge(legs)
}

// structural: shares are in per cent.
const hundred = 100

// foundSettlement charters a settlement on the character's tile for its guild
// (GDD 4.8): a free passable tile far enough from every settlement and
// outside an overrun region; the charter's goods from the character, its
// coin from the treasury.
func (g *Game) foundSettlement(c *Char, cmd Command) error {
	gd, err := g.officerOf(c)
	if err != nil {
		return err
	}
	if !gd.G.Full(g.r.Guild) {
		return refuse(BadArgs, "a guild needs %d members to found a settlement", g.r.Guild.Least)
	}
	h := c.C.At
	base := g.r.Gen.Baseline(h)
	switch {
	case base.Site != "" || !g.r.Gen.Passable(base.Terrain):
		return refuse(NotHere, "a settlement needs a free, passable tile")
	case !settle.FarEnough(h, g.allSettlements(h), g.r.Settle):
		return refuse(NotHere, "a settlement stands at least %d tiles from any other", g.r.Settle.FoundDistance)
	case g.overrun(h):
		return refuse(NotHere, "nobody charters in an overrun region")
	}
	name := cmd.Note
	if err := g.named("settlement", name); err != nil {
		return err
	}
	n := len(g.Places)
	if err := g.payCharter(c, gd, cmd.Key, TreasuryPool(n)); err != nil {
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

// charter charters a starting settlement nobody runs for the character's
// guild, which needs prosperity in its region (GDD 4.8).
func (g *Game) charter(c *Char, cmd Command) error {
	gd, err := g.officerOf(c)
	if err != nil {
		return err
	}
	p := g.PlaceAt(c.C.At)
	switch {
	case p == nil || p.Lattice < 0:
		return refuse(NotHere, "only a starting settlement is taken by charter")
	case p.Guild != "":
		return refuse(NotHere, "a guild already runs this settlement")
	}
	if v, ok := g.World.GaugeAt(p.Hex, "prosperity"); !ok || v < g.sp("charter-prosperity") {
		return refuse(NotHere, "a charter here needs %d prosperity in the region", g.sp("charter-prosperity"))
	}
	if err := g.payCharter(c, gd, cmd.Key, TreasuryPool(p.N)); err != nil {
		return err
	}
	p.Guild = gd.G.ID
	_, err = g.factWith(c, []fact.Ref{guildRef(gd.G.ID)}, "settlement.chartered", g.Tick(), append([]fact.Datum{fact.N("settlement", int64(p.N))}, fact.At(p.Hex)...)...)
	return err
}

// payCharter moves a charter's goods from the character and its coin from
// the guild's treasury into the settlement's treasury, the goods sunk
// into the tile; a Reeve's Founder halves it.
func (g *Game) payCharter(c *Char, gd *Guild, key, treasury string) error {
	pct := g.charScale(c, "charter-cost", hundred)
	coin := g.sp("charter-coin") * pct / hundred
	lines := []costLine{{Tag: "timber", Units: g.sp("charter-timber") * pct / hundred}, {Tag: "stone", Units: g.sp("charter-stone") * pct / hundred}}
	if g.Ledger.Of(gd.Pool(), ledger.Coin) < coin {
		return refuse(BadArgs, "the charter takes %d coin from the treasury", coin)
	}
	if err := g.payLines(c, key, "charter", lines, ledger.ToBuild); err != nil {
		return err
	}
	t := ledger.Move(ledger.SubKey(key, "charter-coin"), "charter", g.Tick(), gd.Pool(), treasury, ledger.Coin, coin)
	if err := g.post(t); err != nil {
		return err
	}
	gd.G.Spent(c.C.ID, g.World.Day, coin)
	return nil
}

// costLine is units of goods of a tag a character pays.
type costLine struct {
	Tag   string
	Units int64
}

func linesOf(ls []sheets.CostLine, pct int64) []costLine {
	out := make([]costLine, len(ls))
	for i, l := range ls {
		out[i] = costLine{Tag: l.Tag, Units: max(1, l.Quantity*pct/hundred)}
	}
	return out
}

// payLines takes goods of each line's tag from what a character carries,
// materials in the order they are carried, into a sink; it refuses with
// nothing moved if the character carries too little.
func (g *Game) payLines(c *Char, key, kind string, lines []costLine, sink string) error {
	var legs []ledger.Leg
	for _, l := range lines {
		need := l.Units
		if l.Tag == "" {
			if c.C.Coin < need {
				return refuse(BadArgs, "that takes %d coin", need)
			}
			legs = append(legs, ledger.Pair(ledger.Char(c.C.ID), sink, ledger.Coin, need)...)
			continue
		}
		for _, s := range c.C.Goods {
			if need == 0 {
				break
			}
			if !g.materialHas(s.Material, l.Tag) {
				continue
			}
			n := min(need, s.Qty)
			legs = append(legs, ledger.Pair(ledger.Char(c.C.ID), sink, ledger.Material(s.Material), n)...)
			need -= n
		}
		if need > 0 {
			return refuse(BadArgs, "that takes %d %s; %s carries %d too few", l.Units, l.Tag, c.C.ID, need)
		}
	}
	if len(legs) == 0 {
		return nil
	}
	return g.postAll(ledger.Txn{Key: ledger.SubKey(key, kind), Kind: kind, Tick: g.Tick(), Legs: ledger.Merge(legs)})
}

// materialHas reports whether a material, or provisions, holds a tag.
func (g *Game) materialHas(material, tag string) bool {
	if material == ledger.Provisions {
		return tag == ledger.Provisions
	}
	return slices.Contains(g.r.matTags[material], tag)
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
	if p.Guild != "" && c.C.Guild != p.Guild {
		return refuse(NotHere, "only %s's members repair here", p.Guild)
	}
	st, row := p.Get(cmd.Slot), g.r.structures[cmd.Slot]
	if st == nil || row == nil {
		return refuse(BadArgs, "no %q stands here", cmd.Slot)
	}
	points := min(g.r.Settle.ConditionMax-st.Condition, max(cmd.Units, 1))
	if points <= 0 {
		return refuse(BadArgs, "the %s needs no repair", cmd.Slot)
	}
	if err := g.payLines(c, cmd.Key, "repair", linesOf(settle.Repair(row, *st, points, g.r.Settle), hundred), ledger.ToBuild); err != nil {
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
	return settle.Repair(row, *st, points, g.r.Settle)
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
	Deposit: {structureStorehouse}, Draw: {structureStorehouse}, Work: {structureStorehouse},
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
)

// CharterView is whether a character's tile can be chartered for its guild
// and what it costs (GDD 4.8); Fields is a Surveyor's view of the tile.
type CharterView struct {
	Can                 bool
	Why                 string
	Take                bool
	Coin, Timber, Stone int64
	Fields              map[string]int64
}

// CharterAt reads what founding or taking a settlement on the
// character's tile would take, and why not if it cannot.
func (g *Game) CharterAt(c *Char) CharterView {
	pct := g.charScale(c, "charter-cost", hundred)
	out := CharterView{Coin: g.sp("charter-coin") * pct / hundred, Timber: g.sp("charter-timber") * pct / hundred, Stone: g.sp("charter-stone") * pct / hundred}
	h := c.C.At
	if g.charScale(c, "sees-fields", 0) > 0 {
		b := g.r.Gen.Baseline(h)
		out.Fields = map[string]int64{"ore": b.Ore, "fertility": b.Fertility, "cover": b.Cover, "moisture": b.Moisture}
	}
	gd := g.GuildOf(c.C.Guild)
	p := g.PlaceAt(h)
	base := g.r.Gen.Baseline(h)
	switch {
	case gd == nil || !gd.G.IsOfficer(c.C.ID):
		out.Why = "an officer of a guild charters"
	case !gd.G.Full(g.r.Guild):
		out.Why = "a guild needs " + strconv.FormatInt(g.r.Guild.Least, decimal) + " members"
	case p != nil && (p.Lattice < 0 || p.Guild != ""):
		out.Why = "a guild already runs this settlement"
	case p != nil:
		out.Take = true
		if v, ok := g.World.GaugeAt(h, "prosperity"); !ok || v < g.sp("charter-prosperity") {
			out.Why = "taking a starting settlement needs " + strconv.FormatInt(g.sp("charter-prosperity"), decimal) + " prosperity in its region"
		}
	case base.Site != "" || !g.r.Gen.Passable(base.Terrain):
		out.Why = "a settlement needs a free, passable tile"
	case !settle.FarEnough(h, g.allSettlements(h), g.r.Settle):
		out.Why = "too near another settlement"
	case g.overrun(h):
		out.Why = "the region is overrun"
	}
	switch {
	case out.Why != "":
	case g.Ledger.Of(gd.Pool(), ledger.Coin) < out.Coin:
		out.Why = "the treasury holds too little"
	case g.carriedOfTag(c, "timber") < out.Timber || g.carriedOfTag(c, "stone") < out.Stone:
		out.Why = "the charter's timber and stone are carried to the tile"
	}
	out.Can = out.Why == ""
	return out
}

// carriedOfTag is how much a character carries of a tag's goods.
func (g *Game) carriedOfTag(c *Char, tag string) int64 {
	var n int64
	for _, s := range c.C.Goods {
		if g.materialHas(s.Material, tag) {
			n += s.Qty
		}
	}
	return n
}

// Raising reports whether a structure has a raise open at a settlement.
func (g *Game) Raising(settlement int, structure string) bool {
	return g.raising(settlement, structure)
}
