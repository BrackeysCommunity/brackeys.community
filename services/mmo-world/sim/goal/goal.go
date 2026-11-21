// Package goal is quests as data (GDD 11): a condition built from nine
// verbs and checked against what facts record, a reward in escrow, a
// scope, a mode, a lifetime and a turnover. Nothing judges: the game turns
// each fact into an Event, and a goal counts the events its condition
// matches.
package goal

import (
	"cmp"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/tally"
)

// The nine verbs (GDD 11.2).
const (
	Deliver  = "deliver"
	Make     = "make"
	Discover = "discover"
	Defeat   = "defeat"
	Reach    = "reach"
	Haul     = "haul"
	Hold     = "hold"
	Back     = "back"
	Carry    = "carry"
)

// Verbs in the order a poster picks them.
var Verbs = []string{Deliver, Make, Discover, Defeat, Reach, Haul, Hold, Back, Carry}

// Equip is the event a vow to hold off a thing breaks on; it is not a verb
// a goal is posted with.
const Equip = "equip"

// Modes (GDD 11.4).
const (
	First  = "first"
	Each   = "each"
	Pooled = "pooled"
)

// Lifetimes.
const (
	Ephemeral = "ephemeral"
	Season    = "season"
	Standing  = "standing"
)

// Turnovers, at a season's close.
const (
	Expire = "expire"
	Reset  = "reset"
	Keep   = "carry"
	Evolve = "evolve"
)

// Scopes: who may work on it.
const (
	Personal   = "personal"
	Party      = "party"
	Settlement = "settlement"
	World      = "world"
)

// Issuer kinds (GDD 11.3).
const (
	ByCharacter  = "character"
	ByParty      = "party"
	BySettlement = "settlement"
	ByAdmin      = "admin"
	ByFaction    = "faction"
	ByWorld      = "world"
)

// States a goal moves through.
const (
	Proposed = "proposed" // a settlement goal gathering pledges
	Live     = "live"
	Done     = "met"
	Ended    = "ended"
)

// Ref is who issued a goal.
type Ref struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

// Kinds of place a condition's At and From, and an event's Places, name.
const (
	PlaceSettlement = "settlement"
	PlaceRegion     = "region"
	PlaceTile       = "tile"
)

// SettlementRef names an open settlement by its index.
func SettlementRef(n int) string { return PlaceSettlement + ":" + strconv.Itoa(n) }

// RegionRef names a region by the world's ref for it.
func RegionRef(ref string) string { return PlaceRegion + ":" + ref }

// TileRef names a tile.
func TileRef(h hex.Hex) string { return PlaceTile + ":" + h.Ref() }

// ParseRef splits a place ref into its kind and id; ok is false for text
// that is not one.
func ParseRef(ref string) (kind, id string, ok bool) { return strings.Cut(ref, ":") }

// SettlementOf is the index a settlement ref names.
func SettlementOf(ref string) (int, bool) {
	kind, id, ok := ParseRef(ref)
	if !ok || kind != PlaceSettlement {
		return 0, false
	}
	n, err := strconv.Atoi(id)
	return n, err == nil && n >= 0
}

// Condition is one verb, a target and an amount. Every field but Verb and
// Count is optional; an empty one matches anything.
type Condition struct {
	Verb string `json:"verb"`
	// Kind, Tag and Trait narrow what is delivered, made, found or
	// defeated: a kind or creature archetype, anything holding a tag, an
	// item carrying a trait.
	Kind  string `json:"kind,omitempty"`
	Tag   string `json:"tag,omitempty"`
	Trait string `json:"trait,omitempty"`
	// Count is units, kills, places or days.
	Count int64 `json:"count"`
	// At is a place an event must be in: a settlement, region or tile
	// ref. Hex and Within ask instead for anywhere that many tiles from Hex.
	At     string   `json:"at,omitempty"`
	Hex    *hex.Hex `json:"hex,omitempty"`
	Within int64    `json:"within,omitempty"`
	// From is where a Haul's stock starts.
	From string `json:"from,omitempty"`
	// Field and AtLeast: Discover a tile whose generated field is at
	// least this.
	Field   string `json:"field,omitempty"`
	AtLeast int64  `json:"atLeast,omitempty"`
	// Gauge, Line and Below: Hold a region's gauge on one side of a line.
	// A Hold with no gauge is a vow to hold off what Tag names.
	Gauge string `json:"gauge,omitempty"`
	Line  int64  `json:"line,omitempty"`
	Below bool   `json:"below,omitempty"`
	// Who is a Carry's downed character.
	Who string `json:"who,omitempty"`
	// Side is a Back's arc stage side.
	Side string `json:"side,omitempty"`
}

