package game

import (
	"cmp"
	"maps"
	"slices"
	"sort"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/econ"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
	"jams.team/mmo-world/sim/world"
)

// see reads a fact as goal events: what a character did, to what, where,
// and then what it counts toward the sides of arcs. The backing events
// apply their standing and marks as they are read.
func (g *Game) see(f fact.Fact) []goal.Event {
	return append(g.seeOwn(f), g.backEvents(f)...)
}

// seeOwn is a fact's own events. Facts no verb counts read as nothing; a
// first step onto a tile is both a Reach and a Discover.
func (g *Game) seeOwn(f fact.Fact) []goal.Event {
	e, ok := g.event(f)
	if !ok {
		return nil
	}
	if f.Kind == "hunt.slain" {
		return g.hunted(e, f)
	}
	if f.Kind == "travel.entered" {
		if d, _ := f.Get("first"); d.N > 0 {
			return []goal.Event{e, g.discovered(e, e.Hex)}
		}
	}
	return []goal.Event{e}
}

func (g *Game) event(f fact.Fact) (goal.Event, bool) {
	who := ""
	if len(f.Subjects) > 0 && f.Subjects[0].Kind == "character" {
		who = f.Subjects[0].ID
	}
	e := goal.Event{Fact: f.ID, Who: who}
	h, at := fact.HexOf(f)
	if at {
		e.Hex, e.Places = h, g.placesOf(h)
	} else if f.Region != "" {
		e.Places = []string{goal.RegionRef(f.Region)}
	}
	str := func(k string) string { d, _ := f.Get(k); return d.S }
	num := func(k string) int64 { d, _ := f.Get(k); return d.N }
	switch f.Kind {
	case "goal.delivered":
		e.Verb, e.Goal, e.Kind, e.Units = goal.Deliver, str("goal"), str("material"), num("units")
		e.Tags = g.materialTags(e.Kind)
	case "goal.hauled":
		e.Verb, e.Goal, e.Kind, e.Units, e.From = goal.Haul, str("goal"), str("material"), num("units"), str("from")
		e.Tags = g.materialTags(e.Kind)
	case "goal.held":
		e.Verb, e.Goal, e.Gauge, e.Value, e.Units = goal.Hold, str("goal"), str("gauge"), num("value"), num("day")
	case "rescue.carried":
		e.Verb, e.Kind = goal.Carry, str("who")
	case "travel.entered":
		e.Verb = goal.Reach
	case "dungeon.reached":
		e.Verb, e.Floor = goal.Reach, num("floor")
		if at {
			e.Dungeon = h.Ref()
		}
	case "hunt.slain":
		e.Verb = goal.Defeat
		e.Kind, e.Tags = defeated(f)
	case "craft.made":
		k, ok := g.Kinds.Kind(subjectID(f, "kind"))
		if !ok {
			return e, false
		}
		e.Verb, e.Kind, e.Traits = goal.Make, k.ID, k.Traits
		e.Tags = tagStrings(k.Tags)
		if k.Slot != "" {
			e.Tags = append(e.Tags, k.Slot)
		}
	case "encounter.won":
		e.Verb = goal.Defeat
		e.Kind, e.Tags = defeated(f)
	case "item.equipped":
		in := g.itemOf(who, str("item"))
		if in == nil {
			return e, false
		}
		e = g.equipped(e, in)
	default:
		return e, false
	}
	return e, e.Verb != ""
}

// hunted is a hunt's kill read as a Defeat for every character who
// pressed it: each counts the kill once.
func (g *Game) hunted(e goal.Event, f fact.Fact) []goal.Event {
	var out []goal.Event
	for _, s := range f.Subjects {
		if s.Kind == "character" {
			x := e
			x.Who = s.ID
			out = append(out, x)
		}
	}
	return out
}

// equipped is an event read as a character having an item equipped.
func (g *Game) equipped(e goal.Event, in *item.Instance) goal.Event {
	e.Verb = goal.Equip
	if k, ok := g.Kinds.Kind(in.Kind); ok {
		e.Kind, e.Tags = k.ID, tagStrings(k.Tags)
	}
	return e
}

// discovered is a first entry read as a Discover: the tile's site, the
// tags of the materials it holds, and its generated fields.
func (g *Game) discovered(e goal.Event, h hex.Hex) goal.Event {
	e.Verb, e.Tags = goal.Discover, nil
	e.Kind, e.Fields = g.slot(h), g.r.Gen.Baseline(h).Fields()
	for _, m := range g.Materials(h) {
		e.Tags = append(e.Tags, g.materialTags(m)...)
	}
	return e
}

