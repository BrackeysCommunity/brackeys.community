package game

import (
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/guild"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tally"
	"jams.team/mmo-world/sim/world"
)

// Commands of guilds (GDD 4.8, 4.14).
const (
	FoundGuild = "guild-found"   // found a guild under a name
	Invite     = "guild-invite"  // an officer invites a character
	Join       = "guild-join"    // accept an invitation
	Leave      = "guild-leave"   // leave with what you hold
	Promote    = "guild-promote" // the leader makes a member an officer
	Vote       = "guild-vote"    // vote to remove a leader or officer
	Deposit    = "guild-deposit" // give coin or goods to the guild
	Pay        = "guild-pay"     // an officer pays out of the treasury or bank
	Approve    = "guild-approve" // a second officer approves a larger payment
	Draw       = "guild-draw"    // a member takes crafting stock at cost
	Allow      = "guild-allow"   // an officer lets a member withdraw freely (Units 1) or not
	Work       = "guild-work"    // an officer switches a work on (Units 1) or off
)

// structural: the work the market's fee reads by name.
const workOpenLedger = "open-ledger"

// Guild is a guild as the game holds it.
type Guild struct {
	G *guild.Guild `json:"g"`
	// Waiting marks a server's guild that has no settlement yet; it takes
	// the next starting settlement the world opens (D24).
	Waiting bool `json:"waiting,omitempty"`
	// Invited are characters an officer has invited.
	Invited []string `json:"invited,omitempty"`
}

// Pool is the ledger pool holding the guild's treasury (coin) and bank
// (goods).
func (gd *Guild) Pool() string { return ledger.Pool + "guild:" + gd.G.ID }

func guildRef(id string) fact.Ref { return fact.Ref{Kind: "guild", ID: id} }

// GuildOf finds a guild, or nil.
func (g *Game) GuildOf(id string) *Guild {
	i := slices.IndexFunc(g.Guilds, func(gd *Guild) bool { return gd.G.ID == id })
	if i < 0 {
		return nil
	}
	return g.Guilds[i]
}

// ServerGuild is a Discord server's own guild, or nil.
func (g *Game) ServerGuild(server string) *Guild {
	i := slices.IndexFunc(g.Guilds, func(gd *Guild) bool { return server != "" && gd.G.Server == server })
	if i < 0 {
		return nil
	}
	return g.Guilds[i]
}

// install gives a server its own guild the first time one of its players
// arrives, with the nearest starting settlement nobody runs, or the next
// the world opens (D22, D24).
func (g *Game) install(c *Char, server, name string) (*Guild, error) {
	if gd := g.ServerGuild(server); gd != nil {
		return gd, nil
	}
	g.NextGuild++
	id := "g-" + strconv.FormatInt(g.NextGuild, decimal)
	// A server's name is its admins' words, not a player's: one the board
	// would refuse, or another guild holds, gives way to the guild's id.
	if g.named("guild", name) != nil || g.nameTaken(name) {
		name = "Guild " + id
	}
	gd := &Guild{G: guild.New(id, name, c.C.ID, g.Tick())}
	gd.G.Server = server
	g.Guilds = append(g.Guilds, gd)
	if i := slices.IndexFunc(g.Places, func(p *Place) bool { return p.Lattice >= 0 && p.Guild == "" }); i >= 0 {
		g.Places[i].Guild = gd.G.ID
	} else {
		gd.Waiting = true
		g.World.OpenSettlement()
	}
	_, err := g.factWith(c, []fact.Ref{guildRef(gd.G.ID)}, "guild.installed", g.Tick(), fact.S("name", name), fact.S("server", server))
	return gd, err
}

// home is where a new character starts: its server's settlement if it has
// one, else the first starting settlement.
func (g *Game) home(server string) (int, bool) {
	if gd := g.ServerGuild(server); gd != nil {
		if i := slices.IndexFunc(g.Places, func(p *Place) bool { return p.Guild == gd.G.ID }); i >= 0 {
			return i, true
		}
	}
	return 0, len(g.Places) > 0
}

// joinServer puts a new character in its server's guild, installing it
// first if need be.
func (g *Game) joinServer(c *Char, server, name string) error {
	if server == "" {
		return nil
	}
	gd, err := g.install(c, server, name)
	if err != nil {
		return err
	}
	gd.G.Join(c.C.ID, g.Tick())
	c.C.Guild = gd.G.ID
	return nil
}

