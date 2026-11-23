package game

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tally"
	"jams.team/mmo-world/sim/world"
)

// What the world does when a side wins or a stage, trouble or occasion
// ends (GDD 12.2, 12.10). Regions and factions change only through story
// actions applied in world.Advance; characters, places and the ledger
// change here.

// Why a hunt opened for the story.
const (
	WhyTrouble  = "trouble"
	WhyOccasion = "occasion"
)

// Effect kinds of story.arcs, story.troubles and their lapses.
const (
	effFortify     = "fortify"
	effFalls       = "holding-falls"
	effGauge       = "gauge"
	effSplit       = "split"
	effAppoint     = "appoint"
	effLoyalty     = "loyalty"
	effDefect      = "defect"
	effPeace       = "peace"
	effGrudge      = "grudge"
	effTrouble     = "trouble"
	effSpread      = "spread"
	effSeal        = "seal"
	effKeepOpen    = "keep-open"
	effCache       = "cache"
	effMend        = "mend"
	effStanding    = "standing"
	effDisposition = "disposition"
	effWithdraw    = "withdraw"
	effMarked      = "marked"
	effDamage      = "damage"
	effFees        = "fees"
	effOrdersStop  = "orders-stop"
	effPrices      = "prices"
	effSick        = "sick"
	effToll        = "toll"
	effCut         = "cut"
	effPatrolRoad  = "patrol-road"
	effCaravanOn   = "caravan-on"
	effSalvage     = "salvage"
	effCaravanLost = "caravan-lost"
	effLayLegend   = "lay-legend"
	effNothing     = "nothing"
)

// Facts the emergence effects write.
const (
	factRoadTolled  = "road.tolled"
	factCaravanLost = "caravan.lost"
	factLegendLaid  = "legend.laid"
)

// structural: the NPC memories a disposition leaves, and the holdings a
// faction needs to split in two.
const (
	entryHelped  = "helped"
	entryWronged = "wronged"
	splitLeast   = 2
)

// applyFrom runs effects in order; won is the side that won, if one did,
// and cause the fact the world's actions follow from.
func (g *Game) applyFrom(a *Arc, es []sheets.StoryEffect, won *SideRun, cause fact.ID, t int64) error {
	for i, e := range es {
		x := effect{g: g, a: a, e: e, won: won, cause: cause, t: t, key: ledger.SubKey("tick", i64(t), "arc", a.ID, itoa(a.Stage), "effect", itoa(i))}
		if err := x.run(); err != nil {
			return err
		}
	}
	return nil
}

// effect is one effect row in hand.
type effect struct {
	g     *Game
	a     *Arc
	e     sheets.StoryEffect
	won   *SideRun
	cause fact.ID
	t     int64
	key   string
}

func (x effect) run() error {
	switch x.e.Kind {
	case effFortify:
		x.fortify(x.e.Amount)
	case effFalls:
		x.falls()
	case effGauge:
		for _, r := range x.regions() {
			x.queue(world.Action{Kind: world.ActGauge, Hex: x.g.regionHex(r), Tag: x.e.Gauge, Units: x.e.Amount})
		}
	case effSplit:
		x.split()
	case effAppoint:
		if id, fi, ok := x.notable(); ok {
			x.queue(world.Action{Kind: world.ActAppoint, Hex: x.seat(fi), Species: id})
		}
	case effLoyalty:
		if id, fi, ok := x.notable(); ok && x.e.Amount != 0 {
			x.queue(world.Action{Kind: world.ActLoyalty, Hex: x.seat(fi), Species: id, Units: x.e.Amount})
		}
	case effDefect:
		x.defect()
	case effPeace:
		if fi, other, ok := x.pair(true); ok {
			x.queue(world.Action{Kind: world.ActPeace, Hex: x.seat(fi), Material: arc.FactionRef(other).ID})
		}
	case effGrudge:
		if fi, other, ok := x.pair(false); ok && x.e.Amount > 0 {
			x.queue(world.Action{Kind: world.ActGrudge, Hex: x.seat(fi), Material: arc.FactionRef(other).ID, Units: x.e.Amount})
		}
	case effTrouble:
		return x.trouble()
	case effSpread:
		x.spread()
	case effSeal:
		return x.seal()
	case effKeepOpen:
		x.keepOpen()
	case effCache:
		return x.cache()
	case effMend:
		x.mend()
	case effStanding:
		x.standing()
	case effDisposition:
		return x.disposition()
	case effWithdraw:
		return x.withdraw()
	case effMarked:
		return x.marked()
	case effDamage:
		return x.damage()
	case effFees, effOrdersStop, effPrices, effSick:
		x.stake()
	case effToll, effCut, effPatrolRoad:
		return x.roads()
	case effCaravanOn:
		if cv := x.caravan(); cv != nil {
			x.g.resumeCaravan(cv, x.t)
		}
	case effSalvage:
		return x.salvage()
	case effCaravanLost:
		return x.caravanLost()
	case effLayLegend:
		return x.layLegend()
	case effNothing:
	}
	return nil
}

