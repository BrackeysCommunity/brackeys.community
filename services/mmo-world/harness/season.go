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
	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/season"
	"jams.team/mmo-world/sim/sheets"
)

// structural: season zero's proof (GDD 12.6). The run goes one world day
// past season zero's close so the close and the next season's start are
// both seen. decidedBackers is a measurement, not a rule: a stage won by
// fewer characters was not decided by players.
const (
	seasonDays     = 15
	seasonPlayers  = 20
	seasonSeeds    = 8
	seasonServer   = "season"
	decidedBackers = 2
)

// seasonSide is one side of a stage as it stood when last seen.
type seasonSide struct {
	side     string
	mark     int64
	units    int64
	backers  []string // characters who put units in
	declared int      // characters who declared for it
}

// seasonStage is one stage of an arc.
type seasonStage struct {
	due, ended int64
	won        string
	lapsed     bool
	sides      []seasonSide
}

// decided reports whether players decided the stage: a side won with its
// mark met by decidedBackers or more distinct characters.
func (s seasonStage) decided() bool {
	for _, sd := range s.sides {
		if s.won != "" && sd.side == s.won && sd.units >= sd.mark && len(sd.backers) >= decidedBackers {
			return true
		}
	}
	return false
}

// seasonArc is one arc (or trouble, or thread) over a run.
type seasonArc struct {
	n                   int64
	id, template, scope string
	by, place, outcome  string
	regions             []int
	began, ended        int64
	stages              []seasonStage
}

// seasonResult is one seed's season.
type seasonResult struct {
	seed            string
	arcs            []*seasonArc
	finale          bool // season.finale written
	finaleTemplate  string
	finaleOutcome   string
	finaleTick      int64
	closed          bool // season.closed written
	closedTick      int64
	clock           season.Clock
	troubles        []seasonPlace
	audit           []string
	digest          string
	actions, refuse int
	// offered counts option reads that listed a side; backs the goal-back
	// presses sent, and backRefused those refused.
	offered, backs, backRefused int
	elapsed                     time.Duration
}

// seasonPlace is one place's troubles over a run.
type seasonPlace struct {
	name       string
	held, lost int
}

// stagesWhere counts the stages of a run that pass ok.
func (r seasonResult) stagesWhere(ok func(seasonStage) bool) int {
	n := 0
	for _, a := range r.arcs {
		for _, s := range a.stages {
			if ok(s) {
				n++
			}
		}
	}
	return n
}

func (r seasonResult) decided() int {
	return r.stagesWhere(func(s seasonStage) bool { return s.decided() })
}

func (r seasonResult) lapsed() int {
	return r.stagesWhere(func(s seasonStage) bool { return s.lapsed })
}

// holds is the season-zero row on one seed.
func (r seasonResult) holds() bool {
	return r.decided() > 0 && r.lapsed() > 0 && r.finale && r.closed && len(r.audit) == 0
}

// seasonSeed is the key label suffix of the i-th seed; the first is "".
func seasonSeed(i int) string {
	if i == 0 {
		return ""
	}
	return strconv.Itoa(i)
}

// SeasonRun plays season zero headless (GDD 12.6): on each of n seeds
// (default seasonSeeds), seasonPlayers scripted players of the economy
// roles on one server, with the guild plan and backing sides, join over
// the first world day and play seasonDays world days. The first seed is
// played twice to show the season replays to the same digest.
func SeasonRun(b *sheets.Book, out string, n int) ([]Measured, error) {
	runs, again, err := playSeasons(b, n)
	if err != nil {
		return nil, err
	}
	for _, r := range runs {
		fmt.Fprintf(os.Stderr, "season %q: %s, %d actions, %d refused, %d decided, %d lapsed, digest %s\n", r.seed, r.elapsed.Round(elapsedShown),
			r.actions, r.refuse, r.decided(), r.lapsed(), r.digest)
	}
	m := seasonReading(runs, again.digest == runs[0].digest)
	if err := seasonDoc(b, runs, again, m).save(out, "season.md"); err != nil {
		return nil, err
	}
	return []Measured{m}, nil
}