// Scales reports whether a condition's amount grows with how many play:
// goods delivered, things made and creatures defeated do; days held, a
// place reached and a tile found do not.
func (c Condition) Scales() bool {
	return c.Verb == Deliver || c.Verb == Make || c.Verb == Defeat || c.Verb == Back
}

// Abstains reports whether a Hold is a vow to hold off a thing rather
// than a gauge.
func (c Condition) Abstains() bool { return c.Verb == Hold && c.Gauge == "" }

// Event is a fact as the goals read it: what a character did, to what,
// where. The game makes one from each fact a goal could count.
type Event struct {
	Fact   fact.ID  `json:"fact"`
	Verb   string   `json:"verb"`
	Who    string   `json:"who"`
	Kind   string   `json:"kind,omitempty"`
	Tags   []string `json:"tags,omitempty"`
	Traits []string `json:"traits,omitempty"`
	// Places are the refs the event is in: its settlement, region, tile.
	Places []string `json:"places,omitempty"`
	Hex    hex.Hex  `json:"hex"`
	From   string   `json:"from,omitempty"`
	Units  int64    `json:"units"`
	// Fields are a discovered tile's generated fields.
	Fields map[string]int64 `json:"fields,omitempty"`
	// Gauge and Value are a Hold day's reading; its Units is the world day.
	Gauge string `json:"gauge,omitempty"`
	Value int64  `json:"value,omitempty"`
	// Goal binds an event to one goal: a delivery, a haul, a Hold's reading.
	Goal string `json:"goal,omitempty"`
}

// Matches reports whether an event counts toward a condition. A Hold's
// reading is matched by gauge and place here; Held judges its line.
func (c Condition) Matches(e Event) bool {
	verb := c.Verb
	if c.Abstains() {
		verb = Equip
	}
	switch {
	case e.Verb != verb:
		return false
	case c.Kind != "" && e.Kind != c.Kind:
		return false
	case c.Tag != "" && !slices.Contains(e.Tags, c.Tag):
		return false
	case c.Trait != "" && !slices.Contains(e.Traits, c.Trait):
		return false
	case c.From != "" && e.From != c.From:
		return false
	case c.Who != "" && c.Verb == Carry && e.Kind != c.Who:
		return false
	case c.Field != "" && e.Fields[c.Field] < c.AtLeast:
		return false
	case c.Hold() && e.Gauge != c.Gauge:
		return false
	}
	return c.in(e)
}

// Hold reports whether the condition reads a gauge day by day.
func (c Condition) Hold() bool { return c.Verb == Hold && c.Gauge != "" }

func (c Condition) in(e Event) bool {
	if c.Hex != nil && c.Within > 0 {
		return hex.Distance(*c.Hex, e.Hex) <= c.Within
	}
	return c.At == "" || slices.Contains(e.Places, c.At)
}

// Held reports whether a Hold day's reading keeps the line.
func (c Condition) Held(value int64) bool {
	if c.Below {
		return value < c.Line
	}
	return value > c.Line
}

// Met reports whether facts, read as events by see, meet a condition on
// their own: every matching unit counts, whoever did it, and a vow is met
// while unbroken.
func Met(c Condition, facts []fact.Fact, see func(fact.Fact) (Event, bool)) bool {
	g := Goal{Cond: c, Mode: Pooled, State: Live, Progress: tally.Tally{}}
	for _, f := range facts {
		if e, ok := see(f); ok {
			g.Credit(e)
		}
	}
	return g.State == Done || g.Kept()
}

// Claim is a payout and the facts that earned it.
type Claim struct {
	Who   string    `json:"who"`
	Units int64     `json:"units"`
	Coin  int64     `json:"coin"`
	Facts []fact.ID `json:"facts"`
}

