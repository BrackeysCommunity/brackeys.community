package game

import (
	"cmp"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/econ"
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

// see reads a fact as goal events: what a character did, to what, where.
// Facts no verb counts read as nothing; a first step onto a tile is both a
// Reach and a Discover.
func (g *Game) see(f fact.Fact) []goal.Event {
	e, ok := g.event(f)
	if !ok {
		return nil
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
	case "goal.held":
		e.Verb, e.Goal, e.Gauge, e.Value, e.Units = goal.Hold, str("goal"), str("gauge"), num("value"), num("day")
	case "rescue.carried":
		e.Verb, e.Kind = goal.Carry, str("who")
	case "travel.entered":
		e.Verb = goal.Reach
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
		e.Verb, e.Kind = goal.Defeat, str("archetype")
		e.Tags = strings.Split(str("tags"), ",")
	case "item.equipped":
		in := g.itemOf(who, str("item"))
		if in == nil {
			return e, false
		}
		e.Verb = goal.Equip
		if k, ok := g.Kinds.Kind(in.Kind); ok {
			e.Kind, e.Tags = k.ID, tagStrings(k.Tags)
		}
	default:
		return e, false
	}
	return e, e.Verb != ""
}

// discovered is a first entry read as a Discover: the tile's site, the
// tags of the materials it holds, and its generated fields.
func (g *Game) discovered(e goal.Event, h hex.Hex) goal.Event {
	e.Verb, e.Tags = goal.Discover, nil
	b := g.r.Gen.Baseline(h)
	e.Kind, e.Fields = b.Site, b.Fields()
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
	if material == ledger.Provisions {
		return []string{ledger.Provisions}
	}
	return slices.Clone(g.r.matTags[material])
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
// reward per goal from the treasury. Every line is drafted before any is
// posted, so a refusal posts none.
func (g *Game) raise(c *Char, cmd Command) error {
	gd, err := g.officerOf(c)
	if err != nil {
		return err
	}
	p := g.PlaceAt(c.C.At)
	row := g.r.structures[cmd.Slot]
	switch {
	case p == nil || p.Guild != gd.G.ID:
		return refuse(NotHere, "%s raises structures at a settlement it runs", gd.G.Name)
	case row == nil:
		return refuse(BadArgs, "no structure %q", cmd.Slot)
	case g.raising(p.N, row.ID):
		return refuse(BadArgs, "the %s is already being raised", row.ID)
	}
	tier, lines, ok := p.Next(row, g.r.Settle)
	switch {
	case !ok && len(lines) > 0:
		return refuse(BadArgs, "the %s is at its highest tier", row.ID)
	case !ok:
		return refuse(BadArgs, "the %s is not raised by goals", row.ID)
	}
	name := g.r.Name("settlements.structures:" + row.ID)
	if name == "" {
		name = row.ID
	}
	var drafts []*Goal
	var need int64
	for _, l := range lines {
		x, err := g.draft(c, GoalSpec{Title: name + ": " + l.Tag, Issuer: goal.ByAdmin, Reward: cmd.Price, Mode: goal.Pooled,
			Lifetime: goal.Season, Turnover: goal.Keep, Cond: goal.Condition{Verb: goal.Deliver, Tag: l.Tag, Count: l.Quantity, At: goal.SettlementRef(p.N)}})
		if err != nil {
			return err
		}
		drafts = append(drafts, x)
		need += x.Escrow() + x.Fee
	}
	// Each line was quoted alone; together they must still be covered.
	if g.Ledger.Of(TreasuryPool(p.N), ledger.Coin) < need {
		return refuse(BadArgs, "raising the %s takes %d coin from the treasury", row.ID, need)
	}
	if err := g.mayMuster(c, drafts[0], need); err != nil {
		return err
	}
	// The project is named for its first goal, so no two raises share one.
	project := ""
	for i, x := range drafts {
		if err := g.open(c, x, ledger.SubKey(cmd.Key, strconv.Itoa(i))); err != nil {
			return err
		}
		if project == "" {
			project = "raise-" + x.ID
		}
		x.Build = &goal.Build{Settlement: p.N, Structure: row.ID, Tier: tier, Project: project}
	}
	return nil
}

// raising reports whether a structure has a project open.
func (g *Game) raising(settlement int, structure string) bool {
	return slices.ContainsFunc(g.Goals, func(x *Goal) bool {
		return x.Build != nil && x.Build.Settlement == settlement && x.Build.Structure == structure && x.Open()
	})
}

// built raises a structure once every goal of its project is met.
func (g *Game) built(b *goal.Build) error {
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
// fact, ephemeral goals past their time end (a vow to hold off a thing is
// kept if unbroken), a season's close turns every season goal over, and
// each faction posts the day's bounty.
func (g *Game) goalsTurn(t int64) error {
	day := t / sheets.TicksPerDay
	key := ledger.SubKey("goals", strconv.FormatInt(day, decimal))
	first := fact.ID(g.Log.Len())
	for _, x := range g.Goals {
		if x.State != goal.Live || !x.Cond.Hold() || x.Hidden {
			continue
		}
		// The reading is a fact of the region held, wherever its board is.
		if r, ok := g.regionOf(x.Cond.At); ok {
			v := g.World.Regions[r].Gauge[g.World.GaugeIndex(x.Cond.Gauge)]
			if _, err := g.regionFact(world.RegionRef(r), "goal.held", []fact.Ref{goalRef(x.ID)}, nil,
				fact.S("goal", x.ID), fact.S("gauge", x.Cond.Gauge), fact.N("value", v), fact.N("day", day)); err != nil {
				return err
			}
		}
	}
	if err := g.creditGoals(first, key); err != nil {
		return err
	}
	closing := day%g.r.wp("season-days") == 0
	for _, x := range g.Goals {
		if !x.Open() {
			continue
		}
		due := x.Due(t)
		if closing && x.Turn(day/g.r.wp("season-days"), day, g.seasonRatio(), g.rebind) {
			due = true
		}
		if !due {
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
		x := &Goal{Title: "Thin the beasts of " + g.r.NPC.PlaceName("region", world.RegionRef(r)),
			Issuer: issuer, Scope: goal.World, Board: n, Reward: reward, Mode: goal.Pooled, Lifetime: goal.Ephemeral, Turnover: goal.Expire,
			Posted: t, Expires: t + g.gp("bounty-days")*sheets.TicksPerDay, State: goal.Live,
			Cond: goal.Condition{Verb: goal.Defeat, Count: g.gp("bounty-kills"), At: goal.RegionRef(world.RegionRef(r))}}
		g.openGoal(x)
		if err := g.post(ledger.Move(ledger.SubKey(key, "bounty", strconv.Itoa(n)), "bounty", t, ledger.FromFaction, goalPool(x.ID), ledger.Coin, reward)); err != nil {
			return err
		}
		if _, err := g.worldFact(p.Hex, "goal.posted", []fact.Ref{goalRef(x.ID)}, nil, fact.S("verb", goal.Defeat), fact.S("issuer", goal.ByFaction), fact.N("reward", reward)); err != nil {
			return err
		}
	}
	return nil
}

// bounty reports whether a goal is a live faction bounty on a
// settlement's board.
func bounty(x *Goal, n int) bool {
	return x.Board == n && x.Issuer.Kind == goal.ByFaction && x.State == goal.Live
}

// bountyOpen reports whether a settlement's board still shows a live
// faction bounty.
func (g *Game) bountyOpen(n int) bool {
	return slices.ContainsFunc(g.Goals, func(x *Goal) bool { return bounty(x, n) })
}

// bountyHeld is what a settlement's faction holds out in bounties posted
// today, taken from its faction orders' budget.
func (g *Game) bountyHeld(n int) int64 {
	var out int64
	for _, x := range g.Goals {
		if bounty(x, n) && x.Posted == g.Tick() {
			out += x.Reward
		}
	}
	return out
}

// threatened is the region near a settlement with the most threat over
// the ambush line, if any.
func (g *Game) threatened(h hex.Hex) (int, bool) {
	near := g.r.NPC.Param("news-range")
	line := g.gp("bounty-threat")
	best, bestV := -1, int64(0)
	ti := g.World.GaugeIndex("threat")
	for i, r := range g.World.Regions {
		if !r.Discovered || r.Gauge[ti] < line || hex.Distance(g.r.Gen.Region(r.Lattice).Centre, h) > near {
			continue
		}
		if r.Gauge[ti] > bestV {
			best, bestV = i, r.Gauge[ti]
		}
	}
	return best, best >= 0
}

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
		out = append(out, Draft{Why: "a source of " + g.MaterialName(m) + " near here is worked out",
			Spec: GoalSpec{Title: "Find the next " + g.MaterialName(m), Issuer: goal.ByCharacter, Mode: goal.First, Lifetime: goal.Standing, Turnover: goal.Keep,
				Reward: g.gp("reward-least"), Cond: goal.Condition{Verb: goal.Discover, Tag: tag, Count: 1, Hex: &h, Within: g.r.NPC.Param("news-range")}}})
	}
	if r, ok := g.threatened(h); ok {
		out = append(out, Draft{Why: g.r.NPC.PlaceName("region", world.RegionRef(r)) + " is the most threatened region near here",
			Spec: GoalSpec{Title: "Keep " + g.r.NPC.PlaceName("region", world.RegionRef(r)) + " quiet", Issuer: goal.BySettlement, Mode: goal.Pooled,
				Lifetime: goal.Season, Turnover: goal.Evolve, Cond: goal.Condition{Verb: goal.Hold, Gauge: "threat", Line: g.gp("bounty-threat"), Below: true,
					Count: g.gp("hold-days"), At: goal.RegionRef(world.RegionRef(r))}}})
	}
	if m, ok := g.lacking(n); ok {
		out = append(out, Draft{Why: "nobody is selling " + g.MaterialName(m) + " here and a faction wants it",
			Spec: GoalSpec{Title: "Bring " + g.MaterialName(m), Issuer: goal.ByCharacter, Mode: goal.First, Lifetime: goal.Ephemeral, Turnover: goal.Expire,
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
		if n.Kind != "node.worked-out" || hex.Distance(n.At, h) > g.r.NPC.Param("news-range") {
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
