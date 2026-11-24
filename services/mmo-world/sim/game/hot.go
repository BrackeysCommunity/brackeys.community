package game

import (
	"slices"
	"strings"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/econ"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
)

// Hot goods (GDD 6.5): a material's hot units are its live lots, at most
// what the character holds. Every outflow takes clean units first, so a
// lot only shrinks once the clean units are gone; lots past what is held
// are trimmed oldest first.

// hotCell is a theft.params cell.
func (g *Game) hotCell(id string) int64 { return sheets.IntParam(g.r.Book.TheftParams, id) }

// hotMark is the mark goods stolen from a victim at h carry from t.
func (g *Game) hotMark(victim, faction string, h hex.Hex, t int64) item.Hot {
	return item.Hot{Victim: victim, Faction: faction, Ends: t/sheets.TicksPerDay + g.hotCell("hot-days"), At: h.Ref()}
}

// hotHeld is how many units of a material a character holds.
func (g *Game) hotHeld(c *Char, material string) int64 {
	return g.Ledger.Of(ledger.Char(c.C.ID), ledger.Goods(material))
}

// markHot puts goods the character now holds under a mark; marking goods
// before they arrive loses the mark to the trim that follows.
func (g *Game) markHot(c *Char, goods []item.Spoil, mark item.Hot) {
	for _, s := range goods {
		if s.Qty <= 0 {
			continue
		}
		a := c.C.Align()
		if n := len(a.Hot); n > 0 && a.Hot[n-1].Material == s.Material && a.Hot[n-1].Mark == mark {
			a.Hot[n-1].Units += s.Qty
		} else {
			a.Hot = append(a.Hot, char.HotLot{Material: s.Material, Units: s.Qty, Mark: mark})
		}
		g.touchOnce(c)
	}
}

// trimHot drops lots whose mark has run out and cuts a material's lots,
// oldest first, to most units.
func trimHot(c *Char, material string, most, day int64) {
	a := c.C.Alignment
	if a == nil || len(a.Hot) == 0 {
		return
	}
	var sum int64
	for _, l := range a.Hot {
		if l.Material == material && l.Mark.HotOn(day) {
			sum += l.Units
		}
	}
	over := sum - max(most, 0)
	for i := range a.Hot {
		l := &a.Hot[i]
		if over <= 0 {
			break
		}
		if l.Material == material && l.Mark.HotOn(day) {
			cut := min(over, l.Units)
			l.Units -= cut
			over -= cut
		}
	}
	a.Hot = slices.DeleteFunc(a.Hot, func(l char.HotLot) bool { return l.Units <= 0 || !l.Mark.HotOn(day) })
	if len(a.Hot) == 0 {
		a.Hot = nil
	}
}

// liveLots are a material's live lots as they stand once trimmed to what
// is held, a copy.
func (g *Game) liveLots(c *Char, material string, day int64) []char.HotLot {
	var out []char.HotLot
	for _, l := range char.HotLotsOf(c.C) {
		if l.Material == material && l.Mark.HotOn(day) && l.Units > 0 {
			out = append(out, l)
		}
	}
	if len(out) == 0 {
		return nil
	}
	over := -g.hotHeld(c, material)
	for _, l := range out {
		over += l.Units
	}
	for i := range out {
		if over <= 0 {
			break
		}
		cut := min(over, out[i].Units)
		out[i].Units -= cut
		over -= cut
	}
	return slices.DeleteFunc(out, func(l char.HotLot) bool { return l.Units <= 0 })
}

// HotUnits is how many of the units of a material a character holds are hot.
func (g *Game) HotUnits(c *Char, material string, day int64) int64 {
	var n int64
	for _, l := range g.liveLots(c, material, day) {
		n += l.Units
	}
	return n
}

// nearTheft reports whether a mark's theft lies within hot-reach of h.
func (g *Game) nearTheft(m item.Hot, h hex.Hex) bool {
	at, ok := hex.ParseRef(m.At)
	return ok && hex.Distance(at, h) <= g.hotCell("hot-reach")
}