// queue appends a story action for the next world step, naming the stage's
// end as its cause.
func (x effect) queue(act world.Action) {
	act.By, act.Cause = arcRef(x.a.ID), x.cause
	x.g.Pending = append(x.g.Pending, act)
}

// ref is the ref the effect's role binds; a trouble's empty role is its
// place.
func (x effect) ref() (fact.Ref, bool) { return x.g.roleRef(x.a, x.e.Role) }

// regions are the regions the effect acts on: every region of the arc for
// "regions", a faction's seat region, else the regions its role names.
func (x effect) regions() []int {
	if x.e.Role == sheets.RoleRegions {
		return x.a.Regions
	}
	ref, ok := x.ref()
	if !ok {
		return nil
	}
	if fi, ok := x.faction(ref); ok && ref.Kind != kindHolding && ref.Kind != kindRegion && ref.Kind != kindSettlement && ref.Kind != kindTile {
		return []int{x.g.World.Factions[fi].Seat}
	}
	return x.g.refRegions(ref)
}

// faction is the living faction a ref names or stands for.
func (x effect) faction(ref fact.Ref) (int, bool) {
	g := x.g
	switch ref.Kind {
	case kindFaction:
		fi, ok := arc.RefIndex(ref)
		return fi, ok && fi < len(g.World.Factions) && !g.World.Factions[fi].Fallen
	case kindNotable:
		fi, _ := g.notableFaction(ref.ID)
		return fi, fi >= 0
	}
	for _, r := range g.refRegions(ref) {
		if h := g.World.Regions[r].Holder; h >= 0 && !g.World.Factions[h].Fallen {
			return h, true
		}
	}
	return -1, false
}

// seat is a faction's seat's tile.
func (x effect) seat(fi int) hex.Hex { return x.g.regionHex(x.g.World.Factions[fi].Seat) }

// holding is the held region the effect's role names: a holding or region,
// or a faction's seat.
func (x effect) holding() (int, bool) {
	ref, ok := x.ref()
	if !ok {
		return -1, false
	}
	if ref.Kind == kindFaction || ref.Kind == kindNotable {
		fi, ok := x.faction(ref)
		if !ok {
			return -1, false
		}
		return x.g.World.Factions[fi].Seat, true
	}
	rs := x.g.refRegions(ref)
	if len(rs) == 0 {
		return -1, false
	}
	return rs[0], true
}

func (x effect) fortify(by int64) {
	if r, ok := x.holding(); ok && by != 0 && x.g.World.Regions[r].Holder >= 0 {
		x.queue(world.Action{Kind: world.ActFortify, Hex: x.g.regionHex(r), Units: by})
	}
}

// falls fells the holding, or cuts its defence instead when it is its
// holder's last: the story never takes a faction's last holding.
func (x effect) falls() {
	r, ok := x.holding()
	if !ok {
		return
	}
	holder := x.g.World.Regions[r].Holder
	if holder < 0 {
		return
	}
	if len(x.g.heldRegions(holder)) <= 1 {
		by := x.e.Amount
		if by == 0 {
			by = sheets.IntParam(x.g.r.Book.FactionParams, "last-holding-damage")
		}
		x.fortify(-by)
		return
	}
	x.queue(world.Action{Kind: world.ActFallHolding, Hex: x.g.regionHex(r)})
}