func tagStrings(ts []tags.Tag) []string {
	out := make([]string, len(ts))
	for i, t := range ts {
		out[i] = string(t)
	}
	return out
}

func subjectID(f fact.Fact, kind string) string {
	for _, s := range f.Subjects {
		if s.Kind == kind {
			return s.ID
		}
	}
	return ""
}

func (g *Game) materialTags(material string) []string {
	if tags, ok := g.r.matTags[material]; ok {
		return slices.Clone(tags)
	}
	if m, ok := g.foundReg.Get(material); ok {
		return slices.Clone(m.Tags)
	}
	return nil
}

func (g *Game) itemOf(who, id string) *item.Instance {
	if c := g.Char(who); c != nil {
		return c.C.Item(id)
	}
	return nil
}

// raise posts a structure's next tier as a project: one pooled settlement
// goal per line of its cost, the structure rising when all are met (GDD
// 4.16). An officer of the running guild posts it, with an optional
// reward per goal from the treasury.
func (g *Game) raise(c *Char, cmd Command) error {
	plan, err := g.planRaise(c, cmd.Slot)
	if err != nil {
		return err
	}
	if err := g.rewardRaise(c, plan, cmd.Price); err != nil {
		return err
	}
	// The project is named for its first goal, so no two raises share one.
	project := ""
	for i, x := range plan.drafts {
		if err := g.open(c, x, ledger.SubKey(cmd.Key, strconv.Itoa(i))); err != nil {
			return err
		}
		if project == "" {
			project = "raise-" + x.ID
		}
		x.Build = &goal.Build{Settlement: plan.settlement, Structure: plan.structure, Tier: plan.tier, Project: project}
	}
	return nil
}

// raisePlan is a raise ready to post: the goals of its lines, drafted.
type raisePlan struct {
	settlement int
	structure  string
	tier       int64
	drafts     []*Goal
}

// planRaise drafts every line of a raise, with no reward yet, or refuses.
// It changes nothing, so a refusal posts none.
func (g *Game) planRaise(c *Char, slot string) (*raisePlan, error) {
	_, p, err := g.officerHere(c, "raises structures")
	if err != nil {
		return nil, err
	}
	row := g.r.structures[slot]
	switch {
	case row == nil:
		return nil, refuse(BadArgs, "no structure %q", slot)
	case g.raising(p.N, row.ID):
		return nil, refuse(BadArgs, "the %s is already being raised", row.ID)
	}
	tier, lines, ok := p.Next(row, g.r.Settle)
	switch {
	case !ok && len(lines) > 0:
		return nil, refuse(BadArgs, "the %s is at its highest tier", row.ID)
	case !ok:
		return nil, refuse(BadArgs, "the %s is not raised by goals", row.ID)
	}
	if waits := RaiseWaits(p, row); waits != "" {
		return nil, refuse(BadArgs, "raising the %s does nothing yet: it waits for %s", row.ID, waits)
	}
	name := g.r.Name("settlements.structures:" + row.ID)
	if name == "" {
		name = row.ID
	}
	plan := &raisePlan{settlement: p.N, structure: row.ID, tier: tier}
	for _, l := range lines {
		x, err := g.draft(c, GoalSpec{Title: name + ": " + l.Tag, Issuer: goal.ByAdmin, Mode: goal.Pooled,
			Lifetime: goal.Season, Turnover: goal.Keep, Cond: goal.Condition{Verb: goal.Deliver, Tag: l.Tag, Count: l.Quantity, At: goal.SettlementRef(p.N)}})
		if err != nil {
			return nil, err
		}
		plan.drafts = append(plan.drafts, x)
	}
	return plan, nil
}

// rewardRaise puts a reward on each line of a planned raise, or refuses
// one a line may not carry or the treasury and the officer's day do not
// cover across them all. Only the plan's drafts change.
func (g *Game) rewardRaise(c *Char, plan *raisePlan, reward int64) error {
	var need int64
	for _, x := range plan.drafts {
		x.Reward = reward
		if err := goal.Valid(x, g.Tick(), g.GoalLimits()); err != nil {
			return refuse(BadArgs, "%v", err)
		}
		if err := g.quote(c, x); err != nil {
			return err
		}
		need += x.Cost()
	}
	// Each line was quoted alone; together they must still be covered.
	if g.Ledger.Of(TreasuryPool(plan.settlement), ledger.Coin) < need {
		return refuse(BadArgs, "raising the %s takes %d coin from the treasury", plan.structure, need)
	}
	return g.mayMuster(c, plan.drafts[0], need)
}