// barredBy is what keeps hot units from a buyer or a place: the victim's
// own faction key, and any market within hot-reach of the theft.
func (g *Game) barredBy(faction string, near *hex.Hex) func(item.Hot) bool {
	return func(m item.Hot) bool {
		return (faction != "" && m.Faction == faction) || (near != nil && g.nearTheft(m, *near))
	}
}

// anyMark bars every hot unit.
func anyMark(item.Hot) bool { return true }

// hotFor is how many hot units of a material are barred from a buyer under
// a faction key, or from a market at near.
func (g *Game) hotFor(c *Char, material string, faction string, near hex.Hex, day int64) int64 {
	return g.hotBarred(c, material, day, g.barredBy(faction, &near))
}

// hotBarred is how many hot units of a material a rule bars.
func (g *Game) hotBarred(c *Char, material string, day int64, barred func(item.Hot) bool) int64 {
	var n int64
	for _, l := range g.liveLots(c, material, day) {
		if barred(l.Mark) {
			n += l.Units
		}
	}
	return n
}

// hotGuard refuses sending units of a material where a rule bars the hot
// units the clean ones cannot cover.
func (g *Game) hotGuard(c *Char, material string, units, day int64, barred func(item.Hot) bool) error {
	if g.hotHeld(c, material)-g.hotBarred(c, material, day, barred) < units {
		return refuse(HotGoods, "%s's %s is hot: it cannot go there yet", c.C.ID, material)
	}
	return nil
}

// consumeHot takes units of a material about to leave the character out of
// its clean units first, then its lots oldest first, and returns the parts
// of lots that leave. Call it before the units leave.
func (g *Game) consumeHot(c *Char, material string, units int64, day int64) []char.HotLot {
	return g.consumeHotBut(c, material, units, day, nil)
}

// consumeHotBut is consumeHot taking lots a rule bars only last.
func (g *Game) consumeHotBut(c *Char, material string, units, day int64, barred func(item.Hot) bool) []char.HotLot {
	a := c.C.Alignment
	if a == nil || len(a.Hot) == 0 || units <= 0 {
		return nil
	}
	held := g.hotHeld(c, material)
	trimHot(c, material, held, day)
	var hot int64
	for _, l := range a.Hot {
		if l.Material == material {
			hot += l.Units
		}
	}
	take := units - (held - hot)
	if take <= 0 {
		return nil
	}
	var out []char.HotLot
	for _, last := range []bool{false, true} {
		for i := range a.Hot {
			l := &a.Hot[i]
			if take <= 0 || l.Material != material || l.Units <= 0 || (barred != nil && barred(l.Mark) != last) || (barred == nil && last) {
				continue
			}
			cut := min(take, l.Units)
			l.Units -= cut
			take -= cut
			out = append(out, char.HotLot{Material: material, Units: cut, Mark: l.Mark})
		}
	}
	trimHot(c, material, held, day)
	g.touchOnce(c)
	return out
}

// passHot hands the hot part of units of a material one character gives
// another to the receiver as lots (GDD 6.5: no laundering through a
// friend). Call it before the units move and what it returns after.
func (g *Game) passHot(from, to *Char, material string, units, day int64) (after func()) {
	lots := g.consumeHot(from, material, units, day)
	return func() {
		for _, l := range lots {
			g.markHot(to, []item.Spoil{{Material: l.Material, Qty: l.Units}}, l.Mark)
		}
	}
}

// heldWas is what a character carrying lots of a material held of it
// before a transaction.
type heldWas struct {
	c        *Char
	material string
	held     int64
}