// playSeasons plays n seeds (seasonSeeds when n is 0) in parallel, and
// the first seed once more.
func playSeasons(b *sheets.Book, n int) (runs []seasonResult, again seasonResult, err error) {
	if n <= 0 {
		n = seasonSeeds
	}
	results := make([]seasonResult, n+1)
	err = runParallel(n+1, func(i int) error {
		r, err := playSeason(b, seasonSeed(i%n))
		if err != nil {
			return fmt.Errorf("season run, seed %q: %w", seasonSeed(i%n), err)
		}
		results[i] = r
		return nil
	})
	return results[:n], results[n], err
}

// structural: how finely a seed's wall time is shown.
const elapsedShown = 10 * time.Millisecond

// seasonReading is the season-zero row over runs; repeat is whether the
// first seed's second run gave the same digest.
func seasonReading(runs []seasonResult, repeat bool) Measured {
	ok := repeat
	held, decided, lapsed, finale, closed, clean := 0, 0, 0, 0, 0, 0
	for _, r := range runs {
		ok = ok && r.holds()
		held += btoi(r.holds())
		decided += btoi(r.decided() > 0)
		lapsed += btoi(r.lapsed() > 0)
		finale += btoi(r.finale)
		closed += btoi(r.closed)
		clean += btoi(len(r.audit) == 0)
	}
	v := fmt.Sprintf("%d of %d seeds hold, %d days: a stage decided by players on %d, a lapse on %d, the finale on %d, the close on %d, the ledger clean on %d; seed \"\" replays %s",
		held, len(runs), seasonDays, decided, lapsed, finale, closed, clean, either(repeat, "to the same digest", "to **another digest**"))
	return Measured{Target: "season-zero", Value: v, Holds: ok}
}

func btoi(b bool) int {
	if b {
		return 1
	}
	return 0
}

// playSeason plays one seed's season zero.
func playSeason(b *sheets.Book, seed string) (seasonResult, error) {
	start := time.Now()
	res := seasonResult{seed: seed}
	r, err := game.NewRules(b, keys.Throwaway("season"+seed))
	if err != nil {
		return res, err
	}
	g, err := game.New(r)
	if err != nil {
		return res, err
	}
	g.World.OpenSettlement()
	local := service.NewLocal(g)
	players := seasonRoster(b, seasonServer)
	script := agent.NewScript(counting{local, &res}, players, "season"+seed)
	ctx := context.Background()
	seen := map[string]*seasonArc{}
	var playing []*agent.Player
	for t := int64(0); t < seasonDays*sheets.TicksPerDay; t++ {
		playing = seasonDue(g, players, t, playing[:0])
		if err := script.TurnFor(ctx, t, playing); err != nil {
			return res, err
		}
		if _, err := g.Advance(); err != nil {
			return res, err
		}
		facts, _ := g.Flush()
		local.Txns()
		res.note(facts)
		res.observe(g, seen)
		if g.Tick()%sheets.TicksPerDay == 0 {
			local.Forget()
		}
	}
	for _, p := range players {
		res.actions += p.Actions
		res.refuse += p.Refused
	}
	slices.SortFunc(res.arcs, func(a, b *seasonArc) int { return int(a.n - b.n) })
	res.troubles = troublesByPlace(g, res.arcs)
	res.clock, _, _ = g.Season()
	res.audit = ledger.Audit(g.Ledger.Balances, g.Holdings())
	sum, err := g.Digest()
	if err != nil {
		return res, err
	}
	res.digest = sum.String()
	res.elapsed = time.Since(start)
	return res, nil
}

// seasonRoster is the season's players on server: the economy roles, the
// guild plan with its city, backing the sides they can serve.
func seasonRoster(b *sheets.Book, server string) []*agent.Player {
	plan := guildPlan(b, guildGoods, guildTithe, false)
	plan.City = true
	pop := population{roles: economyRoles, back: agent.NewBacker(b)}
	players := earners(pop, plan, seasonPlayers, 0, 0, agent.Bands(b))
	for i, p := range players {
		p.Server, p.Admin = server, i < economyAdmins
	}
	return players
}