// notable is the living notable the effect's role names and its faction.
func (x effect) notable() (string, int, bool) {
	ref, ok := x.ref()
	if !ok || ref.Kind != kindNotable {
		return "", -1, false
	}
	fi, _ := x.g.notableFaction(ref.ID)
	return ref.ID, fi, fi >= 0
}

// split breaks the named notable's faction in two under it, or, when the
// faction holds too few regions to split, costs every claimant loyalty.
func (x effect) split() {
	id, fi, ok := x.notable()
	if !ok {
		return
	}
	if len(x.g.heldRegions(fi)) >= splitLeast {
		x.queue(world.Action{Kind: world.ActSplit, Hex: x.seat(fi), Species: id})
		return
	}
	if x.e.Amount == 0 {
		return
	}
	for _, b := range x.a.Cast {
		if b.Ref.Kind != kindNotable {
			continue
		}
		if nf, _ := x.g.notableFaction(b.Ref.ID); nf >= 0 {
			x.queue(world.Action{Kind: world.ActLoyalty, Hex: x.seat(nf), Species: b.Ref.ID, Units: -x.e.Amount})
		}
	}
}

// defect moves the named notable to the faction that won it: the winning
// side's sponsor, else the cast's other faction.
func (x effect) defect() {
	id, fi, ok := x.notable()
	if !ok {
		return
	}
	var to int
	if x.won != nil && x.won.Sponsor >= 0 && x.won.Sponsor != fi {
		to = x.won.Sponsor
	} else {
		to = x.other(fi)
	}
	if to >= 0 && to < len(x.g.World.Factions) && !x.g.World.Factions[to].Fallen {
		x.queue(world.Action{Kind: world.ActDefect, Hex: x.seat(to), Species: id})
	}
}

// pair is the faction the effect's role names and the one it is set
// against: for peace the winning side's opponent or sponsor, else the
// cast's other faction.
func (x effect) pair(peace bool) (fi, other int, ok bool) {
	ref, ok := x.ref()
	if !ok {
		return -1, -1, false
	}
	fi, ok = x.faction(ref)
	if !ok {
		return -1, -1, false
	}
	other = -1
	if peace && x.won != nil {
		for _, f := range []int{x.won.Opponent, x.won.Sponsor} {
			if f >= 0 && f != fi {
				other = f
				break
			}
		}
	}
	if other < 0 {
		other = x.other(fi)
	}
	return fi, other, other >= 0 && other < len(x.g.World.Factions) && !x.g.World.Factions[other].Fallen
}

// other is the first faction the cast binds besides fi, or -1.
func (x effect) other(fi int) int {
	for _, b := range x.a.Cast {
		if b.Ref.Kind != kindFaction {
			continue
		}
		if f, ok := arc.RefIndex(b.Ref); ok && f != fi {
			return f
		}
	}
	return -1
}

// trouble casts a trouble at every standing place in the role's regions
// that has none, whatever its rest.
func (x effect) trouble() error {
	g := x.g
	tpl, ok := g.template(x.e.Ref)
	if !ok || tpl.Row.Trouble == nil {
		return nil
	}
	regions := x.regions()
	for n, p := range g.Places {
		r := g.World.RegionAt(p.Hex)
		if p.Ruined != 0 || r < 0 || !slices.Contains(regions, r) || g.placeTaken(n) {
			continue
		}
		cast := arc.Cast{{Role: rolePlace, Ref: arc.SettlementRef(n)}, {Role: roleSource, Ref: arc.RegionRef(r)}}
		if tpl.Row.Trouble.Wants == arc.WantSold {
			if h := g.World.Regions[r].Holder; h >= 0 {
				cast = append(cast, arc.Binding{Role: roleFaction, Ref: arc.FactionRef(h)})
			}
		}
		c := arc.Candidate{Cast: arc.Sorted(cast), Regions: []int{r}, Seat: p.Hex, Causes: []fact.ID{x.cause}, Place: n}
		if _, err := g.castFrom(tpl, c, ByEffect, x.t); refusedIsNothing(err) != nil {
			return err
		}
	}
	return nil
}