// heldBefore notes what each character a transaction touches holds of
// each material it carries lots of, so hotSettled can trim after it.
func (g *Game) heldBefore(t ledger.Txn) []heldWas {
	var out []heldWas
	for _, l := range t.Legs {
		m, ok := ledger.MaterialOf(l.Asset)
		if !ok {
			continue
		}
		c := g.charOf(l.Account)
		if c == nil || len(char.HotLotsOf(c.C)) == 0 ||
			slices.ContainsFunc(out, func(h heldWas) bool { return h.c == c && h.material == m }) {
			continue
		}
		out = append(out, heldWas{c, m, g.Ledger.Of(l.Account, l.Asset)})
	}
	return out
}

// hotSettled trims lots to what is held after a transaction, and to what
// was held before it, so units that left by a path that took no lots
// were the clean ones and units that came in are clean.
func (g *Game) hotSettled(before []heldWas) {
	day := g.Tick() / sheets.TicksPerDay
	for _, h := range before {
		trimHot(h.c, h.material, min(h.held, g.hotHeld(h.c, h.material)), day)
	}
}

// HotView is one hot lot or item a character carries.
type HotView struct {
	Material string // a lot's material
	Item     string // an item's id
	Units    int64
	Victim   string
	Faction  string
	At       hex.Hex // the theft's tile
	Ends     int64   // the first clean world day
	Days     int64   // world days left
	Reach    int64   // tiles from the character to the theft
}

// HotGoods are the hot lots and items a character carries, live marks only.
func (g *Game) HotGoods(c *Char) []HotView {
	day := g.Tick() / sheets.TicksPerDay
	view := func(m item.Hot) HotView {
		at, _ := hex.ParseRef(m.At)
		return HotView{Victim: m.Victim, Faction: m.Faction, At: at, Ends: m.Ends, Days: m.Ends - day, Reach: hex.Distance(at, c.C.At)}
	}
	var out []HotView
	var seen []string
	for _, l := range char.HotLotsOf(c.C) {
		if slices.Contains(seen, l.Material) {
			continue
		}
		seen = append(seen, l.Material)
		for _, x := range g.liveLots(c, l.Material, day) {
			if n := len(out); n > 0 && out[n-1].Material == x.Material && out[n-1].Victim == x.Mark.Victim && out[n-1].Ends == x.Mark.Ends && out[n-1].At.Ref() == x.Mark.At {
				out[n-1].Units += x.Units
				continue
			}
			v := view(x.Mark)
			v.Material, v.Units = x.Material, x.Units
			out = append(out, v)
		}
	}
	for _, in := range c.C.Pack {
		if in.Hot.HotOn(day) {
			v := view(*in.Hot)
			v.Item, v.Units = in.ID, 1
			out = append(out, v)
		}
	}
	return out
}

// hotItemGuard refuses an item whose mark bars it from a market at h or a
// buyer under a faction key.
func (g *Game) hotItemGuard(in *item.Instance, faction string, h hex.Hex) error {
	if in.Hot.HotOn(g.Tick()/sheets.TicksPerDay) && g.barredBy(faction, &h)(*in.Hot) {
		return refuse(HotGoods, "%s is hot: it cannot be sold here yet", in.ID)
	}
	return nil
}

// marketBarred is what keeps hot units of a material out of an order at a
// market: the theft within hot-reach, or a faction bidding on that book
// whose goods they were.
func (g *Game) marketBarred(n int, material string) func(item.Hot) bool {
	h := g.SettlementHex(n)
	var keys []string
	if b := g.BookOf(n, material); b != nil {
		for _, o := range b.Bids {
			if o.Faction != nil {
				keys = append(keys, standingKey(*o.Faction, h))
			}
		}
	}
	return func(m item.Hot) bool {
		return g.nearTheft(m, h) || (m.Faction != "" && slices.Contains(keys, m.Faction))
	}
}

// Stores: what a faction buys or a caravan brings in, a
// material at a time, is kept in its store up to store-kept units and
// the rest is eaten, in the one transaction.