// admit marks a server's admin as an officer no vote removes, in its
// server's own guild (GDD 4.8).
func (g *Game) admit(c *Char) {
	gd := g.GuildOf(c.C.Guild)
	if gd == nil || gd.G.Server == "" || gd.G.Server != c.Server {
		return
	}
	if m := gd.G.Member(c.C.ID); m != nil && !m.Admin {
		m.Admin, m.Officer, m.Since = true, true, g.Tick()
	}
}

// guildOf is the character's guild, or a refusal.
func (g *Game) guildOf(c *Char) (*Guild, error) {
	gd := g.GuildOf(c.C.Guild)
	if gd == nil {
		return nil, refuse(BadArgs, "%s is in no guild", c.C.ID)
	}
	return gd, nil
}

// officerOf is the character's guild if it is an officer there.
func (g *Game) officerOf(c *Char) (*Guild, error) {
	gd, err := g.guildOf(c)
	if err != nil {
		return nil, err
	}
	if !gd.G.IsOfficer(c.C.ID) {
		return nil, refuse(BadArgs, "only an officer of %s may do that", gd.G.Name)
	}
	return gd, nil
}

// leaveGuild takes a character out of its guild; a server guild's members
// leave too when they join another.
func (g *Game) leaveGuild(c *Char) error {
	gd := g.GuildOf(c.C.Guild)
	if gd == nil {
		return nil
	}
	gd.G.Leave(c.C.ID)
	c.C.Guild = ""
	_, err := g.factWith(c, []fact.Ref{guildRef(gd.G.ID)}, "guild.left", g.Tick())
	return err
}

func (g *Game) guildAct(c *Char, cmd Command) error {
	switch cmd.Kind {
	case FoundGuild:
		return g.foundGuild(c, cmd)
	case Invite:
		return g.invite(c, cmd)
	case Join:
		return g.join(c, cmd)
	case Leave:
		if c.C.Guild == "" {
			return refuse(BadArgs, "%s is in no guild", c.C.ID)
		}
		return g.leaveGuild(c)
	case Promote:
		return g.promote(c, cmd)
	case Vote:
		return g.vote(c, cmd)
	case Deposit:
		return g.deposit(c, cmd)
	case Pay:
		return g.pay(c, cmd)
	case Approve:
		return g.approve(c, cmd)
	case Draw:
		return g.draw(c, cmd)
	case Allow:
		return g.allow(c, cmd)
	case Work:
		return g.work(c, cmd)
	}
	return refuse(BadArgs, "unknown command %q", cmd.Kind)
}

// allow is an officer setting who may withdraw from the bank (GDD 4.14).
func (g *Game) allow(c *Char, cmd Command) error {
	gd, err := g.officerOf(c)
	if err != nil {
		return err
	}
	on := cmd.Units > 0
	if !gd.G.Allow(cmd.Target, on) {
		return refuse(BadArgs, "%s is not a member of %s", cmd.Target, gd.G.Name)
	}
	data := []fact.Datum{fact.N("allowed", cmd.Units)}
	_, err = g.factWith(c, []fact.Ref{guildRef(gd.G.ID), {Kind: "character", ID: cmd.Target}}, "guild.draw-set", g.Tick(), data...)
	return err
}

// named refuses a guild's or settlement's name that is empty, too long,
// or holds a word the board does not take.
func (g *Game) named(what, name string) error {
	if name == "" || int64(len([]rune(name))) > g.sp("guild-name-length") {
		return refuse(BadArgs, "a %s needs a name of 1 to %d characters", what, g.sp("guild-name-length"))
	}
	if g.blocked(name) != "" {
		return refuse(Screened, "the name holds a word the board does not take")
	}
	return nil
}

