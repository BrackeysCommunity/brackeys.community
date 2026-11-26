package harness

import (
	"context"
	"fmt"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/harness/agent"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/faucet"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

// structural: the Economy run's shape. The band is read after the
// warm-up, in which characters arrive with nothing and earn their first
// coin.
const (
	economyDays   = 120
	economyWarmup = 78
	joinDays      = 7   // players arrive over the first week
	workPeriod    = 3   // ticks between a playing player's choices
	awake         = 96  // ticks of a world day a player is about: sixteen hours
	wakeSpread    = 13  // ticks between one player's waking and the next's
	casualEvery   = 432 // ticks between a casual player's sessions
	casualSession = 72  // ticks a casual session lasts
	casualSpread  = 37  // ticks between one casual player's sessions and the next's
)

// structural: the band is required from bandFrom players up. Below it
// the mean is a handful of purses, so the run asks only that coin neither
// runs away nor drifts off the band (driftOver).
const (
	bandFrom      = 100
	runawayFloor  = 25  // percent of band-low
	runawayCeil   = 200 // percent of band-high
	driftSlackPct = 25  // percent of the band's width
)

// economySizes are the populations a run measures when no n is given.
var economySizes = []int{10, 1000, 10000}

// role is one share of the soak population and the coin it keeps.
type role struct {
	name    string
	share   int // per cent
	comfort int64
}

var economyRoles = []role{
	{agent.Gatherer, 30, 400},
	{agent.Crafter, 10, 400},
	{agent.Hauler, 10, 400},
	{agent.Speculator, 5, 600},
	{agent.Hoarder, 15, 1000},
	{agent.Casual, 30, 100},
}

// economyDay is one world day of a soak.
type economyDay struct {
	day       int64
	active    int64
	supply    int64
	perActive int64 // the stabiliser's windowed mean
	rate      int64
	traded    int64 // coin that changed hands in the markets that day
}

type economyResult struct {
	size    int
	days    []economyDay
	audit   []string
	elapsed time.Duration
	refused int
	actions int
	second  int64 // units traded at the unplayed settlement
	reports []game.Report
	guild   guildResult
	classes classResult
	threads threadResult
	digest  string // the world at the soak's end, to tell two builds apart
}

// EconomyRun soaks the economy (GDD 10) at each of economySizes, or n
// alone, for economyDays (ECONOMY_DAYS overrides), and reports coin per
// active character against the band after the warm-up and the
// conservation check; then what the players' guild, its works and their
// classes did, and a founding world of the smallest guild
// (ECONOMY_ONLY=founding runs that alone). ECONOMY_STAGING=1 adds a
// staging twin of the fixed maximum policy at each size.
func EconomyRun(b *sheets.Book, out string, n int) ([]Measured, error) {
	sizes, days := economyPlan(n)
	if os.Getenv("ECONOMY_ONLY") == "founding" {
		sizes = nil
	}
	var results []economyResult
	for _, size := range sizes {
		r, err := soak(b, soakers(b, size), days)
		if err != nil {
			return nil, fmt.Errorf("economy run at %d: %w", size, err)
		}
		results = append(results, r)
		fmt.Fprintf(os.Stderr, "economy %d: %s, %d actions, %d refused, digest %s\n", size, r.elapsed.Round(time.Second), r.actions, r.refused, r.digest)
	}
	fr, err := soak(b, founders(b), foundersDays)
	if err != nil {
		return nil, fmt.Errorf("economy run, the founding world: %w", err)
	}
	fmt.Fprintf(os.Stderr, "economy founding: %s, %d actions, %d refused, digest %s\n", fr.elapsed.Round(time.Second), fr.actions, fr.refused, fr.digest)
	fp := faucet.ParamsOf(b.EconomyParams)
	lo, hi := fp.Low, fp.High
	allHold, allDrift, clean := true, true, true
	var held, drifted []string
	var doc lineDoc
	p := doc.p
	p("# Economy run")
	p("")
	p("Scripted players (`harness/agent.Earner`) in six roles: %s. They join over the first %d world days at the first starting settlement, which their server's guild runs and its admins work to make a city; a second settlement is open from day 1 and nobody starts there. With guilds on, %d%% of the players come from a quiet server instead: they arrive on the second day at the next starting settlement, which their guild takes, so a third is opened for nobody; they found, and stop playing once world day %d ends. Every player backs the arc sides it can serve (`agent.Backer`, within %d tiles). %d simulated world days; the band is read over days %d to %d.", roleList(), joinDays, quietShare, quietDays, agent.NewBacker(b).Reach, days, economyWarmup, days)
	p("")
	p("From %s players up the band must hold. Below that the run asks for drift: over the last two thirds coin per active character stays between %d%% of the band's floor and %d%% of its ceiling, and its mean distance to the band over the last third is no worse than over the middle third by more than %d%% of the band's width.", comma(bandFrom), runawayFloor, runawayCeil, driftSlackPct)
	p("")
	p("| Players | Coin per active character, days %d–%d | Rule | Holds | Faucet rate at the end | Units traded at the unplayed settlement | Conservation | Time |", economyWarmup, days)
	p("| --- | --- | --- | --- | --- | --- | --- | --- |")
	for _, r := range results {
		v := bandVerdict(r.days, r.size, lo, hi)
		mn, mx, ok, rule := v.mn, v.mx, v.ok, v.rule
		if v.drifts {
			allDrift = allDrift && ok
			drifted = append(drifted, comma(int64(r.size)))
		} else {
			allHold = allHold && ok
			held = append(held, comma(int64(r.size)))
		}
		clean = clean && len(r.audit) == 0
		end := r.days[len(r.days)-1]
		p("| %s | %d to %d coin | %s | %s | %d coin per active character per day | %d | %s | %s |", comma(int64(r.size)), mn, mx, rule, holds(ok), end.rate, r.second, auditWord(r.audit), r.elapsed.Round(time.Second))
	}
	p("")
	for _, r := range results {
		p("## %s players", comma(int64(r.size)))
		p("")
		p("| Day | Active | Supply (coin) | Coin per active character (7-day mean) | Faucet (coin per active character) | Coin traded that day |")
		p("| --- | --- | --- | --- | --- | --- |")
		for _, d := range r.days {
			p("| %d | %d | %d | %d | %d | %d |", d.day, d.active, d.supply, d.perActive, d.rate, d.traded)
		}
		p("")
		if len(r.reports) > 0 {
			last := r.reports[len(r.reports)-1]
			var top []string
			for _, t := range last.Top {
				top = append(top, fmt.Sprintf("%s (%d units)", t.Material, t.Units))
			}
			p("Last weekly ledger report (day %d): velocity %s coin changing hands per coin per day; most traded %s.", last.Day, last.Velocity, strings.Join(top, ", "))
			p("")
		}
		for _, a := range r.audit {
			p("- %s", a)
		}
	}
	threadSection(p, results)
	society := guildSections(p, b, results, fr, days)
	var staging []Measured
	if os.Getenv("ECONOMY_STAGING") == "1" {
		if staging, err = economyStaging(p, b, sizes, days); err != nil {
			return nil, err
		}
	}
	if err := doc.save(out, "economy.md"); err != nil {
		return nil, err
	}
	var readings []Measured
	if len(held) > 0 {
		readings = append(readings, Measured{Target: "coin-band", Value: fmt.Sprintf("%s players, days %d–%d", strings.Join(held, ", "), economyWarmup, days), Holds: allHold && clean})
	}
	if len(drifted) > 0 {
		readings = append(readings, Measured{Target: "coin-drift", Value: fmt.Sprintf("%s players, %d days", strings.Join(drifted, ", "), days), Holds: allDrift && clean})
	}
	return slices.Concat(readings, society, staging), nil
}

// drift is a small server's coin read against the band: the least and
// most over the last two thirds of the soak, the mean distance to the
// band over the middle and last thirds, and whether the drift rule holds.
type drift struct {
	lo, hi, middle, last int64
	ok                   bool
}

// economyPlan is the sizes to soak, economySizes or n alone, and the world
// days to soak them for, economyDays unless ECONOMY_DAYS overrides it.
func economyPlan(n int) (sizes []int, days int64) {
	sizes = economySizes
	if n > 0 {
		sizes = []int{n}
	}
	days = int64(economyDays)
	if v, err := strconv.Atoi(os.Getenv("ECONOMY_DAYS")); err == nil && v > economyWarmup {
		days = int64(v)
	}
	return sizes, days
}

// verdict is one soak read against the band, or for drift below bandFrom.
type verdict struct {
	mn, mx int64 // least and most coin per active character after the warm-up
	readLo int64 // the range the rule read: mn and mx, or drift's over the last two thirds
	readHi int64
	ok     bool
	rule   string
	drifts bool
}

func bandVerdict(days []economyDay, size int, lo, hi int64) verdict {
	v := verdict{rule: fmt.Sprintf("band %d–%d", lo, hi)}
	v.mn, v.mx, v.ok = bandOver(days, lo, hi)
	v.readLo, v.readHi = v.mn, v.mx
	if size < bandFrom {
		d := driftOver(days, lo, hi)
		v.ok, v.drifts = d.ok, true
		v.readLo, v.readHi = d.lo, d.hi
		v.rule = fmt.Sprintf("drift: %d–%d coin over the last two thirds, distance %d → %d coin", d.lo, d.hi, d.middle, d.last)
	}
	return v
}

// auditWord is the conservation check in a word, or the count of what it
// found.
func auditWord(audit []string) string {
	return either(len(audit) == 0, "clean", fmt.Sprintf("**%d discrepancies**", len(audit)))
}

// driftOver reads days by thirds (see bandFrom).
func driftOver(days []economyDay, lo, hi int64) drift {
	n := len(days)
	third := n / 3
	var d drift
	if third == 0 {
		return d
	}
	dist := func(x int64) int64 { return max(0, lo-x, x-hi) }
	var mid, last int64
	for i, day := range days[third:] {
		x := day.perActive
		if i == 0 || x < d.lo {
			d.lo = x
		}
		if i == 0 || x > d.hi {
			d.hi = x
		}
		if third+i < 2*third {
			mid += dist(x)
		} else {
			last += dist(x)
		}
	}
	d.middle = mid / int64(third)
	d.last = last / int64(n-2*third)
	bounded := d.lo*100 >= lo*runawayFloor && d.hi*100 <= hi*runawayCeil
	d.ok = bounded && (d.last-d.middle)*100 <= (hi-lo)*driftSlackPct
	return d
}

func roleList() string {
	var s []string
	for _, r := range economyRoles {
		s = append(s, fmt.Sprintf("%s %d%%", r.name, r.share))
	}
	return strings.Join(s, ", ")
}

// bandOver is the least and most coin per active character after the
// warm-up, and whether every day was inside the band.
func bandOver(days []economyDay, lo, hi int64) (mn, mx int64, ok bool) {
	ok, first := true, true
	for _, d := range days {
		if d.day < economyWarmup {
			continue
		}
		if first || d.perActive < mn {
			mn = d.perActive
		}
		if first || d.perActive > mx {
			mx = d.perActive
		}
		first = false
		ok = ok && d.perActive >= lo && d.perActive <= hi
	}
	return mn, mx, ok && !first
}

// population is who a soak simulates: how many players in which roles,
// under which key and guild plan, whether they back arc sides, and when
// it may stop early.
type population struct {
	label  string
	server string // the Discord server every player comes from, "" for none
	size   int
	roles  []role
	plan   *agent.GuildPlan
	admins int
	join   int64 // world days over which the players arrive
	back   *agent.Backer
	quiet  quietServer
	until  func(g *game.Game) bool
	// stealers turns every stealEvery-th main player to theft, keeping
	// its name, role and dice; nil for a world without thieves.
	stealers func(agent.Policy) agent.Policy
	// watch reads the soak as it plays; nil for none.
	watch soakWatch
	// opts are what openSoak adds to the population; the zero value adds
	// nothing.
	opts soakOptions
}

// soakWatch reads a soak beyond what the Economy run reads: the client
// its players reach the world through, every tick's transactions, and
// the end of each world day.
type soakWatch interface {
	open(w *soakWorld) agent.Client
	tick(g *game.Game, txns []ledger.Txn)
	day(g *game.Game)
}

// tickWatch is a soakWatch that also reads the transactions each tick
// posts itself, beside those of the players' commands.
type tickWatch interface {
	ticked(g *game.Game, txns []ledger.Txn)
}

// structural: one main player in stealEvery is a thief (GDD 18.3).
const stealEvery = 10

// quietServer is a second server's players, part of the soak's size, who
// arrive on the second day, found, and stop playing once world day
// quietDays ends: the guild that leaves its places to the troubles.
type quietServer struct {
	size int
	plan *agent.GuildPlan
}

// structural: the quiet server's share of the soak and the world day it
// goes idle, the day the founding target gives a guild to found by.
const (
	quietName  = "quiet"
	quietShare = 5
	quietDays  = 10
)

// soakers is the Economy run's population at a size: one server, whose
// guild takes the first starting settlement, founds, and makes its home a
// city, and a quiet server. Every player backs arc sides.
// ECONOMY_GUILDS=off leaves the players without a server, a guild or a
// class page, to read what guilds and abilities move.
func soakers(b *sheets.Book, size int) population {
	pop := population{label: "economy", size: size, roles: economyRoles, join: joinDays, back: agent.NewBacker(b)}
	if os.Getenv("ECONOMY_GUILDS") != "off" {
		pop.server, pop.plan, pop.admins = economyServer, guildPlan(b, guildGoods, guildTithe, false), economyAdmins
		pop.plan.City = true
		pop.quiet = quietServer{size: size * quietShare / 100, plan: guildPlan(b, foundersGive, foundersGive, true)}
	}
	return pop
}

// earners are a share of players in the population's roles, under a
// plan, idle from a tick (0 for never), named from first on.
func earners(pop population, plan *agent.GuildPlan, size, first int, idle int64, bands []string) []*agent.Player {
	var out []*agent.Player
	for _, ro := range pop.roles {
		e := &agent.Earner{Role: ro.name, BandOrder: bands, Comfort: ro.comfort, Guild: plan, Back: pop.back, Idle: idle}
		for range max(1, size*ro.share/100) {
			out = append(out, &agent.Player{Discord: fmt.Sprintf("%s-%d", ro.name, first+len(out)), Start: "hook", Policy: e})
		}
	}
	return out[:min(len(out), max(size, len(pop.roles)))]
}

// soakWorld is a soak's world as the Economy run opens it: the game, the
// service its players reach it through, and the tick each player arrives.
type soakWorld struct {
	g       *game.Game
	local   *service.Local
	client  agent.Client
	players []*agent.Player
	arrive  []int64
	main    int // players before the quiet server's
}

// openSoak makes a world under k with the starting settlements a soak of
// pop asks for, and pop's players with the tick each arrives.
func openSoak(b *sheets.Book, k keys.Set, pop population) (*soakWorld, error) {
	r, err := game.NewRules(b, k)
	if err != nil {
		return nil, err
	}
	g, err := game.New(r)
	if err != nil {
		return nil, err
	}
	g.World.OpenSettlement()
	if pop.quiet.size > 0 {
		// The quiet server's guild takes the second starting settlement,
		// so a third stays unplayed.
		g.World.OpenSettlement()
	}
	if pop.opts.EmptyServer {
		// The empty server's guild takes one more, so one still stays
		// unplayed.
		g.World.OpenSettlement()
	}
	local := service.NewLocal(g)
	bands := agent.Bands(b)
	players := earners(pop, pop.plan, pop.size-pop.quiet.size, 0, 0, bands)
	main := len(players)
	for i, p := range players {
		p.Server, p.Admin = pop.server, i < pop.admins
		if pop.stealers != nil && i%stealEvery == stealEvery-1 {
			p.Policy = pop.stealers(p.Policy)
		}
		if e, ok := p.Policy.(*agent.Earner); ok && !pop.opts.Adversary.Zero() && i%stealEvery == mixAt && !p.Admin {
			p.Policy = agent.NewMixed(b, e, pop.opts.Adversary)
		}
	}
	arrive := make([]int64, 0, pop.size)
	join := pop.join * sheets.TicksPerDay
	for i := range players {
		arrive = append(arrive, int64(i)*join/int64(main))
	}
	if pop.quiet.size > 0 {
		quiet := earners(pop, pop.quiet.plan, pop.quiet.size, main, quietDays*sheets.TicksPerDay, bands)
		for j, p := range quiet {
			p.Server, p.Admin = quietName, j < pop.admins
			// Over the second day, once the starting settlements the soak
			// asked for have opened.
			arrive = append(arrive, sheets.TicksPerDay+int64(j)*sheets.TicksPerDay/int64(len(quiet)))
		}
		players = append(players, quiet...)
	}
	if pop.opts.EmptyServer {
		players = append(players, &agent.Player{Discord: emptyName + "-admin", Start: "hook", Server: emptyName, Admin: true, Policy: &agent.HouseKeeper{Settings: emptySettings()}})
		arrive = append(arrive, emptyArrives*sheets.TicksPerDay)
	}
	var client agent.Client = local
	if pop.plan == nil {
		// Hiding the pages leaves the players to the market alone.
		client = struct{ agent.Client }{local}
	}
	w := &soakWorld{g: g, local: local, client: client, players: players, arrive: arrive, main: main}
	if pop.watch != nil {
		w.client = pop.watch.open(w)
	}
	return w, nil
}

// due is who plays at tick t: arrived, the quiet server's only until it
// goes idle, and due by the soak's rhythm.
func (w *soakWorld) due(t int64, busy func(*agent.Player) bool, into []*agent.Player) []*agent.Player {
	into = into[:0]
	for i, p := range w.players {
		if t < w.arrive[i] || (i >= w.main && t >= quietDays*sheets.TicksPerDay) {
			continue
		}
		if due(i, t, p, busy) {
			into = append(into, p)
		}
	}
	return into
}

func soak(b *sheets.Book, pop population, days int64) (economyResult, error) {
	start := time.Now()
	w, err := openSoak(b, keys.Throwaway(pop.label+os.Getenv("ECONOMY_SEED")), pop)
	if err != nil {
		return economyResult{}, err
	}
	g, local, players := w.g, w.local, w.players
	script := agent.NewScript(w.client, players, pop.label)
	ctx := context.Background()
	res := economyResult{size: pop.size}
	end := days * sheets.TicksPerDay
	var playing []*agent.Player
	stocked := map[string]int64{}
	busy := longBusy(g)
	for t := int64(0); t < end; t++ {
		playing = w.due(t, busy, playing)
		if err := script.TurnFor(ctx, t, playing); err != nil {
			return res, err
		}
		if _, err := g.Advance(); err != nil {
			return res, err
		}
		_, ticked := g.Flush()
		txns := local.Txns()
		if pop.watch != nil {
			pop.watch.tick(g, txns)
			if tw, ok := pop.watch.(tickWatch); ok {
				tw.ticked(g, ticked)
			}
		}
		if g.Tick()%sheets.TicksPerDay == 0 {
			local.Forget()
			if pop.watch != nil {
				pop.watch.day(g)
			}
			res.days = append(res.days, dayOf(g))
			for _, bk := range g.BooksAt(unplayed(g)) {
				units, _ := bk.Traded(1, false)
				res.second += units
			}
			res.guild.day(g, pop.plan, stocked)
			res.threads.day(g)
			if pop.until != nil && pop.until(g) {
				break
			}
		}
	}
	for _, p := range players {
		res.actions += p.Actions
		res.refused += p.Refused
	}
	res.audit = ledger.Audit(g.Ledger.Balances(), g.Holdings())
	if g.Market != nil {
		res.reports = g.Market.Reports
	}
	res.guild.close(g, stocked)
	res.threads.queued = g.Queued()
	res.classes = classesOf(g, players)
	sum, err := g.Digest()
	if err != nil {
		return res, err
	}
	res.digest = sum.String()
	res.elapsed = time.Since(start)
	return res, nil
}

// due is whether player i plays rel ticks into its run: every workPeriod
// ticks while awake, a casual player only within its sessions, and never
// while busy holds of it.
func due(i int, rel int64, p *agent.Player, busy func(*agent.Player) bool) bool {
	if (rel+int64(i))%workPeriod != 0 || (rel+int64(i)*wakeSpread)%sheets.TicksPerDay >= awake {
		return false
	}
	if e, ok := earnerOf(p.Policy); ok && e.Role == agent.Casual && (rel+int64(i)*casualSpread)%casualEvery >= casualSession {
		return false
	}
	return !busy(p)
}

// earnerOf is the Earner a policy plays, a thief's own included.
func earnerOf(p agent.Policy) (*agent.Earner, bool) {
	switch e := p.(type) {
	case *agent.Earner:
		return e, true
	case *agent.Thief:
		return e.Earner, true
	case *agent.Beneficiary:
		return earnerOf(e.Unwrap())
	case *agent.Resting:
		return earnerOf(e.Unwrap())
	case *agent.Mixed:
		return e.Base, true
	}
	return nil, false
}

// longBusy is whether a player's character is on a long action outside a
// fight, which a turn could not interrupt.
func longBusy(g *game.Game) func(*agent.Player) bool {
	return func(p *agent.Player) bool {
		if p.Character == "" {
			return false
		}
		c := g.Char(p.Character)
		return c != nil && c.Long != nil && c.Fight == nil
	}
}

// unplayed is the last starting settlement no guild runs: the second
// without a quiet server, the third with one; -1 for none.
func unplayed(g *game.Game) int {
	for i := len(g.Places) - 1; i >= 0; i-- {
		if p := g.Places[i]; p.Lattice >= 0 && p.Guild == "" {
			return i
		}
	}
	return -1
}

func dayOf(g *game.Game) economyDay {
	d := economyDay{day: g.World.Day, active: g.Active(), supply: g.Supply()}
	if m := g.Market; m != nil {
		d.perActive = m.Faucet.Mean()
		d.rate = m.Faucet.Rate.Floor()
		for _, bk := range m.Books {
			_, coin := bk.Traded(1, false)
			d.traded += coin
		}
	}
	return d
}

// agentMix is a weight per agent activity: the loop climb's policy.
type agentMix = agent.Mix

// soakOptions is what a soak turns on beside the Economy population; the
// zero value is the Economy run's soak, digest for digest. An option off
// adds no player, settlement or draw.
type soakOptions struct {
	Thieves     bool     // a tenth of mains steal (crime's plan)
	Staging     bool     // the staging adversary at the main server (ECONOMY_STAGING's twin)
	Emergence   bool     // emergence-start at day 0
	Season      bool     // season-start at day 0
	EmptyServer bool     // a server with a house and settings and no players
	Adversary   agentMix // a tenth of mains on this activity mix (the loop climb)
}

func (o soakOptions) String() string {
	var on []string
	for _, x := range []struct {
		on   bool
		name string
	}{{o.Thieves, "thieves"}, {o.Staging, "staging"}, {o.Emergence, "emergence"}, {o.Season, "season"}, {o.EmptyServer, "an empty server"}} {
		if x.on {
			on = append(on, x.name)
		}
	}
	if !o.Adversary.Zero() {
		on = append(on, "the mix "+o.Adversary.String())
	}
	return either(len(on) == 0, "nothing", strings.Join(on, ", "))
}

// structural: which main player in stealEvery plays the adversary's mix,
// and the empty server: its name, the world day its admin arrives (after
// the quiet server's) and the settings it saves.
const (
	mixAt          = 4
	emptyName      = "empty"
	emptyArrives   = 2
	emptyChronicle = "900000000000000001"
	emptyEvents    = "900000000000000002"
	emptyStaff     = "900000000000000003"
	emptyQuietFrom = 1320 // 22:00 UTC
	emptyQuietTo   = 420  // 07:00 UTC
)

func emptySettings() api.HouseSettings {
	return api.HouseSettings{
		Channels:   []api.Channel{{Kind: "chronicle", ID: emptyChronicle}, {Kind: "events", ID: emptyEvents}},
		StaffRoles: []string{emptyStaff},
		QuietFrom:  emptyQuietFrom,
		QuietTo:    emptyQuietTo,
	}
}

// stealersOf turns a main Earner to theft under the sheets' rules.
func stealersOf(b *sheets.Book) func(agent.Policy) agent.Policy {
	return func(p agent.Policy) agent.Policy {
		if e, ok := p.(*agent.Earner); ok {
			return agent.NewThief(b, e)
		}
		return p
	}
}

// soakResult is one soak with options: the Economy run's result and what
// each option read.
type soakResult struct {
	economyResult
	opts    soakOptions
	crime   *crimeWatch   // thieves, or a mix that steals; nil for neither
	staging *stagingWatch // nil without staging
	read    *optsWatch
}

// soakWith soaks the Economy population at a size for days with what o
// turns on, keyed as the Economy run is (ECONOMY_SEED).
func soakWith(b *sheets.Book, size int, days int64, o soakOptions) (*soakResult, error) {
	pop := soakers(b, size)
	pop.opts = o
	res := &soakResult{opts: o, read: newOptsWatch(b, o, pop.server)}
	var ws soakWatches
	if o.Thieves {
		pop.stealers = stealersOf(b)
	}
	if o.Thieves || o.Adversary.Weight(agent.Theft) > 0 {
		res.crime = &crimeWatch{}
		ws = append(ws, res.crime)
	}
	if o.Staging {
		if pop.server == "" {
			return nil, fmt.Errorf("staging needs the main server: ECONOMY_GUILDS=off leaves none")
		}
		res.staging = newStagingWatch(b, strongestSeed(), true, pop.server)
		res.staging.full = true
		ws = append(ws, res.staging)
	}
	pop.watch = append(ws, res.read)
	pop.until = func(*game.Game) bool { return res.read.err != nil }
	r, err := soak(b, pop, days)
	if err == nil {
		err = res.read.err
	}
	if err != nil {
		return nil, fmt.Errorf("soak at %d with %s: %w", size, o, err)
	}
	res.economyResult = r
	if res.crime != nil {
		res.crime.close(r.audit)
	}
	if res.staging != nil {
		res.staging.closeWith(r.audit)
	}
	res.read.close()
	return res, nil
}

// clean reports whether nothing was minted: the end's conservation check
// and every day's, theft's sources and the fences' slices, and the
// staging gate.
func (r *soakResult) clean() bool {
	return len(r.audit) == 0 && r.read.dirty == 0 && (r.crime == nil || r.crime.mints()) && (r.staging == nil || r.staging.leaks == 0)
}

// band is the soak read against the economy band, or for drift below
// bandFrom.
func (r *soakResult) band(b *sheets.Book) verdict {
	fp := faucet.ParamsOf(b.EconomyParams)
	return bandVerdict(r.days, r.size, fp.Low, fp.High)
}

// soakReadings are the targets soaks with options read, over all of them:
// the band and drift (with the daily conservation check), the band with
// thieves and theft's sources, the staging gate, the guild works and the
// spoils pools.
func soakReadings(b *sheets.Book, rs []*soakResult) []Measured {
	var out []Measured
	var held, drifted, thieved, mintNotes, staged, guilds []string
	band, drift, thieves, mints, gate, works, spoils := true, true, true, true, true, true, true
	anyThieves, anyCrime, anyStaging := false, false, false
	problems, finds := 0, 0
	for _, r := range rs {
		v := r.band(b)
		name := fmt.Sprintf("%s players (%s)", comma(int64(r.size)), r.opts)
		ok := v.ok && r.clean()
		if v.drifts {
			drift = drift && ok
			drifted = append(drifted, name)
		} else {
			band = band && ok
			held = append(held, name)
		}
		if r.opts.Thieves {
			anyThieves = true
			thieves = thieves && ok
			thieved = append(thieved, fmt.Sprintf("%s %d to %d coin", comma(int64(r.size)), v.readLo, v.readHi))
		}
		if r.crime != nil {
			anyCrime = true
			mints = mints && r.crime.mints() && r.read.dirty == 0
			mintNotes = append(mintNotes, fmt.Sprintf("%s players: %d thefts, %d source legs", comma(int64(r.size)), r.crime.thefts, r.crime.legs))
		}
		if r.staging != nil {
			anyStaging = true
			gate = gate && r.staging.leaks == 0
			problems += r.staging.leaks
			staged = append(staged, comma(int64(r.size)))
		}
		guilds = append(guilds, comma(int64(r.guild.members)))
		for _, w := range r.guild.works {
			works = works && w.gave <= w.used
		}
		spoils = spoils && r.read.spoils.holds()
		finds += r.read.spoils.finds
	}
	if len(held) > 0 {
		out = append(out, Measured{Target: "coin-band", Value: fmt.Sprintf("soak, %s, days %d–%d", strings.Join(held, "; "), economyWarmup, len(rs[0].days)), Holds: band})
	}
	if len(drifted) > 0 {
		out = append(out, Measured{Target: "coin-drift", Value: fmt.Sprintf("soak, %s", strings.Join(drifted, "; ")), Holds: drift})
	}
	if anyThieves {
		out = append(out, Measured{Target: "thieves-hold-band", Value: "soak, " + strings.Join(thieved, "; "), Holds: thieves})
	}
	if anyCrime {
		out = append(out, Measured{Target: "theft-never-mints", Value: "soak, " + strings.Join(mintNotes, "; ") + "; every day's conservation check", Holds: mints})
	}
	if anyStaging {
		out = append(out, Measured{Target: "staged-goods-local", Value: fmt.Sprintf("soak at %s: %s", strings.Join(staged, ", "), gateValue(gate, problems)), Holds: gate})
	}
	if len(rs) > 0 {
		out = append(out,
			Measured{Target: "guild-works-sink", Value: "soak, guilds of " + strings.Join(guilds, ", ") + ": " + either(works, "no work gave back more than it consumed", "a work gave back more than it consumed"), Holds: works},
			Measured{Target: "spoils-conserved", Value: fmt.Sprintf("soak, %d finds from pools", finds), Holds: spoils})
	}
	return out
}

// soakWatches are several watches read as one, each opening on the
// client the one before it handed out.
type soakWatches []soakWatch

func (ws soakWatches) open(w *soakWorld) agent.Client {
	for _, x := range ws {
		w.client = x.open(w)
	}
	return w.client
}

func (ws soakWatches) tick(g *game.Game, txns []ledger.Txn) {
	for _, x := range ws {
		x.tick(g, txns)
	}
}

func (ws soakWatches) ticked(g *game.Game, txns []ledger.Txn) {
	for _, x := range ws {
		if tw, ok := x.(tickWatch); ok {
			tw.ticked(g, txns)
		}
	}
}

func (ws soakWatches) day(g *game.Game) {
	for _, x := range ws {
		x.day(g)
	}
}

// optsWatch reads what a soak's options turn on, and what every soak with
// options reports: each world day's wall time and conservation check, the
// spoils pools, the season clock, emergence's traces, the empty server
// and the adversary's wealth against the other main players'.
type optsWatch struct {
	b       *sheets.Book
	opts    soakOptions
	server  string
	g       *game.Game
	started []string // the recorded starts sent at day 0
	err     error    // a start the world refused, which ends the soak
	last    time.Time
	cost    []time.Duration
	dirty   int      // world days whose conservation check found something
	audits  []string // the first leaksKept of what they found
	spoils  spoilsTally
	seasons []seasonMark
	emerge  []emergeMark
	empty   quietResult
	house   bool // the empty server's house holds its settings
	players []*agent.Player
	mixed   []*agent.Player
	control []*agent.Player
	worth   map[string]*worthLine
	loop    loopReading
	others  loopReading
}

func newOptsWatch(b *sheets.Book, o soakOptions, server string) *optsWatch {
	return &optsWatch{b: b, opts: o, server: server, empty: quietResult{server: emptyName}, worth: map[string]*worthLine{}, spoils: spoilsTally{ok: true}}
}

// seasonMark is the season clock as a world day opened.
type seasonMark struct {
	day, season, of, days int64
}

// emergeMark is emergence's state as a world day opened: the tiles with
// traces, the styles traced and the promotions so far.
type emergeMark struct {
	day, spots, styles, promotions int64
}

// worthLine is one character's worth at the first and last world day
// read: coin and everything it carries at reference value.
type worthLine struct {
	firstDay, lastDay, first, last int64
}

// loopReading is a group of characters' worth gained per character-day,
// and the turns the mixed among them gave each activity.
type loopReading struct {
	players  int
	charDays int64
	gained   int64
	played   agent.Mix
}

// perDay is coin plus goods value gained per character-day.
func (l loopReading) perDay() int64 {
	if l.charDays == 0 {
		return 0
	}
	return l.gained / l.charDays
}

func (w *optsWatch) open(sw *soakWorld) agent.Client {
	w.g, w.last, w.players = sw.g, time.Now(), sw.players
	w.started, w.err = startClocks(sw.g, w.opts)
	for _, p := range sw.players[:sw.main] {
		switch pol := p.Policy; {
		case mixedOf(pol) != nil:
			w.mixed = append(w.mixed, p)
		case p.Server == w.server && !p.Admin && plays(pol):
			w.control = append(w.control, p)
		}
	}
	return sw.client
}

// plays reports whether a policy is a main player's earning one, a thief
// or a beneficiary of one included, rather than a stager.
func plays(p agent.Policy) bool {
	_, ok := earnerOf(p)
	return ok
}

// mixedOf is the Mixed a policy plays, through any wrapper.
func mixedOf(p agent.Policy) *agent.Mixed {
	switch e := p.(type) {
	case *agent.Mixed:
		return e
	case *agent.Beneficiary:
		return mixedOf(e.Unwrap())
	case *agent.Resting:
		return mixedOf(e.Unwrap())
	}
	return nil
}

// startClocks sends the recorded season and emergence starts the options
// ask for to a world that keeps neither, as the service does at open
// (season first, so the traces carry its stamp). A world from game.New
// keeps both from tick 0, and is sent nothing.
func startClocks(g *game.Game, o soakOptions) ([]string, error) {
	var sent []string
	for _, x := range []struct {
		on   bool
		need bool
		kind string
	}{{o.Season, g.Story == nil, game.SeasonStart}, {o.Emergence, g.Emergence == nil, game.EmergenceStart}} {
		if !x.on || !x.need {
			continue
		}
		if _, err := g.Act(game.Command{Key: x.kind, Kind: x.kind}); err != nil {
			return sent, fmt.Errorf("sending %s: %w", x.kind, err)
		}
		sent = append(sent, x.kind)
	}
	return sent, nil
}

func (w *optsWatch) tick(_ *game.Game, txns []ledger.Txn)   { w.spoils.read(txns) }
func (w *optsWatch) ticked(_ *game.Game, txns []ledger.Txn) { w.spoils.read(txns) }

func (w *optsWatch) day(g *game.Game) {
	now := time.Now()
	w.cost, w.last = append(w.cost, now.Sub(w.last)), now
	if found := ledger.Audit(g.Ledger.Balances(), g.Holdings()); len(found) > 0 {
		w.dirty++
		for _, a := range found {
			if len(w.audits) < leaksKept {
				w.audits = append(w.audits, fmt.Sprintf("day %d: %s", g.World.Day, a))
			}
		}
	}
	if w.opts.Season {
		if c, _, ok := g.Season(); ok {
			w.seasons = append(w.seasons, seasonMark{day: g.World.Day, season: c.N, of: c.Day(g.World.Day), days: c.Days})
		}
	}
	if e := g.Emergence; w.opts.Emergence && e != nil {
		w.emerge = append(w.emerge, emergeMark{day: g.World.Day, spots: int64(len(e.Passage) + len(e.Clearing) + len(e.Loss)), styles: int64(len(e.Styles)), promotions: int64(len(e.Promotions))})
	}
	if w.opts.EmptyServer {
		w.empty.day(g)
	}
	for _, p := range slices.Concat(w.mixed, w.control) {
		c := g.Char(p.Character)
		if c == nil {
			continue
		}
		v := worthOf(g, c)
		l, ok := w.worth[c.C.ID]
		if !ok {
			l = &worthLine{firstDay: g.World.Day, first: v}
			w.worth[c.C.ID] = l
		}
		l.lastDay, l.last = g.World.Day, v
	}
}

// close reads the soak's end: the empty server's house, and the mixed
// players' and the other main players' worth gained.
func (w *optsWatch) close() {
	if h := w.g.House(emptyName); h != nil {
		w.house = len(h.Settings.Channels) > 0
	}
	read := func(players []*agent.Player) loopReading {
		var l loopReading
		for _, p := range players {
			line, ok := w.worth[p.Character]
			if !ok {
				continue
			}
			l.players++
			l.charDays += line.lastDay - line.firstDay
			l.gained += line.last - line.first
			if m := mixedOf(p.Policy); m != nil {
				for i, n := range m.Played(p.Character) {
					l.played[i] += n
				}
			}
		}
		return l
	}
	w.loop, w.others = read(w.mixed), read(w.control)
}

// worthOf is a character's coin and what it carries at reference value:
// provisions, clean goods and items. Staged goods are its server's, not
// its own.
func worthOf(g *game.Game, c *game.Char) int64 {
	v := g.Rules().Values
	n := c.C.Coin + c.C.Provisions*v.Asset(ledger.Provisions)
	for _, s := range c.C.Goods {
		n += s.Qty * v.Asset(s.Material)
	}
	for _, in := range c.C.Pack {
		n += g.ItemValue(in)
	}
	return n
}

// spoilsTally checks every transaction against the spoils pools, as the
// Social run's spoils world does: a find only moves goods out of a pool,
// and no pool gives more than it took in.
type spoilsTally struct {
	finds         int
	found, pooled int64
	ok            bool
	in, gave      map[string]int64
}

func (s *spoilsTally) read(txns []ledger.Txn) {
	if s.in == nil {
		s.in, s.gave = map[string]int64{}, map[string]int64{}
	}
	for _, t := range txns {
		for _, leg := range t.Legs {
			pool := strings.HasPrefix(leg.Account, ledger.Pool+"tile:")
			switch {
			case t.Kind == txnFind && leg.Units < 0 && !pool:
				s.ok = false
			case t.Kind == txnFind && leg.Units < 0:
				s.gave[leg.Account+" "+leg.Asset] -= leg.Units
				s.found -= leg.Units
			case pool && leg.Units > 0:
				s.in[leg.Account+" "+leg.Asset] += leg.Units
				s.pooled += leg.Units
			}
		}
		if t.Kind == txnFind {
			s.finds++
		}
	}
}

// holds reports whether the pools were conserved.
func (s *spoilsTally) holds() bool {
	if !s.ok {
		return false
	}
	for k, n := range s.gave {
		if n > s.in[k] {
			return false
		}
	}
	return true
}

// structural: a find's transaction kind.
const txnFind = "find"