// storeLegs move units of an asset from an account to a faction: into
// its store while it keeps fewer than store-kept of it, the rest into the
// faction sink. The keepers keep no store, and no store keeps provisions.
func (g *Game) storeLegs(from string, fi int, asset string, units int64) []ledger.Leg {
	_, isMat := ledger.MaterialOf(asset)
	var kept int64
	if isMat && fi >= 0 && fi < len(g.World.Factions) && units > 0 {
		kept = min(units, max(g.hotCell("store-kept")-g.Ledger.Of(ledger.StorePool(fi), asset), 0))
	}
	var legs []ledger.Leg
	if kept > 0 {
		legs = ledger.Pair(from, ledger.StorePool(fi), asset, kept)
	}
	if rest := units - kept; rest > 0 {
		legs = append(legs, ledger.Pair(from, ledger.ToFaction, asset, rest)...)
	}
	return legs
}

// holderAt is the faction holding a tile's region, or econ.Keepers.
func (g *Game) holderAt(h hex.Hex) int {
	if r := g.World.RegionAt(h); r >= 0 && g.World.Regions[r].Holder >= 0 {
		return g.World.Regions[r].Holder
	}
	return econ.Keepers
}

// Wanted and the watch.

// wantedAt are the indices of a character's live Wanted entries that
// apply at settlement n: the theft's own, and any open settlement whose
// region the victim's faction holds (GDD 5.5).
func (g *Game) wantedAt(c *Char, n int, t int64) []int {
	if !g.placeStands(n) {
		return nil
	}
	holder := g.holderAt(g.SettlementHex(n))
	var out []int
	for i, w := range char.WantedOf(c.C) {
		if w.Ends <= t {
			continue
		}
		fi, _, ok := parseStandingKey(w.Faction)
		if w.Place == n || (ok && fi >= 0 && fi == holder) {
			out = append(out, i)
		}
	}
	return out
}

// settling is what clearing a set of Wanted entries moves: the goods and
// items still held back to where they came from, lifted coin back to the
// purse, and the fine.
type settling struct {
	legs   []ledger.Leg
	items  []*item.Instance
	relist []relisted
	lots   []char.HotLot // what leaves the character's lots
	coin   int64         // lifted coin returned
	fine   int64
	units  int64 // goods and items returned
	causes []fact.ID
}

// relisted is a returned item that goes back up on its owner's listing.
type relisted struct {
	in  *item.Instance
	npc string
	n   int
}

// settleWanted works out what clearing entries moves, changing nothing.
// With fined unset, nothing but the goods and items goes back.
func (g *Game) settleWanted(c *Char, idx []int, fined bool, t int64) settling {
	day := t / sheets.TicksPerDay
	acc := ledger.Char(c.C.ID)
	ws := char.WantedOf(c.C)
	var s settling
	type lotKey struct{ victim, material string }
	taken := map[lotKey]int64{} // units of a victim's lots already returned
	for _, i := range idx {
		w := ws[i]
		if w.Fact > 0 && !slices.Contains(s.causes, fact.ID(w.Fact)) {
			s.causes = append(s.causes, fact.ID(w.Fact))
		}
		var all, gone int64
		for _, gd := range w.Goods {
			all += gd.Qty
			k := lotKey{w.Victim, gd.Material}
			held := g.victimUnits(c, gd.Material, w.Victim, day) - taken[k]
			back := min(gd.Qty, max(held, 0))
			gone += gd.Qty - back
			if back <= 0 {
				continue
			}
			taken[k] += back
			s.units += back
			s.lots = append(s.lots, char.HotLot{Material: gd.Material, Units: back, Mark: item.Hot{Victim: w.Victim}})
			s.legs = append(s.legs, ledger.Pair(acc, g.returnAccount(w), ledger.Goods(gd.Material), back)...)
		}
		for _, id := range w.Items {
			all++
			in := c.C.Item(id)
			if in == nil || slices.Contains(s.items, in) {
				gone++
				continue
			}
			s.units++
			s.items = append(s.items, in)
			s.legs = append(s.legs, g.itemBack(c, w, in, &s)...)
		}
		if fined {
			s.coin += w.Coin
			if npcID, ok := victimNPC(w.Victim); ok && w.Coin > 0 {
				s.legs = append(s.legs, ledger.Pair(acc, ledger.NPCPool(npcID), ledger.Coin, w.Coin)...)
			}
			s.fine += w.Worth
			if all > 0 {
				s.fine += fixed.Ratio((w.Worth-w.Coin)*gone, all).Int()
			}
		}
	}
	if s.fine > 0 {
		s.legs = append(s.legs, ledger.Pair(acc, ledger.ToFees, ledger.Coin, s.fine)...)
	}
	return s
}