// Build is the structure a pooled settlement goal raises when met.
type Build struct {
	Settlement int    `json:"settlement"`
	Structure  string `json:"structure"`
	Tier       int64  `json:"tier"`
	// Project names the goals raising one tier together, one per
	// material line; the structure rises when all of them are met.
	Project string `json:"project"`
}

// Cargo is a Haul goal's stock and who carries it.
type Cargo struct {
	Material   string `json:"material"`
	Units      int64  `json:"units"`
	Collateral int64  `json:"collateral"` // coin the hauler puts up
	Hauler     string `json:"hauler,omitempty"`
	Taken      int64  `json:"taken,omitempty"`
}

// Out reports whether a hauler has taken the stock.
func (c *Cargo) Out() bool { return c.Hauler != "" }

// Take hands the stock to a hauler against the collateral it put up.
func (c *Cargo) Take(who string, tick, collateral int64) {
	c.Hauler, c.Taken, c.Collateral = who, tick, collateral
}

// Held is goods a contributor handed to a Deliver goal on a tile, kept in
// the goal's escrow until the claim that counts them is paid.
type Held struct {
	Who   string  `json:"who"`
	Asset string  `json:"asset"`
	Units int64   `json:"units"`
	At    hex.Hex `json:"at"`
}

// Goal is a posted goal and everything counted toward it.
type Goal struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Note   string `json:"note,omitempty"`
	Issuer Ref    `json:"issuer"`
	Poster string `json:"poster,omitempty"` // the character who posted it
	Scope  string `json:"scope"`
	// Members are who a personal or party goal is for.
	Members []string  `json:"members,omitempty"`
	Board   int       `json:"board"` // the settlement whose board shows it
	Cond    Condition `json:"cond"`
	// Reward is coin to each claimant (first, each) or the pool (pooled);
	// 0 is a vow, which pays nothing and is tracked.
	Reward   int64  `json:"reward"`
	Mode     string `json:"mode"`
	Cap      int64  `json:"cap,omitempty"`
	Lifetime string `json:"lifetime"`
	Turnover string `json:"turnover"`
	Posted   int64  `json:"posted"`
	Expires  int64  `json:"expires,omitempty"` // 0: none
	Season   int64  `json:"season"`
	State    string `json:"state"`
	Why      string `json:"why,omitempty"` // how it ended
	Hidden   bool   `json:"hidden,omitempty"`
	// Paid marks a met goal whose claims are paid and escrow emptied.
	Paid bool  `json:"paid,omitempty"`
	Fee  int64 `json:"fee,omitempty"`
	// Need and Pledges: a settlement proposal goes live at Need pledged.
	Need    int64       `json:"need,omitempty"`
	Pledges tally.Tally `json:"pledges,omitempty"`
	// Progress is units counted per contributor; Facts the facts behind
	// each contributor's units, for the claim to cite.
	Progress tally.Tally `json:"progress"`
	Facts    []Cite      `json:"facts,omitempty"`
	// Held are the deliveries its escrow still holds.
	Held []Held `json:"held,omitempty"`
	// Streak and Day: days running a Hold has kept its line, and the
	// last day read. Broken: a vow to hold off a thing was broken.
	Streak int64 `json:"streak,omitempty"`
	Day    int64 `json:"day,omitempty"`
	Broken bool  `json:"broken,omitempty"`
	// Even pays a pooled goal equally rather than by contribution.
	Even   bool    `json:"even,omitempty"`
	Claims []Claim `json:"claims,omitempty"`
	Build  *Build  `json:"build,omitempty"`
	Cargo  *Cargo  `json:"cargo,omitempty"`
	// Front is the tick until which the board shows it first.
	Front int64 `json:"front,omitempty"`
	// Evolved is the world day its target last evolved: that day its
	// issuer may withdraw it whatever has been claimed.
	Evolved int64 `json:"evolved,omitempty"`
}

// Cite is one fact counted for one contributor.
type Cite struct {
	Who  string  `json:"who"`
	Fact fact.ID `json:"fact"`
}