// spread starts a lapsed front spreading from its role's region.
func (x effect) spread() {
	for _, r := range x.regions()[:min(1, len(x.regions()))] {
		x.g.Story.Spreads = append(x.g.Story.Spreads, Spread{Arc: x.a.ID, Region: r, Left: x.g.r.Story.FrontSpreadDays})
	}
}

// seal shuts the open core.
func (x effect) seal() error {
	ring := x.g.Story.Ring
	if ring == nil || ring.Open == 0 {
		return nil
	}
	ring.Open, ring.Until = 0, 0
	_, err := x.g.worldFact(ring.Core, "core.sealed", []fact.Ref{arcRef(x.a.ID), arc.TileRef(ring.Core)}, []fact.ID{x.cause}, fact.At(ring.Core)...)
	return err
}

// keepOpen holds the core open through Amount more seasons' closes.
func (x effect) keepOpen() {
	ring := x.g.Story.Ring
	c, ok := x.g.clock()
	if ring == nil || ring.Open == 0 || !ok {
		return
	}
	ring.Until = max(ring.Until, c.N+max(x.e.Amount, 1))
}

// cache mints a story.caches row's goods and splits each line among the
// winning side's contributors by what they gave; with nobody to take it,
// nothing is minted.
func (x effect) cache() error {
	g := x.g
	i := slices.IndexFunc(g.r.Book.Caches, func(c sheets.Cache) bool { return c.ID == x.e.Ref })
	if i < 0 || x.won == nil {
		return nil
	}
	w := g.GoalOf(x.won.Goal)
	if w == nil || w.Total() <= 0 {
		return nil
	}
	at := x.a.Seat
	if ref, ok := x.ref(); ok {
		if h, ok := g.refHexOf(ref); ok {
			at = h
		}
	}
	pool := ledger.CachePool(x.a.ID + sidePart + itoa(x.a.Stage) + sidePart + x.e.Ref)
	return g.openCache(g.r.Book.Caches[i].Goods, pool, w.Progress, at, ledger.SubKey(x.key, "cache"), "cache", x.cause, x.t)
}

// openCache mints cache lines into pool and splits each line among the
// contributors in by, by share; each share is handed to its taker at tile
// at, who then awaits it there.
func (g *Game) openCache(lines []sheets.CacheLine, pool string, by tally.Tally, at hex.Hex, key, kind string, cause fact.ID, t int64) error {
	var legs []ledger.Leg
	for _, line := range lines {
		asset := ledger.Goods(line.Material)
		legs = append(legs, ledger.Pair(ledger.FromCache, pool, asset, line.Quantity)...)
		for j, part := range splitUnits(line.Quantity, by) {
			if part > 0 {
				legs = append(legs, ledger.Pair(pool, g.handTo(by[j].Key, at), asset, part)...)
			}
		}
	}
	if err := g.postAll(ledger.Txn{Key: key, Kind: kind, Tick: t, Fact: cause, Legs: ledger.Merge(legs)}); err != nil {
		return err
	}
	for _, p := range by {
		if p.N > 0 {
			g.awaits(p.Key, at)
		}
	}
	return nil
}

// splitUnits shares units by contribution, the rounding to the largest
// contributors first, then the first listed.
func splitUnits(units int64, by tally.Tally) []int64 {
	out := make([]int64, len(by))
	total := int64(0)
	for _, c := range by {
		total += max(c.N, 0)
	}
	if total <= 0 {
		return out
	}
	paid := int64(0)
	for i, c := range by {
		out[i] = units * max(c.N, 0) / total
		paid += out[i]
	}
	order := make([]int, len(by))
	for i := range order {
		order[i] = i
	}
	slices.SortStableFunc(order, func(a, b int) int { return cmp.Compare(by[b].N, by[a].N) })
	for i := 0; paid < units; i++ {
		if k := order[i%len(order)]; by[k].N > 0 {
			out[k]++
			paid++
		}
	}
	return out
}