// RaiseMost is the most coin an officer could put on each line of a
// structure's raise now, the treasury and its day covering every line and
// its listing fee; 0 when no reward fits.
func (g *Game) RaiseMost(c *Char, slot string) int64 {
	plan, err := g.planRaise(c, slot)
	if err != nil {
		return 0
	}
	fits := func(reward int64) bool { return g.rewardRaise(c, plan, reward) == nil }
	least := g.gp("reward-least")
	if !fits(least) {
		return 0
	}
	// A reward costs no less as it grows, so the first that does not fit
	// ends the search.
	room := g.Ledger.Of(TreasuryPool(plan.settlement), ledger.Coin) - least
	return least + int64(sort.Search(int(room), func(over int) bool { return !fits(least + int64(over) + 1) }))
}

// raising reports whether a structure has a project open.
func (g *Game) raising(settlement int, structure string) bool {
	return slices.ContainsFunc(g.Goals, func(x *Goal) bool {
		return x.Build != nil && x.Build.Settlement == settlement && x.Build.Structure == structure && x.Open()
	})
}

// built raises a structure once every goal of its project is met.
func (g *Game) built(b *goal.Build) error {
	if b.Structure == "" {
		// A city project raises no structure: its city lands on a story day.
		return nil
	}
	for _, x := range g.Goals {
		if x.Build != nil && x.Build.Project == b.Project && x.State != goal.Done {
			return nil
		}
	}
	p := g.Places[b.Settlement]
	if !p.Raise(g.r.structures[b.Structure], g.Tick(), g.r.Settle) {
		return nil
	}
	_, err := g.worldFact(p.Hex, "structure.raised", nil, nil, fact.S("structure", b.Structure), fact.N("tier", b.Tier), fact.N("settlement", int64(p.N)))
	return err
}

// goalsTurn is the goals' world day: each live Hold reads its gauge as a
// fact, goals past their time end, a season's close turns every season
// goal over, and each faction posts the day's bounty.
func (g *Game) goalsTurn(t int64) error {
	day := t / sheets.TicksPerDay
	key := ledger.SubKey("goals", strconv.FormatInt(day, decimal))
	first := fact.ID(g.Log.Len())
	for _, x := range g.Goals {
		if x.State != goal.Live || !x.Cond.Hold() || x.Hidden {
			continue
		}
		// The reading is a fact of the region held, wherever its board is.
		r, ok := g.regionOf(x.Cond.At)
		gi, known := g.World.GaugeOf(x.Cond.Gauge)
		if ok && known {
			v := g.World.Regions[r].Gauge[gi]
			if _, err := g.regionFact(world.RegionRef(r), "goal.held", []fact.Ref{goalRef(x.ID)}, nil,
				fact.S("goal", x.ID), fact.S("gauge", x.Cond.Gauge), fact.N("value", v), fact.N("day", day)); err != nil {
				return err
			}
		}
	}
	if err := g.creditGoals(first, key); err != nil {
		return err
	}
	closing, next := g.seasonCloses(day)
	for _, x := range g.Goals {
		if !x.Open() {
			continue
		}
		due := x.Due(t)
		if closing && x.Turn(next, day, g.seasonRatio(), g.rebind) {
			due = true
		}
		if !due {
			// A reset counts from nothing again: what was handed over goes back.
			if x.Total() == 0 {
				if err := g.handBack(x, key); err != nil {
					return err
				}
			}
			continue
		}
		if err := g.closeGoal(x, key); err != nil {
			return err
		}
	}
	if closing {
		g.SeasonActive = g.Active()
	}
	return g.bounties(t, key)
}

// goalsDue ends the goals whose time ran out this tick, so none is met,
// pledged to or hauled past its end.
func (g *Game) goalsDue(t int64) error {
	key := ledger.SubKey("tick", strconv.FormatInt(t, decimal), "due")
	for _, x := range g.Goals {
		if x.Open() && x.Due(t) {
			if err := g.closeGoal(x, key); err != nil {
				return err
			}
		}
	}
	return nil
}