// Vow reports whether the goal pays nothing.
func (g *Goal) Vow() bool { return g.Reward == 0 }

// Open reports whether the goal is still up: live, or a proposal.
func (g *Goal) Open() bool { return g.State == Live || g.State == Proposed }

// Due reports whether the goal's time has run out.
func (g *Goal) Due(now int64) bool { return g.Expires > 0 && g.Expires <= now }

// Left is how many more units the goal counts from a contributor: what
// the pool still lacks, or what that contributor does.
func (g *Goal) Left(who string) int64 {
	if g.Mode == Pooled {
		return max(0, g.Cond.Count-g.Total())
	}
	return max(0, g.Cond.Count-g.Progress.Get(who))
}

// Escrow is what the goal holds to pay out: the reward once, once per
// capped claimant, or the pool.
func (g *Goal) Escrow() int64 {
	if g.Mode == Each {
		return g.Reward * g.Cap
	}
	return g.Reward
}

// Cost is what posting the goal takes from its backer: the escrow and the
// listing fee.
func (g *Goal) Cost() int64 { return g.Escrow() + g.Fee }

// Pledge adds coin to a proposal's pledges, or to a live goal's reward.
func (g *Goal) Pledge(who string, coin int64) {
	g.Pledges.Bump(who, coin)
	if g.State == Live {
		g.Reward += coin
	}
}

// GoLive turns a proposal live on the coin pledged to it: the fee out of
// the pool, the rest the reward, so that Escrow is what the pool is left
// holding.
func (g *Goal) GoLive(pool, fee int64) {
	g.Fee, g.Reward, g.State = fee, pool-fee, Live
	if g.Mode == Each {
		g.Reward = (pool - fee) / max(g.Cap, 1)
	}
}

// Total is every unit counted so far.
func (g *Goal) Total() int64 { return g.Progress.Sum() }

// Kept reports whether a vow to hold off a thing has held so far.
func (g *Goal) Kept() bool { return g.Cond.Abstains() && !g.Broken }

// May reports whether a character may work toward the goal.
func (g *Goal) May(who string) bool {
	switch g.Scope {
	case Personal, Party:
		return slices.Contains(g.Members, who)
	}
	return true
}

// Credit counts one event toward a live goal and returns the claims it
// earns: the first to the count, each capped claimant, or the pool's
// split once the counter fills. A fact is fed once.
func (g *Goal) Credit(e Event) []Claim {
	if g.State != Live {
		return nil
	}
	if g.Cond.Hold() {
		switch {
		// A day's reading is the world's, whoever the goal is for.
		case (e.Goal == "" || e.Goal == g.ID) && g.Cond.Matches(e):
			return g.hold(e)
		case e.Verb == Defeat && g.Cond.in(e) && g.May(e.Who):
			g.Progress.Bump(e.Who, max(e.Units, 1))
		}
		return nil
	}
	if (e.Goal != "" && e.Goal != g.ID) || !g.Cond.Matches(e) || !g.May(e.Who) {
		return nil
	}
	if g.Cond.Abstains() {
		if e.Who == g.Poster || slices.Contains(g.Members, e.Who) {
			g.Broken = true
		}
		return nil
	}
	units := min(max(e.Units, 1), g.Left(e.Who))
	if units <= 0 {
		return nil
	}
	g.Progress.Bump(e.Who, units)
	g.Facts = append(g.Facts, Cite{Who: e.Who, Fact: e.Fact})
	switch g.Mode {
	case First:
		if g.Progress.Get(e.Who) >= g.Cond.Count {
			return g.close([]Claim{g.claim(e.Who, g.Reward)})
		}
	case Each:
		if g.Progress.Get(e.Who) >= g.Cond.Count {
			c := []Claim{g.claim(e.Who, g.Reward)}
			if int64(len(g.Claims)+1) >= g.Cap {
				return g.close(c)
			}
			g.Claims = append(g.Claims, c...)
			return c
		}
	case Pooled:
		if g.Total() >= g.Cond.Count {
			return g.close(g.split())
		}
	}
	return nil
}