// victimUnits is how many units of a material a character holds under
// lots naming a victim.
func (g *Game) victimUnits(c *Char, material, victim string, day int64) int64 {
	var n int64
	for _, l := range g.liveLots(c, material, day) {
		if l.Mark.Victim == victim {
			n += l.Units
		}
	}
	return n
}

// returnAccount is where goods taken from a victim go back to: the
// account they left, or for a caravan that has since ended its
// destination faction's store.
func (g *Game) returnAccount(w char.Wanted) string {
	switch {
	case ledger.IsCaravan(w.Source):
		id := strings.TrimPrefix(w.Source, ledger.CaravanPool(""))
		if g.castCaravan(id) != nil {
			return w.Source
		}
		if fi, _, ok := parseStandingKey(w.Faction); ok && fi >= 0 && fi < len(g.World.Factions) {
			return ledger.StorePool(fi)
		}
		return ledger.ToFaction
	case ledger.IsStore(w.Source):
		return w.Source
	}
	if id, ok := victimNPC(w.Victim); ok {
		return ledger.NPCPool(id)
	}
	return w.Source
}

// itemBack is the legs that return a lifted item: back on a listing of
// its owner's at the theft's market where there is one, so it stays
// booked to the NPC and on the market, else into its purse.
func (g *Game) itemBack(c *Char, w char.Wanted, in *item.Instance, s *settling) []ledger.Leg {
	acc := ledger.Char(c.C.ID)
	id, isNPC := victimNPC(w.Victim)
	if isNPC && g.Market != nil && g.placeIndex(w.Place) {
		if n, ok := g.MarketAt(g.SettlementHex(w.Place)); ok && n == w.Place {
			s.relist = append(s.relist, relisted{in: in, npc: id, n: n})
			return nil
		}
	}
	if isNPC {
		return itemLegs(in, acc, ledger.NPCPool(id))
	}
	return itemLegs(in, acc, g.returnAccount(w))
}

// victimNPC is the NPC a victim ref names.
func victimNPC(victim string) (string, bool) {
	r, ok := fact.ParseRef(victim)
	if !ok || r.Kind != npc.Ref("").Kind {
		return "", false
	}
	return r.ID, true
}

// payOff pays the watch at settlement n: the goods and
// items still held go back, lifted coin goes back to the purse, and the
// haul's worth, plus the worth of what is gone, is the fine into the fees
// sink. Every entry that applies there ends; one short of coin pays
// nothing.
func (g *Game) payOff(c *Char, n int, key string, t int64) error {
	idx := g.wantedAt(c, n, t)
	if len(idx) == 0 {
		return refuse(BadArgs, "the watch here wants nothing of %s", c.C.ID)
	}
	s := g.settleWanted(c, idx, true, t)
	if have := g.balance(c, ledger.Coin); have < s.coin+s.fine {
		return refuse(ShortCode, "the watch asks %d coin of %s, who has %d", s.coin+s.fine, c.C.ID, have)
	}
	h := g.SettlementHex(n)
	fid, err := g.worldFact(h, factWatchPaid, []fact.Ref{char.Ref(c.C.ID)}, s.causes, append([]fact.Datum{fact.N("settlement", int64(n)),
		fact.N("fine", s.fine), fact.N("coin", s.coin), fact.N("units", s.units)}, fact.At(h)...)...)
	if err != nil {
		return err
	}
	return g.cleared(c, idx, s, "fine", key, fid, n, t)
}

