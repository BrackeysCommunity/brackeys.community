package harness

import (
	"fmt"
	"maps"
	"slices"
	"strings"

	"jams.team/mmo-world/harness/agent"
	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/class"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

// structural: how a soak's one server plays its guild (agent.GuildPlan):
// two admins, and one settlement founded beside the starting one it took.
const (
	economyServer    = "soak"
	economyAdmins    = 2
	guildGoods       = 10 // per cent of a wanted stack a member gives a day
	guildTithe       = 10 // per cent of the coin over its comfort
	guildStock       = 5  // world days of stock members keep a work in
	guildStart       = 2  // world days of stock before an admin switches a work on
	guildReview      = 7  // world days a work is stocked before its admins judge it
	guildKeep        = 25 // per cent of what it consumed a work must have spared to stay lit
	guildSettlements = 2
)

// structural: the founding world, a guild of the least size that puts
// everything over its keep into a charter.
const (
	foundersDays    = 30
	foundersComfort = 60
	foundersGive    = 100
)

func guildPlan(b *sheets.Book, goods, tithe int64, rush bool) *agent.GuildPlan {
	p := agent.NewGuildPlan(b)
	p.GoodsShare, p.Tithe, p.StockDays, p.StartDays, p.Settlements = goods, tithe, guildStock, guildStart, guildSettlements
	p.ReviewDays, p.KeepShare = guildReview, guildKeep
	p.Works, p.Seek, p.Every = !rush, rush, rush
	return p
}

// founders is the founding world's population: a guild of guild-least
// gatherers who arrive together and stop once they have founded.
func founders(b *sheets.Book) population {
	return population{label: "economy-founding", server: economyServer, size: int(sheets.IntParam(b.SettlementParams, "guild-least")),
		roles: []role{{agent.Gatherer, 100, foundersComfort}}, plan: guildPlan(b, foundersGive, foundersGive, true), admins: economyAdmins, join: 0,
		until: func(g *game.Game) bool { return foundedDay(g, economyServer) > 0 }}
}

// foundedDay is how many world days had begun when a server's guild
// founded its first settlement; 0 for none yet.
func foundedDay(g *game.Game, server string) int64 {
	gd := g.ServerGuild(server)
	if gd == nil {
		return 0
	}
	for _, p := range g.Places {
		if p.Chartered() && p.Guild == gd.G.ID {
			return dayOfTick(p.Founded)
		}
	}
	return 0
}

// dayOfTick is how many world days had begun at a tick.
func dayOfTick(t int64) int64 { return t/sheets.TicksPerDay + 1 }

// workLine is one guild work over a soak: the world days it was stocked,
// and the coin value it consumed and gave back.
type workLine struct {
	id               string
	days, used, gave int64
}

// guildDay is what the guild held at the end of a world day.
type guildDay struct {
	day, treasury, timber, stone int64
}

// guildResult is a soak's server guild at its end.
type guildResult struct {
	members  int
	put      int64 // everything members gave, at reference value
	treasury int64
	founded  int64 // the world day it founded a settlement; 0 for never
	works    []workLine
	days     []guildDay
	city     cityResult
	quiet    quietResult
}

// structural: a city project's goals are named for it.
const cityProjectPrefix = "city-"

// cityResult is the server guild's pursuit of a city: the places it ran,
// the world days its project was first posted and its first city landed
// (0 for never), and, when none landed, where its home stood on a city's
// needs at the end.
type cityResult struct {
	ran            []int
	posted, raised int64
	place          int
	needs          []game.CityNeed
}

func (c *cityResult) day(g *game.Game, gd *game.Guild) {
	for n, p := range g.Places {
		if p.Guild == gd.G.ID && !slices.Contains(c.ran, n) {
			c.ran = append(c.ran, n)
		}
	}
	if c.posted == 0 {
		for _, x := range g.Goals {
			if x.Build != nil && x.Build.Structure == "" && strings.HasPrefix(x.Build.Project, cityProjectPrefix) && slices.Contains(c.ran, x.Build.Settlement) {
				c.posted = dayOfTick(x.Posted)
				break
			}
		}
	}
	if c.raised != 0 {
		return
	}
	for _, n := range c.ran {
		if p := g.Places[n]; p.City != nil && (c.raised == 0 || dayOfTick(p.City.Raised) < c.raised) {
			c.raised, c.place = dayOfTick(p.City.Raised), n
		}
	}
}

// close reads the needs at the guild's home, its first starting
// settlement, when no city landed.
func (c *cityResult) close(g *game.Game) {
	if c.raised != 0 || len(c.ran) == 0 {
		return
	}
	c.place = c.ran[0]
	if i := slices.IndexFunc(c.ran, func(n int) bool { return !g.Places[n].Chartered() }); i >= 0 {
		c.place = c.ran[i]
	}
	c.needs = g.CityCheck(c.place)
}

// quietPlace is one place the quiet server's guild ran: its troubles and its ruin.
type quietPlace struct {
	n          int
	name       string
	held, lost int
	ruined     int64    // the world day, 0 for standing
	treasury   int64    // at the last read before the ruin
	pool       [2]int64 // guild pool coin then and at the read that found the ruin
	left       []string // what the ruin should have returned
	audit      []string // ledger discrepancies
}

// quietResult is the quiet server's guild over a soak.
type quietResult struct {
	members int
	founded int64
	places  []quietPlace
	counted map[string]bool // trouble arcs already counted
	pool    int64           // the guild's pool coin at the last read
}

func (q *quietResult) day(g *game.Game) {
	gd := g.ServerGuild(quietName)
	if gd == nil {
		return
	}
	for n, p := range g.Places {
		if p.Guild == gd.G.ID && !slices.ContainsFunc(q.places, func(qp quietPlace) bool { return qp.n == n }) {
			q.places = append(q.places, quietPlace{n: n, name: cmpName(p.Name, g.PlaceName(p.Hex))})
		}
	}
	if q.founded == 0 {
		q.founded = foundedDay(g, quietName)
	}
	q.troubles(g)
	pool := g.Ledger.Of(gd.Pool(), ledger.Coin)
	for i := range q.places {
		qp := &q.places[i]
		p := g.Places[qp.n]
		if p.Ruined == 0 {
			qp.treasury = g.Ledger.Of(game.TreasuryPool(qp.n), ledger.Coin)
			continue
		}
		if qp.ruined != 0 {
			continue
		}
		qp.ruined, qp.pool = dayOfTick(p.Ruined), [2]int64{q.pool, pool}
		qp.left = ruinLeft(g, qp.n)
		qp.audit = ledger.Audit(g.Ledger.Balances, g.Holdings())
	}
	q.pool = pool
}

// troubles counts each trouble that ended at a quiet place, once: held
// when a side won it, lost when it lapsed. An ended arc stays in the
// story for kept-arc-days, so a daily read sees every one.
func (q *quietResult) troubles(g *game.Game) {
	if g.Story == nil {
		return
	}
	if q.counted == nil {
		q.counted = map[string]bool{}
	}
	book := g.Rules().Book
	for _, a := range g.Story.Arcs {
		if a.Ended == 0 || q.counted[a.ID] || !slices.ContainsFunc(book.Troubles, func(t sheets.TroubleRow) bool { return t.ID == a.Template }) {
			continue
		}
		n, ok := goal.SettlementOf(a.Place)
		i := slices.IndexFunc(q.places, func(qp quietPlace) bool { return qp.n == n })
		if !ok || i < 0 {
			continue
		}
		q.counted[a.ID] = true
		if a.Outcome == troubleLapsed {
			q.places[i].lost++
		} else {
			q.places[i].held++
		}
	}
}

// structural: an arc's outcome when its last stage lapsed.
const troubleLapsed = "lapsed"

// structural: the road war (GDD 12.9) and its two sides.
const (
	roadWarTemplate = "the-road-war"
	sidePatrol      = "patrol-it"
	sidePrey        = "prey-on-it"
)

// roadWars counts each road war's stages once they end: won by the
// patrol, won by the raiders' prey, or lapsed.
type roadWars struct {
	counted              map[string]bool
	patrol, prey, lapsed int
}

// day counts the road wars that ended since the last read. An ended arc
// stays in the story for kept-arc-days, so a daily read sees every one.
func (r *roadWars) day(g *game.Game) {
	if g.Story == nil {
		return
	}
	if r.counted == nil {
		r.counted = map[string]bool{}
	}
	for _, a := range g.Story.Arcs {
		if a.Template != roadWarTemplate || a.Ended == 0 || r.counted[a.ID] {
			continue
		}
		r.counted[a.ID] = true
		for _, st := range a.Stages {
			switch {
			case st.Ended == 0:
			case st.Lapsed:
				r.lapsed++
			case st.Won == sidePatrol:
				r.patrol++
			case st.Won == sidePrey:
				r.prey++
			}
		}
	}
}

// ended is how many road-war stages have ended.
func (r roadWars) ended() int { return r.patrol + r.prey + r.lapsed }

// line is the road war's tally in words.
func (r roadWars) line() string {
	return fmt.Sprintf("%d ended: %d won by %s, %d by %s, %d lapsed", r.ended(), r.patrol, sidePatrol, r.prey, sidePrey, r.lapsed)
}

// ruinLeft is what a ruined place still holds that the ruin should have
// returned: its treasury, an open goal on its board other than an arc
// side's, a player's order or listing at its market.
func ruinLeft(g *game.Game, n int) []string {
	var left []string
	for _, h := range g.Ledger.Held(game.TreasuryPool(n)) {
		left = append(left, fmt.Sprintf("its treasury holds %d %s", h.Units, h.Asset))
	}
	for _, x := range g.Goals {
		if x.Board == n && x.Open() && x.Cond.Verb != goal.Back {
			left = append(left, "goal "+x.ID+" is open")
		}
	}
	for _, bk := range g.BooksAt(n) {
		for o := range bk.Orders() {
			if o.Faction == nil && len(g.Ledger.Held(ledger.EscrowPool(o.ID))) > 0 {
				left = append(left, "order "+o.ID+" holds escrow")
			}
		}
	}
	if g.Market != nil {
		for _, l := range g.Market.Listings {
			if l.Settlement == n {
				left = append(left, "listing "+l.ID+" is up")
			}
		}
	}
	return left
}

// day notes which works were stocked today and what the guild holds.
func (r *guildResult) day(g *game.Game, plan *agent.GuildPlan, stocked map[string]int64) {
	for _, row := range g.Rules().Book.GuildWorks {
		used := g.WorkLedger.Used.Get(row.ID)
		if used > stocked["used/"+row.ID] {
			stocked[row.ID]++
		}
		stocked["used/"+row.ID] = used
	}
	if plan == nil {
		return
	}
	r.quiet.day(g)
	gd := g.ServerGuild(economyServer)
	if gd == nil {
		return
	}
	if r.founded == 0 {
		r.founded = foundedDay(g, economyServer)
	}
	r.city.day(g, gd)
	d := guildDay{day: g.World.Day}
	for _, h := range g.Ledger.Held(gd.Pool()) {
		if h.Asset == ledger.Coin {
			d.treasury = h.Units
		}
		m, _ := ledger.GoodsOf(h.Asset)
		if slices.Contains(plan.Tags[m], "timber") {
			d.timber += h.Units
		}
		if slices.Contains(plan.Tags[m], "stone") {
			d.stone += h.Units
		}
	}
	r.days = append(r.days, d)
}

func (r *guildResult) close(g *game.Game, stocked map[string]int64) {
	if r.founded == 0 {
		r.founded = foundedDay(g, economyServer)
	}
	for _, row := range g.Rules().Book.GuildWorks {
		r.works = append(r.works, workLine{id: row.ID, days: stocked[row.ID], used: g.WorkLedger.Used.Get(row.ID), gave: g.WorkLedger.Gave.Get(row.ID)})
	}
	if q := g.ServerGuild(quietName); q != nil {
		r.quiet.members = len(q.G.Members)
	}
	gd := g.ServerGuild(economyServer)
	if gd == nil {
		return
	}
	r.city.close(g)
	r.members = len(gd.G.Members)
	for _, m := range gd.G.Members {
		r.put += m.Put
	}
	r.treasury = g.Ledger.Of(gd.Pool(), ledger.Coin)
}

// classResult is how a soak's daily players came by their classes.
type classResult struct {
	daily     int            // players who play every day
	days      []int64        // world days to a first class, sorted, for those who earned one
	first     map[string]int // players by first class
	abilities int            // abilities taken, all players
}

// classesOf reads each daily player's first class and when it came.
func classesOf(g *game.Game, players []*agent.Player) classResult {
	out := classResult{first: map[string]int{}}
	for _, p := range players {
		c := g.Char(p.Character)
		if c == nil {
			continue
		}
		out.abilities += len(c.C.Classes.Abilities)
		if e, ok := earnerOf(p.Policy); ok && e.Role == agent.Casual {
			continue
		}
		out.daily++
		if len(c.C.Classes.Earned) == 0 {
			continue
		}
		e := slices.MinFunc(c.C.Classes.Earned, func(a, b class.Earned) int { return int(a.Tick - b.Tick) })
		out.first[e.ID]++
		out.days = append(out.days, (e.Tick-c.Born)/sheets.TicksPerDay+1)
	}
	slices.Sort(out.days)
	return out
}

// median is the median day over every daily player, those with no class
// counted as later than any; ok is false when it falls among them.
func (c classResult) median() (int64, bool) {
	if i := c.daily / 2; i < len(c.days) {
		return c.days[i], true
	}
	return 0, false
}

func (c *classResult) add(o classResult) {
	c.daily += o.daily
	c.abilities += o.abilities
	c.days = append(c.days, o.days...)
	slices.Sort(c.days)
	if c.first == nil {
		c.first = map[string]int{}
	}
	for k, v := range o.first {
		c.first[k] += v
	}
}

// guildSections writes the Economy run's guild, founding and class
// sections and returns their readings.
func guildSections(p func(string, ...any), b *sheets.Book, results []economyResult, fr economyResult, days int64) []Measured {
	sp := func(id string) int64 { return sheets.IntParam(b.SettlementParams, id) }

	p("## Guilds")
	p("")
	p("Every player but the quiet server's comes from one Discord server, so its guild takes the first starting settlement and half of each market fee paid there. Each world day at home a member gives %d%% of any stack it carries that the guild is short of, %d%% of its provisions over its floor and %d%% of its coin over its comfort; the guild is short of whatever keeps each work it can run stocked for %d world days, and of a charter until it has founded. Its %d admins switch a work on once the bank holds %d days of its stock, switch off for good one that after %d stocked days has spared under %d%% of what it consumed (a patrol's eased threat has no coin value and is never judged), approve each other's payments, and one of them carries the charter out and founds.", guildGoods, guildGoods, guildTithe, guildStock, economyAdmins, guildStart, guildReview, guildKeep)
	p("")
	p("| Players | Members | Given (coin value) | Treasury at the end | Founded a settlement |")
	p("| --- | --- | --- | --- | --- |")
	for _, r := range results {
		p("| %s | %s | %s | %s | %s |", comma(int64(r.size)), comma(int64(r.guild.members)), comma(r.guild.put), comma(r.guild.treasury), either(r.guild.founded > 0, fmt.Sprintf("day %d", r.guild.founded), "no"))
	}
	p("")
	p("### Guild works")
	p("")
	p("What each work consumed from the bank and gave back, at reference value: a stoked forge's waived station fees, an open ledger's point of market fee, a stable's unpaid upkeep. A road patrol gives threat, which has no coin value.")
	p("")
	p("| Guild size | Work | Days stocked | Consumed (coin value) | Gave back (coin value) | Gave back no more |")
	p("| --- | --- | --- | --- | --- | --- |")
	sink := true
	var worst string
	var worstOver int64
	var sizes []string
	for _, r := range results {
		sizes = append(sizes, comma(int64(r.guild.members)))
		for _, w := range r.guild.works {
			if w.days == 0 && w.gave == 0 {
				continue
			}
			ok := w.gave <= w.used
			sink = sink && ok
			if over := w.gave - w.used; over > worstOver {
				worst, worstOver = fmt.Sprintf("%s at %s members gave back %s coin for %s consumed", w.id, comma(int64(r.guild.members)), comma(w.gave), comma(w.used)), over
			}
			p("| %s | %s | %d | %s | %s | %s |", comma(int64(r.guild.members)), w.id, w.days, comma(w.used), comma(w.gave), holds(ok))
		}
	}
	p("")
	var never []string
	for _, row := range b.GuildWorks {
		if slices.ContainsFunc(results, func(r economyResult) bool {
			return slices.ContainsFunc(r.guild.works, func(w workLine) bool { return w.id == row.ID && w.days > 0 })
		}) {
			continue
		}
		why := fmt.Sprintf("the bank never held %d days of its stock", guildStart)
		if row.Needs != "" && !slices.ContainsFunc(b.Starting, func(st sheets.StartingStructure) bool { return st.Structure == row.Needs }) {
			why = fmt.Sprintf("it needs a %s, which a starting settlement lacks and nobody here raises", row.Needs)
		}
		never = append(never, fmt.Sprintf("%s (%s)", row.ID, why))
	}
	if len(never) > 0 {
		p("Never stocked: %s.", strings.Join(never, "; "))
		p("")
	}
	works := Measured{Target: "guild-works-sink", Value: "guilds of " + strings.Join(sizes, ", ") + ": no work gave back more than it consumed", Holds: sink}
	if !sink {
		works.Value = worst
	}
	readings := []Measured{works}
	if len(results) == 0 {
		readings = nil
	} else {
		readings = append(readings, citySection(p, b, results, days))
		quietSection(p, b, results)
	}

	most := sp("found-days-max")
	p("## Founding")
	p("")
	p("A guild of %d gatherers in a world of their own, arriving together with nothing and lighting no works. Each keeps about %d coin and, every time it comes home, gives the guild everything over it and all the timber and stone it carries; half its trips go to where a member last saw whichever the guild is shortest of, or farther out to look. The charter is %s coin from the treasury and %d timber and %d stone, which an admin draws from the bank, a second approving, and carries to a free tile at least %d tiles out. The run stops at the founding, or after %d world days.", fr.size, foundersComfort, comma(sp("charter-coin")), sp("charter-timber"), sp("charter-stone"), sp("found-distance"), foundersDays)
	p("")
	p("| Day | Treasury (coin) | Timber banked | Stone banked |")
	p("| --- | --- | --- | --- |")
	for _, d := range fr.guild.days {
		p("| %d | %d | %d | %d |", d.day, d.treasury, d.timber, d.stone)
	}
	p("")
	found := Measured{Target: "guild-founds", Holds: fr.guild.founded > 0 && fr.guild.founded <= most && len(fr.audit) == 0}
	if fr.guild.founded > 0 {
		p("Founded on world day %d; the target is within %d. Conservation: %s.", fr.guild.founded, most, either(len(fr.audit) == 0, "clean", fmt.Sprintf("**%d discrepancies**", len(fr.audit))))
		found.Value = fmt.Sprintf("a guild of %d founded on world day %d", fr.size, fr.guild.founded)
	} else {
		p("**Not founded in %d world days.**", foundersDays)
		found.Value = fmt.Sprintf("a guild of %d had not founded in %d world days", fr.size, foundersDays)
	}
	for _, a := range fr.audit {
		p("- %s", a)
	}
	p("")

	lo, hi := sheets.IntParam(b.ClassParams, "first-class-days-min"), sheets.IntParam(b.ClassParams, "first-class-days-max")
	p("## Classes")
	p("")
	p("World days from a character's arrival to its first class, over the players who play every day (every role but the casual one). Players take an ability whenever a tier of an active class opens.")
	p("")
	p("| Players | Daily players | Earned a class | Median days to the first | 10th to 90th percentile | First classes | Abilities taken |")
	p("| --- | --- | --- | --- | --- | --- | --- |")
	var pooled classResult
	for _, r := range results {
		c := r.classes
		pooled.add(c)
		med, spread := fmt.Sprintf("none in %d", days), "–"
		if m, ok := c.median(); ok {
			med = fmt.Sprint(m)
		}
		if len(c.days) > 0 {
			spread = fmt.Sprintf("%d to %d", percentile(c.days, 10), percentile(c.days, 90))
		}
		p("| %s | %s | %s (%.0f%%) | %s | %s | %s | %s |", comma(int64(r.size)), comma(int64(c.daily)), comma(int64(len(c.days))), pct(len(c.days), c.daily), med, spread, either(len(c.first) > 0, mapList(c.first), "–"), comma(int64(c.abilities)))
	}
	p("")
	class := Measured{Target: "first-class-unlock", Value: fmt.Sprintf("no first class for half of %s daily players in %d world days", comma(int64(pooled.daily)), days)}
	if m, ok := pooled.median(); ok {
		class.Value = fmt.Sprintf("median %d world days over %s daily players (%s)", m, comma(int64(pooled.daily)), mapList(pooled.first))
		class.Holds = m >= lo && m <= hi
	}
	if len(results) == 0 {
		return append(readings, found)
	}
	return append([]Measured{class}, append(readings, found)...)
}

// structural: the least soak size city-takes-season is read at; a smaller
// server is too few to make a city.
const cityFrom = 1000

// citySection writes the server guild's city and returns the
// city-takes-season reading: the first city landed within the later half
// of a season of story season-days, at every size from cityFrom up.
func citySection(p func(string, ...any), b *sheets.Book, results []economyResult, days int64) Measured {
	sp := func(id string) int64 { return sheets.IntParam(b.SettlementParams, id) }
	most := arc.ParamsOf(b).SeasonDays
	lo := most/2 + 1
	p("## A city")
	p("")
	p("The server guild's admins raise the wall and the stations a city needs at home, post the city project once those works and the six outer tiles stand, and members deliver to it as to a raise. It lands on the first world day all five needs hold (GDD 4.8): %d active characters who visited within %d days, %d days running at %d prosperity in its region (a day's trade on the region's books adds a point for each %s coin, up to %d), the works, the project's %s timber, %s stone and %s metal, and %s coin from the treasury. The target is the first city between world day %d and %d, read from %s players.", sp("city-users"), sp("city-user-days"), sp("city-prosperity-days"), sp("city-prosperity"), comma(sp("prosperity-coin")), sp("prosperity-trade-cap"), comma(sp("city-timber")), comma(sp("city-stone")), comma(sp("city-metal")), comma(sp("city-coin")), lo, most, comma(cityFrom))
	p("")
	p("| Players | Members | Project posted | First city | Short at the end |")
	p("| --- | --- | --- | --- | --- |")
	var got, small []string
	ok, measured := true, false
	for _, r := range results {
		c := r.guild.city
		landed := fmt.Sprintf("none in %d days", days)
		if c.raised > 0 {
			landed = fmt.Sprintf("day %d", c.raised)
		}
		p("| %s | %s | %s | %s | %s |", comma(int64(r.size)), comma(int64(r.guild.members)), either(c.posted > 0, fmt.Sprintf("day %d", c.posted), "never"), landed, either(len(c.needs) > 0, shortOf(c.needs), "–"))
		if r.size < cityFrom {
			why := landed
			if users := sp("city-users"); int64(r.guild.members) < users {
				why = fmt.Sprintf("%d members, under the %d active characters a city needs", r.guild.members, users)
			}
			small = append(small, fmt.Sprintf("%s players: %s", comma(int64(r.size)), why))
			continue
		}
		measured = true
		ok = ok && c.raised >= lo && c.raised <= most
		got = append(got, fmt.Sprintf("%s players: %s", comma(int64(r.size)), landed))
	}
	p("")
	if !measured {
		return notMeasured("city-takes-season", fmt.Sprintf("read from %s players; %s", comma(cityFrom), strings.Join(small, "; ")))
	}
	return Measured{Target: "city-takes-season", Value: "the first city, " + strings.Join(got, "; "), Holds: ok}
}

// shortOf lists the city needs not met.
func shortOf(needs []game.CityNeed) string {
	var out []string
	for _, n := range needs {
		if !n.Met {
			out = append(out, fmt.Sprintf("%s %s of %s %s", n.ID, comma(n.Have), comma(n.Need), n.Unit))
		}
	}
	if len(out) == 0 {
		return "nothing"
	}
	return strings.Join(out, ", ")
}

// quietSection writes the quiet server: the troubles its places held and
// lost once nobody played there, and what a ruin did with its escrows and
// treasury.
func quietSection(p func(string, ...any), b *sheets.Book, results []economyResult) {
	p("## The quiet server")
	p("")
	p("The quiet server's guild takes the second starting settlement, founds, and from world day %d nobody plays there, so its places meet their troubles with no one to hold them off. A place a guild founded that loses %d troubles in one season falls to ruin: its orders and goals return their escrow, its treasury goes to the guild's pool, and nothing it held is left at the place. The ledger is audited at the world day the ruin is found.", quietDays, arc.ParamsOf(b).RuinTroubles)
	p("")
	p("| Players | Quiet players | Founded | Place | Troubles held | Troubles lost | Ruin | Through the ruin |")
	p("| --- | --- | --- | --- | --- | --- | --- | --- |")
	for _, r := range results {
		q := r.guild.quiet
		if len(q.places) == 0 {
			p("| %s | %d | – | – | – | – | – | no quiet guild (%d%% of %s players) |", comma(int64(r.size)), q.members, quietShare, comma(int64(r.size)))
			continue
		}
		for _, qp := range q.places {
			ruin, through := "standing", "–"
			if qp.ruined > 0 {
				ruin = fmt.Sprintf("day %d", qp.ruined)
				through = fmt.Sprintf("treasury %s coin to the guild's pool (%s → %s)", comma(qp.treasury), comma(qp.pool[0]), comma(qp.pool[1]))
				if len(qp.left) > 0 {
					through += "; **left: " + strings.Join(qp.left, ", ") + "**"
				}
				through += "; audit " + either(len(qp.audit) == 0, "clean", fmt.Sprintf("**%d discrepancies**", len(qp.audit)))
			}
			p("| %s | %d | %s | %s | %d | %d | %s | %s |", comma(int64(r.size)), q.members, either(q.founded > 0, fmt.Sprintf("day %d", q.founded), "no"), qp.name, qp.held, qp.lost, ruin, through)
		}
	}
	p("")
	for _, r := range results {
		for _, qp := range r.guild.quiet.places {
			for _, a := range qp.audit {
				p("- %s players, the ruin of %s: %s", comma(int64(r.size)), qp.name, a)
			}
		}
	}
}

// threadResult is a soak's personal threads: the candidates queued by
// where they came from, and the threads open on the last day and at their
// peak, by template and by the faction that offered them.
type threadResult struct {
	queued     game.Queued
	open, peak int64
	read       threadRead
	byTemplate map[string]*openCount
	byFaction  map[string]*openCount
}

// threadRead is the threads as they stood at the end of threadsReadDay.
type threadRead struct {
	reached           bool
	gate, open, rival int64
}

// structural: the world day the threads are also read at, before a city
// forms at 1,000 players, so the bound reads against a busy world.
const threadsReadDay = 38

// openCount is one template's or faction's open threads.
type openCount struct{ last, peak int64 }

// structural: how the threads section names a thread no faction's cap
// counts, and the template the gate and arc winners cast.
const (
	earnedThread = "none (earned)"
	rivalThread  = "the-rival"
)

// day counts the personal threads open at a world day's end.
func (r *threadResult) day(g *game.Game) {
	if g.Story == nil {
		return
	}
	if r.byTemplate == nil {
		r.byTemplate, r.byFaction = map[string]*openCount{}, map[string]*openCount{}
	}
	tpl, fac := map[string]int64{}, map[string]int64{}
	var n int64
	for _, a := range g.Story.Arcs {
		if a.Outcome != "" || a.Scope != arc.Personal {
			continue
		}
		n++
		tpl[a.Template]++
		fac[viaName(g, a.Via)]++
	}
	r.open, r.peak = n, max(r.peak, n)
	if g.Tick()/sheets.TicksPerDay == threadsReadDay {
		r.read = threadRead{reached: true, gate: g.Queued().Gate, open: n, rival: tpl[rivalThread]}
	}
	tally := func(into map[string]*openCount, today map[string]int64) {
		for _, c := range into {
			c.last = 0
		}
		for k, v := range today {
			c := into[k]
			if c == nil {
				c = &openCount{}
				into[k] = c
			}
			c.last, c.peak = v, max(c.peak, v)
		}
	}
	tally(r.byTemplate, tpl)
	tally(r.byFaction, fac)
}

// viaName is the faction a thread was offered by, with its archetype.
func viaName(g *game.Game, via fact.Ref) string {
	fi, ok := arc.RefIndex(via)
	if via == (fact.Ref{}) || !ok || fi < 0 || fi >= len(g.World.Factions) {
		return either(via == (fact.Ref{}), earnedThread, via.String())
	}
	return fmt.Sprintf("%s (%s)", via.ID, g.World.Factions[fi].Archetype)
}

// threadSection reports each soak's personal threads, so the per-faction
// offer cap can be read against the churn it bounds.
func threadSection(p func(string, ...any), results []economyResult) {
	p("## Personal threads")
	p("")
	p("Personal thread candidates queued over the whole run, by source: the thread gate (a faction's notables offering a character standing high with them), a won arc side's contributors against the faction it beat, and every other hook (an NPC's debt, a return, a broken vow). Then the personal threads open at the last world day and at their peak, by template and by the faction whose offer cap each counts against: the one that offered it, or the one a rival is against.")
	p("")
	p("| Players | Queued by the gate | Queued for arc winners | Queued otherwise | Open on the last day | Peak open | Gate by day %d | Open on day %d | Rivals open on day %d |", threadsReadDay, threadsReadDay, threadsReadDay)
	p("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
	for _, r := range results {
		th := r.threads
		at := func(n int64) string { return either(th.read.reached, comma(n), "–") }
		p("| %s | %s | %s | %s | %s | %s | %s | %s | %s |", comma(int64(r.size)), comma(th.queued.Gate), comma(th.queued.Winners), comma(th.queued.Other), comma(th.open), comma(th.peak),
			at(th.read.gate), at(th.read.open), at(th.read.rival))
	}
	p("")
	for _, r := range results {
		for _, by := range []struct {
			name   string
			counts map[string]*openCount
		}{{"template", r.threads.byTemplate}, {"faction counted against", r.threads.byFaction}} {
			if len(by.counts) == 0 {
				continue
			}
			p("Open personal threads at %s players by %s:", comma(int64(r.size)), by.name)
			p("")
			p("| %s | Last day | Peak |", strings.ToUpper(by.name[:1])+by.name[1:])
			p("| --- | --- | --- |")
			for _, k := range slices.Sorted(maps.Keys(by.counts)) {
				c := by.counts[k]
				p("| %s | %s | %s |", k, comma(c.last), comma(c.peak))
			}
			p("")
		}
	}
}