// hold reads one day of a Hold: a day on the right side of the line adds to
// the streak, any other clears it, and the streak at the count meets the
// goal. Whoever won fights in the region while the goal was up shares the
// reward; with nobody it pays none and the escrow goes back.
func (g *Goal) hold(e Event) []Claim {
	if e.Units <= g.Day {
		return nil
	}
	g.Day = e.Units
	if !g.Cond.Held(e.Value) {
		g.Streak, g.Facts = 0, nil
		return nil
	}
	g.Streak++
	g.Facts = append(g.Facts, Cite{Who: g.Poster, Fact: e.Fact})
	if g.Streak < g.Cond.Count {
		return nil
	}
	return g.close(g.split())
}

func (g *Goal) claim(who string, coin int64) Claim {
	var facts []fact.ID
	for _, c := range g.Facts {
		if c.Who == who {
			facts = append(facts, c.Fact)
		}
	}
	return Claim{Who: who, Units: g.Progress.Get(who), Coin: coin, Facts: facts}
}

func (g *Goal) close(claims []Claim) []Claim {
	g.Claims = append(g.Claims, claims...)
	g.State, g.Why = Done, Done
	return claims
}

// split shares a pooled reward: equally when Even, else by contribution;
// what rounding leaves goes to the largest contributors first.
func (g *Goal) split() []Claim {
	var out []Claim
	n := int64(len(g.Progress))
	if n == 0 {
		return nil
	}
	total := g.Total()
	var paid int64
	for _, p := range g.Progress {
		share := g.Reward / n
		if !g.Even && total > 0 {
			share = g.Reward * p.N / total
		}
		c := g.claim(p.Key, share)
		out = append(out, c)
		paid += share
	}
	order := make([]int, len(out))
	for i := range order {
		order[i] = i
	}
	slices.SortStableFunc(order, func(a, b int) int {
		return cmp.Or(cmp.Compare(out[b].Units, out[a].Units), cmp.Compare(out[a].Who, out[b].Who))
	})
	for i := 0; paid < g.Reward; i++ {
		out[order[i%len(order)]].Coin++
		paid++
	}
	return out
}

// End closes a goal without its condition met: expired, withdrawn,
// hidden, or a vow resolved at its close.
func (g *Goal) End(why string) {
	g.State, g.Why = Ended, why
}

// Rebind re-casts an evolving goal's place for a new season; the game
// decides what stands in for one that no longer exists.
type Rebind func(at string) string

// Turn applies a season's close to a season goal by its turnover (GDD
// 11.4) and reports whether it ends. A resetting Each goal keeps only the
// claimants its escrow still covers; ratio is the new season's measure
// over the old, in hundredths, for an evolving count.
func (g *Goal) Turn(season, day, ratio int64, rebind Rebind) bool {
	if !g.Open() || g.Lifetime != Season {
		return false
	}
	switch g.Turnover {
	case Expire:
		return true
	case Reset:
		if g.Mode == Each {
			if g.Cap -= int64(len(g.Claims)); g.Cap <= 0 {
				return true
			}
		}
		g.Progress, g.Facts, g.Streak, g.Claims, g.Broken = tally.Tally{}, nil, 0, nil, false
	case Keep:
	case Evolve:
		if rebind != nil && g.Cond.At != "" {
			g.Cond.At = rebind(g.Cond.At)
		}
		if g.Cond.Scales() {
			g.Cond.Count = max(1, g.counted()+1, fixed.PercentFloor(g.Cond.Count, ratio))
		}
		g.Evolved = day
	}
	g.Season = season
	return false
}

// counted is the most the goal has counted toward one claim still open:
// the pool's total, or the furthest contributor yet to claim. An evolved
// amount stays above it, so the goal can still be met by a counted event.
func (g *Goal) counted() int64 {
	if g.Mode == Pooled {
		return g.Total()
	}
	var most int64
	for _, p := range g.Progress {
		claimed := slices.ContainsFunc(g.Claims, func(c Claim) bool { return c.Who == p.Key })
		if !claimed && p.N > most {
			most = p.N
		}
	}
	return most
}

// structural: amounts stay far inside int64, so a reward times its cap
// and a count times a season's ratio cannot wrap.
const amountMost = 1 << 40