// takeBack is the watch catching a character that fled at settlement n:
// the goods and items still held go back with no fine and
// no coin, and every entry that applies there ends.
func (g *Game) takeBack(c *Char, n int, key string, cause fact.ID, t int64) error {
	idx := g.wantedAt(c, n, t)
	if len(idx) == 0 {
		return nil
	}
	return g.cleared(c, idx, g.settleWanted(c, idx, false, t), "caught", key, cause, n, t)
}

// cleared posts a settling and ends its entries.
func (g *Game) cleared(c *Char, idx []int, s settling, kind, key string, fid fact.ID, n int, t int64) error {
	day := t / sheets.TicksPerDay
	a := c.C.Align()
	old := slices.Clone(a.Hot)
	for _, l := range s.lots {
		g.takeLots(c, l.Material, l.Mark.Victim, l.Units, day)
	}
	for _, in := range s.items {
		in.Hot = nil
	}
	if len(s.legs) > 0 {
		if err := g.postAll(ledger.Txn{Key: key, Kind: kind, Tick: t, Fact: fid, Legs: ledger.Merge(s.legs)}, s.items...); err != nil {
			a.Hot = old
			return err
		}
	}
	for i, r := range s.relist {
		if err := g.relist(c, r, ledger.SubKey(key, "relist", i64(int64(i)))); err != nil {
			return err
		}
	}
	var keep []char.Wanted
	for i, w := range a.Wanted {
		if !slices.Contains(idx, i) && w.Ends > t {
			keep = append(keep, w)
		}
	}
	a.Wanted = keep
	if a.Stopped == n+1 {
		a.Stopped = 0
	}
	g.wantedCondition(c)
	g.touchOnce(c)
	return nil
}

// relist puts a returned item back on its owner's listing at its market.
func (g *Game) relist(c *Char, r relisted, key string) error {
	purse := ledger.NPCPool(r.npc)
	l := g.newListing(r.n, purse, r.in, fixed.PercentOf(g.ItemValue(r.in), g.mp("trader-sells")))
	if err := g.postAll(ledger.Txn{Key: key, Kind: "return", Tick: g.Tick(), Legs: itemLegs(r.in, ledger.Char(c.C.ID), ledger.EscrowPool(l.ID))}, r.in); err != nil {
		return err
	}
	g.Market.Listings = append(g.Market.Listings, l)
	g.Market.opened(l.Seller, 1)
	return nil
}

// takeLots takes units of a material out of the lots naming a victim,
// oldest first.
func (g *Game) takeLots(c *Char, material, victim string, units, day int64) {
	a := c.C.Alignment
	if a == nil {
		return
	}
	trimHot(c, material, g.hotHeld(c, material), day)
	for i := range a.Hot {
		l := &a.Hot[i]
		if units <= 0 {
			break
		}
		if l.Material == material && l.Mark.Victim == victim {
			cut := min(units, l.Units)
			l.Units -= cut
			units -= cut
		}
	}
	a.Hot = slices.DeleteFunc(a.Hot, func(l char.HotLot) bool { return l.Units <= 0 })
	if len(a.Hot) == 0 {
		a.Hot = nil
	}
}

// wantedCondition runs the wanted condition to the latest live entry's
// end, or clears it.
func (g *Game) wantedCondition(c *Char) {
	var ends int64
	for _, w := range char.WantedOf(c.C) {
		ends = max(ends, w.Ends)
	}
	if ends > g.Tick() {
		c.C.Set(char.WantedCondition, ends)
		return
	}
	c.C.Clear(char.WantedCondition)
}

