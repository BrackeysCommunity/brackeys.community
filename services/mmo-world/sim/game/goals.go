package game

import (
	"cmp"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// Commands of goals (GDD 11).
const (
	PostGoal     = "goal-post"     // post a goal from a spec
	Pledge       = "goal-pledge"   // pledge coin to a settlement proposal or a goal's reward
	DeliverGoal  = "goal-deliver"  // hand goods to a Deliver goal, or a haul at its end
	TakeHaul     = "goal-haul"     // take a Haul goal's stock, putting up collateral
	WithdrawGoal = "goal-withdraw" // the issuer takes a goal down
	CallHelp     = "help"          // a downed character calls for help (GDD 11.6)
	CarryHome    = "carry"         // pick up a downed character to carry home
	HideGoal     = "goal-hide"     // an operator hides a goal (MM6.7)
)

// GoalSpec is what a poster chooses: the verb and target, the reward, the
// mode, lifetime and turnover, and the words.
type GoalSpec struct {
	Title    string         `json:"title"`
	Note     string         `json:"note,omitempty"`
	Issuer   string         `json:"issuer"` // character, party, settlement or admin
	Members  []string       `json:"members,omitempty"`
	Cond     goal.Condition `json:"cond"`
	Reward   int64          `json:"reward"`
	Mode     string         `json:"mode"`
	Cap      int64          `json:"cap,omitempty"`
	Lifetime string         `json:"lifetime"`
	Turnover string         `json:"turnover"`
	// Ticks is how long an ephemeral goal lasts.
	Ticks int64 `json:"ticks,omitempty"`
	Even  bool  `json:"even,omitempty"`
	// Material and Units: a Haul's stock, escrowed from the poster.
	Material string `json:"material,omitempty"`
	Units    int64  `json:"units,omitempty"`
}

// Goal is a goal as the game holds it.
type Goal = goal.Goal

// GoalOf finds a goal, or nil.
func (g *Game) GoalOf(id string) *Goal {
	i, ok := slices.BinarySearchFunc(g.Goals, id, func(x *Goal, id string) int { return cmpID(x.ID, id) })
	if !ok {
		return nil
	}
	return g.Goals[i]
}

// cmpID orders ids by length then text, so q-9 sorts before q-10.
func cmpID(a, b string) int { return cmp.Or(cmp.Compare(len(a), len(b)), cmp.Compare(a, b)) }

func goalRef(id string) fact.Ref { return fact.Ref{Kind: "goal", ID: id} }

// goalPool is a goal's escrow.
func goalPool(id string) string { return ledger.EscrowPool(id) }

func (g *Game) gp(id string) int64 { return sheets.IntParam(g.r.Book.GoalParams, id) }

func (g *Game) limits() goal.Limits {
	return goal.Limits{RewardLeast: g.gp("reward-least"), EachCap: g.gp("each-cap"), PartyMost: g.gp("party-most"),
		TitleLen: g.gp("title-length"), NoteLen: g.gp("note-length"),
		EphemeralLeast: g.gp("ephemeral-least"), EphemeralMost: g.gp("ephemeral-most") * sheets.TicksPerDay}
}

// LiveGoals counts the goals a character has posted that are still up.
func (g *Game) LiveGoals(c *Char) int64 {
	var n int64
	for _, x := range g.Goals {
		if x.Poster == c.C.ID && x.Issuer.Kind != goal.ByAdmin && (x.State == goal.Live || x.State == goal.Proposed) {
			n++
		}
	}
	return n
}

func (g *Game) goalAct(c *Char, cmd Command) error {
	switch cmd.Kind {
	case PostGoal:
		if cmd.Goal == nil {
			return refuse(BadArgs, "a goal needs a spec")
		}
		_, err := g.postGoal(c, cmd.Key, *cmd.Goal)
		return err
	case Pledge:
		return g.pledge(c, cmd)
	case DeliverGoal:
		return g.deliver(c, cmd)
	case TakeHaul:
		return g.takeHaul(c, cmd)
	case WithdrawGoal:
		return g.withdrawGoal(c, cmd)
	case CallHelp:
		return g.callHelp(c, cmd)
	case CarryHome:
		return g.carry(c, cmd)
	case Raise:
		return g.raise(c, cmd)
	}
	return refuse(BadArgs, "unknown command %q", cmd.Kind)
}

// postGoal checks a spec and posts it: the fee and escrow from whoever
// pays (the poster, the treasury, or for a proposal its pledges once it
// goes live), a fact, and the goal on its settlement's board.
func (g *Game) postGoal(c *Char, key string, s GoalSpec) (*Goal, error) {
	board, onBoard := g.SettlementAt(c.C.At)
	if !onBoard {
		return nil, refuse(NotHere, "goals are posted at a settlement's notice board")
	}
	if s.Issuer != goal.ByAdmin && g.LiveGoals(c) >= g.gp("live-goals") {
		return nil, refuse(BadArgs, "%s has %d live goals already", c.C.ID, g.gp("live-goals"))
	}
	if w := g.blocked(s.Title + " " + s.Note); w != "" {
		return nil, refuse(Screened, "the title or note holds a word the board does not take")
	}
	x := &Goal{Title: s.Title, Note: s.Note, Poster: c.C.ID, Board: board, Cond: s.Cond, Reward: s.Reward, Mode: s.Mode, Cap: s.Cap,
		Lifetime: s.Lifetime, Turnover: s.Turnover, Posted: g.Tick(), Season: g.season(), State: goal.Live, Progress: nil, Members: s.Members}
	if s.Lifetime == goal.Ephemeral {
		x.Expires = g.Tick() + s.Ticks
	}
	if err := g.issue(c, x, s); err != nil {
		return nil, err
	}
	if err := goal.Valid(x, g.Tick(), g.limits()); err != nil {
		return nil, refuse(BadArgs, "%v", err)
	}
	if x.Cond.Verb == goal.Haul {
		if err := g.cargo(c, x, s); err != nil {
			return nil, err
		}
	}
	if err := g.quote(c, x); err != nil {
		return nil, err
	}
	g.NextGoal++
	x.ID = "q-" + strconv.FormatInt(g.NextGoal, decimal)
	if g.charScale(c, "board-first-days", 0) > 0 {
		x.Front = g.Tick() + g.charScale(c, "board-first-days", 0)*sheets.TicksPerDay
	}
	if err := g.fund(c, x, key); err != nil {
		return nil, err
	}
	g.insertGoal(x)
	c.C.Goals.Bump("posted", 1)
	_, err := g.factWith(c, []fact.Ref{goalRef(x.ID)}, "goal.posted", g.Tick(), fact.S("verb", x.Cond.Verb), fact.S("mode", x.Mode),
		fact.N("reward", x.Reward), fact.S("issuer", x.Issuer.Kind), fact.N("settlement", int64(board)))
	return x, err
}

// Screened is a goal's words refused by the word list.
const Screened = "screened"

// paid marks a met goal whose claims are paid and escrow emptied.
const paid = "paid"

func (g *Game) insertGoal(x *Goal) {
	i, _ := slices.BinarySearchFunc(g.Goals, x.ID, func(y *Goal, id string) int { return cmpID(y.ID, id) })
	g.Goals = slices.Insert(g.Goals, i, x)
}

// issue sets who issues a goal and its scope from the spec: a character
// alone, a party it names, a settlement proposal waiting for pledges, or
// an officer's muster from the treasury.
func (g *Game) issue(c *Char, x *Goal, s GoalSpec) error {
	x.Issuer = goal.Ref{Kind: s.Issuer, ID: c.C.ID}
	x.Scope = goal.World
	switch s.Issuer {
	case goal.ByCharacter:
		if len(s.Members) > 0 {
			return refuse(BadArgs, "a character's goal names no members; a party's does")
		}
	case goal.ByParty:
		x.Scope = goal.Party
		x.Members = append([]string{c.C.ID}, s.Members...)
		for _, m := range s.Members {
			if g.Char(m) == nil {
				return refuse(BadArgs, "no character %q", m)
			}
		}
	case goal.BySettlement:
		x.Scope, x.State = goal.Settlement, goal.Proposed
		x.Issuer.ID = "settlement:" + strconv.Itoa(x.Board)
		x.Need = g.charScale(c, "pledge-need", g.gp("pledge-need"))
		if x.Mode == goal.Pooled && s.Even && g.charScale(c, "even-shares", 0) > 0 {
			x.Even = true
		}
	case goal.ByAdmin:
		p := g.Places[x.Board]
		gd := g.GuildOf(p.Guild)
		if gd == nil || !gd.G.IsOfficer(c.C.ID) {
			return refuse(BadArgs, "a muster is posted by an officer of the guild that runs this settlement")
		}
		x.Scope = goal.Settlement
		x.Issuer.ID = gd.G.ID
	default:
		return refuse(BadArgs, "no issuer %q", s.Issuer)
	}
	if s.Cond.Verb == goal.Hold && s.Cond.Abstains() {
		x.Members = []string{c.C.ID}
		x.Scope = goal.Personal
	}
	return nil
}

// cargo escrows a Haul's stock from the poster, who must stand where it
// starts.
func (g *Game) cargo(c *Char, x *Goal, s GoalSpec) error {
	if x.Cond.From != "settlement:"+strconv.Itoa(x.Board) || s.Material == "" || s.Units <= 0 {
		return refuse(BadArgs, "a Haul is posted where its stock starts, with the stock named")
	}
	x.Cond.Count, x.Cond.Kind = s.Units, s.Material
	x.Cargo = &goal.Cargo{Material: s.Material, Units: s.Units}
	return g.afford(c, ledger.Goods(s.Material), s.Material, s.Units)
}

// payer is who funds a goal: the poster's purse, or a muster's treasury.
func payer(c *Char, x *Goal) string {
	if x.Issuer.Kind == goal.ByAdmin {
		return TreasuryPool(x.Board)
	}
	return ledger.Char(c.C.ID)
}

// quote sets a live goal's listing fee and refuses a payer who cannot
// cover it and the escrow; a proposal pays when it goes live. It runs
// before anything moves, so a refused post changes nothing.
func (g *Game) quote(c *Char, x *Goal) error {
	if x.State == goal.Proposed {
		return nil
	}
	x.Fee = 0
	if !x.Vow() {
		x.Fee = g.charScale(c, "listing-fee", g.r.Values.GoalFee(x.Escrow()))
	}
	if need := x.Escrow() + x.Fee; g.Ledger.Of(payer(c, x), ledger.Coin) < need {
		return refuse(BadArgs, "posting takes %d coin, the reward and a %d coin listing fee", need, x.Fee)
	}
	return nil
}

// fund moves a quoted goal's cargo, escrow and fee.
func (g *Game) fund(c *Char, x *Goal, key string) error {
	payer := payer(c, x)
	if x.Cargo != nil {
		x.Cargo.Collateral = g.r.Values.Asset(x.Cargo.Material) * x.Cargo.Units * g.gp("collateral") / hundred
		if err := g.postAll(ledger.Move(ledger.SubKey(key, "cargo"), "goal-cargo", g.Tick(), ledger.Char(c.C.ID), goalPool(x.ID), ledger.Goods(x.Cargo.Material), x.Cargo.Units)); err != nil {
			return err
		}
	}
	if x.State == goal.Proposed {
		return nil
	}
	var legs []ledger.Leg
	if x.Escrow() > 0 {
		legs = ledger.Pair(payer, goalPool(x.ID), ledger.Coin, x.Escrow())
	}
	if x.Fee > 0 {
		legs = append(legs, ledger.Pair(payer, ledger.ToGoalFees, ledger.Coin, x.Fee)...)
	}
	if len(legs) == 0 {
		return nil
	}
	return g.postAll(ledger.Txn{Key: ledger.SubKey(key, "fund"), Kind: "goal-fund", Tick: g.Tick(), Legs: ledger.Merge(legs)})
}

// pledge adds coin to a proposal (live at its need) or to a first or
// pooled goal's reward.
func (g *Game) pledge(c *Char, cmd Command) error {
	x := g.GoalOf(cmd.Target)
	switch {
	case x == nil || x.Hidden || (x.State != goal.Proposed && x.State != goal.Live):
		return refuse(BadArgs, "no open goal %q", cmd.Target)
	case x.State == goal.Live && (x.Mode == goal.Each || x.Vow()):
		return refuse(BadArgs, "only a proposal or a first or pooled goal with a reward takes pledges")
	case cmd.Units <= 0 || c.C.Coin < cmd.Units:
		return refuse(BadArgs, "a pledge is coin %s holds", c.C.ID)
	}
	if err := g.postAll(ledger.Move(cmd.Key, "pledge", g.Tick(), ledger.Char(c.C.ID), goalPool(x.ID), ledger.Coin, cmd.Units)); err != nil {
		return err
	}
	x.Pledges.Bump(c.C.ID, cmd.Units)
	c.C.Deeds.Bump(DeedPledged, cmd.Units)
	if x.State == goal.Live {
		x.Reward += cmd.Units
	}
	if _, err := g.factWith(c, []fact.Ref{goalRef(x.ID)}, "goal.pledged", g.Tick(), fact.N("coin", cmd.Units)); err != nil {
		return err
	}
	if x.State == goal.Proposed && x.Pledges.Sum() >= x.Need {
		return g.goLive(x, cmd.Key)
	}
	return nil
}

// goLive turns a proposal whose pledges reached its need into a live goal:
// the fee from the pool, the rest the reward.
func (g *Game) goLive(x *Goal, key string) error {
	pool := g.Ledger.Of(goalPool(x.ID), ledger.Coin)
	x.Fee = g.r.Values.GoalFee(pool)
	if x.Mode == goal.Each {
		x.Reward = (pool - x.Fee) / max(x.Cap, 1)
	} else {
		x.Reward = pool - x.Fee
	}
	if err := g.post(ledger.Move(ledger.SubKey(key, "live"), "goal-fee", g.Tick(), goalPool(x.ID), ledger.ToGoalFees, ledger.Coin, x.Fee)); err != nil {
		return err
	}
	x.State = goal.Live
	_, err := g.worldFact(g.SettlementHex(x.Board), "goal.live", []fact.Ref{goalRef(x.ID)}, nil, fact.N("reward", x.Reward))
	return err
}

// deliver hands goods to a Deliver goal at its place, or a haul's stock at
// its end: to the issuer, into a structure being raised, or into the
// settlement's treasury.
func (g *Game) deliver(c *Char, cmd Command) error {
	x := g.GoalOf(cmd.Target)
	if x == nil || x.State != goal.Live || x.Hidden || !x.May(c.C.ID) {
		return refuse(BadArgs, "no live goal %q for %s", cmd.Target, c.C.ID)
	}
	if !slices.Contains(g.placesOf(c.C.At), x.Cond.At) {
		return refuse(NotHere, "it is delivered at %s", x.Cond.At)
	}
	if x.Cond.Verb == goal.Haul {
		return g.haulIn(c, x, cmd.Key)
	}
	if x.Cond.Verb != goal.Deliver {
		return refuse(BadArgs, "%s is not met by a delivery", x.ID)
	}
	material := cmd.Material
	if !g.matches(x.Cond, material) {
		return refuse(BadArgs, "%s does not take %s", x.ID, material)
	}
	left := x.Cond.Count - x.Total()
	if x.Mode != goal.Pooled {
		left = x.Cond.Count - x.Progress.Get(c.C.ID)
	}
	units := min(cmd.Units, left)
	if units <= 0 {
		return refuse(BadArgs, "%s needs no more", x.ID)
	}
	asset := ledger.Goods(material)
	if err := g.afford(c, asset, material, units); err != nil {
		return err
	}
	if err := g.postAll(ledger.Move(cmd.Key, "goal-delivery", g.Tick(), ledger.Char(c.C.ID), g.deliveredTo(x), asset, units)); err != nil {
		return err
	}
	_, err := g.factWith(c, []fact.Ref{goalRef(x.ID)}, "goal.delivered", g.Tick(), append([]fact.Datum{fact.S("goal", x.ID), fact.S("material", material),
		fact.N("units", units)}, fact.At(c.C.At)...)...)
	return err
}

// matches reports whether a material is what a Deliver condition asks.
func (g *Game) matches(c goal.Condition, material string) bool {
	if c.Kind != "" && c.Kind != material {
		return false
	}
	return c.Tag == "" || g.materialHas(material, c.Tag)
}

// deliveredTo is where a delivery goes: a structure's goods are sunk into
// it, a settlement's into its treasury, a muster's into its guild's bank,
// anyone else's to the issuer.
func (g *Game) deliveredTo(x *Goal) string {
	switch {
	case x.Build != nil:
		return ledger.ToBuild
	case x.Issuer.Kind == goal.BySettlement:
		return TreasuryPool(x.Board)
	case x.Issuer.Kind == goal.ByAdmin:
		if gd := g.GuildOf(x.Issuer.ID); gd != nil {
			return gd.Pool()
		}
		return TreasuryPool(x.Board)
	case x.Issuer.Kind == goal.ByFaction:
		return ledger.ToFaction
	}
	return ledger.Char(x.Poster)
}

// placesOf are the refs a tile is in: its tile, region and settlement.
func (g *Game) placesOf(h hex.Hex) []string {
	out := []string{"tile:" + h.Ref()}
	if r := g.World.RegionAt(h); r >= 0 {
		out = append(out, "region:"+world.RegionRef(r))
	}
	if n, ok := g.SettlementAt(h); ok {
		out = append(out, "settlement:"+strconv.Itoa(n))
	}
	return out
}

// takeHaul hands a Haul goal's stock to a hauler at its start, against
// collateral (a Chandler's Bonded halves it).
func (g *Game) takeHaul(c *Char, cmd Command) error {
	x := g.GoalOf(cmd.Target)
	switch {
	case x == nil || x.State != goal.Live || x.Cargo == nil || x.Hidden:
		return refuse(BadArgs, "no live Haul %q", cmd.Target)
	case x.Cargo.Hauler != "":
		return refuse(BadArgs, "%s is already being hauled", x.ID)
	case x.Poster == c.C.ID:
		return refuse(BadArgs, "a poster does not haul its own stock")
	case !slices.Contains(g.placesOf(c.C.At), x.Cond.From):
		return refuse(NotHere, "the stock waits at %s", x.Cond.From)
	}
	collateral := g.charScale(c, "haul-collateral", x.Cargo.Collateral)
	if c.C.Coin < collateral {
		return refuse(BadArgs, "taking it puts up %d coin of collateral", collateral)
	}
	legs := append(ledger.Pair(goalPool(x.ID), ledger.Char(c.C.ID), ledger.Goods(x.Cargo.Material), x.Cargo.Units),
		ledger.Pair(ledger.Char(c.C.ID), goalPool(x.ID), ledger.Coin, collateral)...)
	if collateral == 0 {
		legs = ledger.Pair(goalPool(x.ID), ledger.Char(c.C.ID), ledger.Goods(x.Cargo.Material), x.Cargo.Units)
	}
	if err := g.postAll(ledger.Txn{Key: cmd.Key, Kind: "haul-taken", Tick: g.Tick(), Legs: legs}); err != nil {
		return err
	}
	x.Cargo.Hauler, x.Cargo.Taken, x.Cargo.Collateral = c.C.ID, g.Tick(), collateral
	_, err := g.factWith(c, []fact.Ref{goalRef(x.ID)}, "goal.haul-taken", g.Tick(), fact.N("collateral", collateral))
	return err
}

// haulIn delivers a haul at its end: the stock, intact, to the poster,
// the collateral back, and the fact the goal counts.
func (g *Game) haulIn(c *Char, x *Goal, key string) error {
	if x.Cargo.Hauler != c.C.ID {
		return refuse(BadArgs, "%s is %s's to deliver", x.ID, x.Cargo.Hauler)
	}
	asset := ledger.Goods(x.Cargo.Material)
	if err := g.afford(c, asset, x.Cargo.Material, x.Cargo.Units); err != nil {
		return refuse(BadArgs, "the haul is no longer intact")
	}
	legs := ledger.Pair(ledger.Char(c.C.ID), ledger.Char(x.Poster), asset, x.Cargo.Units)
	if x.Cargo.Collateral > 0 {
		legs = append(legs, ledger.Pair(goalPool(x.ID), ledger.Char(c.C.ID), ledger.Coin, x.Cargo.Collateral)...)
	}
	if err := g.postAll(ledger.Txn{Key: key, Kind: "haul-delivered", Tick: g.Tick(), Legs: legs}); err != nil {
		return err
	}
	x.Cargo.Collateral = 0
	_, err := g.factWith(c, []fact.Ref{goalRef(x.ID)}, "goal.hauled", g.Tick(), append([]fact.Datum{fact.S("goal", x.ID), fact.S("material", x.Cargo.Material),
		fact.N("units", x.Cargo.Units), fact.S("from", x.Cond.From)}, fact.At(c.C.At)...)...)
	return err
}

// withdrawGoal takes down a goal nobody has claimed from: escrow and
// pledges back, the fee kept.
func (g *Game) withdrawGoal(c *Char, cmd Command) error {
	x := g.GoalOf(cmd.Target)
	switch {
	case x == nil || (x.State != goal.Live && x.State != goal.Proposed):
		return refuse(BadArgs, "no open goal %q", cmd.Target)
	case x.Poster != c.C.ID:
		return refuse(BadArgs, "only %s may withdraw %s", x.Poster, x.ID)
	case x.Cargo != nil && x.Cargo.Hauler != "":
		return refuse(BadArgs, "%s has been taken", x.ID)
	case len(x.Claims) > 0 && (x.Evolved == 0 || g.World.Day != x.Evolved):
		return refuse(BadArgs, "%s has been claimed from", x.ID)
	}
	return g.endGoal(x, "withdrawn", cmd.Key)
}

// endGoal closes a goal unmet and returns what its escrow holds: pledges to
// their pledgers, a haul's stock and collateral to the poster (the
// collateral forfeit if the hauler never delivered), the rest to whoever
// paid it.
func (g *Game) endGoal(x *Goal, why, key string) error {
	if err := g.refund(x, key); err != nil {
		return err
	}
	x.End(why)
	return g.goalFact(x, "goal.ended", fact.S("why", why))
}

// refund empties a goal's escrow: pledges first, the rest to whoever paid.
func (g *Game) refund(x *Goal, key string) error {
	pool := goalPool(x.ID)
	var legs []ledger.Leg
	for _, p := range x.Pledges {
		if n := min(p.N, g.Ledger.Of(pool, ledger.Coin)-sumLegs(legs, ledger.Coin)); n > 0 {
			legs = append(legs, ledger.Pair(pool, ledger.Char(p.Key), ledger.Coin, n)...)
		}
	}
	back := ledger.Char(x.Poster)
	switch x.Issuer.Kind {
	case goal.ByAdmin:
		back = TreasuryPool(x.Board)
	case goal.ByFaction:
		back = ledger.ToFaction
	}
	for _, h := range g.Ledger.Held(pool) {
		n := h.Units - sumLegs(legs, h.Asset)
		if n > 0 {
			legs = append(legs, ledger.Pair(pool, back, h.Asset, n)...)
		}
	}
	if len(legs) == 0 {
		return nil
	}
	return g.postAll(ledger.Txn{Key: ledger.SubKey(key, "end", x.ID), Kind: "goal-end", Tick: g.Tick(), Legs: ledger.Merge(legs)})
}

// sumLegs is what legs already take from their pools of an asset.
func sumLegs(legs []ledger.Leg, asset string) int64 {
	var n int64
	for _, l := range legs {
		if l.Asset == asset && l.Units < 0 {
			n -= l.Units
		}
	}
	return n
}

// goalFact writes a fact about a goal, on its poster where it has one.
func (g *Game) goalFact(x *Goal, kind string, data ...fact.Datum) error {
	if c := g.Char(x.Poster); c != nil {
		_, err := g.factWith(c, []fact.Ref{goalRef(x.ID)}, kind, g.Tick(), data...)
		return err
	}
	_, err := g.worldFact(g.SettlementHex(x.Board), kind, []fact.Ref{goalRef(x.ID)}, nil, data...)
	return err
}

// callHelp posts a downed character's Carry goal (GDD 11.6): the rescue
// reward from its purse, first to carry it home, expiring when it would
// have crawled out, for it starts crawling too.
func (g *Game) callHelp(c *Char, cmd Command) error {
	if notDown(c) == nil {
		return refuse(BadArgs, "%s is not down", c.C.ID)
	}
	if slices.ContainsFunc(g.Goals, func(x *Goal) bool { return x.State == goal.Live && x.Cond.Verb == goal.Carry && x.Cond.Who == c.C.ID }) {
		return refuse(BadArgs, "%s has already called for help", c.C.ID)
	}
	home := g.HomeOf(c)
	reward := min(c.C.Coin, g.gp("rescue-reward"))
	if reward < g.gp("reward-least") {
		reward = 0
	}
	x := &Goal{Title: "Carry " + c.C.ID + " home", Poster: c.C.ID, Board: home, Issuer: goal.Ref{Kind: goal.ByCharacter, ID: c.C.ID},
		Scope: goal.World, Cond: goal.Condition{Verb: goal.Carry, Who: c.C.ID, Count: 1, At: "settlement:" + strconv.Itoa(home)},
		Reward: reward, Mode: goal.First, Lifetime: goal.Ephemeral, Turnover: goal.Expire, Posted: g.Tick(), Season: g.season(), State: goal.Live}
	if c.Long == nil || c.Long.Kind != Crawl {
		if err := g.crawl(c, cmd); err != nil {
			return err
		}
	}
	x.Expires = c.Long.Due
	if g.quote(c, x) != nil {
		x.Reward, x.Fee = 0, 0
	}
	g.NextGoal++
	x.ID = "q-" + strconv.FormatInt(g.NextGoal, decimal)
	if err := g.fund(c, x, cmd.Key); err != nil {
		return err
	}
	g.insertGoal(x)
	_, err := g.factWith(c, []fact.Ref{goalRef(x.ID)}, "rescue.called", g.Tick(), append([]fact.Datum{fact.N("reward", x.Reward)}, fact.At(c.C.At)...)...)
	return err
}

// HomeOf is the settlement a character calls home: its server's, else
// the first.
func (g *Game) HomeOf(c *Char) int {
	if n, ok := g.home(c.Server); ok {
		return n
	}
	return 0
}

// carry picks up a downed character on the rescuer's tile; the rescuer's
// journeys take it along until a settlement, where it is set down (GDD
// 11.6).
func (g *Game) carry(c *Char, cmd Command) error {
	if err := free(c); err != nil {
		return err
	}
	d := g.Char(cmd.Target)
	switch {
	case d == nil || d == c || notDown(d) == nil:
		return refuse(BadArgs, "%q is not down", cmd.Target)
	case d.C.At != c.C.At:
		return refuse(NotHere, "%s lies elsewhere", d.C.ID)
	case d.CarriedBy != "" || c.Carrying != "":
		return refuse(Busy, "someone is already carried")
	}
	c.Carrying, d.CarriedBy = d.C.ID, c.C.ID
	if d.Long != nil && d.Long.Kind == Crawl {
		d.Long = nil
	}
	d.Version++
	c.C.Meet(char.Met{Who: d.C.ID, How: "rescued", Tick: g.Tick()}, g.r.limits)
	d.C.Meet(char.Met{Who: c.C.ID, How: "rescued-by", Tick: g.Tick()}, g.r.limits)
	_, err := g.factWith(c, []fact.Ref{char.Ref(d.C.ID)}, "rescue.lifted", g.Tick(), fact.At(c.C.At)...)
	return err
}

// carried moves a carried character with its rescuer and sets it down,
// no longer down, when they reach its home settlement.
func (g *Game) carried(c *Char, to hex.Hex, t int64) error {
	d := g.Char(c.Carrying)
	if d == nil {
		c.Carrying = ""
		return nil
	}
	d.C.At = to
	d.Version++
	if n, ok := g.SettlementAt(to); !ok || n != g.HomeOf(d) {
		return nil
	}
	c.Carrying, d.CarriedBy = "", ""
	d.C.Clear(char.Down)
	_, err := g.factWith(c, []fact.Ref{char.Ref(d.C.ID)}, "rescue.carried", t, append([]fact.Datum{fact.S("who", d.C.ID)}, fact.At(to)...)...)
	return err
}

// hideGoal is an operator's hide (MM6.7): the goal leaves the board and
// ends, its escrow returned as a withdrawal.
func (g *Game) hideGoal(cmd Command) error {
	x := g.GoalOf(cmd.Target)
	if x == nil || x.Hidden || cmd.Note == "" {
		return refuse(BadArgs, "a hide names a shown goal and a note")
	}
	x.Hidden = true
	if x.State == goal.Live || x.State == goal.Proposed {
		if err := g.endGoal(x, "hidden", cmd.Key); err != nil {
			return err
		}
	}
	return g.goalFact(x, "goal.hidden", fact.S("note", cmd.Note))
}

// setDown ends a carry without a rescue: the carried lies where it is,
// still down.
func (g *Game) setDown(rescuer, carried *Char) {
	if rescuer != nil {
		rescuer.Carrying = ""
		rescuer.Version++
	}
	if carried != nil {
		carried.CarriedBy = ""
		carried.Version++
	}
}

// blocked is the first word of the goals word list a text holds, or "".
func (g *Game) blocked(text string) string {
	words := strings.FieldsFunc(strings.ToLower(text), func(r rune) bool {
		return (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '\''
	})
	for _, w := range words {
		if slices.ContainsFunc(g.r.Book.Words, func(b sheets.Word) bool { return b.ID == w || b.Stem && strings.HasPrefix(w, b.ID) }) {
			return w
		}
	}
	return ""
}

// season is the world's season number.
func (g *Game) season() int64 { return g.World.Day / g.r.wp("season-days") }

// creditGoals reads the facts written since from as events and counts
// them toward every live goal; claims are paid at once.
func (g *Game) creditGoals(from fact.ID, key string) error {
	for _, f := range g.Log.Since(from) {
		for _, e := range g.see(f) {
			for _, x := range g.Goals {
				if x.Hidden {
					continue
				}
				if err := g.payClaims(x, x.Credit(e), key); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// payClaims moves claims out of a goal's escrow, records them, and raises a
// structure a met project finishes.
func (g *Game) payClaims(x *Goal, claims []goal.Claim, key string) error {
	for i, cl := range claims {
		if cl.Coin > 0 && x.Issuer.Kind == goal.ByFaction {
			g.Market.Week.faucet(cl.Coin)
		}
		if cl.Coin > 0 {
			t := ledger.Move(ledger.SubKey(key, "claim", x.ID, strconv.Itoa(len(x.Claims)), strconv.Itoa(i)), "goal-claim", g.Tick(), goalPool(x.ID), ledger.Char(cl.Who), ledger.Coin, cl.Coin)
			if err := g.postAll(t); err != nil {
				return err
			}
		}
		if c := g.Char(cl.Who); c != nil {
			c.C.Goals.Bump("met", 1)
			if cl.Who != x.Poster {
				c.C.Deeds.Bump(DeedForOthers, 1)
				c.C.Practise(practiceGoals, 1, g.r.Growth.Params())
			}
			data := []fact.Datum{fact.N("coin", cl.Coin), fact.N("units", cl.Units)}
			for _, f := range cl.Facts {
				data = append(data, fact.N("fact", int64(f)))
			}
			if _, err := g.factWith(c, []fact.Ref{goalRef(x.ID)}, "goal.claimed", g.Tick(), data...); err != nil {
				return err
			}
		}
	}
	if x.State != goal.Done || x.Why != goal.Done {
		return nil
	}
	x.Why = paid
	if err := g.goalFact(x, "goal.met", fact.N("claims", int64(len(x.Claims)))); err != nil {
		return err
	}
	if err := g.refund(x, key); err != nil {
		return err
	}
	if x.Build != nil {
		return g.built(x.Build)
	}
	return nil
}

// Takes reports whether a Deliver goal takes a material.
func (g *Game) Takes(x *Goal, material string) bool { return g.matches(x.Cond, material) }

// HaulHere is what a character may do with a Haul goal where it stands:
// "take" its stock at the start, "deliver" it at the end, or "".
func (g *Game) HaulHere(x *Goal, c *Char) string {
	if x.Cargo == nil || x.State != goal.Live {
		return ""
	}
	here := g.placesOf(c.C.At)
	switch {
	case x.Cargo.Hauler == "" && x.Poster != c.C.ID && slices.Contains(here, x.Cond.From):
		return "take"
	case x.Cargo.Hauler == c.C.ID && slices.Contains(here, x.Cond.At):
		return "deliver"
	}
	return ""
}

// DownedAt are the characters down on a character's tile that it could
// carry home.
func (g *Game) DownedAt(c *Char) []*Char {
	var out []*Char
	for _, d := range g.Chars {
		if d != c && d.C.At == c.C.At && notDown(d) != nil && d.CarriedBy == "" {
			out = append(out, d)
		}
	}
	return out
}

// Called reports whether a downed character has a live call for help.
func (g *Game) Called(d *Char) bool {
	return slices.ContainsFunc(g.Goals, func(x *Goal) bool { return x.State == goal.Live && x.Cond.Verb == goal.Carry && x.Cond.Who == d.C.ID })
}