func (g *Game) foundGuild(c *Char, cmd Command) error {
	name := cmd.Note
	if err := g.named("guild", name); err != nil {
		return err
	}
	if g.nameTaken(name) {
		return refuse(BadArgs, "another guild is called %s", name)
	}
	if gd := g.GuildOf(c.C.Guild); gd != nil && gd.G.Server == "" {
		return refuse(BadArgs, "%s must leave %s first", c.C.ID, gd.G.Name)
	}
	if err := g.leaveGuild(c); err != nil {
		return err
	}
	g.NextGuild++
	gd := &Guild{G: guild.New("g-"+strconv.FormatInt(g.NextGuild, decimal), name, c.C.ID, g.Tick())}
	g.Guilds = append(g.Guilds, gd)
	c.C.Guild = gd.G.ID
	_, err := g.factWith(c, []fact.Ref{guildRef(gd.G.ID)}, "guild.founded", g.Tick(), fact.S("name", name))
	return err
}

func (g *Game) nameTaken(name string) bool {
	return slices.ContainsFunc(g.Guilds, func(gd *Guild) bool { return gd.G.Name == name })
}

func (g *Game) invite(c *Char, cmd Command) error {
	gd, err := g.officerOf(c)
	if err != nil {
		return err
	}
	if g.Char(cmd.Target) == nil || gd.G.Member(cmd.Target) != nil {
		return refuse(BadArgs, "no character %q to invite", cmd.Target)
	}
	if !slices.Contains(gd.Invited, cmd.Target) {
		gd.Invited = append(gd.Invited, cmd.Target)
	}
	_, err = g.factWith(c, []fact.Ref{guildRef(gd.G.ID), {Kind: "character", ID: cmd.Target}}, "guild.invited", g.Tick())
	return err
}

func (g *Game) join(c *Char, cmd Command) error {
	gd := g.GuildOf(cmd.Target)
	if gd == nil || !slices.Contains(gd.Invited, c.C.ID) {
		return refuse(BadArgs, "%s has no invitation to %q", c.C.ID, cmd.Target)
	}
	if cur := g.GuildOf(c.C.Guild); cur != nil && cur.G.Server == "" {
		return refuse(BadArgs, "%s must leave %s first", c.C.ID, cur.G.Name)
	}
	if err := g.leaveGuild(c); err != nil {
		return err
	}
	gd.Invited = slices.DeleteFunc(gd.Invited, func(s string) bool { return s == c.C.ID })
	gd.G.Join(c.C.ID, g.Tick())
	c.C.Guild = gd.G.ID
	_, err := g.factWith(c, []fact.Ref{guildRef(gd.G.ID)}, "guild.joined", g.Tick())
	return err
}

func (g *Game) promote(c *Char, cmd Command) error {
	gd, err := g.guildOf(c)
	if err != nil {
		return err
	}
	if gd.G.Leader != c.C.ID {
		return refuse(BadArgs, "only the leader names officers")
	}
	if !gd.G.Promote(cmd.Target, g.Tick(), g.r.Guild) {
		return refuse(BadArgs, "%s cannot be made an officer: one per %d members", cmd.Target, g.r.Guild.OfficerPer)
	}
	_, err = g.factWith(c, []fact.Ref{guildRef(gd.G.ID), {Kind: "character", ID: cmd.Target}}, "guild.officer", g.Tick())
	return err
}

func (g *Game) vote(c *Char, cmd Command) error {
	gd, err := g.guildOf(c)
	if err != nil {
		return err
	}
	role := cmd.Option
	if !gd.G.Removable(cmd.Target, role) {
		return refuse(BadArgs, "no vote stands against %s as %s", cmd.Target, role)
	}
	carried := gd.G.Cast(c.C.ID, cmd.Target, role, g.World.Day, g.activeMembers(gd), g.r.Guild, gd.G.Next("v"))
	data := []fact.Datum{fact.S("target", cmd.Target), fact.S("role", role)}
	if !carried {
		_, err = g.factWith(c, []fact.Ref{guildRef(gd.G.ID)}, "guild.voted", g.Tick(), data...)
		return err
	}
	if _, err := g.factWith(c, []fact.Ref{guildRef(gd.G.ID), {Kind: "character", ID: cmd.Target}}, "guild.removed", g.Tick(), data...); err != nil {
		return err
	}
	return g.succeed(gd)
}

// activeMembers counts members who acted within active-days.
func (g *Game) activeMembers(gd *Guild) int64 {
	var n int64
	for _, m := range gd.G.Members {
		if g.isActive(m.Char) {
			n++
		}
	}
	return n
}

