package harness

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

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
	digest  string // the world at the soak's end, to tell two builds apart
}

// EconomyRun soaks the economy (GDD 10) at each of economySizes, or n
// alone, for economyDays (ECONOMY_DAYS overrides), and reports coin per
// active character against the band after the warm-up and the
// conservation check; then what the players' guild, its works and their
// classes did, and a founding world of the smallest guild
// (ECONOMY_ONLY=founding runs that alone).
func EconomyRun(b *sheets.Book, out string, n int) ([]Measured, error) {
	sizes := economySizes
	if n > 0 {
		sizes = []int{n}
	}
	days := int64(economyDays)
	if v, err := strconv.Atoi(os.Getenv("ECONOMY_DAYS")); err == nil && v > economyWarmup {
		days = int64(v)
	}
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
		mn, mx, ok := bandOver(r.days, lo, hi)
		rule := fmt.Sprintf("band %d–%d", lo, hi)
		if r.size < bandFrom {
			d := driftOver(r.days, lo, hi)
			ok = d.ok
			rule = fmt.Sprintf("drift: %d–%d coin over the last two thirds, distance %d → %d coin", d.lo, d.hi, d.middle, d.last)
			allDrift = allDrift && ok
			drifted = append(drifted, comma(int64(r.size)))
		} else {
			allHold = allHold && ok
			held = append(held, comma(int64(r.size)))
		}
		clean = clean && len(r.audit) == 0
		end := r.days[len(r.days)-1]
		p("| %s | %d to %d coin | %s | %s | %d coin per active character per day | %d | %s | %s |", comma(int64(r.size)), mn, mx, rule, holds(ok), end.rate, r.second, either(len(r.audit) == 0, "clean", fmt.Sprintf("**%d discrepancies**", len(r.audit))), r.elapsed.Round(time.Second))
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
	society := guildSections(p, b, results, fr, days)
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
	return append(readings, society...), nil
}

// drift is a small server's coin read against the band: the least and
// most over the last two thirds of the soak, the mean distance to the
// band over the middle and last thirds, and whether the drift rule holds.
type drift struct {
	lo, hi, middle, last int64
	ok                   bool
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
}

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

func soak(b *sheets.Book, pop population, days int64) (economyResult, error) {
	start := time.Now()
	size := pop.size
	k := keys.Throwaway(pop.label + os.Getenv("ECONOMY_SEED"))
	r, err := game.NewRules(b, k)
	if err != nil {
		return economyResult{}, err
	}
	g, err := game.New(r)
	if err != nil {
		return economyResult{}, err
	}
	g.World.OpenSettlement()
	if pop.quiet.size > 0 {
		// The quiet server's guild takes the second starting settlement,
		// so a third stays unplayed.
		g.World.OpenSettlement()
	}
	local := service.NewLocal(g)
	bands := agent.Bands(b)
	players := earners(pop, pop.plan, size-pop.quiet.size, 0, 0, bands)
	main := len(players)
	for i, p := range players {
		p.Server, p.Admin = pop.server, i < pop.admins
	}
	arrive := make([]int64, 0, size)
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
	var client agent.Client = local
	if pop.plan == nil {
		// Hiding the pages leaves the players to the market alone.
		client = struct{ agent.Client }{local}
	}
	script := agent.NewScript(client, players, pop.label)
	ctx := context.Background()
	res := economyResult{size: size}
	end := days * sheets.TicksPerDay
	var due []*agent.Player
	stocked := map[string]int64{}
	for t := int64(0); t < end; t++ {
		due = due[:0]
		for i, p := range players {
			if t < arrive[i] || (i >= main && t >= quietDays*sheets.TicksPerDay) {
				continue
			}
			if (t+int64(i))%workPeriod != 0 || (t+int64(i)*wakeSpread)%sheets.TicksPerDay >= awake {
				continue
			}
			if e, ok := p.Policy.(*agent.Earner); ok && e.Role == agent.Casual && (t+int64(i)*casualSpread)%casualEvery >= casualSession {
				continue
			}
			if p.Character != "" {
				if c := g.Char(p.Character); c != nil && c.Long != nil && c.Fight == nil {
					continue
				}
			}
			due = append(due, p)
		}
		if err := script.TurnFor(ctx, t, due); err != nil {
			return res, err
		}
		if _, err := g.Advance(); err != nil {
			return res, err
		}
		g.Flush()
		local.Txns()
		if g.Tick()%sheets.TicksPerDay == 0 {
			local.Forget()
			res.days = append(res.days, dayOf(g))
			for _, bk := range g.BooksAt(unplayed(g)) {
				units, _ := bk.Traded(1, false)
				res.second += units
			}
			res.guild.day(g, pop.plan, stocked)
			if pop.until != nil && pop.until(g) {
				break
			}
		}
	}
	for _, p := range players {
		res.actions += p.Actions
		res.refused += p.Refused
	}
	res.audit = ledger.Audit(g.Ledger.Balances, g.Holdings())
	if g.Market != nil {
		res.reports = g.Market.Reports
	}
	res.guild.close(g, stocked)
	res.classes = classesOf(g, players)
	sum, err := g.Digest()
	if err != nil {
		return res, err
	}
	res.digest = sum.String()
	res.elapsed = time.Since(start)
	return res, nil
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
