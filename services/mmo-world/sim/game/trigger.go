package game

import (
	"slices"
	"strings"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

// Trigger ids, as rows of tiles.triggers (GDD 8.6).
const (
	TrigSpoils    = "spoils-of-war"
	TrigFell      = "what-fell-here"
	TrigKnown     = "recognised"
	TrigNemesis   = "nemesis"
	TrigThin      = "thin-herds"
	TrigHigh      = "high-ground"
	TrigLowWater  = "low-water"
	TrigTrail     = "follow-the-trail"
	TrigCache     = "the-cache"
	TrigWorkedOut = "worked-out"
	// A party of two who rescued one another, and a key at a fork (GDD 8.6).
	TrigOldFriends = "old-friends"
	TrigTheKey     = "the-key"
	// TrigFloorFind names a find from a dungeon floor's pool; it is drawn
	// at tiles.params floor-find-chance, not from a trigger row.
	TrigFloorFind = "floor-find"
)

// Commands the triggers open.
const (
	Search = "search"
	Stash  = "cache"
)

func (g *Game) trigger(id string) sheets.Trigger {
	for _, t := range g.r.Book.Triggers {
		if t.ID == id {
			return t
		}
	}
	return sheets.Trigger{}
}

// Dropped is haul a character lost on a tile, or on one of a dungeon's
// floors, which only they can find again through what-fell-here, while the
// pool still holds it.
type Dropped struct {
	Hex   hex.Hex      `json:"hex"`
	Floor int64        `json:"floor,omitempty"`
	Lost  []item.Spoil `json:"lost"`
}

// Left is an item a character cached on a tile.
type Left struct {
	Hex    hex.Hex        `json:"hex"`
	By     string         `json:"by"`
	Hidden bool           `json:"hidden"`
	Item   *item.Instance `json:"item"`
}

// Find is what a trigger turned up, with its rarity and chance.
type Find struct {
	Trigger string       `json:"trigger"`
	Rarity  string       `json:"rarity"`
	Chance  fixed.F      `json:"chance"`
	Goods   []item.Spoil `json:"goods,omitempty"`
	Item    string       `json:"item,omitempty"`
	// By is who left a storied find, until it is given back to them.
	By string `json:"by,omitempty"`
}

func poolOf(h hex.Hex) string { return ledger.TilePool(h.Ref()) }

// StockLeft is what a tile's node still holds of a material.
func (g *Game) StockLeft(h hex.Hex, material string) int64 {
	stock := g.Stock(h, material)
	if t := g.World.Tile(h); t != nil {
		return max(0, stock-t.Gathered[material])
	}
	return stock
}

// WorkedOut reports whether a node is gathered past its stock.
func (g *Game) WorkedOut(h hex.Hex, material string) bool {
	return g.stockWorkedOut(g.Stock(h, material), g.StockLeft(h, material))
}

// stockWorkedOut reads the worked-out line against the node's own stock.
func (g *Game) stockWorkedOut(stock, left int64) bool {
	return fixed.AtPercent(stock-left, stock, g.trigger(TrigWorkedOut).Magnitude)
}

func (g *Game) workedOut(c *Char, material string, t int64) error {
	_, err := g.fact(c, "node.worked-out", t, append(append([]fact.Datum{fact.S("material", material)}, fact.At(c.C.At)...), fact.S("trigger", TrigWorkedOut))...)
	return err
}

// toolUse wears the tool in hand a gathering tick, and levels it when the
// node is at its tier or above (GDD 9.11, 9.12).
func (g *Game) toolUse(c *Char, t int64) error {
	tool := c.C.In(char.Hand, 0)
	if tool == nil || !tool.Usable() {
		return nil
	}
	k, ok := g.Kinds.Kind(tool.Kind)
	if !ok {
		return nil
	}
	tool.Use(1)
	tier, _ := g.r.Fight.D.Material(c.Long.Material)
	if tier >= k.Tier {
		return g.levelled(c, tool, g.r.Growth.Deed("gather-tick"), t)
	}
	return nil
}

// arrived runs the arrival triggers on the tile just entered.
func (g *Game) arrived(c *Char, h hex.Hex, key string, t int64) error {
	if err := g.fell(c, h, key, t); err != nil {
		return err
	}
	return g.spoils(c, h, key, t)
}

// fell gives back the character's own haul lost on this tile, as much
// as the pool still holds (GDD 8.6, What fell here).
func (g *Game) fell(c *Char, h hex.Hex, key string, t int64) error {
	i := slices.IndexFunc(c.Dropped, func(d Dropped) bool { return d.Hex == h && d.Floor == 0 })
	if i < 0 {
		return nil
	}
	tr := g.trigger(TrigFell)
	var goods []item.Spoil
	room := tr.Magnitude
	for _, s := range c.Dropped[i].Lost {
		n := min(s.Qty, g.Ledger.Of(poolOf(h), ledger.Material(s.Material)), room)
		if n > 0 {
			goods = item.AddSpoil(goods, s.Material, n)
			room -= n
		}
	}
	c.Dropped = slices.Delete(c.Dropped, i, i+1)
	if len(goods) == 0 {
		return nil
	}
	return g.found(c, h, ledger.SubKey(key, "fell", h.Ref()), Find{Trigger: TrigFell, Rarity: rarityCommon, Chance: tr.Chance, Goods: goods}, t)
}

// Rarities, as rows of tiles.find-rarities.
const (
	rarityCommon   = "common"
	rarityUncommon = "uncommon"
	rarityRare     = "rare"
	rarityStoried  = "storied"
)

// spoils draws a find from a fought-over tile's spoils pool (GDD 8.6,
// Spoils of war). The rarity is rolled from the sheet; a rarity the pool
// cannot meet falls to the next one down.
func (g *Game) spoils(c *Char, h hex.Hex, key string, t int64) error {
	tl := g.World.Tile(h)
	if tl == nil || (len(tl.BattlesWon) == 0 && tl.BattlesLost == 0) || len(g.Ledger.Held(poolOf(h))) == 0 {
		return nil
	}
	tr := g.trigger(TrigSpoils)
	if !g.r.draw.Roll(tr.Chance, "game.spoils", draw.Str(c.C.ID), draw.Int(t)) {
		return nil
	}
	weights := make([]int64, len(g.r.Book.FindRarities))
	for i, r := range g.r.Book.FindRarities {
		weights[i] = int64(r.Chance)
	}
	at := g.r.draw.Pick(weights, "game.find-rarity", draw.Str(c.C.ID), draw.Int(t))
	for i := at; i >= 0; i-- {
		r := g.r.Book.FindRarities[i]
		if f, ok := g.fromPool(c, h, r.ID, tr.Magnitude); ok {
			f.Trigger, f.Chance = TrigSpoils, r.Chance
			k := ledger.SubKey(key, "spoils", h.Ref())
			if r.ID == rarityUncommon && g.pouchable(c) && g.r.draw.Roll(g.trigger(TrigPouch).Chance, "game.pouch", draw.Str(c.C.ID), draw.Int(t)) {
				return g.pouched(c, h, k, f, g.tierAt(h), t)
			}
			return g.found(c, h, k, f, t)
		}
	}
	return nil
}

// fromPool is what a rarity takes from a tile's pool: materials of the
// tile's tier, or one tier up, or an item lying there, or one whose
// record names whoever lost it.
func (g *Game) fromPool(c *Char, h hex.Hex, rarity string, most int64) (Find, bool) {
	tier := g.tierAt(h)
	switch rarity {
	case rarityCommon, rarityUncommon:
		want := tier
		if rarity == rarityUncommon {
			want++
		}
		var goods []item.Spoil
		for _, b := range g.Ledger.Held(poolOf(h)) {
			m, ok := ledger.MaterialOf(b.Asset)
			if mt, known := g.r.Fight.D.Material(m); ok && known && mt == want && most > 0 {
				n := min(b.Units, most)
				goods = item.AddSpoil(goods, m, n)
				most -= n
			}
		}
		return Find{Rarity: rarity, Goods: goods}, len(goods) > 0
	case rarityRare, rarityStoried:
		for _, l := range g.Left {
			if l.Hex == h && !l.Hidden && (rarity == rarityRare || l.By != c.C.ID) {
				f := Find{Rarity: rarity, Item: l.Item.ID}
				if rarity == rarityStoried {
					f.By = l.By
				}
				return f, true
			}
		}
	}
	return Find{}, false
}

// tierAt is the tier of the region a tile lies in, at least the first.
func (g *Game) tierAt(h hex.Hex) int64 {
	if r := g.World.RegionAt(h); r >= 0 {
		return max(1, g.World.Regions[r].Tier)
	}
	return 1
}

// found moves a find out of the tile's pool to the character, as a fact
// naming its trigger, rarity and chance. Nothing is minted.
func (g *Game) found(c *Char, h hex.Hex, key string, f Find, t int64) error {
	return g.foundIn(c, h, poolOf(h), key, f, t)
}

// foundIn is found from a given pool on the tile: its own, or a floor's.
func (g *Game) foundIn(c *Char, h hex.Hex, pool, key string, f Find, t int64) error {
	acc := ledger.Char(c.C.ID)
	var legs []ledger.Leg
	for _, s := range f.Goods {
		legs = append(legs, ledger.Pair(pool, acc, ledger.Material(s.Material), s.Qty)...)
	}
	if f.Item != "" {
		i := slices.IndexFunc(g.Left, func(l *Left) bool { return l.Item.ID == f.Item })
		in := g.Left[i].Item
		c.C.Pack = append(c.C.Pack, in)
		g.Left = slices.Delete(g.Left, i, i+1)
		legs = append(legs, itemLegs(in, poolOf(h), acc)...)
	}
	data := append([]fact.Datum{fact.S("trigger", f.Trigger), fact.S("rarity", f.Rarity), fact.N("chance", f.Chance.Of(fixed.Hundredths)),
		fact.N("goods", item.Total(f.Goods))}, fact.At(h)...)
	if _, n, ok := ledger.FloorOf(pool); ok {
		data = append(data, fact.N("floor", n))
	}
	if f.Item != "" {
		data = append(data, fact.S("item", f.Item))
	}
	ff, err := g.fact(c, "find.made", t, data...)
	if err != nil {
		return err
	}
	if err := g.receive(c, ledger.Txn{Key: key, Kind: "find", Tick: t, Fact: ff.ID, Legs: legs}); err != nil {
		return err
	}
	c.Finds = append(c.Finds, f)
	return nil
}

// itemLegs move an item, and the exploit loaded in it, between accounts.
func itemLegs(in *item.Instance, from, to string) []ledger.Leg {
	legs := ledger.Pair(from, to, ledger.Item(in.ID), 1)
	if in.Exploit != nil {
		legs = append(legs, ledger.Pair(from, to, ledger.Item(in.Exploit.ID), 1)...)
	}
	return legs
}

// drop leaves a lost encounter's dropped haul in the tile's pool, or the
// floor's on a dungeon's floor, and remembers it was this character's
// (GDD 4.9, 5.6, 8.6).
func (g *Game) drop(c *Char, key string, lost []item.Spoil, t int64) error {
	if len(lost) == 0 {
		return nil
	}
	h, n := c.C.At, c.C.Floor
	pool := poolOf(h)
	if n > 0 {
		pool = ledger.FloorPool(h.Ref(), n)
	}
	var legs []ledger.Leg
	for _, s := range lost {
		legs = append(legs, ledger.Pair(ledger.FromHaul, pool, ledger.Material(s.Material), s.Qty)...)
	}
	if err := g.post(ledger.Txn{Key: ledger.SubKey(key, "dropped"), Kind: "dropped", Tick: t, Legs: legs}); err != nil {
		return err
	}
	g.remember(c, h, n, lost)
	return nil
}

// stash hides a carried item on the tile; a rumour of it spreads as a
// fact others can hear (GDD 8.6, The cache).
func (g *Game) stash(c *Char, cmd Command) error {
	if err := free(c); err != nil {
		return err
	}
	in, err := unworn(c, cmd.Item)
	if err != nil {
		return err
	}
	h := c.C.At
	if err := g.post(ledger.Txn{Key: cmd.Key, Kind: "cache", Tick: g.Tick(), Legs: itemLegs(in, ledger.Char(c.C.ID), poolOf(h))}); err != nil {
		return err
	}
	c.C.Drop(in.ID)
	g.Left = append(g.Left, &Left{Hex: h, By: c.C.ID, Hidden: true, Item: in})
	_, err = g.fact(c, "item.cached", g.Tick(), append([]fact.Datum{fact.S("item", in.ID)}, fact.At(h)...)...)
	return err
}

// CacheRumour is the rumour that names a tile's cache.
func CacheRumour(h hex.Hex) string { return "cache:" + h.Ref() }

func (g *Game) cacheAt(h hex.Hex) int {
	return slices.IndexFunc(g.Left, func(l *Left) bool { return l.Hex == h && l.Hidden })
}

// CanSearch reports whether a character who heard of a cache here may
// search for it.
func (g *Game) CanSearch(c *Char, h hex.Hex) bool {
	return slices.Contains(c.C.Rumours, CacheRumour(h)) && g.cacheAt(h) >= 0
}

func (g *Game) search(c *Char, cmd Command) error {
	if err := free(c); err != nil {
		return err
	}
	h := c.C.At
	if !g.CanSearch(c, h) {
		return refuse(NotHere, "nothing here you have heard of")
	}
	i := g.cacheAt(h)
	c.C.Rumours = slices.DeleteFunc(c.C.Rumours, func(r string) bool { return r == CacheRumour(h) })
	tr := g.trigger(TrigCache)
	return g.found(c, h, cmd.Key, Find{Trigger: TrigCache, Rarity: rarityRare, Chance: tr.Chance, Item: g.Left[i].Item.ID}, g.Tick())
}

// Trail is someone who passed a tile recently, and where they are now.
type Trail struct {
	Who  string  `json:"who"`
	Tick int64   `json:"tick"`
	Now  hex.Hex `json:"now"`
}

// Trails are the tracks on a tile within the trigger's window, newest
// first, that a character can follow to where their maker stands now.
func (g *Game) Trails(c *Char, h hex.Hex) []Trail {
	tl := g.World.Tile(h)
	if tl == nil {
		return nil
	}
	w := g.trackWindow(c)
	var out []Trail
	for i := len(tl.Tracks) - 1; i >= 0; i-- {
		k := tl.Tracks[i]
		if k.Who.Kind != char.Ref(c.C.ID).Kind || k.Who.ID == c.C.ID || g.Tick()-k.Tick > w {
			continue
		}
		if o := g.Char(k.Who.ID); o != nil && o.C.At != h && !slices.ContainsFunc(out, func(x Trail) bool { return x.Who == k.Who.ID }) {
			out = append(out, Trail{Who: k.Who.ID, Tick: k.Tick, Now: o.C.At})
		}
	}
	return out
}

// lowWater is what crossing a river under drought costs, when the
// trigger makes it cheaper (GDD 8.6, Low water).
func (g *Game) lowWater(to hex.Hex, cost int64) (int64, bool) {
	b := g.r.Gen.Baseline(to)
	if !b.River || b.Water == gen.WaterFord {
		return cost, false
	}
	tr := g.trigger(TrigLowWater)
	if !g.World.Place(to).Has(tags.Tag(tr.Tag)) || cost <= tr.Magnitude {
		return cost, false
	}
	return tr.Magnitude, true
}

// oldFriends reports whether an encounter's members are a party of two
// either of whom once rescued the other (GDD 8.6, Old friends): from the
// Company ring, or from a call for help one carried the other home on,
// which a later meeting cannot push out.
func (g *Game) oldFriends(members []*Char) bool {
	if len(members) != oldFriendsSize {
		return false
	}
	a, b := members[0], members[1]
	return rescued(a, b) || rescued(b, a) || g.carriedHome(a, b) || g.carriedHome(b, a)
}

// structural: old friends are a party of exactly two.
const oldFriendsSize = 2

func rescued(a, b *Char) bool {
	return slices.ContainsFunc(a.C.Company, func(m char.Met) bool {
		return m.Who == b.C.ID && (m.How == char.MetRescued || m.How == char.MetRescuedBy)
	})
}

// carriedHome reports whether a carried b home on b's call for help.
func (g *Game) carriedHome(a, b *Char) bool {
	return slices.ContainsFunc(g.Goals, func(x *Goal) bool {
		return x.Cond.Verb == goal.Carry && x.Cond.Who == b.C.ID && x.State == goal.Done &&
			slices.ContainsFunc(x.Claims, func(cl goal.Claim) bool { return cl.Who == a.C.ID })
	})
}

// partyTrigger runs the triggers of a party encounter's start (on: party):
// old friends put their tag on the site. It is safe to run twice for one
// site.
func (g *Game) partyTrigger(c *Char, members []*Char, site *fight.Site) error {
	tag := g.oldFriendsTag()
	if !g.oldFriends(members) || slices.Contains(site.Tags, tag[0]) {
		return nil
	}
	site.Tags = append(site.Tags, tag...)
	_, err := g.fact(c, "trigger.fired", g.Tick(), fact.S("trigger", TrigOldFriends))
	return err
}

// oldFriendsTag is the site tag old-friends sets, for a rule to read.
func (g *Game) oldFriendsTag() []tags.Tag {
	if t := g.trigger(TrigOldFriends).Tag; t != "" {
		return []tags.Tag{tags.Tag(t)}
	}
	return []tags.Tag{tags.Tag(TrigOldFriends)}
}

// encounterTags are what the explore triggers add: the nemesis on the
// creature, high ground on the place.
func (g *Game) encounterTags(c *Char, h hex.Hex, arch string) (creature, place []tags.Tag) {
	if c.C.Fights.Nemesis() == arch {
		creature = append(creature, tags.Tag(g.trigger(TrigNemesis).Tag))
	}
	if n := len(c.C.Trail); n >= cameFrom {
		from := c.C.Trail[n-cameFrom]
		tr := g.trigger(TrigHigh)
		if g.r.Gen.Baseline(h).Elevation-g.r.Gen.Baseline(from).Elevation >= tr.Magnitude {
			place = append(place, tags.Tag(tr.Tag))
		}
	}
	return creature, place
}

// structural: the tile walked from is second from the end of the trail,
// which ends with the tile stood on.
const cameFrom = 2

// thin reports whether a tile's creatures are under the thin-herds line
// and the draw says nothing shows. The draw holds for the tick, so
// exploring again waits for the next one.
func (g *Game) thin(c *Char, h hex.Hex) bool {
	tr := g.trigger(TrigThin)
	var n, capacity int64
	for _, sp := range g.Creatures(h) {
		n += g.World.Population(h, sp)
		capacity += g.World.Capacity(h, sp)
	}
	return !fixed.AtPercent(n, capacity, tr.Magnitude) && g.r.draw.Roll(tr.Chance, "game.thin", draw.Str(c.C.ID), draw.Str(h.Ref()), draw.Int(g.Tick()))
}

// nameKind gives a kind its plain generated name the first time it is
// made (GDD 9.10).
func (g *Game) nameKind(k *item.Kind, by string) {
	if g.Kinds.Name(k.ID) != "" {
		return
	}
	g.Kinds.SetName(k.ID, g.plainName(k.Recipe), by)
}

// plainName is a recipe's plain name: its leading material and its slot,
// or its process when it has none.
func (g *Game) plainName(r item.Recipe) string {
	lead, most := "", int64(-1)
	for _, in := range r.Inputs {
		if in.Qty > most {
			lead, most = in.Kind, in.Qty
		}
	}
	what := g.r.names["items.slots:"+r.Slot]
	if r.Slot == "" {
		what = g.r.names["items.processes:"+r.Process]
	}
	m := g.sheetMaterialName(lead)
	if m == "" {
		m = g.Kinds.Name(lead)
	}
	return strings.TrimSpace(m + " " + strings.ToLower(what))
}

// Name is what the setting calls a sheet row, by "sheet:id".
func (r *Rules) Name(ref string) string { return r.names[ref] }