// closeGoal ends a goal at its time: a kept vow is recorded as kept, a broken
// one as broken, and a haul still out forfeits its collateral.
func (g *Game) closeGoal(x *Goal, key string) error {
	if x.Cond.Abstains() {
		kind, why := "goal.vow-kept", "kept"
		if x.Broken {
			kind, why = "goal.vow-broken", "broken"
		}
		if c := g.Char(x.Poster); c != nil {
			c.C.Goals.Bump("vows-"+why, 1)
		}
		if err := g.goalFact(x, kind); err != nil {
			return err
		}
		x.End(why)
		return g.refund(x, key)
	}
	if c := g.Char(x.Poster); c != nil {
		c.C.Goals.Bump("lapsed", 1)
	}
	return g.endGoal(x, "expired", key)
}

// regionOf is the region a place ref names, if it names one the world
// holds.
func (g *Game) regionOf(ref string) (int, bool) {
	kind, id, ok := goal.ParseRef(ref)
	if !ok || kind != goal.PlaceRegion {
		return 0, false
	}
	r, ok := world.ParseRegionRef(id)
	return r, ok && r >= 0 && r < len(g.World.Regions)
}

// seasonRatio is the new season's active characters over the old's, in
// hundredths, for goals that evolve.
func (g *Game) seasonRatio() int64 {
	if g.SeasonActive <= 0 {
		return fixed.Hundredths
	}
	return max(1, g.Active()*fixed.Hundredths/g.SeasonActive)
}

// rebind re-casts a place that no longer exists: a settlement past the
// open ones becomes the first.
func (g *Game) rebind(at string) string {
	if kind, _, _ := goal.ParseRef(at); kind != goal.PlaceSettlement {
		return at
	}
	if n, ok := goal.SettlementOf(at); !ok || n >= len(g.Places) {
		return goal.SettlementRef(0)
	}
	return at
}

// bounties posts each open settlement's faction bounty for the day (GDD
// 11.3): a pooled Defeat in the most threatened region near it, its
// reward a share of the settlement's faucet budget minted into escrow, so
// it stays inside the faucet (GDD 10.2).
func (g *Game) bounties(t int64, key string) error {
	if g.Market == nil {
		return nil
	}
	budgets := g.Budgets()
	for n, p := range g.Places {
		if g.bountyOpen(n) || !p.Open(structureMarket) {
			continue
		}
		reward := fixed.PercentFloor(budgets[n], g.gp("bounty-share"))
		r, ok := g.threatened(p.Hex)
		if !ok || reward < g.gp("reward-least") {
			continue
		}
		fi := g.World.Regions[r].Holder
		issuer := goal.Ref{Kind: goal.ByFaction, ID: strconv.Itoa(fi)}
		if fi < 0 {
			issuer.ID = strconv.Itoa(econ.Keepers)
		}
		x := &Goal{Title: "Thin the beasts of " + g.RegionName(r),
			Issuer: issuer, Scope: goal.World, Board: n, Reward: reward, Mode: goal.Pooled, Lifetime: goal.Ephemeral, Turnover: goal.Expire,
			Posted: t, Expires: t + g.gp("bounty-days")*sheets.TicksPerDay, State: goal.Live,
			Cond: goal.Condition{Verb: goal.Defeat, Count: g.gp("bounty-kills"), At: goal.RegionRef(world.RegionRef(r))}}
		if err := g.postPool(x, ledger.SubKey(key, "bounty", strconv.Itoa(n)), "bounty", t); err != nil {
			return err
		}
		if _, err := g.worldFact(p.Hex, "goal.posted", []fact.Ref{goalRef(x.ID)}, nil, fact.S("verb", goal.Defeat), fact.S("issuer", goal.ByFaction), fact.N("reward", reward)); err != nil {
			return err
		}
	}
	return nil
}

// postPool opens a faction's goal and mints its reward into the goal's
// pool from the faction.
func (g *Game) postPool(x *Goal, key, kind string, t int64) error {
	g.openGoal(x)
	if x.Reward <= 0 {
		return nil
	}
	return g.post(ledger.Move(key, kind, t, ledger.FromFaction, goalPool(x.ID), ledger.Coin, x.Reward))
}

// bounty reports whether a goal is a live faction bounty on a
// settlement's board.
func bounty(x *Goal, n int) bool {
	return x.Board == n && x.Issuer.Kind == goal.ByFaction && x.State == goal.Live && x.Cond.Verb != goal.Back
}

// bountyPosted reports whether a goal is a faction bounty on a
// settlement's board, live or not: its reward left the day budget when it
// was posted.
func bountyPosted(x *Goal, n int) bool {
	return x.Board == n && x.Issuer.Kind == goal.ByFaction && x.Cond.Verb != goal.Back && x.Reward > 0
}