func (g *Game) isActive(id string) bool {
	c := g.Char(id)
	return c != nil && g.Tick()-c.Acted < g.mp("active-days")*sheets.TicksPerDay && c.Acted > 0
}

// deposit gives coin or goods to the guild: coin to the treasury, goods to
// the bank, recorded for the member at reference value.
func (g *Game) deposit(c *Char, cmd Command) error {
	gd, err := g.guildOf(c)
	if err != nil {
		return err
	}
	asset, err := g.fungible(cmd.Asset)
	if err != nil || cmd.Units <= 0 {
		return refuse(BadArgs, "a deposit is coin, provisions or a material, and an amount")
	}
	if err := g.afford(c, asset, cmd.Asset, cmd.Units); err != nil {
		return err
	}
	if err := g.postAll(ledger.Move(cmd.Key, "deposit", g.Tick(), ledger.Char(c.C.ID), gd.Pool(), asset, cmd.Units)); err != nil {
		return err
	}
	value := g.worth(asset, cmd.Units)
	gd.G.Deposit(c.C.ID, g.World.Day, value)
	_, err = g.factWith(c, []fact.Ref{guildRef(gd.G.ID)}, "guild.deposited", g.Tick(), fact.S("asset", asset), fact.N("units", cmd.Units), fact.N("value", value))
	return err
}

// fungible reads a command's asset: coin, provisions or a material.
func (g *Game) fungible(asset string) (string, error) {
	switch {
	case asset == ledger.Coin || asset == ledger.Provisions:
		return asset, nil
	case g.isMaterial(ledger.Material(asset)):
		return ledger.Material(asset), nil
	case g.isMaterial(asset):
		return asset, nil
	}
	return "", refuse(BadArgs, "no asset %q", asset)
}

// worth is units of an asset at reference value.
func (g *Game) worth(asset string, units int64) int64 {
	if asset == ledger.Coin {
		return units
	}
	m, _ := ledger.GoodsOf(asset)
	return g.r.Values.Asset(m) * units
}

// pay moves coin or goods out of the guild to a character; past the
// officer's day it waits for a second officer.
func (g *Game) pay(c *Char, cmd Command) error {
	gd, err := g.officerOf(c)
	if err != nil {
		return err
	}
	asset, err := g.fungible(cmd.Asset)
	if err != nil || cmd.Units <= 0 || g.Char(cmd.Target) == nil {
		return refuse(BadArgs, "a payment names a character, an asset and an amount")
	}
	if g.Ledger.Of(gd.Pool(), asset) < cmd.Units {
		return refuse(BadArgs, "%s holds less than %d %s", gd.G.Name, cmd.Units, cmd.Asset)
	}
	value := g.worth(asset, cmd.Units)
	if !gd.G.MaySpend(c.C.ID, g.World.Day, value, g.r.Guild) {
		a := guild.Approval{ID: gd.G.Next("a"), By: c.C.ID, Day: g.World.Day, Asset: asset, Units: cmd.Units, Value: value, To: cmd.Target, Purpose: cmd.Note}
		gd.G.Approvals = append(gd.G.Approvals, a)
		_, err := g.factWith(c, []fact.Ref{guildRef(gd.G.ID)}, "guild.approval-asked", g.Tick(), fact.S("approval", a.ID), fact.N("value", value))
		return err
	}
	return g.payOut(gd, c, cmd.Key, asset, cmd.Units, value, cmd.Target)
}

func (g *Game) payOut(gd *Guild, officer *Char, key, asset string, units, value int64, to string) error {
	if err := g.postAll(ledger.Move(key, "guild-pay", g.Tick(), gd.Pool(), ledger.Char(to), asset, units)); err != nil {
		return err
	}
	gd.G.Spent(officer.C.ID, g.World.Day, value)
	_, err := g.factWith(officer, []fact.Ref{guildRef(gd.G.ID), {Kind: "character", ID: to}}, "guild.paid", g.Tick(), fact.S("asset", asset), fact.N("units", units), fact.N("value", value))
	return err
}

