package game

import (
	"cmp"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
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
	HideGoal     = "goal-hide"     // an operator hides a goal
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

// PostedBy are the goals a character has posted that are still up.
func (g *Game) PostedBy(c *Char) []*Goal {
	var out []*Goal
	for _, x := range g.Goals {
		if x.Poster == c.C.ID && x.Open() {
			out = append(out, x)
		}
	}
	return out
}

// LiveGoals counts the goals a character has up against its limit; a
// muster is its guild's, not its own.
func (g *Game) LiveGoals(c *Char) int64 {
	var n int64
	for _, x := range g.PostedBy(c) {
		if x.Issuer.Kind != goal.ByAdmin {
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

// postGoal drafts a spec and opens it on its settlement's board.
func (g *Game) postGoal(c *Char, key string, s GoalSpec) (*Goal, error) {
	x, err := g.draft(c, s)
	if err != nil {
		return nil, err
	}
	return x, g.open(c, x, key)
}

// draft is the goal a spec asks for, checked against the board's rules
// and its payer's coin. It changes nothing, so a refusal leaves the game
// as it was.
func (g *Game) draft(c *Char, s GoalSpec) (*Goal, error) {
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
		Lifetime: s.Lifetime, Turnover: s.Turnover, Posted: g.Tick(), State: goal.Live, Progress: nil, Members: s.Members}
	if s.Lifetime == goal.Ephemeral {
		x.Expires = g.Tick() + s.Ticks
	}
	if err := g.issue(c, x, s); err != nil {
		return nil, err
	}
	if err := goal.Valid(x, g.Tick(), g.limits()); err != nil {
		return nil, refuse(BadArgs, "%v", err)
	}
	if err := g.target(c, x.Cond); err != nil {
		return nil, err
	}
	if x.Cond.Verb == goal.Haul {
		if err := g.cargo(c, x, s); err != nil {
			return nil, err
		}
	}
	if err := g.quote(c, x); err != nil {
		return nil, err
	}
	if g.charScale(c, "board-first-days", 0) > 0 {
		x.Front = g.Tick() + g.charScale(c, "board-first-days", 0)*sheets.TicksPerDay
	}
	return x, nil
}

// open posts a drafted goal: its escrow and fee moved, and the fact.
func (g *Game) open(c *Char, x *Goal, key string) error {
	g.openGoal(x)
	if err := g.fund(c, x, key); err != nil {
		return err
	}
	c.C.Goals.Bump("posted", 1)
	_, err := g.factWith(c, []fact.Ref{goalRef(x.ID)}, "goal.posted", g.Tick(), fact.S("verb", x.Cond.Verb), fact.S("mode", x.Mode),
		fact.N("reward", x.Reward), fact.S("issuer", x.Issuer.Kind), fact.N("settlement", int64(x.Board)))
	return err
}

// openGoal puts a goal on the books under the next id, in this season.
func (g *Game) openGoal(x *Goal) {
	g.NextGoal++
	x.ID = "q-" + strconv.FormatInt(g.NextGoal, decimal)
	x.Season = g.season()
	i, _ := slices.BinarySearchFunc(g.Goals, x.ID, func(y *Goal, id string) int { return cmpID(y.ID, id) })
	g.Goals = slices.Insert(g.Goals, i, x)
}

// Screened is a goal's words refused by the word list.
const Screened = "screened"

// target refuses a condition aimed at what the world does not hold, or at
// what its poster already fails: a Hold's gauge and region, a Discover's
// field, a vow to hold off a thing the poster has equipped.
func (g *Game) target(c *Char, cond goal.Condition) error {
	if cond.Hold() {
		if _, ok := g.World.GaugeOf(cond.Gauge); !ok {
			return refuse(BadArgs, "no gauge %q", cond.Gauge)
		}
		if _, ok := g.regionOf(cond.At); !ok {
			return refuse(BadArgs, "a Hold names a region the world holds")
		}
	}
	if _, ok := g.r.Gen.Baseline(c.C.At).Fields()[cond.Field]; cond.Field != "" && !ok {
		return refuse(BadArgs, "no field %q", cond.Field)
	}
	if cond.Abstains() {
		for _, e := range c.C.Equipped {
			if in := c.C.Item(e.Item); in != nil && cond.Matches(g.equipped(goal.Event{Who: c.C.ID, Hex: c.C.At, Places: g.placesOf(c.C.At)}, in)) {
				return refuse(BadArgs, "%s has that equipped: take it off before vowing to hold it off", c.C.ID)
			}
		}
	}
	return nil
}

// issue sets who issues a goal and its scope from the spec: a character
// alone, a party it names, a settlement proposal waiting for pledges, or
// an officer's muster from the treasury.
func (g *Game) issue(c *Char, x *Goal, s GoalSpec) error {
	x.Issuer = goal.Ref{Kind: s.Issuer, ID: c.C.ID}
	x.Scope = goal.World
	if s.Cond.Abstains() && s.Issuer != goal.ByCharacter {
		return refuse(BadArgs, "a vow to hold off a thing is a character's own")
	}
	if s.Cond.Verb == goal.Carry && s.Cond.Who != c.C.ID {
		return refuse(BadArgs, "only %s calls for help for itself", s.Cond.Who)
	}
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
		// A proposal offers what is pledged to it, set when it goes live.
		x.Scope, x.State, x.Reward = goal.Settlement, goal.Proposed, 0
		x.Issuer.ID = goal.SettlementRef(x.Board)
		x.Need = g.charScale(c, "pledge-need", g.gp("pledge-need"))
	case goal.ByAdmin:
		gd, _ := g.RunsHere(c)
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
	x.Even = x.Mode == goal.Pooled && s.Even && g.EvenShares(c)
	return nil
}

// cargo escrows a Haul's stock from the poster, who must stand where it
// starts.
func (g *Game) cargo(c *Char, x *Goal, s GoalSpec) error {
	if x.Cond.From != goal.SettlementRef(x.Board) || s.Material == "" || s.Units <= 0 {
		return refuse(BadArgs, "a Haul is posted where its stock starts, with the stock named")
	}
	x.Cond.Count, x.Cond.Kind = s.Units, s.Material
	x.Cargo = &goal.Cargo{Material: s.Material, Units: s.Units}
	return g.afford(c, ledger.Goods(s.Material), s.Material, s.Units)
}

// backer is the account behind a goal's coin: it pays the escrow and the
// fee, and takes back what nobody claims. A muster's is its settlement's
// treasury, a bounty's its faction, anyone else's the poster's purse.
func backer(x *Goal) string {
	switch x.Issuer.Kind {
	case goal.ByAdmin:
		return TreasuryPool(x.Board)
	case goal.ByFaction:
		return ledger.ToFaction
	}
	return ledger.Char(x.Poster)
}

// quote sets a live goal's listing fee and refuses a payer who cannot
// cover it and the escrow, or a muster over its officer's day; a proposal
// pays when it goes live.
func (g *Game) quote(c *Char, x *Goal) error {
	if x.State == goal.Proposed {
		return nil
	}
	x.Fee = 0
	if !x.Vow() {
		x.Fee = g.listingFee(x, x.Escrow())
	}
	need := x.Cost()
	if g.Ledger.Of(backer(x), ledger.Coin) < need {
		return refuse(BadArgs, "posting takes %d coin, the reward and a %d coin listing fee", need, x.Fee)
	}
	return g.mayMuster(c, x, need)
}

// listingFee is the fee on a goal's escrow, which its poster's abilities
// may lower.
func (g *Game) listingFee(x *Goal, escrow int64) int64 {
	fee := g.r.Values.GoalFee(escrow)
	if c := g.Char(x.Poster); c != nil {
		return g.charScale(c, "listing-fee", fee)
	}
	return fee
}

// mayMuster refuses a muster whose coin is over what its officer may
// still spend today: the treasury's coin is the guild's, as its bank is.
func (g *Game) mayMuster(c *Char, x *Goal, coin int64) error {
	if x.Issuer.Kind != goal.ByAdmin || coin == 0 {
		return nil
	}
	if gd := g.GuildOf(x.Issuer.ID); gd == nil || !gd.G.MaySpend(c.C.ID, g.World.Day, coin, g.r.Guild) {
		return refuse(BadArgs, "%d coin is over what an officer spends from the treasury in a day", coin)
	}
	return nil
}

// fund moves a quoted goal's cargo, escrow and fee, a muster's counted
// against its officer's day.
func (g *Game) fund(c *Char, x *Goal, key string) error {
	payer := backer(x)
	if x.Cargo != nil {
		x.Cargo.Collateral = fixed.PercentFloor(g.r.Values.Asset(x.Cargo.Material)*x.Cargo.Units, g.gp("collateral"))
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
	if gd := g.GuildOf(x.Issuer.ID); gd != nil && x.Issuer.Kind == goal.ByAdmin {
		gd.G.Spent(c.C.ID, g.World.Day, x.Cost())
	}
	return g.postAll(ledger.Txn{Key: ledger.SubKey(key, "fund"), Kind: "goal-fund", Tick: g.Tick(), Legs: ledger.Merge(legs)})
}

// TakesPledges reports whether a goal takes pledges: a proposal, or a
// live first or pooled goal with a reward.
func TakesPledges(x *Goal) bool {
	return !x.Hidden && x.Open() && (x.State == goal.Proposed || x.Mode != goal.Each && !x.Vow())
}

// pledge adds coin to a proposal (live at its need) or to a first or
// pooled goal's reward. A live goal's pledger pays the listing fee its
// coin adds, as the poster did on the rest.
func (g *Game) pledge(c *Char, cmd Command) error {
	x := g.GoalOf(cmd.Target)
	switch {
	case x == nil || x.Hidden || !x.Open():
		return refuse(BadArgs, "no open goal %q", cmd.Target)
	case !TakesPledges(x):
		return refuse(BadArgs, "only a proposal or a first or pooled goal with a reward takes pledges")
	case cmd.Units <= 0:
		return refuse(BadArgs, "a pledge is coin %s holds", c.C.ID)
	}
	var fee int64
	if x.State == goal.Live {
		fee = max(0, g.listingFee(x, x.Escrow()+cmd.Units)-x.Fee)
	}
	if err := g.afford(c, ledger.Coin, ledger.Coin, cmd.Units+fee); err != nil {
		return err
	}
	legs := ledger.Pair(ledger.Char(c.C.ID), goalPool(x.ID), ledger.Coin, cmd.Units)
	if fee > 0 {
		legs = append(legs, ledger.Pair(ledger.Char(c.C.ID), ledger.ToGoalFees, ledger.Coin, fee)...)
	}
	if err := g.postAll(ledger.Txn{Key: cmd.Key, Kind: "pledge", Tick: g.Tick(), Legs: ledger.Merge(legs)}); err != nil {
		return err
	}
	x.Pledge(c.C.ID, cmd.Units)
	x.Fee += fee
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
	x.GoLive(pool, g.listingFee(x, pool))
	if err := g.post(ledger.Move(ledger.SubKey(key, "live"), "goal-fee", g.Tick(), goalPool(x.ID), ledger.ToGoalFees, ledger.Coin, x.Fee)); err != nil {
		return err
	}
	_, err := g.worldFact(g.SettlementHex(x.Board), "goal.live", []fact.Ref{goalRef(x.ID)}, nil, fact.N("reward", x.Reward))
	return err
}

// deliver hands goods to a Deliver goal at its place, or a haul's stock at
// its end. A delivery stays in the goal's escrow until the claim that
// counts it is paid, so a goal that ends short gives it back.
func (g *Game) deliver(c *Char, cmd Command) error {
	x := g.GoalOf(cmd.Target)
	if x == nil || x.State != goal.Live || x.Hidden || !x.May(c.C.ID) {
		return refuse(BadArgs, "no live goal %q for %s", cmd.Target, c.C.ID)
	}
	if !g.standsIn(c, x.Cond.At) {
		return refuse(NotHere, "it is delivered at %s", x.Cond.At)
	}
	if x.Cond.Verb == goal.Haul {
		return g.haulIn(c, x, cmd.Key)
	}
	if x.Cond.Verb != goal.Deliver {
		return refuse(BadArgs, "%s is not met by a delivery", x.ID)
	}
	material := cmd.Material
	if !g.Takes(x, c, material) {
		return refuse(BadArgs, "%s does not take %s", x.ID, material)
	}
	units := min(cmd.Units, x.Left(c.C.ID))
	if units <= 0 {
		return refuse(BadArgs, "%s needs no more", x.ID)
	}
	asset := ledger.Goods(material)
	if err := g.afford(c, asset, material, units); err != nil {
		return err
	}
	if err := g.postAll(ledger.Move(cmd.Key, "goal-delivery", g.Tick(), ledger.Char(c.C.ID), goalPool(x.ID), asset, units)); err != nil {
		return err
	}
	x.Held = append(x.Held, goal.Held{Who: c.C.ID, Asset: asset, Units: units, At: c.C.At})
	_, err := g.factWith(c, []fact.Ref{goalRef(x.ID)}, "goal.delivered", g.Tick(), append([]fact.Datum{fact.S("goal", x.ID), fact.S("material", material),
		fact.N("units", units)}, fact.At(c.C.At)...)...)
	return err
}

// delivery is a character handing a material to a goal where it stands,
// as the goal will read the fact of it.
func (g *Game) delivery(x *Goal, c *Char, material string) goal.Event {
	return goal.Event{Verb: goal.Deliver, Who: c.C.ID, Goal: x.ID, Kind: material, Tags: g.materialTags(material), Hex: c.C.At, Places: g.placesOf(c.C.At)}
}

// Takes reports whether a Deliver goal would count a material from a
// character where it stands.
func (g *Game) Takes(x *Goal, c *Char, material string) bool {
	return x.Cond.Verb == goal.Deliver && x.May(c.C.ID) && x.Cond.Matches(g.delivery(x, c, material))
}

// deliveredTo is where a goal's deliveries made on a tile go once they
// count: a structure's are sunk into it; a settlement's and a muster's go
// to the bank of the guild behind them, where its works draw them, or are
// built into a settlement its keepers run; anyone else's to the poster,
// there.
func (g *Game) deliveredTo(x *Goal, at hex.Hex) string {
	switch {
	case x.Build != nil:
		return ledger.ToBuild
	case x.Issuer.Kind == goal.BySettlement, x.Issuer.Kind == goal.ByAdmin:
		gd := g.GuildOf(g.Places[x.Board].Guild)
		if x.Issuer.Kind == goal.ByAdmin {
			gd = g.GuildOf(x.Issuer.ID)
		}
		if gd != nil {
			return gd.Pool()
		}
		return ledger.ToBuild
	case x.Issuer.Kind == goal.ByFaction:
		return ledger.ToFaction
	}
	return g.handTo(x.Poster, at)
}

// release hands a claimant's deliveries on from the goal's escrow.
func (g *Game) release(x *Goal, who, key string) error {
	var legs []ledger.Leg
	var kept, gone []goal.Held
	for _, h := range x.Held {
		if h.Who != who {
			kept = append(kept, h)
			continue
		}
		gone = append(gone, h)
		legs = append(legs, ledger.Pair(goalPool(x.ID), g.deliveredTo(x, h.At), h.Asset, h.Units)...)
	}
	if len(legs) == 0 {
		return nil
	}
	x.Held = kept
	if err := g.postAll(ledger.Txn{Key: ledger.SubKey(key, "handed", x.ID, who), Kind: "goal-handed", Tick: g.Tick(), Legs: ledger.Merge(legs)}); err != nil {
		return err
	}
	for _, h := range gone {
		g.awaits(x.Poster, h.At)
	}
	return nil
}

// handBack returns every delivery the goal's escrow still holds to whoever
// made it, where it was made.
func (g *Game) handBack(x *Goal, key string) error {
	held := x.Held
	if len(held) == 0 {
		return nil
	}
	var legs []ledger.Leg
	for _, h := range held {
		legs = append(legs, ledger.Pair(goalPool(x.ID), g.handTo(h.Who, h.At), h.Asset, h.Units)...)
	}
	x.Held = nil
	if err := g.postAll(ledger.Txn{Key: ledger.SubKey(key, "back", x.ID), Kind: "goal-back", Tick: g.Tick(), Legs: ledger.Merge(legs)}); err != nil {
		return err
	}
	for _, h := range held {
		g.awaits(h.Who, h.At)
	}
	return nil
}

// handTo is the account goods handed over on a tile for a character go to:
// its pack if it stands there, else a pool on the tile that waits for it
// to come (GDD 10.1: goods are where they are).
func (g *Game) handTo(who string, at hex.Hex) string {
	if c := g.Char(who); c == nil || c.C.At == at {
		return ledger.Char(who)
	}
	return ledger.WaitPool(at.Ref(), who)
}

// awaits notes on a character that goods now wait for it on a tile.
func (g *Game) awaits(who string, at hex.Hex) {
	c := g.Char(who)
	if c == nil || slices.Contains(c.Waits, at) || len(g.Ledger.Held(ledger.WaitPool(at.Ref(), who))) == 0 {
		return
	}
	c.Waits = append(c.Waits, at)
	c.Version++
}

// sweep are the legs moving everything an account holds to another.
func (g *Game) sweep(from, to string) []ledger.Leg {
	var legs []ledger.Leg
	for _, h := range g.Ledger.Held(from) {
		if h.Units > 0 {
			legs = append(legs, ledger.Pair(from, to, h.Asset, h.Units)...)
		}
	}
	return legs
}

// collect hands a character the goods that wait for it where it stands.
func (g *Game) collect(c *Char, key string) error {
	i := slices.Index(c.Waits, c.C.At)
	if i < 0 {
		return nil
	}
	c.Waits = slices.Delete(c.Waits, i, i+1)
	legs := g.sweep(ledger.WaitPool(c.C.At.Ref(), c.C.ID), ledger.Char(c.C.ID))
	if len(legs) == 0 {
		return nil
	}
	return g.postAll(ledger.Txn{Key: ledger.SubKey(key, "collect"), Kind: "goal-collect", Tick: g.Tick(), Legs: legs})
}

// Waiting is goods on a tile that wait for a character to come for them.
type Waiting struct {
	At    hex.Hex
	Goods []ledger.Balance
}

// WaitingFor are the goods that wait for a character, tile by tile.
func (g *Game) WaitingFor(c *Char) []Waiting {
	var out []Waiting
	for _, at := range c.Waits {
		if held := g.Ledger.Held(ledger.WaitPool(at.Ref(), c.C.ID)); len(held) > 0 {
			out = append(out, Waiting{At: at, Goods: held})
		}
	}
	return out
}

// standsIn reports whether a character stands in the place a ref names.
func (g *Game) standsIn(c *Char, ref string) bool { return slices.Contains(g.placesOf(c.C.At), ref) }

// placesOf are the refs a tile is in: its tile, region and settlement.
func (g *Game) placesOf(h hex.Hex) []string {
	out := []string{goal.TileRef(h)}
	if r := g.World.RegionAt(h); r >= 0 {
		out = append(out, goal.RegionRef(world.RegionRef(r)))
	}
	if n, ok := g.SettlementAt(h); ok {
		out = append(out, goal.SettlementRef(n))
	}
	return out
}

// takeHaul hands a Haul goal's stock to a hauler at its start, against
// collateral, which a Chandler's Bonded lowers.
func (g *Game) takeHaul(c *Char, cmd Command) error {
	x := g.GoalOf(cmd.Target)
	switch {
	case x == nil || x.State != goal.Live || x.Cargo == nil || x.Hidden || !x.May(c.C.ID):
		return refuse(BadArgs, "no live Haul %q for %s", cmd.Target, c.C.ID)
	case x.Cargo.Out():
		return refuse(BadArgs, "%s is already being hauled", x.ID)
	case x.Poster == c.C.ID:
		return refuse(BadArgs, "a poster does not haul its own stock")
	case !g.standsIn(c, x.Cond.From):
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
	x.Cargo.Take(c.C.ID, g.Tick(), collateral)
	_, err := g.factWith(c, []fact.Ref{goalRef(x.ID)}, "goal.haul-taken", g.Tick(), fact.N("collateral", collateral))
	return err
}

// haulIn delivers a haul at its end: the stock, intact, to where the
// goal's deliveries go, the collateral back, and the fact the goal counts.
func (g *Game) haulIn(c *Char, x *Goal, key string) error {
	if x.Cargo.Hauler != c.C.ID {
		return refuse(BadArgs, "%s is %s's to deliver", x.ID, x.Cargo.Hauler)
	}
	asset := ledger.Goods(x.Cargo.Material)
	if err := g.afford(c, asset, x.Cargo.Material, x.Cargo.Units); err != nil {
		return refuse(BadArgs, "the haul is no longer intact")
	}
	legs := ledger.Pair(ledger.Char(c.C.ID), g.deliveredTo(x, c.C.At), asset, x.Cargo.Units)
	if x.Cargo.Collateral > 0 {
		legs = append(legs, ledger.Pair(goalPool(x.ID), ledger.Char(c.C.ID), ledger.Coin, x.Cargo.Collateral)...)
	}
	if err := g.postAll(ledger.Txn{Key: key, Kind: "haul-delivered", Tick: g.Tick(), Legs: legs}); err != nil {
		return err
	}
	x.Cargo.Collateral = 0
	g.awaits(x.Poster, c.C.At)
	_, err := g.factWith(c, []fact.Ref{goalRef(x.ID)}, "goal.hauled", g.Tick(), append([]fact.Datum{fact.S("goal", x.ID), fact.S("material", x.Cargo.Material),
		fact.N("units", x.Cargo.Units), fact.S("from", x.Cond.From)}, fact.At(c.C.At)...)...)
	return err
}

// withdrawGoal takes down a goal nobody has claimed from or hauled, or
// one whose target evolved today: escrow, pledges and deliveries back, the
// fee kept.
func (g *Game) withdrawGoal(c *Char, cmd Command) error {
	x := g.GoalOf(cmd.Target)
	if x == nil || !x.Open() {
		return refuse(BadArgs, "no open goal %q", cmd.Target)
	}
	if err := g.withdrawal(x, c); err != nil {
		return err
	}
	return g.endGoal(x, "withdrawn", cmd.Key)
}

// withdrawal refuses a character who may not take an open goal down now.
// A guild's muster or raise is its officers' to withdraw, whoever posted
// it; any other goal is its poster's.
func (g *Game) withdrawal(x *Goal, c *Char) error {
	mine := x.Poster == c.C.ID
	if gd := g.GuildOf(x.Issuer.ID); gd != nil && x.Issuer.Kind == goal.ByAdmin {
		mine = gd.G.IsOfficer(c.C.ID)
	}
	switch {
	case !mine:
		return refuse(BadArgs, "%s is not %s's to withdraw", x.ID, c.C.ID)
	case x.Cargo != nil && x.Cargo.Out():
		return refuse(BadArgs, "%s has been taken", x.ID)
	case len(x.Claims) > 0 && (x.Evolved == 0 || g.World.Day != x.Evolved):
		return refuse(BadArgs, "%s has been claimed from", x.ID)
	}
	return nil
}

// CanWithdraw reports whether a character may take an open goal down now.
func (g *Game) CanWithdraw(x *Goal, c *Char) bool { return x.Open() && g.withdrawal(x, c) == nil }

// endGoal closes a goal unmet and refunds its escrow; a hauler who never
// delivered forfeits its collateral to the poster. One line of a raise
// ending ends the others.
func (g *Game) endGoal(x *Goal, why, key string) error {
	if err := g.refund(x, key); err != nil {
		return err
	}
	x.End(why)
	if err := g.goalFact(x, "goal.ended", fact.S("why", why)); err != nil {
		return err
	}
	if x.Build == nil {
		return nil
	}
	for _, y := range g.Goals {
		if y.Build != nil && y.Build.Project == x.Build.Project && y.Open() {
			if err := g.endGoal(y, why, key); err != nil {
				return err
			}
		}
	}
	return nil
}

// refund empties a goal's escrow: pledges to their pledgers, deliveries to
// whoever made them, a haul's stock to its poster at the board it was
// posted on, and the rest to whoever paid. A pledge counts as a deed for
// what of it was paid out.
func (g *Game) refund(x *Goal, key string) error {
	pool := goalPool(x.ID)
	var legs []ledger.Leg
	for _, p := range x.Pledges {
		n := max(0, min(p.N, g.Ledger.Of(pool, ledger.Coin)-sumLegs(legs, ledger.Coin)))
		if n > 0 {
			legs = append(legs, ledger.Pair(pool, ledger.Char(p.Key), ledger.Coin, n)...)
		}
		if c := g.Char(p.Key); c != nil && p.N > n {
			c.C.Deeds.Bump(DeedPledged, p.N-n)
			c.Version++
		}
	}
	held, board := x.Held, g.SettlementHex(x.Board)
	for _, h := range held {
		legs = append(legs, ledger.Pair(pool, g.handTo(h.Who, h.At), h.Asset, h.Units)...)
	}
	x.Held = nil
	for _, h := range g.Ledger.Held(pool) {
		n := h.Units - sumLegs(legs, h.Asset)
		if n <= 0 {
			continue
		}
		to := backer(x)
		if h.Asset != ledger.Coin && g.Char(x.Poster) != nil {
			to = g.handTo(x.Poster, board)
		}
		legs = append(legs, ledger.Pair(pool, to, h.Asset, n)...)
	}
	if len(legs) == 0 {
		return nil
	}
	if err := g.postAll(ledger.Txn{Key: ledger.SubKey(key, "end", x.ID), Kind: "goal-end", Tick: g.Tick(), Legs: ledger.Merge(legs)}); err != nil {
		return err
	}
	for _, h := range held {
		g.awaits(h.Who, h.At)
	}
	g.awaits(x.Poster, board)
	return nil
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
// reward its purse covers, first to carry it home, expiring when it would
// have crawled out, for it starts crawling too.
func (g *Game) callHelp(c *Char, cmd Command) error {
	if notDown(c) == nil {
		return refuse(BadArgs, "%s is not down", c.C.ID)
	}
	if g.Called(c) {
		return refuse(BadArgs, "%s has already called for help", c.C.ID)
	}
	home := g.HomeOf(c)
	x := &Goal{Title: "Carry " + c.C.ID + " home", Poster: c.C.ID, Board: home, Issuer: goal.Ref{Kind: goal.ByCharacter, ID: c.C.ID},
		Scope: goal.World, Cond: goal.Condition{Verb: goal.Carry, Who: c.C.ID, Count: 1, At: goal.SettlementRef(home)},
		Mode: goal.First, Lifetime: goal.Ephemeral, Turnover: goal.Expire, Posted: g.Tick(), State: goal.Live}
	if c.Long == nil || c.Long.Kind != Crawl {
		if err := g.crawl(c, cmd); err != nil {
			return err
		}
	}
	g.rescueOffer(c, x)
	g.openGoal(x)
	g.syncCall(c)
	if err := g.fund(c, x, cmd.Key); err != nil {
		return err
	}
	_, err := g.factWith(c, []fact.Ref{goalRef(x.ID)}, "rescue.called", g.Tick(), append([]fact.Datum{fact.N("reward", x.Reward)}, fact.At(c.C.At)...)...)
	return err
}

// rescueOffer sets a call for help's reward to what the caller's purse
// covers with the listing fee, up to the rescue reward; a purse that
// covers less than the least reward makes the call a vow.
func (g *Game) rescueOffer(c *Char, x *Goal) {
	least := g.gp("reward-least")
	x.Reward = min(c.C.Coin, g.gp("rescue-reward"))
	if x.Reward >= least && g.quote(c, x) != nil {
		// The fee never rises as the reward falls, so what the purse holds
		// over this fee is covered.
		x.Reward = c.C.Coin - x.Fee
	}
	if x.Reward < least || g.quote(c, x) != nil {
		x.Reward, x.Fee = 0, 0
	}
}

// HomeOf is the settlement a character calls home, else the first.
func (g *Game) HomeOf(c *Char) int {
	if n, ok := goal.SettlementOf(c.C.Home); ok && n < len(g.Places) {
		return n
	}
	return 0
}

// carry picks up a downed character on the rescuer's tile; the rescuer's
// journeys take it along to its home settlement (GDD 11.6).
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
	g.syncCall(d)
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

// hideGoal is an operator's hide: the goal leaves the board and ends, its
// escrow returned as a withdrawal.
func (g *Game) hideGoal(cmd Command) error {
	x := g.GoalOf(cmd.Target)
	if x == nil || x.Hidden || cmd.Note == "" {
		return refuse(BadArgs, "a hide names a shown goal and a note")
	}
	x.Hidden = true
	if x.Open() {
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

// dropIfDown has a rescuer who is down carry nobody further.
func (g *Game) dropIfDown(c *Char) {
	if c.Carrying != "" && notDown(c) != nil {
		g.setDown(c, g.Char(c.Carrying))
	}
}

// syncCall runs a downed character's call for help as long as the crawl it
// would spare: to the crawl's end, and with no end while it is carried and
// crawls nowhere.
func (g *Game) syncCall(d *Char) {
	x := g.callOf(d)
	if x == nil {
		return
	}
	x.Expires = 0
	if d.Long != nil && d.Long.Kind == Crawl {
		x.Expires = d.Long.Due
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
				if x.Hidden || x.State != goal.Live {
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

// payClaims moves claims out of a goal's escrow with the deliveries they
// count, records them, and raises a structure a met project finishes.
func (g *Game) payClaims(x *Goal, claims []goal.Claim, key string) error {
	for i, cl := range claims {
		if cl.Coin > 0 && x.Issuer.Kind == goal.ByFaction {
			// Only what the faction minted is new coin: a pledge was a
			// player's already.
			g.Market.Week.faucet(cl.Coin * (x.Reward - x.Pledges.Sum()) / x.Reward)
		}
		if cl.Coin > 0 {
			t := ledger.Move(ledger.SubKey(key, "claim", x.ID, strconv.Itoa(len(x.Claims)), strconv.Itoa(i)), "goal-claim", g.Tick(), goalPool(x.ID), ledger.Char(cl.Who), ledger.Coin, cl.Coin)
			if err := g.postAll(t); err != nil {
				return err
			}
		}
		if err := g.release(x, cl.Who, key); err != nil {
			return err
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
	if x.State != goal.Done || x.Paid {
		return nil
	}
	x.Paid = true
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

// HaulHere is what a character may do with a Haul goal where it stands:
// "take" its stock at the start, "deliver" it at the end, or "".
func (g *Game) HaulHere(x *Goal, c *Char) string {
	if x.Cargo == nil || x.State != goal.Live || !x.May(c.C.ID) {
		return ""
	}
	switch {
	case !x.Cargo.Out() && x.Poster != c.C.ID && g.standsIn(c, x.Cond.From):
		return "take"
	case x.Cargo.Hauler == c.C.ID && g.standsIn(c, x.Cond.At):
		return "deliver"
	}
	return ""
}

// CharsAt are the characters on a tile.
func (g *Game) CharsAt(h hex.Hex) []*Char {
	var out []*Char
	for _, c := range g.Chars {
		if c.C.At == h {
			out = append(out, c)
		}
	}
	return out
}

// DownedAt are the characters down on a character's tile that it could
// carry home.
func (g *Game) DownedAt(c *Char) []*Char {
	var out []*Char
	for _, d := range g.CharsAt(c.C.At) {
		if d != c && notDown(d) != nil && d.CarriedBy == "" {
			out = append(out, d)
		}
	}
	return out
}

// Called reports whether a downed character has a live call for help.
func (g *Game) Called(d *Char) bool { return g.callOf(d) != nil }

// callOf is a downed character's live call for help, or nil.
func (g *Game) callOf(d *Char) *Goal {
	i := slices.IndexFunc(g.Goals, func(x *Goal) bool { return x.State == goal.Live && x.Cond.Verb == goal.Carry && x.Cond.Who == d.C.ID })
	if i < 0 {
		return nil
	}
	return g.Goals[i]
}