// bountyOpen reports whether a settlement's board still shows a live
// faction bounty.
func (g *Game) bountyOpen(n int) bool {
	return slices.ContainsFunc(g.Goals, func(x *Goal) bool { return bounty(x, n) })
}

// bountyHeld is what a settlement's faction holds out in every bounty
// posted this world day so far, met or not, taken from its day budget.
func (g *Game) bountyHeld(n int) int64 {
	var out int64
	t := g.Tick()
	for _, x := range g.Goals {
		if bountyPosted(x, n) && postedToday(x, t) {
			out += x.Reward
		}
	}
	return out
}

// postedToday reports whether x was posted in the TicksPerDay ticks up to t.
func postedToday(x *Goal, t int64) bool { return x.Posted <= t && x.Posted > t-sheets.TicksPerDay }

// threatened is the region near a settlement with the most threat over
// the ambush line, if any.
func (g *Game) threatened(h hex.Hex) (int, bool) {
	line := g.gp("bounty-threat")
	best, bestV := -1, int64(0)
	ti := g.World.GaugeIndex("threat")
	for _, i := range g.RegionsNear(h) {
		if v := g.World.Regions[i].Gauge[ti]; v >= line && v > bestV {
			best, bestV = i, v
		}
	}
	return best, best >= 0
}

// Near is how far from a settlement the goals look: as far as its news
// travels.
func (g *Game) Near() int64 { return g.r.NPC.Param("news-range") }

// RegionsNear are the discovered regions whose centre is near a tile.
func (g *Game) RegionsNear(h hex.Hex) []int {
	var out []int
	for i, r := range g.World.Regions {
		if r.Discovered && hex.Distance(g.r.Gen.Region(r.Lattice).Centre, h) <= g.Near() {
			out = append(out, i)
		}
	}
	return out
}

// RegionName is a region's name.
func (g *Game) RegionName(r int) string { return g.r.NPC.PlaceName("region", world.RegionRef(r)) }

// Draft is a goal the board suggests from the state of the world (GDD
// 11.3); a player decides whether to post it.
type Draft struct {
	Why  string   `json:"why"`
	Spec GoalSpec `json:"spec"`
}

// Drafts are the board's suggestions for a character at a settlement: a
// search for a material whose node near it is worked out, a hold on the
// most threatened region near it, and a delivery of what its market lacks
// most.
func (g *Game) Drafts(c *Char) []Draft {
	n, ok := g.SettlementAt(c.C.At)
	if !ok {
		return nil
	}
	h := g.SettlementHex(n)
	here := goal.SettlementRef(n)
	var out []Draft
	if m, ok := g.workedOutNear(h); ok {
		tag := firstOr(g.materialTags(m), m)
		out = append(out, Draft{Why: "a source of " + g.sheetMaterialName(m) + " near here is worked out",
			Spec: GoalSpec{Title: "Find the next " + g.sheetMaterialName(m), Issuer: goal.ByCharacter, Mode: goal.First, Lifetime: goal.Standing, Turnover: goal.Keep,
				Reward: g.gp("reward-least"), Cond: goal.Condition{Verb: goal.Discover, Tag: tag, Count: 1, Hex: &h, Within: g.Near()}}})
	}
	if r, ok := g.threatened(h); ok {
		out = append(out, Draft{Why: g.RegionName(r) + " is the most threatened region near here",
			Spec: GoalSpec{Title: "Keep " + g.RegionName(r) + " quiet", Issuer: goal.BySettlement, Mode: goal.Pooled,
				Lifetime: goal.Season, Turnover: goal.Evolve, Cond: goal.Condition{Verb: goal.Hold, Gauge: "threat", Line: g.gp("bounty-threat"), Below: true,
					Count: g.gp("hold-days"), At: goal.RegionRef(world.RegionRef(r))}}})
	}
	if d, ok := g.huntDraft(n); ok {
		out = append(out, d)
	}
	if m, ok := g.lacking(n); ok {
		out = append(out, Draft{Why: "nobody is selling " + g.sheetMaterialName(m) + " here and a faction wants it",
			Spec: GoalSpec{Title: "Bring " + g.sheetMaterialName(m), Issuer: goal.ByCharacter, Mode: goal.First, Lifetime: goal.Ephemeral, Turnover: goal.Expire,
				Ticks: sheets.TicksPerDay, Reward: g.gp("reward-least") * g.gp("draft-units"),
				Cond: goal.Condition{Verb: goal.Deliver, Kind: m, Count: g.gp("draft-units"), At: here}}})
	}
	return out[:min(len(out), int(g.gp("drafts")))]
}