func (g *Game) approve(c *Char, cmd Command) error {
	gd, err := g.officerOf(c)
	if err != nil {
		return err
	}
	a, ok := gd.G.Approve(cmd.Option, c.C.ID)
	if !ok {
		return refuse(BadArgs, "no payment %q waits for %s's approval", cmd.Option, c.C.ID)
	}
	if g.Ledger.Of(gd.Pool(), a.Asset) < a.Units || g.Char(a.To) == nil {
		return refuse(BadArgs, "%s no longer holds what it would pay", gd.G.Name)
	}
	return g.payOut(gd, c, cmd.Key, a.Asset, a.Units, a.Value, a.To)
}

// draw lets a member take goods from the bank at cost, paid into the
// treasury, up to the share its deposits allow (GDD 4.14).
func (g *Game) draw(c *Char, cmd Command) error {
	gd, err := g.guildOf(c)
	if err != nil {
		return err
	}
	asset, err := g.fungible(cmd.Asset)
	if err != nil || asset == ledger.Coin || cmd.Units <= 0 {
		return refuse(BadArgs, "a draw names goods and an amount")
	}
	if g.Ledger.Of(gd.Pool(), asset) < cmd.Units {
		return refuse(BadArgs, "the bank holds less than %d %s", cmd.Units, cmd.Asset)
	}
	value := g.worth(asset, cmd.Units)
	if !gd.G.MayDraw(c.C.ID, value, g.r.Guild) {
		return refuse(BadArgs, "%s may draw up to half of what it has put in", c.C.ID)
	}
	if c.C.Coin < value {
		return refuse(BadArgs, "drawing at cost takes %d coin", value)
	}
	t := ledger.Txn{Key: cmd.Key, Kind: "guild-draw", Tick: g.Tick(), Legs: append(ledger.Pair(gd.Pool(), ledger.Char(c.C.ID), asset, cmd.Units),
		ledger.Pair(ledger.Char(c.C.ID), gd.Pool(), ledger.Coin, value)...)}
	if err := g.postAll(t); err != nil {
		return err
	}
	gd.G.Drew(c.C.ID, value)
	_, err = g.factWith(c, []fact.Ref{guildRef(gd.G.ID)}, "guild.drew", g.Tick(), fact.S("asset", asset), fact.N("units", cmd.Units), fact.N("value", value))
	return err
}

// work switches a guild work on or off at the settlement the officer
// stands in, which its guild must run.
func (g *Game) work(c *Char, cmd Command) error {
	gd, err := g.officerOf(c)
	if err != nil {
		return err
	}
	p := g.PlaceAt(c.C.At)
	row := g.r.works[cmd.Option]
	switch {
	case p == nil || p.Guild != gd.G.ID:
		return refuse(NotHere, "a work runs at a settlement %s runs", gd.G.Name)
	case row == nil:
		return refuse(BadArgs, "no work %q", cmd.Option)
	case row.Needs != "" && !p.Open(row.Needs):
		return refuse(NotHere, "%s needs a %s standing here", row.ID, row.Needs)
	}
	on := cmd.Units > 0
	kind := "guild.work-on"
	if on {
		if gd.G.Work(row.ID, p.N) != nil {
			return refuse(BadArgs, "%s already runs here", row.ID)
		}
		gd.G.Works = append(gd.G.Works, guild.Work{ID: row.ID, Settlement: p.N, Since: g.Tick(), By: c.C.ID})
	} else {
		if !gd.G.Stop(row.ID, p.N) {
			return refuse(BadArgs, "%s does not run here", row.ID)
		}
		kind = "guild.work-off"
	}
	_, err = g.factWith(c, []fact.Ref{guildRef(gd.G.ID)}, kind, g.Tick(), fact.S("work", row.ID), fact.N("settlement", int64(p.N)))
	return err
}

// WorkRunning is a work stocked at a settlement and the guild running it,
// or nil. A work switched on runs from the first world day the bank feeds
// it.
func (g *Game) WorkRunning(settlement int, id string) (*Guild, *guild.Work) {
	if settlement < 0 || settlement >= len(g.Places) {
		return nil, nil
	}
	gd := g.GuildOf(g.Places[settlement].Guild)
	if gd == nil {
		return nil, nil
	}
	if w := gd.G.Work(id, settlement); w != nil && w.Days > 0 {
		return gd, w
	}
	return nil, nil
}