// seasonWorld is what a season's players call: actions and options, and
// the pages a citizen reads.
type seasonWorld interface {
	agent.Client
	agent.Pages
	agent.Boards
}

// counting is a world counting the sides players were offered and the
// backs they sent.
type counting struct {
	seasonWorld
	res *seasonResult
}

func (c counting) Options(ctx context.Context, id string) (api.Options, error) {
	o, err := c.seasonWorld.Options(ctx, id)
	if err == nil && len(o.Sides) > 0 {
		c.res.offered++
	}
	return o, err
}

func (c counting) Act(ctx context.Context, req api.ActionRequest) (api.ActionReply, *api.Refusal, error) {
	rep, ref, err := c.seasonWorld.Act(ctx, req)
	if req.Kind == api.ActBackSide && err == nil {
		c.res.backs++
		c.res.backRefused += btoi(ref != nil)
	}
	return rep, ref, err
}

// joined is whether the i-th of n players has arrived rel ticks into the
// run: each on its own tick of the first world day.
func joined(i int, rel int64, n int) bool {
	return rel >= int64(i)*sheets.TicksPerDay/int64(n)
}

// seasonDue is who plays at tick t: each player arrives over the first
// world day, then keeps the Economy run's hours.
func seasonDue(g *game.Game, players []*agent.Player, t int64, out []*agent.Player) []*agent.Player {
	busy := longBusy(g)
	for i, p := range players {
		if joined(i, t, len(players)) && due(i, t, p, busy) {
			out = append(out, p)
		}
	}
	return out
}

// note reads the season's own facts off a tick's log.
func (r *seasonResult) note(facts []fact.Fact) {
	for _, f := range facts {
		switch f.Kind {
		case "season.finale":
			r.finale, r.finaleTick = true, f.Tick
			if d, ok := f.Get("template"); ok {
				r.finaleTemplate = d.S
			}
			if d, ok := f.Get("outcome"); ok {
				r.finaleOutcome = d.S
			}
		case "season.closed":
			r.closed, r.closedTick = true, f.Tick
		}
	}
}

// observe copies every arc the story holds, so an arc the story forgets
// after kept-arc-days is still reported as it last stood.
func (r *seasonResult) observe(g *game.Game, seen map[string]*seasonArc) {
	if g.Story == nil {
		return
	}
	declared := map[string]int{}
	for _, bk := range g.Story.Backers {
		declared[game.SideKey(bk.Arc, bk.Stage, bk.Side)]++
	}
	for _, a := range g.Story.Arcs {
		l, ok := seen[a.ID]
		if !ok {
			n, _ := strconv.ParseInt(strings.TrimPrefix(a.ID, "arc-"), 10, 64)
			l = &seasonArc{n: n, id: a.ID, template: a.Template, scope: a.Scope, by: a.By, place: a.Place, regions: slices.Clone(a.Regions), began: a.Began}
			seen[a.ID] = l
			r.arcs = append(r.arcs, l)
		}
		l.ended, l.outcome = a.Ended, a.Outcome
		for len(l.stages) < len(a.Stages) {
			l.stages = append(l.stages, seasonStage{})
		}
		for i, st := range a.Stages {
			s := &l.stages[i]
			s.due, s.ended, s.won, s.lapsed = st.Due, st.Ended, st.Won, st.Lapsed
			for len(s.sides) < len(st.Sides) {
				s.sides = append(s.sides, seasonSide{})
			}
			for j, sr := range st.Sides {
				sd := &s.sides[j]
				sd.side, sd.mark = sr.Side, sr.Mark
				sd.declared = max(sd.declared, declared[game.SideKey(a.ID, i, sr.Side)])
				x := g.GoalOf(sr.Goal)
				if x == nil {
					continue
				}
				sd.units, sd.backers = x.Total(), sd.backers[:0]
				for _, p := range x.Progress {
					if p.N > 0 && g.Char(p.Key) != nil {
						sd.backers = append(sd.backers, p.Key)
					}
				}
			}
		}
	}
}

