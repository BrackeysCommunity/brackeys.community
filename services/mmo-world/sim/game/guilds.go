package game

import (
	"math/bits"
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/guild"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/settle"
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

// Guild is a guild as the game holds it.
type Guild struct {
	G *guild.Guild `json:"g"`
	// Waiting marks a server's guild that has no settlement yet; it takes
	// the next starting settlement the world opens.
	Waiting bool `json:"waiting,omitempty"`
	// Invited are characters an officer has invited.
	Invited []string `json:"invited,omitempty"`
}

// Pool is the ledger pool holding the guild's treasury (coin) and bank
// (goods).
func (gd *Guild) Pool() string { return ledger.GuildPool(gd.G.ID) }

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

// newGuild founds a guild under the next id; an empty name stands for
// one named after that id.
func (g *Game) newGuild(name string, founder *Char) *Guild {
	g.NextGuild++
	id := "g-" + strconv.FormatInt(g.NextGuild, decimal)
	if name == "" {
		name = "Guild " + id
	}
	gd := &Guild{G: guild.New(id, name, founder.C.ID, g.Tick())}
	g.Guilds = append(g.Guilds, gd)
	return gd
}

// install gives a server its own guild the first time one of its players
// arrives, with the first starting settlement nobody runs, or the next
// the world opens.
func (g *Game) install(c *Char, server, name string) (*Guild, error) {
	if gd := g.ServerGuild(server); gd != nil {
		return gd, nil
	}
	// A server's name is its admins' words, not a player's: one the board
	// would refuse, or another guild holds, gives way to the guild's id.
	if g.named("guild", name) != nil || g.nameTaken(name) {
		name = ""
	}
	gd := g.newGuild(name, c)
	name = gd.G.Name
	gd.G.Server = server
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

// admit keeps a server guild's admins in step with Discord (GDD 4.8): a
// command sent from the guild's own server marks its character an admin
// there, or unmarks one whose permission is gone. The mark governs the
// command that carries it; undo puts it back if that command is refused.
func (g *Game) admit(c *Char, cmd Command) (undo func()) {
	undo = func() {}
	gd := g.GuildOf(c.C.Guild)
	if gd == nil || gd.G.Server == "" || gd.G.Server != c.Server || cmd.Server != gd.G.Server {
		return undo
	}
	m := gd.G.Member(c.C.ID)
	if m == nil {
		return undo
	}
	admin, since := m.Admin, m.Since
	if !gd.G.SetAdmin(c.C.ID, cmd.Admin, g.Tick()) {
		return undo
	}
	return func() {
		if m := gd.G.Member(c.C.ID); m != nil {
			m.Admin, m.Since = admin, since
		}
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

// officerHere is the guild a character is an officer of and the settlement
// it stands in, which that guild must run; does says what is refused
// anywhere else.
func (g *Game) officerHere(c *Char, does string) (*Guild, *Place, error) {
	gd, err := g.officerOf(c)
	if err != nil {
		return nil, nil, err
	}
	runs, p := g.RunsHere(c)
	if runs != gd {
		return nil, nil, refuse(NotHere, "%s %s at a settlement it runs", gd.G.Name, does)
	}
	return gd, p, nil
}

// OfficerHere reports whether a character is an officer of the guild
// running the settlement it stands in.
func (g *Game) OfficerHere(c *Char) bool {
	gd, _ := g.RunsHere(c)
	return gd != nil && gd.G.IsOfficer(c.C.ID)
}

// leaveGuild takes a character out of its guild; a server guild's members
// leave too when they join another. A founded guild its last member
// leaves is over.
func (g *Game) leaveGuild(c *Char, key string) error {
	gd := g.GuildOf(c.C.Guild)
	if gd == nil {
		return nil
	}
	gd.G.Leave(c.C.ID)
	c.C.Guild = ""
	if _, err := g.factWith(c, []fact.Ref{guildRef(gd.G.ID)}, "guild.left", g.Tick()); err != nil {
		return err
	}
	if len(gd.G.Members) > 0 || gd.G.Server != "" {
		return nil
	}
	return g.disband(gd, key)
}

// disband ends a guild nobody is in: its musters and raises end, its
// settlements go back to their keepers, its works stop, and what it holds
// goes to the treasury of the first settlement it ran, or to fees if it
// ran none, so no pool nobody can reach holds coin.
func (g *Game) disband(gd *Guild, key string) error {
	for _, x := range g.Goals {
		if x.Open() && g.MusterGuild(x) == gd {
			if err := g.endGoal(x, "disbanded", key); err != nil {
				return err
			}
		}
	}
	gd.G.Disband()
	gd.Invited = nil
	to := ""
	for _, p := range g.Places {
		if p.Guild != gd.G.ID {
			continue
		}
		p.Guild = ""
		if to == "" {
			to = TreasuryPool(p.N)
		}
	}
	if to == "" {
		to = ledger.ToFees
	}
	legs := g.sweep(gd.Pool(), to)
	if len(legs) == 0 {
		return nil
	}
	return g.postAll(ledger.Txn{Key: ledger.SubKey(key, "disband"), Kind: "guild-disband", Tick: g.Tick(), Legs: legs})
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
		return g.leaveGuild(c, cmd.Key)
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
	_, err = g.factWith(c, []fact.Ref{guildRef(gd.G.ID), char.Ref(cmd.Target)}, "guild.draw-set", g.Tick(), data...)
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
	if err := g.leaveGuild(c, cmd.Key); err != nil {
		return err
	}
	gd := g.newGuild(name, c)
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
	_, err = g.factWith(c, []fact.Ref{guildRef(gd.G.ID), char.Ref(cmd.Target)}, "guild.invited", g.Tick())
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
	if err := g.leaveGuild(c, cmd.Key); err != nil {
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
	if !g.CanPromote(gd, c, cmd.Target) || !gd.G.Promote(cmd.Target, g.Tick(), g.r.Guild) {
		return refuse(BadArgs, "%s cannot be named an officer: the leader names one per %d members", cmd.Target, g.r.Guild.OfficerPer)
	}
	_, err = g.factWith(c, []fact.Ref{guildRef(gd.G.ID), char.Ref(cmd.Target)}, "guild.officer", g.Tick())
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
	if _, err := g.factWith(c, []fact.Ref{guildRef(gd.G.ID), char.Ref(cmd.Target)}, "guild.removed", g.Tick(), data...); err != nil {
		return err
	}
	// Whoever a vote just removed does not succeed itself.
	return g.succeed(gd, cmd.Target)
}

// activeMembers counts a guild's active members.
func (g *Game) activeMembers(gd *Guild) int64 {
	var n int64
	for _, m := range gd.G.Members {
		if c := g.Char(m.Char); c != nil && g.active(c) {
			n++
		}
	}
	return n
}

// actedWithin reports whether a character's last command was inside the
// last days world days.
func (g *Game) actedWithin(c *Char, days int64) bool {
	return g.Tick()-c.Acted < days*sheets.TicksPerDay
}

// RunsHere is the guild running the settlement a character stands in, and
// that settlement: no guild where its keepers run it, neither on any
// other tile.
func (g *Game) RunsHere(c *Char) (*Guild, *Place) {
	p := g.PlaceAt(c.C.At)
	if p == nil {
		return nil, nil
	}
	return g.GuildOf(p.Guild), p
}

// bankAt is the settlement a character stands in if its guild runs it,
// which is where the bank's goods are (GDD 10.1): goods go in and out
// nowhere else. Coin is the treasury's and moves from anywhere.
func (g *Game) bankAt(gd *Guild, c *Char) (*Place, error) {
	if runs, p := g.RunsHere(c); runs == gd {
		return p, nil
	}
	return nil, refuse(NotHere, "%s's bank is at a settlement it runs: goods go in and out there", gd.G.Name)
}

// handOver refuses a payment of goods unless the officer and whoever is
// paid both stand at the bank it comes out of; coin needs neither.
func (g *Game) handOver(gd *Guild, officer *Char, asset, to string) error {
	if asset == ledger.Coin {
		return nil
	}
	return g.atBankWith(gd, officer, to)
}

// atBankWith refuses unless a character and another both stand at the
// guild's bank.
func (g *Game) atBankWith(gd *Guild, c *Char, other string) error {
	bank, err := g.bankAt(gd, c)
	if err != nil {
		return err
	}
	if d := g.Char(other); d == nil || g.PlaceAt(d.C.At) != bank {
		return refuse(NotHere, "%s is paid goods standing at the bank they come from", other)
	}
	return nil
}

// CanPayGoods reports whether an officer could hand a member goods from
// the bank where they both stand.
func (g *Game) CanPayGoods(gd *Guild, c *Char, to string) bool {
	return gd.G.IsOfficer(c.C.ID) && gd.G.Member(to) != nil && g.atBankWith(gd, c, to) == nil
}

// BankHere reports whether a character stands where its guild's bank
// takes and gives goods.
func (g *Game) BankHere(c *Char) bool {
	gd := g.GuildOf(c.C.Guild)
	if gd == nil {
		return false
	}
	_, err := g.bankAt(gd, c)
	return err == nil
}

// deposit gives coin or goods to the guild: coin to the treasury, goods to
// the bank where it stands, recorded for the member at reference value.
func (g *Game) deposit(c *Char, cmd Command) error {
	gd, err := g.guildOf(c)
	if err != nil {
		return err
	}
	asset, err := g.fungible(cmd.Asset)
	if err != nil || cmd.Units <= 0 {
		return refuse(BadArgs, "a deposit is coin, provisions or a material, and an amount")
	}
	if asset != ledger.Coin {
		if _, err := g.bankAt(gd, c); err != nil {
			return err
		}
	}
	if err := g.afford(c, asset, cmd.Asset, cmd.Units); err != nil {
		return err
	}
	if err := g.postAll(ledger.Move(cmd.Key, "deposit", g.Tick(), ledger.Char(c.C.ID), gd.Pool(), asset, cmd.Units)); err != nil {
		return err
	}
	value := g.worth(asset, cmd.Units)
	gd.G.Deposit(c.C.ID, g.World.Day, value, g.r.Guild)
	c.C.Deeds.Bump(DeedGiven, value)
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
// officer's day it waits for a second officer. Goods are handed over at
// the bank: the officer and the payee both stand there.
func (g *Game) pay(c *Char, cmd Command) error {
	gd, err := g.officerOf(c)
	if err != nil {
		return err
	}
	asset, err := g.fungible(cmd.Asset)
	if err != nil || cmd.Units <= 0 || g.Char(cmd.Target) == nil {
		return refuse(BadArgs, "a payment names a character, an asset and an amount")
	}
	if err := g.payable(gd, c, asset, cmd.Units, cmd.Target); err != nil {
		return err
	}
	value := g.worth(asset, cmd.Units)
	if !gd.G.MaySpend(c.C.ID, g.World.Day, value, g.r.Guild) {
		a := gd.G.Ask(guild.Approval{By: c.C.ID, Day: g.World.Day, Asset: asset, Units: cmd.Units, Value: value, To: cmd.Target, Purpose: cmd.Note})
		_, err := g.factWith(c, []fact.Ref{guildRef(gd.G.ID)}, "guild.approval-asked", g.Tick(), fact.S("approval", a.ID), fact.N("value", value))
		return err
	}
	gd.G.Spent(c.C.ID, g.World.Day, value)
	return g.payOut(gd, c, cmd.Key, asset, cmd.Units, value, cmd.Target)
}

// payable refuses a payment the guild cannot make now: goods are handed
// over at the bank, and the guild holds what it pays.
func (g *Game) payable(gd *Guild, officer *Char, asset string, units int64, to string) error {
	if err := g.handOver(gd, officer, asset, to); err != nil {
		return err
	}
	if g.Char(to) == nil || g.Ledger.Of(gd.Pool(), asset) < units {
		return refuse(BadArgs, "%s does not hold %d %s to pay %s", gd.G.Name, units, asset, to)
	}
	return nil
}

// payOut moves a payment out of the guild, a fact of the officer who made
// it.
func (g *Game) payOut(gd *Guild, by *Char, key, asset string, units, value int64, to string) error {
	if err := g.postAll(ledger.Move(key, "guild-pay", g.Tick(), gd.Pool(), ledger.Char(to), asset, units)); err != nil {
		return err
	}
	_, err := g.factWith(by, []fact.Ref{guildRef(gd.G.ID), char.Ref(to)}, "guild.paid", g.Tick(), fact.S("asset", asset), fact.N("units", units), fact.N("value", value))
	return err
}

// approve is a second officer letting a payment over the asker's day go
// out. It is the asker's payment, and counts against neither's day: two
// officers agreeing is the limit on it.
func (g *Game) approve(c *Char, cmd Command) error {
	gd, err := g.officerOf(c)
	if err != nil {
		return err
	}
	a, err := g.approval(gd, c, cmd.Option)
	if err != nil {
		return err
	}
	gd.G.Approve(a.ID, c.C.ID)
	by := g.Char(a.By)
	if by == nil {
		by = c
	}
	return g.payOut(gd, by, cmd.Key, a.Asset, a.Units, a.Value, a.To)
}

// approval is a waiting payment an officer may approve where it stands, or
// the refusal.
func (g *Game) approval(gd *Guild, c *Char, id string) (guild.Approval, error) {
	a, ok := gd.G.Pending(id, c.C.ID)
	if !ok {
		return a, refuse(BadArgs, "no payment %q waits for %s's approval", id, c.C.ID)
	}
	return a, g.payable(gd, c, a.Asset, a.Units, a.To)
}

// CanApprove reports whether a character could approve a waiting payment
// now.
func (g *Game) CanApprove(gd *Guild, c *Char, id string) bool {
	_, err := g.approval(gd, c, id)
	return err == nil
}

// CanPromote reports whether a character could name a member an officer.
func (g *Game) CanPromote(gd *Guild, c *Char, member string) bool {
	return gd.G.Leader == c.C.ID && gd.G.MayPromote(member, g.r.Guild)
}

// draw lets a member standing at the bank take goods from it at cost,
// paid into the treasury, up to the share its deposits allow (GDD 4.14).
func (g *Game) draw(c *Char, cmd Command) error {
	gd, err := g.guildOf(c)
	if err != nil {
		return err
	}
	asset, err := g.fungible(cmd.Asset)
	if err != nil || asset == ledger.Coin || cmd.Units <= 0 {
		return refuse(BadArgs, "a draw names goods and an amount")
	}
	if _, err := g.bankAt(gd, c); err != nil {
		return err
	}
	held, share, paid := g.drawBounds(gd, c, asset)
	value := g.worth(asset, cmd.Units)
	switch {
	case cmd.Units > held:
		return refuse(BadArgs, "the bank holds less than %d %s", cmd.Units, cmd.Asset)
	case cmd.Units > share:
		return refuse(BadArgs, "%s may draw up to %d%% of what it has put in", c.C.ID, g.r.Guild.DrawShare)
	case cmd.Units > paid:
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

// drawBounds are the most units of a bank's stock a member's draw is held
// to, one for each refusal: what the bank holds, what its share still
// allows at cost, and what its coin pays for. A bound that does not bind
// is what the bank holds.
func (g *Game) drawBounds(gd *Guild, c *Char, asset string) (held, share, paid int64) {
	held = max(g.Ledger.Of(gd.Pool(), asset), 0)
	share, paid = held, held
	each := g.worth(asset, 1)
	room, capped := gd.G.DrawRoom(c.C.ID, g.r.Guild)
	switch {
	case capped && room < 0:
		share = 0
	case capped && each > 0:
		share = room / each
	}
	if each > 0 {
		paid = c.C.Coin / each
	}
	return held, share, paid
}

// DrawMost is the most of a bank's stock a character may draw now: none
// away from the bank, else what the bank holds, its coin pays for at cost
// and its share allows.
func (g *Game) DrawMost(gd *Guild, c *Char, asset string) int64 {
	if _, err := g.bankAt(gd, c); err != nil {
		return 0
	}
	return max(min(g.drawBounds(gd, c, asset)), 0)
}

// CostEach is what a unit of a bank's stock is worth at cost: what drawing
// one pays the treasury, and what paying one out counts against an
// officer's day.
func (g *Game) CostEach(asset string) int64 { return g.worth(asset, 1) }

// work switches a guild work on or off at the settlement the officer
// stands in, which its guild must run. Switching off asks nothing of the
// work's structure.
func (g *Game) work(c *Char, cmd Command) error {
	gd, p, err := g.officerHere(c, "runs works")
	if err != nil {
		return err
	}
	row := g.r.works[cmd.Option]
	if row == nil {
		return refuse(BadArgs, "no work %q", cmd.Option)
	}
	kind := "guild.work-off"
	if cmd.Units > 0 {
		switch {
		case row.Waits != "":
			return refuse(BadArgs, "%s does nothing yet: it waits for %s", row.ID, row.Waits)
		case !CanWork(p, row):
			return refuse(NotHere, "%s needs a %s standing here", row.ID, row.Needs)
		case !gd.G.Start(row.ID, p.N, c.C.ID, g.Tick()):
			return refuse(BadArgs, "%s already runs here", row.ID)
		}
		kind = "guild.work-on"
	} else if !gd.G.Stop(row.ID, p.N) {
		return refuse(BadArgs, "%s does not run here", row.ID)
	}
	_, err = g.factWith(c, []fact.Ref{guildRef(gd.G.ID)}, kind, g.Tick(), fact.S("work", row.ID), fact.N("settlement", int64(p.N)))
	return err
}

// WorkRunning is a work stocked at a settlement and the guild running it,
// or nil. A work switched on runs from the first world day the bank feeds
// it, and gives nothing while its structure is shut.
func (g *Game) WorkRunning(settlement int, id string) (*Guild, *guild.Work) {
	if settlement < 0 || settlement >= len(g.Places) {
		return nil, nil
	}
	p := g.Places[settlement]
	gd, row := g.GuildOf(p.Guild), g.r.works[id]
	if gd == nil || row == nil || !CanWork(p, row) {
		return nil, nil
	}
	if w := gd.G.Work(id, settlement); w != nil && w.Days > 0 {
		return gd, w
	}
	return nil, nil
}

// CanWork reports whether a work can run at a settlement: its structure
// stands open and its system is built.
func CanWork(p *Place, row *sheets.GuildWork) bool {
	return row.Waits == "" && (row.Needs == "" || p.Open(row.Needs))
}

// workHere is the work giving something where a character stands, or nil;
// member limits it to the guild's own members.
func (g *Game) workHere(c *Char, gives string, member bool) (*sheets.GuildWork, *guild.Work) {
	n, ok := g.SettlementAt(c.C.At)
	if !ok {
		return nil, nil
	}
	if member {
		return g.workAt(n, gives, c)
	}
	return g.workAt(n, gives, nil)
}

// workAt is the work giving something at a settlement, or nil; a member
// named limits it to that character's own guild.
func (g *Game) workAt(n int, gives string, member *Char) (*sheets.GuildWork, *guild.Work) {
	for i := range g.r.Book.GuildWorks {
		row := &g.r.Book.GuildWorks[i]
		if row.Gives != gives {
			continue
		}
		if gd, w := g.WorkRunning(n, row.ID); w != nil && (member == nil || gd.G.Member(member.C.ID) != nil) {
			return row, w
		}
	}
	return nil, nil
}

// spared is what a running work takes off a cost: its share, held to what
// is left of the day's stock at reference value, so no work gives back
// more than it burned (GDD 4.14).
func spared(row *sheets.GuildWork, w *guild.Work, cost int64) int64 {
	return max(0, min(fixed.PercentFloor(cost, row.By), w.Left))
}

// workGave books what a work spared against its day.
func (g *Game) workGave(w *guild.Work, saved int64) {
	w.Left -= saved
	w.Gave += saved
	g.WorkLedger.Gave.Bump(w.ID, saved)
}

// guildsTurn is the guilds' world day: a season's close clears the
// season's ranks, approvals and votes lapse, works consume their stock or
// lapse, idle leaders are succeeded, and a server guild re-picks its
// leader.
func (g *Game) guildsTurn(t int64) error {
	day := t / sheets.TicksPerDay
	closing, _ := g.seasonCloses(day)
	for _, gd := range g.Guilds {
		if closing {
			gd.G.NewSeason()
		}
		gd.G.Lapse(day, g.r.Guild)
		if err := g.stock(gd, t); err != nil {
			return err
		}
		if gd.G.Server != "" && day-gd.G.Picked >= g.r.Guild.ServerLeaderEvery {
			if err := g.leaderFact(gd, gd.G.PickLeader(g.acted(gd, day), day)); err != nil {
				return err
			}
			continue
		}
		if err := g.succeed(gd, ""); err != nil {
			return err
		}
	}
	return nil
}

// succeed replaces a leader idle past leader-idle-days, or fills an empty
// leadership, passing over skip; a new leader is a fact.
func (g *Game) succeed(gd *Guild, skip string) error {
	return g.leaderFact(gd, gd.G.Succeed(func(id string) bool {
		c := g.Char(id)
		return c != nil && id != skip && g.actedWithin(c, g.r.Guild.LeaderIdleDays)
	}))
}

// leaderFact records a guild's new leader, if it has one.
func (g *Game) leaderFact(gd *Guild, leader string) error {
	if leader == "" {
		return nil
	}
	_, err := g.worldFact(g.guildHex(gd), "guild.leader", []fact.Ref{guildRef(gd.G.ID), char.Ref(leader)}, nil)
	return err
}

// acted weighs each member by the world days it acted in inside the
// server leader's window, which ends with the day before.
func (g *Game) acted(gd *Guild, day int64) tally.Tally {
	var t tally.Tally
	for _, m := range gd.G.Members {
		if c := g.Char(m.Char); c != nil {
			if n := c.daysActed(day, g.r.Guild.ServerLeaderDays); n > 0 {
				t.Bump(m.Char, n)
			}
		}
	}
	return t
}

// structural: a character's days are the bits of one word.
const daysKept = 64

// markDay records that a character acted on a world day.
func (c *Char) markDay(day int64) {
	switch age := day - c.DaysDay; {
	case age >= daysKept:
		c.Days = 0
	case age > 0:
		c.Days <<= uint(age)
	}
	c.Days, c.DaysDay = c.Days|1, day
}

// daysActed counts the world days a character acted in among the n
// before day.
func (c *Char) daysActed(day, n int64) int64 {
	age := day - c.DaysDay
	lo, hi := max(0, 1-age), min(n-age, daysKept-1)
	if hi < lo {
		return 0
	}
	days := c.Days >> uint(lo)
	if width := hi - lo + 1; width < daysKept {
		days &= 1<<uint(width) - 1
	}
	return int64(bits.OnesCount64(days))
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

// WorkUses is what a work burns a day: its sheet's lines, less a
// Quartermaster's share for a work that officer switched on. w is nil for
// a work that is off.
func (g *Game) WorkUses(row *sheets.GuildWork, w *guild.Work) []sheets.CostLine {
	if w == nil {
		return row.Uses
	}
	pct := int64(fixed.Hundredths)
	if by := g.Char(w.By); by != nil {
		pct = g.charScale(by, "works-stock", fixed.Hundredths)
	}
	return settle.Scaled(row.Uses, pct)
}

// stock feeds each work from the bank for the day; a work the bank cannot
// feed, or whose structure has shut, lapses, which is a fact.
func (g *Game) stock(gd *Guild, t int64) error {
	var kept []guild.Work
	for _, w := range gd.G.Works {
		row := g.r.works[w.ID]
		lines := g.WorkUses(row, &w)
		legs, short, _ := g.takeLines(g.Ledger.Held(gd.Pool()), lines)
		key := ledger.SubKey("work", gd.G.ID, w.ID, strconv.Itoa(w.Settlement), strconv.FormatInt(t/sheets.TicksPerDay, decimal))
		if short != nil || !CanWork(g.Places[w.Settlement], row) {
			if _, err := g.worldFact(g.SettlementHex(w.Settlement), "guild.work-lapsed", []fact.Ref{guildRef(gd.G.ID)}, nil, fact.S("work", w.ID), fact.N("settlement", int64(w.Settlement))); err != nil {
				return err
			}
			continue
		}
		if err := g.post(ledger.Txn{Key: key, Kind: "work", Tick: t, Legs: ledger.Merge(append(legs, sinkLegs(legs, ledger.ToWorks)...))}); err != nil {
			return err
		}
		w.Left = g.linesWorth(lines)
		w.Used += w.Left
		g.WorkLedger.Used.Bump(row.ID, w.Left)
		w.Days++
		kept = append(kept, w)
		// A patrol's threat is eased by the world, at the next tick.
		if row.Gives == guild.GivesThreat && row.By > 0 {
			g.Pending = append(g.Pending, world.Action{Kind: world.ActEase, Hex: g.SettlementHex(w.Settlement), By: guildRef(gd.G.ID), Units: row.By})
		}
	}
	gd.G.Works = kept
	return nil
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
func (g *Game) linesWorth(lines []sheets.CostLine) int64 {
	var n int64
	for _, l := range lines {
		if l.Tag == "" {
			n += l.Quantity
			continue
		}
		n += l.Quantity * g.tagValue(l.Tag)
	}
	return n
}

// MaterialOfTag is the first material of the sheet holding a tag.
func (g *Game) MaterialOfTag(tag string) (string, bool) {
	for _, m := range g.r.Book.Materials {
		if slices.Contains(m.Tags, tag) {
			return m.ID, true
		}
	}
	return "", false
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
// daily use; w is nil for a work that is off.
func (g *Game) StockDays(gd *Guild, row *sheets.GuildWork, w *guild.Work) int64 {
	days := int64(-1)
	for _, l := range g.WorkUses(row, w) {
		have := g.heldOfTag(g.Ledger.Held(gd.Pool()), l.Tag)
		n := have / max(l.Quantity, 1)
		if days < 0 || n < days {
			days = n
		}
	}
	return max(days, 0)
}

// VotesNeeded is how many votes carry a motion in a guild now.
func (g *Game) VotesNeeded(gd *Guild) int64 {
	return guild.Needed(g.activeMembers(gd), g.r.Guild)
}