// place is the settlement the effect acts on: its role's, or the arc's.
func (x effect) place() (*Place, bool) {
	ref, ok := x.ref()
	if ok && ref.Kind == kindSettlement {
		if n, ok := arc.RefIndex(ref); ok && n < len(x.g.Places) {
			return x.g.Places[n], true
		}
	}
	if n, ok := goal.SettlementOf(x.a.Place); ok && n < len(x.g.Places) {
		return x.g.Places[n], true
	}
	return nil, false
}

// mend restores condition on every structure of the place.
func (x effect) mend() {
	p, ok := x.place()
	if !ok || x.e.Amount <= 0 {
		return
	}
	for _, st := range p.Structures {
		p.Mend(st.Kind, x.e.Amount, x.g.r.Settle)
	}
}

// standing moves standing with the role's faction (or its place's keepers)
// for the thread's character, or for every backer of the winning side.
func (x effect) standing() {
	g := x.g
	ref, ok := x.ref()
	if !ok || x.e.Amount == 0 {
		return
	}
	h, _ := g.refHexOf(ref)
	fi, ok := x.faction(ref)
	if !ok {
		fi = -1
	}
	key := standingKey(fi, h)
	for _, c := range x.whom() {
		g.adjustStanding(c, key, x.e.Amount)
		g.touchOnce(c)
	}
}

// whom are who an effect on characters reaches: a thread's character, else
// the winning side's backers.
func (x effect) whom() []*Char {
	g := x.g
	if x.a.Char != "" {
		if c := g.Char(x.a.Char); c != nil {
			return []*Char{c}
		}
		return nil
	}
	if x.won == nil {
		return nil
	}
	w := g.GoalOf(x.won.Goal)
	if w == nil {
		return nil
	}
	var out []*Char
	for _, p := range w.Progress {
		if c := g.Char(p.Key); c != nil && p.N > 0 {
			out = append(out, c)
		}
	}
	return out
}

// disposition turns the cast NPC toward the thread's character: standing
// with whose the NPC is, and a memory of being helped or wronged.
func (x effect) disposition() error {
	g := x.g
	ref, ok := x.ref()
	if !ok || ref.Kind != kindNPC || x.e.Amount == 0 {
		return nil
	}
	n := g.NPCs.Get(ref.ID)
	if n == nil {
		return nil
	}
	kind, weight := entryHelped, x.e.Amount
	if weight < 0 {
		kind, weight = entryWronged, -weight
	}
	for _, c := range x.whom() {
		g.standing(c, n, x.e.Amount)
		g.r.NPC.Remember(n, npc.Entry{Kind: kind, Player: c.C.ID, Weight: weight, Tick: x.t, Fact: int64(x.cause)}, x.t)
		g.touchOnce(c)
	}
	return g.NPCs.Touched(n)
}

// withdraw takes down the thread's character's market orders, listings and
// gear orders with their escrow back, and refunds its pledges to proposals
// not yet live.
func (x effect) withdraw() error {
	g := x.g
	c := g.Char(x.a.Char)
	if c == nil {
		return nil
	}
	var opens []Open
	for o := range g.opens(ledger.Char(c.C.ID), false) {
		opens = append(opens, o)
	}
	for _, o := range opens {
		if err := g.closeOrder(o, ledger.SubKey(x.key, "order", o.ID)); err != nil {
			return err
		}
	}
	for _, y := range g.Goals {
		if y.State != goal.Proposed {
			continue
		}
		pledged := y.Pledges.Get(c.C.ID)
		coin := min(pledged, g.Ledger.Of(goalPool(y.ID), ledger.Coin))
		if pledged <= 0 {
			continue
		}
		y.Pledges = slices.DeleteFunc(y.Pledges, func(p tally.Count) bool { return p.Key == c.C.ID })
		if coin <= 0 {
			continue
		}
		if err := g.postAll(ledger.Move(ledger.SubKey(x.key, "pledge", y.ID), "goal-pledge-back", x.t, goalPool(y.ID), ledger.Char(c.C.ID), ledger.Coin, coin)); err != nil {
			return err
		}
	}
	return nil
}