func firstOr(list []string, or string) string {
	if len(list) > 0 {
		return list[0]
	}
	return or
}

// workedOutNear is a material whose node near a tile is worked out, if any.
func (g *Game) workedOutNear(h hex.Hex) (string, bool) {
	for _, n := range g.News {
		if n.Kind != "node.worked-out" || hex.Distance(n.At, h) > g.Near() {
			continue
		}
		if f, ok := g.Log.Get(n.ID); ok {
			if m, ok := f.Get("material"); ok && m.S != "" {
				return m.S, true
			}
		}
	}
	return "", false
}

// lacking is the material a faction pays most for at a settlement that
// nobody is asking to sell there.
func (g *Game) lacking(n int) (string, bool) {
	best, price := "", int64(0)
	for _, o := range g.FactionOrders(g.SettlementHex(n)) {
		if b := g.BookOf(n, o.Material); b != nil && len(b.Asks) > 0 {
			continue
		}
		if o.Price > price {
			best, price = o.Material, o.Price
		}
	}
	return best, best != ""
}

// Board is a settlement's notice board: its live goals and proposals, a
// Crier's first while it is in front, then the newest.
func (g *Game) Board(n int) []*Goal {
	var out []*Goal
	for _, x := range g.Goals {
		if x.Board == n && !x.Hidden && x.Open() {
			out = append(out, x)
		}
	}
	now := g.Tick()
	slices.SortStableFunc(out, func(a, b *Goal) int {
		af, bf := a.Front > now, b.Front > now
		if af != bf {
			if af {
				return -1
			}
			return 1
		}
		return cmp.Compare(b.Posted, a.Posted)
	})
	return out
}

// Goal lines (GDD 13.2): a goal that could stand unmet into a legend or
// renew into a custom is read by its signature through the season it
// stands in, as it goes live, is attempted, met and turned over. Nothing
// reads the log back.

// structural: how a signature's parts join, and a tile-and-radius place.
const (
	sigSep    = "|"
	sigWithin = "~"
	attemptAt = "@"
)

// signature is a goal's line: who issues it, the verb and what it names,
// and the place.
func signature(x *Goal) string {
	c := x.Cond
	kind := c.Kind
	if kind == "" {
		kind = c.Gauge
	}
	place := c.At
	if c.Hex != nil && c.Within > 0 {
		place = goal.TileRef(*c.Hex) + sigWithin + strconv.FormatInt(c.Within, decimal)
	}
	return strings.Join([]string{x.Issuer.Kind, x.Issuer.ID, c.Verb, kind, c.Tag, c.Trait, place}, sigSep)
}

// lined reports whether a goal keeps a line: a Defeat, which could stand
// unmet into a legend, or a settlement's own goal, which could renew into
// a custom. Hidden goals, arc sides, calls for help, vows and a party's
// or a character's own scope keep none.
func lined(x *Goal) bool {
	switch {
	case x.Hidden, x.Cond.Verb == goal.Back, x.Cond.Verb == goal.Carry, x.Cond.Abstains():
		return false
	case x.Scope == goal.Personal, x.Scope == goal.Party:
		return false
	}
	return x.Cond.Verb == goal.Defeat || customPlace(x) >= 0
}

// customPlace is the settlement whose own goal x is, -1 for any other. A
// raise's or a city's lines are a project, not a goal a settlement renews.
func customPlace(x *Goal) int {
	if x.Build != nil || x.Issuer.Kind != goal.BySettlement && x.Issuer.Kind != goal.ByAdmin {
		return -1
	}
	return x.Board
}

// seasonDayNow is today's day of the season, 0 on a world with no clock.
func (g *Game) seasonDayNow() int64 {
	c, ok := g.clock()
	if !ok {
		return 0
	}
	return c.Day(g.Tick() / sheets.TicksPerDay)
}

// lineOf is a lined goal's line this season, made when first seen.
func (g *Game) lineOf(x *Goal) *emerge.Line {
	e := g.Emergence
	if e == nil || !lined(x) {
		return nil
	}
	sig := signature(x)
	if l := e.Lines[sig]; l != nil {
		return l
	}
	region, at := g.goalPlace(x)
	l := &emerge.Line{Sig: sig, Goal: x.ID, Standing: x.Lifetime == goal.Standing, Region: region, At: at,
		Place: customPlace(x), FirstDay: g.seasonDayNow()}
	if x.Cond.Verb == goal.Defeat {
		l.Archetype = x.Cond.Kind
	}
	e.Lines[sig] = l
	return l
}