// Limits are the goals sheet's cells a posting is checked against.
type Limits struct {
	RewardLeast, EachCap, PartyMost, TitleLen, NoteLen int64
	EphemeralLeast, EphemeralMost                      int64 // ticks
}

// unread names a field the condition sets that its verb's events are never
// matched on, or "": narrowed by one, a goal could not be met.
func (c Condition) unread() string {
	things := []string{Deliver, Make, Discover, Defeat, Haul}
	if c.Abstains() {
		things = append(things, Hold)
	}
	for _, f := range []struct {
		set   bool
		name  string
		verbs []string
	}{
		{c.Kind != "" || c.Tag != "", "kind or tag", things},
		{c.Trait != "", "trait", []string{Make}},
		{c.Hex != nil || c.Within != 0, "distance", []string{Make, Discover, Defeat, Reach}},
		{c.From != "", "start", []string{Haul}},
		{c.Field != "" || c.AtLeast != 0, "field", []string{Discover}},
		{c.Gauge != "" || c.Line != 0 || c.Below, "gauge", []string{Hold}},
		{c.Who != "", "character", []string{Carry}},
		{c.Side != "", "side", []string{Back}},
	} {
		if f.set && !slices.Contains(f.verbs, c.Verb) {
			return f.name
		}
	}
	return ""
}

// Valid reports why a goal cannot be posted as it stands.
func Valid(g *Goal, now int64, l Limits) error {
	c := g.Cond
	switch {
	case !slices.Contains(Verbs, c.Verb):
		return fmt.Errorf("no verb %q", c.Verb)
	case c.Verb == Back:
		return fmt.Errorf("backing a side opens with the first arc")
	case c.unread() != "":
		return fmt.Errorf("a %s is not narrowed by a %s", c.Verb, c.unread())
	case c.Count <= 0 && !c.Abstains():
		return fmt.Errorf("a goal needs an amount")
	case c.Count > amountMost || g.Reward > amountMost:
		return fmt.Errorf("an amount is at most %d", int64(amountMost))
	case c.Verb == Hold && !c.Abstains() && c.At == "":
		return fmt.Errorf("a Hold needs a region")
	case (c.Verb == Deliver || c.Verb == Haul) && c.At == "":
		return fmt.Errorf("a %s needs a place to bring it to", c.Verb)
	case c.Verb == Carry && c.Who == "":
		return fmt.Errorf("a Carry names who is carried")
	case c.Abstains() && g.Reward != 0:
		return fmt.Errorf("a vow to hold off a thing pays nothing")
	case g.Reward != 0 && g.Reward < l.RewardLeast:
		return fmt.Errorf("a reward is at least %d coin, or none", l.RewardLeast)
	case g.Mode != First && g.Mode != Each && g.Mode != Pooled:
		return fmt.Errorf("no mode %q", g.Mode)
	case g.Mode == Each && (g.Cap < 1 || g.Cap > l.EachCap):
		return fmt.Errorf("an Each goal pays 1 to %d claimants", l.EachCap)
	case g.Mode == Each && c.Verb == Haul:
		return fmt.Errorf("a Haul has one stock and one hauler: it pays the first")
	case g.Turnover != Expire && g.Turnover != Reset && g.Turnover != Keep && g.Turnover != Evolve:
		return fmt.Errorf("no turnover %q", g.Turnover)
	case int64(len(g.Members)) > l.PartyMost+1:
		return fmt.Errorf("a party goal names at most %d others", l.PartyMost)
	case int64(len([]rune(g.Title))) > l.TitleLen || g.Title == "":
		return fmt.Errorf("a title is 1 to %d characters", l.TitleLen)
	case int64(len([]rune(g.Note))) > l.NoteLen:
		return fmt.Errorf("a note is at most %d characters", l.NoteLen)
	}
	switch g.Lifetime {
	case Ephemeral:
		if d := g.Expires - now; d < l.EphemeralLeast || d > l.EphemeralMost {
			return fmt.Errorf("an ephemeral goal lasts %d to %d ticks", l.EphemeralLeast, l.EphemeralMost)
		}
	case Season, Standing:
	default:
		return fmt.Errorf("no lifetime %q", g.Lifetime)
	}
	return nil
}