// workHere is the work giving something where a character stands, or nil;
// member limits it to the guild's own members.
func (g *Game) workHere(c *Char, gives string, member bool) (*sheets.GuildWork, *guild.Work) {
	n, ok := g.SettlementAt(c.C.At)
	if !ok {
		return nil, nil
	}
	for _, row := range g.r.Book.GuildWorks {
		if row.Gives != gives {
			continue
		}
		if gd, w := g.WorkRunning(n, row.ID); w != nil && (!member || gd.G.Member(c.C.ID) != nil) {
			return &row, w
		}
	}
	return nil, nil
}

// spared is what a running work takes off a cost: its share, held to what
// is left of the day's stock at reference value, so no work gives back
// more than it burned (GDD 4.14).
func spared(row *sheets.GuildWork, w *guild.Work, cost int64) int64 {
	return max(0, min(cost*row.By/hundred, w.Left))
}

// workGave books what a work spared against its day.
func (g *Game) workGave(w *guild.Work, saved int64) {
	w.Left -= saved
	g.WorkLedger.Gave.Bump(w.ID, saved)
}

// guildsTurn is the guilds' world day: works consume their stock or lapse
// (a road patrol's threat is a world effect), approvals and votes lapse,
// idle leaders are succeeded, and a server guild re-picks its leader.
func (g *Game) guildsTurn(t int64) error {
	day := t / sheets.TicksPerDay
	closing := day%g.r.wp("season-days") == 0
	for _, gd := range g.Guilds {
		if closing {
			gd.G.NewSeason()
		}
		gd.G.Lapse(day, g.r.Guild)
		if err := g.stock(gd, t); err != nil {
			return err
		}
		if gd.G.Server != "" && day-gd.G.Picked >= g.r.Guild.ServerLeaderEvery {
			if l := gd.G.PickLeader(g.acted(gd), day); l != "" {
				if _, err := g.worldFact(g.guildHex(gd), "guild.leader", []fact.Ref{guildRef(gd.G.ID), {Kind: "character", ID: l}}, nil); err != nil {
					return err
				}
			}
			continue
		}
		if err := g.succeed(gd); err != nil {
			return err
		}
	}
	return nil
}

// succeed replaces a leader idle past leader-idle-days, which is a fact.
func (g *Game) succeed(gd *Guild) error {
	idle := g.r.Guild.LeaderIdleDays * sheets.TicksPerDay
	l := gd.G.Succeed(func(id string) bool {
		c := g.Char(id)
		return c != nil && g.Tick()-c.Acted < idle
	})
	if l == "" {
		return nil
	}
	_, err := g.worldFact(g.guildHex(gd), "guild.leader", []fact.Ref{guildRef(gd.G.ID), {Kind: "character", ID: l}}, nil)
	return err
}

// acted is how many ticks each member acted in over the server leader's
// window, read as the ticks since its last act counted back.
func (g *Game) acted(gd *Guild) tally.Tally {
	var t tally.Tally
	window := g.r.Guild.ServerLeaderDays * sheets.TicksPerDay
	for _, m := range gd.G.Members {
		if c := g.Char(m.Char); c != nil && g.Tick()-c.Acted < window {
			t.Bump(m.Char, max(1, c.C.Walked+c.C.Crafts.Sum()+c.C.Fights.Won.Sum()))
		}
	}
	return t
}

// guildHex is where a guild's world facts are placed: its first
// settlement, else the first starting settlement.
func (g *Game) guildHex(gd *Guild) hex.Hex {
	for _, p := range g.Places {
		if p.Guild == gd.G.ID {
			return p.Hex
		}
	}
	return g.SettlementHex(0)
}