// noteGoal reads a goal going live onto its line, which follows its newest
// goal.
func (g *Game) noteGoal(x *Goal) {
	if g.Emergence == nil || x.State != goal.Live {
		return
	}
	l := g.lineOf(x)
	if l == nil || cmpID(x.ID, l.Goal) < 0 {
		return
	}
	l.Goal, l.Standing = x.ID, x.Lifetime == goal.Standing
}

// noteCredit reads one event a goal counted: a unit counted short of a
// claim is an attempt on its line, a claim meets the line, and a First
// goal reaching its contributors may be a rival claim. A staged fact, a
// pin's or a thread's counts toward none of it.
func (g *Game) noteCredit(x *Goal, ev goal.Event, f fact.Fact, contributors, cites int, claims []goal.Claim) {
	if g.Emergence == nil || len(claims) == 0 && len(x.Facts) == cites && len(x.Progress) == contributors {
		return
	}
	if f.StagedBy != nil || untraced(f.Kind) {
		return
	}
	l := g.lineOf(x)
	switch {
	case l == nil:
	case len(claims) > 0:
		l.Met = true
	case len(x.Facts) > cites && !x.Cond.Hold() && ev.Who != "" && x.State == goal.Live:
		if l.Archetype == "" && x.Cond.Verb == goal.Defeat {
			l.Archetype = ev.Kind
		}
		g.attempt(l, ev.Who, f.Tick/sheets.TicksPerDay)
	}
	need := g.r.Emerge.P.OpposedContributors
	if x.Mode == goal.First && x.State == goal.Live && int64(contributors) < need && int64(len(x.Progress)) >= need {
		g.indexContest(x)
	}
}

// attempt counts one character's try at a line on a day, once a day.
func (g *Game) attempt(l *emerge.Line, who string, day int64) {
	l.Attempts.See(who+attemptAt+strconv.FormatInt(day, decimal), day, g.Emergence.Season, g.r.Emerge.Lines.Line(emerge.Legend).Count)
}

// goalPlace is the region and tile a goal's place names: a region's
// centre, a settlement's or a tile, else its board.
func (g *Game) goalPlace(x *Goal) (int, hex.Hex) {
	var h hex.Hex
	if x.Board >= 0 && x.Board < len(g.Places) {
		h = g.SettlementHex(x.Board)
	}
	c := x.Cond
	switch kind, id, _ := goal.ParseRef(c.At); {
	case c.Hex != nil:
		h = *c.Hex
	case kind == goal.PlaceRegion:
		if r, ok := g.regionOf(c.At); ok {
			return r, g.regionHex(r)
		}
	case kind == goal.PlaceSettlement:
		if n, ok := goal.SettlementOf(c.At); ok && n < len(g.Places) {
			h = g.SettlementHex(n)
		}
	case kind == goal.PlaceTile:
		if t, ok := hex.ParseRef(id); ok {
			h = t
		}
	}
	return g.World.RegionAt(h), h
}

// goalGuild is the guild a goal is posted for: a muster's own, else the
// guild that runs its board's settlement; "" for none.
func (g *Game) goalGuild(x *Goal) string {
	if x.Issuer.Kind == goal.ByAdmin {
		return x.Issuer.ID
	}
	if x.Board >= 0 && x.Board < len(g.Places) {
		return g.Places[x.Board].Guild
	}
	return ""
}

// indexContest pairs a First goal that has just reached its contributors
// with every live one racing it for the same thing in the same region on
// another guild's behalf (GDD 17.6). It runs once a goal, when it becomes
// ready, so the arc view reads a short list.
func (g *Game) indexContest(x *Goal) {
	e := g.Emergence
	gx := g.goalGuild(x)
	rx, _ := g.goalPlace(x)
	if gx == "" || rx < 0 {
		return
	}
	need := g.r.Emerge.P.OpposedContributors
	for _, y := range g.Goals {
		if y == x || y.Mode != goal.First || !g.liveGoal(y.ID) || int64(len(y.Progress)) < need ||
			y.Cond.Verb != x.Cond.Verb || y.Cond.Kind != x.Cond.Kind || y.Cond.Tag != x.Cond.Tag {
			continue
		}
		if gy := g.goalGuild(y); gy == "" || gy == gx {
			continue
		}
		if ry, _ := g.goalPlace(y); ry != rx {
			continue
		}
		a, b := y, x
		if cmpID(a.ID, b.ID) > 0 {
			a, b = b, a
		}
		if slices.ContainsFunc(e.Contests, func(c *emerge.Contest) bool { return c.A == a.ID && c.B == b.ID }) {
			continue
		}
		tag := x.Cond.Kind
		if tag == "" {
			tag = x.Cond.Tag
		}
		e.Contests = append(e.Contests, &emerge.Contest{A: a.ID, B: b.ID, SeatA: a.Board, SeatB: b.Board, Region: rx, Tag: tag})
	}
}