// troublesByPlace counts each place's troubles held and lost.
func troublesByPlace(g *game.Game, arcs []*seasonArc) []seasonPlace {
	out := make([]seasonPlace, len(g.Places))
	for i, p := range g.Places {
		out[i].name = cmpName(p.Name, g.PlaceName(p.Hex))
	}
	for _, a := range arcs {
		n, ok := goal.SettlementOf(a.place)
		if a.scope != arc.Settlement || !ok || n >= len(out) {
			continue
		}
		for _, s := range a.stages {
			switch {
			case s.won != "":
				out[n].held++
			case s.lapsed:
				out[n].lost++
			}
		}
	}
	return out
}

func cmpName(names ...string) string {
	for _, n := range names {
		if n != "" {
			return n
		}
	}
	return "?"
}

// why says what a seed that does not hold lacks.
func (r seasonResult) why() string {
	var out []string
	if r.decided() == 0 {
		out = append(out, "no stage decided by players: "+r.undecided())
	}
	if r.lapsed() == 0 {
		out = append(out, "no stage lapsed")
	}
	if !r.finale {
		out = append(out, "no `season.finale`")
	}
	if !r.closed {
		out = append(out, "no `season.closed`")
	}
	if len(r.audit) > 0 {
		out = append(out, "the ledger has discrepancies")
	}
	return strings.Join(out, "; ")
}

// undecided is why no stage was decided by players, from the nearest miss.
func (r seasonResult) undecided() string {
	stages, won, put := 0, 0, 0
	most := 0
	for _, a := range r.arcs {
		for _, s := range a.stages {
			stages++
			won += btoi(s.won != "")
			for _, sd := range s.sides {
				put += btoi(sd.units > 0)
				most = max(most, len(sd.backers))
			}
		}
	}
	switch {
	case stages == 0:
		return "the director cast no arc, trouble or thread"
	case r.offered == 0:
		return fmt.Sprintf("%d stages ran, but no player's options ever listed a side", stages)
	case r.backs == 0:
		return fmt.Sprintf("%d stages ran and sides were listed in %d option reads, but no player sent `goal-back`", stages, r.offered)
	case put == 0:
		return fmt.Sprintf("%d stages ran and players sent %d backs (%d refused), but no side got a unit", stages, r.backs, r.backRefused)
	case won == 0:
		return fmt.Sprintf("%d stages ran and %d sides got units, but none met its mark", stages, put)
	}
	return fmt.Sprintf("%d stages were won, but none by %d or more backers (at most %d on a side)", won, decidedBackers, most)
}

