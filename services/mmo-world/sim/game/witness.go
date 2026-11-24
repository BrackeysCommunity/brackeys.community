package game

import (
	"cmp"
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

// What a character can steal where it stands, and the odds it is seen
// (GDD 6.5). Every target is stock the ledger books to an NPC, a faction's
// store or a caravan; one with nothing booked is no target.

// StealTarget is one theft a character could begin here now, with the
// haul it plans and the witness odds it would be fixed at.
type StealTarget struct {
	Kind, NPC, Caravan, Victim, Faction, Source, Side string
	Worth, Witness                                    int64
	Parts                                             []fight.Part
	Plan                                              Haul
}

// Haul is what a theft plans to take, and its worth.
type Haul struct {
	Coin          int64
	Goods         []item.Spoil
	Item, Listing string
	Worth         int64
}

// structural: the witness formula's parts, the practice a theft trains,
// the tag that quiets an option, the prey side of a road war, and the
// victim ref kind of a caravan.
const (
	partBase        = "base"
	partUpright     = "upright"
	partSleight     = "sleight"
	partCover       = "cover"
	partQuiet       = "quiet"
	practiceSleight = "sleight"
	tagQuiet        = "quiet"
	sidePrey        = "prey-on-it"
	victimCaravan   = "caravan"
)

// TheftKind is a theft.kinds row.
func (g *Game) TheftKind(id string) (sheets.TheftKind, bool) {
	i := slices.IndexFunc(g.r.Book.TheftKinds, func(k sheets.TheftKind) bool { return k.ID == id })
	if i < 0 {
		return sheets.TheftKind{}, false
	}
	return g.r.Book.TheftKinds[i], true
}

func (g *Game) theftCell(id string) int64 { return sheets.IntParam(g.r.Book.TheftParams, id) }

// nextTheftID is the encounter id the character's next theft or flight
// begins with: its count of them, after the one beginning.
func nextTheftID(c *Char) string {
	var n int64
	if c.C.Alignment != nil {
		n = c.C.Alignment.Thefts
	}
	return "t-" + c.C.ID + "-" + strconv.FormatInt(n+1, decimal)
}

// StealTargets are what a character can steal on its tile now, sorted by
// kind, then victim: a lift from each NPC here with something booked to
// it, a burglary of the store of the faction holding this settlement's
// region, and a waylay of each caravan crossing the tile.
func (g *Game) StealTargets(c *Char) []StealTarget {
	h, t := c.C.At, g.Tick()
	people := g.PeopleHere(c, h)
	enc := nextTheftID(c)
	var out []StealTarget
	add := func(kind string, st StealTarget) {
		st.Kind, st.Worth = kind, st.Plan.Worth
		st.Witness, st.Parts = g.witnessAmong(c, kind, h, st.Victim, people)
		out = append(out, st)
	}
	if k, ok := g.TheftKind(KindLift); ok {
		for _, p := range people {
			if plan, ok := g.liftPlan(c, k, p.ID, enc); ok {
				add(KindLift, StealTarget{NPC: p.ID, Victim: refKey(npc.Ref(p.ID)), Faction: g.factionKeyOf(p.Stub), Source: ledger.NPCPool(p.ID), Plan: plan})
			}
		}
	}
	if k, ok := g.TheftKind(KindBurgle); ok {
		if fi, plan, ok := g.burglePlan(c, k, h, enc); ok {
			add(KindBurgle, StealTarget{Victim: refKey(arc.FactionRef(fi)), Faction: factionOwner(fi), Source: ledger.StorePool(fi), Plan: plan})
		}
	}
	if k, ok := g.TheftKind(KindWaylay); ok && g.Emergence != nil {
		for _, cv := range g.Emergence.Caravans {
			if g.caravanAt(cv, t) != h {
				continue
			}
			if plan, ok := g.waylayPlan(cv.ID, k, h); ok {
				add(KindWaylay, StealTarget{Caravan: cv.ID, Victim: refKey(fact.Ref{Kind: victimCaravan, ID: cv.ID}), Faction: g.caravanVictim(cv.To),
					Source: ledger.CaravanPool(cv.ID), Side: g.preySide(c, h), Plan: plan})
			}
		}
	}
	slices.SortStableFunc(out, func(a, b StealTarget) int {
		return cmp.Or(cmp.Compare(a.Kind, b.Kind), cmp.Compare(a.Victim, b.Victim))
	})
	return out
}

// liftPlan is what a lift from an NPC would take: its purse's coin up to
// the cap, then the most valuable item booked to it, held or listed,
// whose worth fits what is left, a tie drawn by the theft's id.
func (g *Game) liftPlan(c *Char, k sheets.TheftKind, id, enc string) (Haul, bool) {
	purse := ledger.NPCPool(id)
	capped := k.Coin + k.CoinPerSleight*c.C.Level(practiceSleight)
	coin := min(g.Ledger.Of(purse, ledger.Coin), capped)
	plan := Haul{Coin: coin, Worth: coin}
	type lot struct {
		in      *item.Instance
		listing string
		worth   int64
	}
	var best []lot
	for _, l := range g.purseItems(purse) {
		w := g.ItemValue(l.in)
		if w > capped-coin {
			continue
		}
		if len(best) > 0 && w < best[0].worth {
			continue
		}
		if len(best) > 0 && w > best[0].worth {
			best = best[:0]
		}
		best = append(best, lot{l.in, l.listing, w})
	}
	if len(best) > 0 {
		pick := best[0]
		if len(best) > 1 {
			pick = best[g.r.draw.Below(uint64(len(best)), "theft.lift-item", draw.Str(c.C.ID), draw.Str(enc))]
		}
		plan.Item, plan.Listing, plan.Worth = pick.in.ID, pick.listing, plan.Worth+pick.worth
	}
	return plan, plan.Coin > 0 || plan.Item != ""
}

type purseItem struct {
	in      *item.Instance
	listing string
}

// purseItems are the items booked to an NPC's purse whose instance the
// game holds: those in the escrow of a listing it sells, in listing
// order.
func (g *Game) purseItems(purse string) []purseItem {
	if g.Market == nil {
		return nil
	}
	var out []purseItem
	for _, l := range g.Market.Listings {
		if l.Seller == purse && l.Item != nil && g.Ledger.Of(ledger.EscrowPool(l.ID), ledger.Item(l.Item.ID)) > 0 {
			out = append(out, purseItem{l.Item, l.ID})
		}
	}
	return out
}

// burglePlan is a burglary of the store of the living faction holding an
// open settlement's region: one material of the tile's tier, drawn by the
// store's units, as many units as the store, the faction's stock and the
// kind's goods allow.
func (g *Game) burglePlan(c *Char, k sheets.TheftKind, h hex.Hex, enc string) (int, Haul, bool) {
	n, ok := g.SettlementAt(h)
	if !ok || g.Places[n].Ruined != 0 || k.GoodsPerUnit <= 0 {
		return 0, Haul{}, false
	}
	r := g.World.RegionAt(h)
	if r < 0 {
		return 0, Haul{}, false
	}
	fi := g.World.Regions[r].Holder
	if fi < 0 || fi >= len(g.World.Factions) || g.World.Factions[fi].Fallen {
		return 0, Haul{}, false
	}
	most := min(k.Goods, g.World.Factions[fi].Stock) / k.GoodsPerUnit
	if most < 1 {
		return 0, Haul{}, false
	}
	store, tier := ledger.StorePool(fi), g.tierAt(h)
	var mats []string
	var units []int64
	for _, b := range g.Ledger.Held(store) {
		mat, ok := ledger.MaterialOf(b.Asset)
		if m := g.r.materials[mat]; ok && m != nil && m.Tier == tier && b.Units > 0 {
			mats, units = append(mats, mat), append(units, b.Units)
		}
	}
	if len(mats) == 0 {
		return 0, Haul{}, false
	}
	i := g.r.draw.Pick(units, "theft.burgle-material", draw.Str(c.C.ID), draw.Str(enc))
	u := min(most, units[i])
	return fi, Haul{Goods: []item.Spoil{{Material: mats[i], Qty: u}}, Worth: g.WorthAt(h, ledger.Material(mats[i]), u)}, true
}

// waylayPlan is the kind's share of each good a caravan holds, held to its
// manifest.
func (g *Game) waylayPlan(id string, k sheets.TheftKind, h hex.Hex) (Haul, bool) {
	pool := ledger.CaravanPool(id)
	var plan Haul
	for _, b := range caravanHolds(g) {
		if b.Account != pool {
			continue
		}
		mat, ok := ledger.GoodsOf(b.Asset)
		if u := fixed.PercentFloor(b.Units, k.Share); ok && u > 0 {
			plan.Goods = item.AddSpoil(plan.Goods, mat, u)
			plan.Worth += g.WorthAt(h, b.Asset, u)
		}
	}
	return plan, len(plan.Goods) > 0
}

// caravanVictim is whose a caravan's goods are: the faction holding its
// destination's region, none if unheld.
func (g *Game) caravanVictim(to int) string {
	if !g.placeIndex(to) {
		return ""
	}
	if r := g.World.RegionAt(g.SettlementHex(to)); r >= 0 {
		if fi := g.World.Regions[r].Holder; fi >= 0 {
			return factionOwner(fi)
		}
	}
	return ""
}

// preySide is the goal of the prey side a character backs in a running
// road war whose regions hold tile h, if any: its waylay may feed it.
func (g *Game) preySide(c *Char, h hex.Hex) string {
	if g.Story == nil {
		return ""
	}
	r := g.World.RegionAt(h)
	for _, b := range g.Story.Backers {
		if b.Char != c.C.ID || b.Side != sidePrey {
			continue
		}
		if a := g.arcByID(b.Arc); a != nil && !a.over() && a.Stage == b.Stage && slices.Contains(a.Regions, r) {
			return b.Goal
		}
	}
	return ""
}

// witness is the odds a theft of a kind on tile h is seen, and its parts
// in per cent: the kind's base, each upright NPC here who is neither the
// victim nor warm to the character, less Sleight, the tile's cover and a
// quiet kit; held between witness-least and witness-most. A kind always
// seen is seen whatever the parts.
func (g *Game) witness(c *Char, kind string, h hex.Hex, victim string) (int64, []fight.Part) {
	return g.witnessAmong(c, kind, h, victim, g.PeopleHere(c, h))
}

func (g *Game) witnessAmong(c *Char, kind string, h hex.Hex, victim string, people []Person) (int64, []fight.Part) {
	k, ok := g.TheftKind(kind)
	if !ok {
		return 0, nil
	}
	base := k.WitnessOut
	if g.IsSettlement(h) {
		base = k.Witness
	}
	parts := []fight.Part{{Label: partBase, Value: base}}
	if k.Always {
		return base, parts
	}
	var uprights int64
	for _, p := range people {
		if p.Leaning == npc.LeaningUpright && p.Mood != MoodWarm && refKey(npc.Ref(p.ID)) != victim {
			uprights++
		}
	}
	cover := min(g.r.Gen.Baseline(h).Cover+g.charScale(c, "cover", 0), fixed.Hundredths)
	more := func(label string, v int64) {
		if v != 0 {
			parts = append(parts, fight.Part{Label: label, Value: v})
		}
	}
	more(partUpright, uprights*g.theftCell("witness-upright"))
	more(partSleight, -c.C.Level(practiceSleight)*g.theftCell("witness-sleight"))
	if per := g.theftCell("witness-cover"); per > 0 {
		more(partCover, -cover/per)
	}
	if g.quietKit(c) {
		more(partQuiet, -g.theftCell("witness-quiet"))
	}
	var sum int64
	for _, p := range parts {
		sum += p.Value
	}
	return min(max(sum, g.theftCell("witness-least")), g.theftCell("witness-most")), parts
}

// quietKit reports whether any item the character has equipped is quiet.
func (g *Game) quietKit(c *Char) bool {
	k := g.r.Fight.KitOf(c.C)
	gear := append([]*fight.Gear{k.Hand, k.OffHand, k.Body}, k.Charms...)
	return slices.ContainsFunc(gear, func(x *fight.Gear) bool { return x != nil && slices.Contains(x.Tags, tags.Tag(tagQuiet)) })
}

// WorthAt is what units of an asset are worth near tile h: at the last
// price of the nearest market's book for it, the lowest index on a tie,
// else at reference value.
func (g *Game) WorthAt(h hex.Hex, asset string, units int64) int64 {
	mat, ok := ledger.GoodsOf(asset)
	if !ok || units <= 0 {
		return 0
	}
	best, far := -1, int64(0)
	for i, p := range g.Places {
		if p.Ruined != 0 || !p.Open(structureMarket) {
			continue
		}
		if d := hex.Distance(p.Hex, h); best < 0 || d < far {
			best, far = i, d
		}
	}
	if best >= 0 {
		if b := g.BookOf(best, mat); b != nil {
			if price, _ := b.PriceAt(g.Tick()); price > 0 {
				return units * price
			}
		}
	}
	return units * g.r.Values.Asset(mat)
}