func init() {
	registerEmerge(emergeHook{Name: "goal-lines", Order: linesOrder, Kinds: []string{factEncounterLost, factEncounterLeft},
		Fact: linesFact, Day: linesDay, Begin: linesBegin})
}

// structural: the lines are kept before the legends and customs that read
// them at the close.
const linesOrder = 60

// The encounter outcomes an attempt is read from.
const (
	factEncounterLost = "encounter.lost"
	factEncounterLeft = "encounter.left"
)

// defeated is the creature kind and tags a Defeat event reads from an
// encounter's or a hunt's fact: its archetype, else its creature.
func defeated(f fact.Fact) (string, []string) {
	a, _ := f.Get("archetype")
	kind := a.S
	if kind == "" {
		c, _ := f.Get("creature")
		kind = c.S
	}
	var tags []string
	if t, _ := f.Get("tags"); t.S != "" {
		tags = strings.Split(t.S, ",")
	}
	return kind, tags
}

// linesFact counts an encounter lost or left as an attempt on every Defeat
// line it is fought under: its archetype, its tags and its place.
func linesFact(g *Game, f fact.Fact) error {
	h, ok := fact.HexOf(f)
	if !ok {
		return nil
	}
	e := g.Emergence
	kind, tags := defeated(f)
	ev := goal.Event{Fact: f.ID, Verb: goal.Defeat, Kind: kind, Tags: tags, Hex: h, Places: g.placesOf(h)}
	day := f.Tick / sheets.TicksPerDay
	for _, sig := range slices.Sorted(maps.Keys(e.Lines)) {
		l := e.Lines[sig]
		x := g.GoalOf(l.Goal)
		if x == nil || x.Cond.Verb != goal.Defeat || !x.Cond.Matches(ev) {
			continue
		}
		if l.Archetype == "" {
			l.Archetype = kind
		}
		for _, s := range f.Subjects {
			if s.Kind == renownCharacter {
				g.attempt(l, s.ID, day)
			}
		}
	}
	return nil
}

// linesDay counts a day posted on every line whose goal stands live, and
// lets a line go once it can neither stand into a legend nor count toward
// a custom, so the lines stay bounded by the goals that are up.
func linesDay(g *Game, day, _ int64) error {
	c, ok := g.clock()
	if !ok {
		return nil
	}
	e := g.Emergence
	left := c.Start + c.Days - day
	for _, sig := range slices.Sorted(maps.Keys(e.Lines)) {
		l := e.Lines[sig]
		if g.liveGoal(l.Goal) {
			l.Days++
			continue
		}
		x := g.GoalOf(l.Goal)
		stands := x != nil && x.Cond.Verb == goal.Defeat && g.postedShare(l.Days+left, c.Days)
		if !stands && (l.Place < 0 || !l.Met) {
			delete(e.Lines, sig)
		}
	}
	e.Contests = slices.DeleteFunc(e.Contests, func(c *emerge.Contest) bool { return !g.liveGoal(c.A) || !g.liveGoal(c.B) })
	return nil
}

// postedShare reports whether a line posted on days of a season's length
// stood long enough to be standing (GDD 13.2).
func (g *Game) postedShare(days, length int64) bool {
	return days*fixed.Hundredths >= g.r.Emerge.P.LegendPostedShare*length
}

// linesBegin opens the new season's lines on every goal still up.
func linesBegin(g *Game, _ int64) error {
	for _, x := range g.Goals {
		g.noteGoal(x)
	}
	return nil
}

// contests are the rival claims indexed so far (GDD 17.6) whose goals both
// still stand live, cast or not; the arc view reads them and casting marks
// them.
func (g *Game) contests() []*emerge.Contest {
	if g.Emergence == nil {
		return nil
	}
	var out []*emerge.Contest
	for _, c := range g.Emergence.Contests {
		if g.liveGoal(c.A) && g.liveGoal(c.B) {
			out = append(out, c)
		}
	}
	return out
}

// liveGoal reports whether a goal stands live and shown.
func (g *Game) liveGoal(id string) bool {
	x := g.GoalOf(id)
	return x != nil && x.State == goal.Live && !x.Hidden
}