// stock feeds each work from the bank for the day, a Quartermaster's
// works using less; a work the bank cannot feed lapses, which is a fact.
func (g *Game) stock(gd *Guild, t int64) error {
	var kept []guild.Work
	for _, w := range gd.G.Works {
		row := g.r.works[w.ID]
		pct := int64(hundred)
		if by := g.Char(w.By); by != nil {
			pct = g.charScale(by, "works-stock", hundred)
		}
		lines := linesOf(row.Uses, pct)
		legs, ok := g.takeLines(gd.Pool(), lines)
		key := ledger.SubKey("work", gd.G.ID, w.ID, strconv.Itoa(w.Settlement), strconv.FormatInt(t/sheets.TicksPerDay, decimal))
		if !ok {
			if _, err := g.worldFact(g.SettlementHex(w.Settlement), "guild.work-lapsed", []fact.Ref{guildRef(gd.G.ID)}, nil, fact.S("work", w.ID), fact.N("settlement", int64(w.Settlement))); err != nil {
				return err
			}
			continue
		}
		if err := g.post(ledger.Txn{Key: key, Kind: "work", Tick: t, Legs: ledger.Merge(append(legs, sinkLegs(legs, ledger.ToWorks)...))}); err != nil {
			return err
		}
		w.Left = g.linesWorth(lines)
		g.WorkLedger.Used.Bump(row.ID, w.Left)
		w.Days++
		kept = append(kept, w)
		if row.Gives == "threat" {
			g.Pending = append(g.Pending, world.Action{Kind: world.ActEase, Hex: g.SettlementHex(w.Settlement), By: guildRef(gd.G.ID), Units: row.By})
		}
	}
	gd.G.Works = kept
	return nil
}

// takeLines are the legs taking each line from a pool's holdings by tag,
// or false if it holds too little.
func (g *Game) takeLines(pool string, lines []costLine) ([]ledger.Leg, bool) {
	held := g.Ledger.Held(pool)
	var legs []ledger.Leg
	for _, l := range lines {
		need := l.Units
		for _, h := range held {
			if need == 0 {
				break
			}
			ok := l.Tag == "" && h.Asset == ledger.Coin
			if l.Tag != "" {
				if m, isMat := ledger.GoodsOf(h.Asset); isMat {
					ok = g.materialHas(m, l.Tag)
				}
			}
			if !ok {
				continue
			}
			n := min(need, h.Units)
			legs = append(legs, ledger.Leg{Account: pool, Asset: h.Asset, Units: -n})
			need -= n
		}
		if need > 0 {
			return nil, false
		}
	}
	return legs, true
}

// sinkLegs balance taking legs into a sink.
func sinkLegs(legs []ledger.Leg, sink string) []ledger.Leg {
	out := make([]ledger.Leg, len(legs))
	for i, l := range legs {
		out[i] = ledger.Leg{Account: sink, Asset: l.Asset, Units: -l.Units}
	}
	return out
}

// WorkLedger is guild works' coin value consumed and given back, by work.
type WorkLedger struct {
	Used tally.Tally `json:"used,omitempty"`
	Gave tally.Tally `json:"gave,omitempty"`
}

// linesWorth is cost lines at reference value: coin as itself, goods at
// the cheapest material holding the tag.
func (g *Game) linesWorth(lines []costLine) int64 {
	var n int64
	for _, l := range lines {
		if l.Tag == "" {
			n += l.Units
			continue
		}
		n += l.Units * g.tagValue(l.Tag)
	}
	return n
}

// tagValue is the least reference value of a material holding a tag.
func (g *Game) tagValue(tag string) int64 {
	if tag == ledger.Provisions {
		return g.r.Values.Param("provisions-value")
	}
	best := int64(0)
	for _, m := range g.r.Book.Materials {
		if slices.Contains(m.Tags, tag) {
			if v := g.r.Values.Asset(m.ID); best == 0 || v < best {
				best = v
			}
		}
	}
	return best
}

// StockDays is how many world days the guild's bank feeds a work, at its
// daily use.
func (g *Game) StockDays(gd *Guild, row *sheets.GuildWork) int64 {
	days := int64(-1)
	for _, l := range row.Uses {
		have := g.heldOfTag(gd.Pool(), l.Tag)
		n := have / max(l.Quantity, 1)
		if days < 0 || n < days {
			days = n
		}
	}
	return max(days, 0)
}

// heldOfTag is what a pool holds of a tag's goods, or coin for none.
func (g *Game) heldOfTag(pool, tag string) int64 {
	var n int64
	for _, h := range g.Ledger.Held(pool) {
		if tag == "" && h.Asset == ledger.Coin {
			n += h.Units
		}
		if m, ok := ledger.GoodsOf(h.Asset); ok && tag != "" && g.materialHas(m, tag) {
			n += h.Units
		}
	}
	return n
}

// VotesNeeded is how many votes carry a motion in a guild now.
func (g *Game) VotesNeeded(gd *Guild) int64 {
	return g.activeMembers(gd)*g.r.Guild.VoteShare/hundred + 1
}
