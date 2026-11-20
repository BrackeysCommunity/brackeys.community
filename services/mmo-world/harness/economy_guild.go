package harness

import (
	"fmt"
	"slices"
	"strings"

	"jams.team/mmo-world/harness/agent"
	"jams.team/mmo-world/sim/class"
	"jams.team/mmo-world/sim/game"
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
	p.Works, p.Seek, p.Every = !rush, rush, rush
	return p
}

// founders is the founding world's population: a guild of guild-least
// gatherers who arrive together and stop once they have founded.
func founders(b *sheets.Book) population {
	return population{label: "economy-founding", server: economyServer, size: int(sheets.IntParam(b.SettlementParams, "guild-least")),
		roles: []role{{agent.Gatherer, 100, foundersComfort}}, plan: guildPlan(b, foundersGive, foundersGive, true), admins: economyAdmins, join: 0,
		until: func(g *game.Game) bool { return foundedDay(g) > 0 }}
}

// foundedDay is how many world days had begun when the first settlement
// was founded; 0 for none yet.
func foundedDay(g *game.Game) int64 {
	for _, p := range g.Places {
		if p.Lattice < 0 {
			return p.Founded/sheets.TicksPerDay + 1
		}
	}
	return 0
}

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
	if len(g.Guilds) == 0 || plan == nil {
		return
	}
	d := guildDay{day: g.World.Day}
	for _, h := range g.Ledger.Held(g.Guilds[0].Pool()) {
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
	r.founded = foundedDay(g)
	for _, row := range g.Rules().Book.GuildWorks {
		r.works = append(r.works, workLine{id: row.ID, days: stocked[row.ID], used: g.WorkLedger.Used.Get(row.ID), gave: g.WorkLedger.Gave.Get(row.ID)})
	}
	if len(g.Guilds) == 0 {
		return
	}
	gd := g.Guilds[0]
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
		if e, ok := p.Policy.(*agent.Earner); ok && e.Role == agent.Casual {
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
	p("Every player comes from one Discord server, so its guild takes the first starting settlement and half of each market fee paid there. Each world day at home a member gives %d%% of any stack it carries that the guild is short of, %d%% of its provisions over its floor and %d%% of its coin over its comfort; the guild is short of whatever keeps each work it can run stocked for %d world days, and of a charter until it has founded. Its %d admins switch a work on once the bank holds %d days of its stock, approve each other's payments, and one of them carries the charter out and founds.", guildGoods, guildGoods, guildTithe, guildStock, economyAdmins, guildStart)
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
	found.Value += "; a city is not in the sim, so its half is not measured"
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