// marked puts arc-marked on the thread's character for Amount days.
func (x effect) marked() error {
	g := x.g
	if x.e.Amount <= 0 {
		return nil
	}
	for _, c := range x.whom() {
		i := slices.IndexFunc(c.C.Conditions, func(k char.Condition) bool { return k.Tag == char.ArcMarked })
		if i >= 0 && c.C.Conditions[i].Ends == 0 {
			continue
		}
		c.C.Set(char.ArcMarked, x.t+x.e.Amount*sheets.TicksPerDay)
		g.touchOnce(c)
		if _, err := g.factWith(c, []fact.Ref{arcRef(x.a.ID)}, "character.marked", x.t, fact.S("arc", x.a.ID), fact.N("days", x.e.Amount)); err != nil {
			return err
		}
	}
	return nil
}

// damage wears one structure of the place, chosen by the trouble's type:
// the first of its damages standing open, else an open station drawn. A
// Steward of the running guild saves it.
func (x effect) damage() error {
	g := x.g
	p, ok := x.place()
	if !ok {
		return nil
	}
	kind := ""
	if tr := g.troubleOf(x.a); tr != nil {
		for _, k := range tr.Damages {
			if p.Open(k) {
				kind = k
				break
			}
		}
	}
	if kind == "" {
		if kind = g.openStation(p, x.t); kind == "" {
			return nil
		}
	}
	if g.stewarded(p) {
		return nil
	}
	points := x.e.Amount
	if points <= 0 {
		points = g.r.Settle.TroubleDamage
	}
	return g.damaged(p, kind, points, x.a.Template, []fact.ID{x.cause}, arcRef(x.a.ID))
}

// stewarded reports whether a member of the guild running a place is a
// Steward, who spares it a lost trouble's damage.
func (g *Game) stewarded(p *Place) bool {
	gd := g.GuildOf(p.Guild)
	if gd == nil {
		return false
	}
	for _, m := range gd.G.Members {
		if c := g.Char(m.Char); c != nil && g.charScale(c, "trouble-structures", 0) < 0 {
			return true
		}
	}
	return false
}

// stake runs one of a lost trouble's stakes at its place for Amount days.
func (x effect) stake() {
	p, ok := x.place()
	if !ok || x.e.Amount <= 0 {
		return
	}
	ps := x.g.placeStory(p.N)
	if ps == nil {
		return
	}
	until := x.t + x.e.Amount*sheets.TicksPerDay
	switch x.e.Kind {
	case effFees:
		ps.Fees = max(ps.Fees, until)
	case effOrdersStop:
		ps.Orders = max(ps.Orders, until)
	case effPrices:
		ps.Prices = max(ps.Prices, until)
	case effSick:
		ps.Sick = max(ps.Sick, until)
	}
}

// feeShare is the percent market fees at place n run at: fees-raised under
// a raid's stake, else 100.
func (g *Game) feeShare(n int, t int64) int64 {
	if ps := g.storyAt(n); ps != nil && ps.Fees > t {
		return g.r.Story.FeesRaised
	}
	return fixed.Hundredths
}

// ordersStopped reports whether panic has stopped place n's faction
// orders.
func (g *Game) ordersStopped(n int, t int64) bool {
	ps := g.storyAt(n)
	return ps != nil && ps.Orders > t
}

// priceShare is the percent of their price faction orders at place n pay:
// prices-cut under a shortage's stake, else 100.
func (g *Game) priceShare(n int, t int64) int64 {
	if ps := g.storyAt(n); ps != nil && ps.Prices > t {
		return g.r.Story.PricesCut
	}
	return fixed.Hundredths
}

// sickShare is the percent rest and repairs at place n take: sick-share
// under sickness, else 100.
func (g *Game) sickShare(n int, t int64) int64 {
	if ps := g.storyAt(n); ps != nil && ps.Sick > t {
		return g.r.Story.SickShare
	}
	return fixed.Hundredths
}

// The emergence effects (GDD 12.9, 13.2) act on emergence's records and
// the ledger alone, and do nothing in a world without emergence.