// seasonDoc is the run's report.
func seasonDoc(b *sheets.Book, runs []seasonResult, again seasonResult, m Measured) *lineDoc {
	var doc lineDoc
	p := doc.p
	zero := arc.ParamsOf(b).SeasonZeroDays
	p("# Season run")
	p("")
	p("Season zero headless (GDD 12.6): on each seed a fresh world (`game.New`, season 0 of %d world days) with its second settlement open, and %d scripted players (`harness/agent.Earner`: %s) from one server, whose guild plays the Economy run's plan and who back the sides they can serve. They join over the first world day and play %d world days, through the close and into season 1.",
		zero, seasonPlayers, roleList(), seasonDays)
	p("")
	p("A stage is decided by players when a side won with its mark met by %d or more distinct characters. The row holds when every seed has such a stage and a stage that lapsed, writes `season.finale` and `season.closed`, and keeps the ledger clean, and seed \"\" played a second time gives the same digest.", decidedBackers)
	p("")
	p("**season-zero:** %s. Holds: %s.", m.Value, holds(m.Holds))
	p("")
	p("| Seed | Arcs | Stages | Decided by players | Lapsed | Finale | Closed (tick) | Clock after | Troubles held / lost | Ledger | Actions / refused | Digest | Time | Holds |")
	p("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
	for _, r := range runs {
		held, lost := 0, 0
		for _, pl := range r.troubles {
			held += pl.held
			lost += pl.lost
		}
		p("| %q | %d | %d | %d | %d | %s | %s | %s | %d / %d | %s | %d / %d | %s | %s | %s |", r.seed, len(r.arcs), r.stagesWhere(func(seasonStage) bool { return true }),
			r.decided(), r.lapsed(), finaleCell(r), either(r.closed, strconv.FormatInt(r.closedTick, 10), "**none**"), clockCell(r.clock), held, lost,
			auditCell(r.audit), r.actions, r.refuse, short(r.digest), r.elapsed.Round(elapsedShown), holds(r.holds()))
	}
	p("")
	p("Seed \"\" again: digest %s, %s.", short(again.digest), either(again.digest == runs[0].digest, "the same", "**different**"))
	p("")
	for _, r := range runs {
		p("## Seed %q", r.seed)
		p("")
		seasonBody(p, r, "", "", "Sides: units / mark, backers (declared)", sideCells)
	}
	return &doc
}

// seasonBody is one season's account: its finale and close, its backing,
// why it does not hold, its arcs and troubles, and its ledger. lead opens
// the first line and backing ends the backing line; sides fills the arc
// table's sides column, headed sidesHead.
func seasonBody(p func(string, ...any), r seasonResult, lead, backing, sidesHead string, sides func(seasonStage) string) {
	p("%sFinale: %s. Close: %s; the clock after is %s.", lead, finaleCell(r),
		either(r.closed, fmt.Sprintf("`season.closed` at tick %d (world day %d)", r.closedTick, r.closedTick/sheets.TicksPerDay), "**not written**"), clockCell(r.clock))
	p("")
	p("Backing: sides listed in %d option reads; %d `goal-back` presses, %d refused.%s", r.offered, r.backs, r.backRefused, backing)
	p("")
	if !r.holds() {
		p("Does not hold: %s.", r.why())
		p("")
	}
	if len(r.arcs) == 0 {
		p("No arc was cast.")
		p("")
	} else {
		p("| Arc | Template | Scope | Regions | By | Stage | Due (day) | Outcome | %s | Decided by players |", sidesHead)
		p("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
		for _, a := range r.arcs {
			for i, s := range a.stages {
				p("| %s | %s | %s | %s | %s | %d | %d | %s | %s | %s |", a.id, a.template, a.scope, regionList(a.regions), a.by, i+1, s.due/sheets.TicksPerDay,
					stageOutcome(s), sides(s), either(s.decided(), "yes", "no"))
			}
		}
		p("")
	}
	if len(r.troubles) > 0 {
		p("| Place | Troubles held | Troubles lost |")
		p("| --- | --- | --- |")
		for _, pl := range r.troubles {
			p("| %s | %d | %d |", pl.name, pl.held, pl.lost)
		}
		p("")
	}
	p("Ledger: %s. Digest %s.", auditCell(r.audit), r.digest)
	p("")
	for _, a := range r.audit {
		p("- %s", a)
	}
	if len(r.audit) > 0 {
		p("")
	}
}

func finaleCell(r seasonResult) string {
	switch {
	case !r.finale:
		return "**not written**"
	case r.finaleTemplate == "":
		return "none cast"
	}
	return r.finaleTemplate + ", " + cmpName(r.finaleOutcome, "open")
}

func clockCell(c season.Clock) string {
	return fmt.Sprintf("season %d from day %d, %d days", c.N, c.Start, c.Days)
}

func auditCell(audit []string) string {
	return either(len(audit) == 0, "clean", fmt.Sprintf("**%d discrepancies**", len(audit)))
}

// structural: digest characters shown in tables.
const digestShown = 12

func short(digest string) string { return digest[:min(len(digest), digestShown)] }

func regionList(rs []int) string {
	var s []string
	for _, r := range rs {
		s = append(s, arc.RegionRef(r).ID)
	}
	return strings.Join(s, ", ")
}

func stageOutcome(s seasonStage) string {
	switch {
	case s.won != "":
		return "won by " + s.won
	case s.lapsed:
		return "lapsed"
	}
	return "open"
}

func sideCells(s seasonStage) string {
	var out []string
	for _, sd := range s.sides {
		out = append(out, fmt.Sprintf("%s: %d / %d, %d (%d)", sd.side, sd.units, sd.mark, len(sd.backers), sd.declared))
	}
	return strings.Join(out, "; ")
}