// returnTo gives back to a victim NPC what a character took from it:
// its hot goods and items to the purse, or an item back on
// its listing, and the coin lifted from it. The lots clear; the Wanted
// entries stay until paid or run out, holding only what was not given
// back.
func (g *Game) returnTo(c *Char, victim, key string, t int64) error {
	id, ok := victimNPC(victim)
	if !ok {
		return refuse(BadArgs, "%s is not someone to give back to", victim)
	}
	day := t / sheets.TicksPerDay
	acc, purse := ledger.Char(c.C.ID), ledger.NPCPool(id)
	var legs []ledger.Leg
	var lots []char.HotLot
	var items []*item.Instance
	var seen []string
	for _, l := range char.HotLotsOf(c.C) {
		if slices.Contains(seen, l.Material) {
			continue
		}
		seen = append(seen, l.Material)
		if n := g.victimUnits(c, l.Material, victim, day); n > 0 {
			lots = append(lots, char.HotLot{Material: l.Material, Units: n})
			legs = append(legs, ledger.Pair(acc, purse, ledger.Goods(l.Material), n)...)
		}
	}
	var relist []relisted
	n, atMarket := g.MarketAt(c.C.At)
	atMarket = atMarket && g.Market != nil
	for _, in := range c.C.Pack {
		if in.Hot.HotOn(day) && in.Hot.Victim == victim {
			items = append(items, in)
			if atMarket {
				relist = append(relist, relisted{in: in, npc: id, n: n})
			} else {
				legs = append(legs, itemLegs(in, acc, purse)...)
			}
		}
	}
	var coin int64
	for _, w := range char.WantedOf(c.C) {
		if w.Victim == victim {
			coin += w.Coin
		}
	}
	if coin > 0 {
		if have := g.balance(c, ledger.Coin); have < coin {
			return refuse(ShortCode, "%s took %d coin from %s and has %d", c.C.ID, coin, id, have)
		}
		legs = append(legs, ledger.Pair(acc, purse, ledger.Coin, coin)...)
	}
	if len(lots) == 0 && len(items) == 0 && coin == 0 {
		return refuse(BadArgs, "%s holds nothing of %s's", c.C.ID, id)
	}
	a := c.C.Align()
	old := slices.Clone(a.Hot)
	for _, l := range lots {
		g.takeLots(c, l.Material, victim, l.Units, day)
	}
	marks := make([]*item.Hot, len(items))
	for i, in := range items {
		marks[i], in.Hot = in.Hot, nil
	}
	if len(legs) > 0 {
		if err := g.postAll(ledger.Txn{Key: key, Kind: "return", Tick: t, Legs: ledger.Merge(legs)}, items...); err != nil {
			a.Hot = old
			for i, in := range items {
				in.Hot = marks[i]
			}
			return err
		}
	}
	for i, r := range relist {
		if err := g.relist(c, r, ledger.SubKey(key, "relist", i64(int64(i)))); err != nil {
			return err
		}
	}
	for i := range a.Wanted {
		w := &a.Wanted[i]
		if w.Victim != victim {
			continue
		}
		w.Coin = 0
		w.Items = slices.DeleteFunc(slices.Clone(w.Items), func(x string) bool {
			return slices.ContainsFunc(items, func(in *item.Instance) bool { return in.ID == x })
		})
		for j := range w.Goods {
			for k := range lots {
				if lots[k].Material == w.Goods[j].Material && lots[k].Units > 0 {
					cut := min(lots[k].Units, w.Goods[j].Qty)
					w.Goods[j].Qty -= cut
					lots[k].Units -= cut
				}
			}
		}
		w.Goods = slices.DeleteFunc(w.Goods, func(s item.Spoil) bool { return s.Qty <= 0 })
		if len(w.Items) == 0 {
			w.Items = nil
		}
		if len(w.Goods) == 0 {
			w.Goods = nil
		}
	}
	g.touchOnce(c)
	return nil
}

// noteBurglary counts a won burglary at settlement n, keeping only those
// within walls-days.
func (g *Game) noteBurglary(n int, t int64) {
	ps := g.placeStory(n)
	if ps == nil {
		return
	}
	from := t - g.hotCell("walls-days")*sheets.TicksPerDay
	ps.Burgled = append(slices.DeleteFunc(ps.Burgled, func(at int64) bool { return at <= from }), t)
}