// roads tolls, cuts or patrols every road of the role's region for the
// effect's days, or the emergence.params cell's.
func (x effect) roads() error {
	g := x.g
	e := g.Emergence
	if e == nil {
		return nil
	}
	p := g.r.Emerge.P
	days := x.e.Amount
	if days <= 0 {
		switch x.e.Kind {
		case effToll:
			days = p.TollDays
		case effCut:
			days = p.CutDays
		default:
			days = p.PatrolDays
		}
	}
	until := x.t/sheets.TicksPerDay + days
	subjects := []fact.Ref{arcRef(x.a.ID)}
	for _, r := range x.regions() {
		var err error
		switch x.e.Kind {
		case effToll:
			err = g.holdRoads(r, holdToll, until, x.cause, subjects, fact.N("days", days), fact.N("coin", p.TollCoin))
		case effCut:
			err = g.holdRoads(r, holdCut, until, x.cause, subjects, fact.N("days", days))
		default:
			err = g.holdRoads(r, holdPatrol, until, 0, nil)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// promotionShown is a promotion's shown name, else its id.
func (g *Game) promotionShown(id string) string {
	if p := g.Emergence.Promotion(id); p != nil {
		return p.Shown()
	}
	return id
}

// caravan is the live caravan the effect's role binds.
func (x effect) caravan() *emerge.Caravan {
	ref, ok := x.ref()
	if !ok || ref.Kind != kindCaravan {
		return nil
	}
	return x.g.castCaravan(ref.ID)
}

// salvage splits a caravan's goods among the winning side's backers by
// what each gave, each share awaiting its taker on the caravan's tile, and
// ends the caravan; with nobody to take them they are lost.
func (x effect) salvage() error {
	g := x.g
	cv := x.caravan()
	if cv == nil {
		return nil
	}
	var w *Goal
	if x.won != nil {
		w = g.GoalOf(x.won.Goal)
	}
	if w == nil || w.Total() <= 0 {
		return x.caravanLost()
	}
	at := g.caravanAt(cv, x.t)
	pool := ledger.CaravanPool(cv.ID)
	var legs []ledger.Leg
	for _, b := range g.caravanGoods(cv) {
		for j, part := range splitUnits(b.Units, w.Progress) {
			if part > 0 {
				legs = append(legs, ledger.Pair(pool, g.handTo(w.Progress[j].Key, at), b.Asset, part)...)
			}
		}
	}
	if len(legs) > 0 {
		if err := g.postAll(ledger.Txn{Key: ledger.SubKey(x.key, "salvage"), Kind: "caravan-salvage", Tick: x.t, Fact: x.cause, Legs: ledger.Merge(legs)}); err != nil {
			return err
		}
	}
	for _, p := range w.Progress {
		if p.N > 0 {
			g.awaits(p.Key, at)
		}
	}
	return g.endCaravan(cv)
}

// caravanLost leaves a caravan's goods in its tile's spoils and ends it.
func (x effect) caravanLost() error {
	g := x.g
	cv := x.caravan()
	if cv == nil {
		return nil
	}
	at, units, err := g.caravanSpill(cv, fixed.Hundredths, ledger.SubKey(x.key, "caravan-lost"), x.cause, x.t)
	if err != nil {
		return err
	}
	data := append(g.caravanData(cv, units), fact.At(at)...)
	if _, err := g.worldFact(at, factCaravanLost, []fact.Ref{promotionRef(cv.Route), arcRef(x.a.ID)}, []fact.ID{x.cause}, data...); err != nil {
		return err
	}
	return g.endCaravan(cv)
}

// layLegend lays the role's legend to rest.
func (x effect) layLegend() error {
	g := x.g
	ref, ok := x.ref()
	if !ok || ref.Kind != kindLegend {
		return nil
	}
	l := g.castLegend(ref.ID)
	if l == nil || l.Laid != 0 {
		return nil
	}
	l.Laid = castDay(x.t)
	region := ""
	if l.Region >= 0 {
		region = world.RegionRef(l.Region)
	}
	_, err := g.regionFact(region, factLegendLaid, []fact.Ref{promotionRef(l.ID), arcRef(x.a.ID)}, []fact.ID{x.cause},
		append([]fact.Datum{fact.S("id", l.ID), fact.S("name", g.promotionShown(l.ID))}, fact.At(l.At)...)...)
	return err
}
