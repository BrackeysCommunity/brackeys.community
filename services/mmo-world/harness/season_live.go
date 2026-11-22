package harness

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/api/client"
	"jams.team/mmo-world/harness/agent"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/season"
	"jams.team/mmo-world/sim/sheets"
)

// structural: the live season's pacing. A world that does not tick for
// liveTickWait has stalled; liveFailures turns in a row that fail in
// transport end the run; outcomeLapsed is how the world names a lapse.
const (
	liveTickWait  = 5 * time.Minute
	liveFailures  = 20
	outcomeLapsed = "lapsed"
)

// pacer waits until the world has run tick n and says the tick it is at.
type pacer func(ctx context.Context, n int64) (int64, error)

// liveSeason is a live world as the season run reaches it: players' calls
// through api, the story, audit and digest through op, and how it waits
// for the world's tick. limit, when positive, ends the run after that many
// ticks.
type liveSeason struct {
	api, op *client.HTTP
	pace    pacer
	limit   int64
}

// SeasonLive plays season zero on a live world over HTTP (GDD 12.6): the
// same scripted players as the headless run, one turn per service tick,
// until the world writes season.closed. It reads the outcome from the
// operator's story view and the events, and applies the season-zero
// reading to the one world.
func SeasonLive(b *sheets.Book, base, out string) ([]Measured, error) {
	if base == "" {
		return nil, errors.New("season -live needs the world's URL")
	}
	op := client.New(base, os.Getenv(service.EnvOperatorToken))
	w := liveSeason{api: client.New(base, os.Getenv(service.EnvAPIToken)), op: op, pace: waitTick(op)}
	r, err := playLive(context.Background(), b, w)
	if err != nil {
		return nil, err
	}
	fmt.Fprintf(os.Stderr, "season live: %s, %d actions, %d refused, %d decided, %d lapsed, digest %s\n", r.elapsed.Round(elapsedShown),
		r.actions, r.refuse, r.decided(), r.lapsed(), r.digest)
	m := liveReading(r)
	if err := liveDoc(b, base, r, m).save(out, "season-live.md"); err != nil {
		return nil, err
	}
	return []Measured{m}, nil
}

// waitTick waits on the world's own clock.
func waitTick(c *client.HTTP) pacer {
	return func(ctx context.Context, n int64) (int64, error) {
		wait, cancel := context.WithTimeout(ctx, liveTickWait)
		defer cancel()
		var now int64
		err := c.WaitHealth(wait, func(h api.Health, err error) bool {
			if err == nil {
				now = h.Tick
			}
			return err == nil && h.Tick >= n
		})
		if err != nil {
			return now, fmt.Errorf("the world did not reach tick %d (at %d): %w", n, now, err)
		}
		return now, nil
	}
}

// liveResult is a live season and what the run saw of it on the way.
type liveResult struct {
	seasonResult
	start, end int64 // the world's ticks the run began and ended at
	lagged     int64 // ticks the world ran while the players were still playing the one before
	failed     int   // turns that failed in transport
	arcs       map[string]*seasonArc
	hunts      map[string]bool // arcs whose trouble has a hunt
	places     map[int64]string
	troubles   map[int64]*seasonPlace
}

// playLive plays season zero on w from where the world stands.
func playLive(ctx context.Context, b *sheets.Book, w liveSeason) (liveResult, error) {
	begin := time.Now()
	res := liveResult{arcs: map[string]*seasonArc{}, hunts: map[string]bool{}, places: map[int64]string{}, troubles: map[int64]*seasonPlace{}}
	hl, err := w.api.Health(ctx)
	if err != nil {
		return res, err
	}
	view, err := operatorStory(ctx, w.op)
	if err != nil {
		return res, err
	}
	if view.Season.N != 0 {
		return res, fmt.Errorf("the world is in season %d: season zero is played on a fresh world (op reset)", view.Season.N)
	}
	res.start, res.seed = hl.Tick, "live"
	run := fmt.Sprintf("season-live-%d", hl.Tick)
	lc := &liveClient{HTTP: w.api, res: &res.seasonResult, busy: map[string]int64{}}
	plan := guildPlan(b, guildGoods, guildTithe, false)
	plan.City = true
	pop := population{roles: economyRoles, back: agent.NewBacker(b)}
	players := earners(pop, plan, seasonPlayers, 0, 0, agent.Bands(b))
	for i, p := range players {
		p.Discord, p.Server, p.Admin = run+"-"+p.Discord, run, i < economyAdmins
	}
	script := agent.NewScript(lc, players, run)
	var last int64
	var due []*agent.Player
	// turn is one tick's play: the events so far, the turns of the players
	// due, and the story view once they have acted, before the next tick
	// can end a stage they filled.
	turn := func(t int64) error {
		var err error
		if last, err = res.events(ctx, w.api, last); err != nil {
			return err
		}
		due = liveDue(lc, players, t-res.start, t, due[:0])
		if err := script.TurnFor(ctx, t, due); err != nil {
			return err
		}
		if view, err = operatorStory(ctx, w.op); err != nil {
			return err
		}
		res.observe(view)
		return nil
	}
	until := view.Season.Ends + sheets.TicksPerDay
	failures := 0
	for t := hl.Tick; !res.closed && t <= until && (w.limit <= 0 || t < res.start+w.limit); t++ {
		now, err := w.pace(ctx, t)
		if err != nil {
			return res, err
		}
		if now > t {
			res.lagged += now - t
			t = now
		}
		if err := turn(t); err != nil {
			res.failed++
			if failures++; failures >= liveFailures {
				return res, fmt.Errorf("%d turns in a row failed: %w", failures, err)
			}
		} else {
			failures = 0
		}
		if t%sheets.TicksPerDay == 0 {
			fmt.Fprintf(os.Stderr, "season live: tick %d, season %d day %d, %d arcs seen, %d lagged, %d failed\n", t, view.Season.N, view.Season.Day,
				len(res.arcs), res.lagged, res.failed)
		}
		res.end = t
	}
	if _, err := res.events(ctx, w.api, last); err != nil {
		return res, err
	}
	return res, res.finish(ctx, w, players, begin)
}

// finish reads the world's state at the run's end into the result.
func (r *liveResult) finish(ctx context.Context, w liveSeason, players []*agent.Player, begin time.Time) error {
	view, err := operatorStory(ctx, w.op)
	if err != nil {
		return err
	}
	r.observe(view)
	r.clock = seasonClock(view.Season)
	for _, p := range players {
		r.actions += p.Actions
		r.refuse += p.Refused
	}
	for _, a := range r.arcs {
		r.seasonResult.arcs = append(r.seasonResult.arcs, a)
	}
	slices.SortFunc(r.seasonResult.arcs, func(a, b *seasonArc) int { return int(a.n - b.n) })
	for _, n := range slices.Sorted(maps.Keys(r.troubles)) {
		pl := *r.troubles[n]
		pl.name = cmpName(r.places[n], "settlement "+strconv.FormatInt(n, 10))
		r.seasonResult.troubles = append(r.seasonResult.troubles, pl)
	}
	audit, err := w.op.Audit(ctx)
	if err != nil {
		return err
	}
	r.audit = audit.Discrepancies
	d, err := w.op.Digest(ctx)
	if err != nil {
		return err
	}
	r.digest, r.elapsed = d.Digest, time.Since(begin)
	return nil
}

// seasonClock is a season as the wire shows it, as the sim's clock.
func seasonClock(s api.Season) season.Clock {
	return season.Clock{N: s.N, Start: s.Ends/sheets.TicksPerDay - s.Days, Days: s.Days}
}

func operatorStory(ctx context.Context, c *client.HTTP) (api.StoryView, error) {
	var out api.StoryView
	ref, err := c.Do(ctx, http.MethodGet, api.PathOperatorStory, nil, &out)
	return out, client.Refused("operator story", ref, err)
}

// events reads the story's events after a fact id and returns the last id
// read.
func (r *liveResult) events(ctx context.Context, c *client.HTTP, after int64) (int64, error) {
	for {
		var page api.StoryEvents
		ref, err := c.Do(ctx, http.MethodGet, api.PathStoryEvents+"?after="+strconv.FormatInt(after, 10), nil, &page)
		if err := client.Refused("story events", ref, err); err != nil {
			return after, err
		}
		for _, e := range page.Events {
			r.fact(e.Fact)
		}
		if page.Last <= after {
			return after, nil
		}
		after = page.Last
	}
}

// fact reads one event's fact: the season's own, and each stage's start
// and end, which the story view shows only while the stage runs.
func (r *liveResult) fact(f api.Fact) {
	sf := simFact(f)
	r.note([]fact.Fact{sf})
	id := datum(f, "arc").S
	if id == "" {
		return
	}
	a := r.arc(id, datum(f, "template").S, datum(f, "scope").S)
	n := int(datum(f, "stage").N)
	for len(a.stages) <= n {
		a.stages = append(a.stages, seasonStage{})
	}
	s := &a.stages[n]
	switch f.Kind {
	case "arc.cast", "arc.stage-began", "trouble.started":
		s.due = datum(f, "due").N
		if by := datum(f, "by").S; by != "" {
			a.by = by
		}
		if n == 0 {
			a.began = f.Tick
		}
		if datum(f, "hunt").S != "" {
			r.hunts[id] = true
		}
		for _, d := range f.Data {
			if side, ok := strings.CutPrefix(d.Key, "mark:"); ok {
				sideOf(s, side).mark = d.N
			}
		}
	case "arc.stage-ended", "trouble.held", "trouble.lost":
		s.ended = f.Tick
		won := datum(f, "side").S
		if won == "" || won == outcomeLapsed {
			s.lapsed = true
		} else {
			s.won = won
			// A side wins when its goal is met, unless a raid's hunt
			// fell first, so the mark was reached even if the last view
			// came before the last unit.
			if sd := sideOf(s, won); !r.hunts[id] {
				sd.units = max(sd.units, sd.mark)
			}
		}
	case "arc.ended":
		a.ended, a.outcome = f.Tick, datum(f, "outcome").S
	}
	if f.Kind == "trouble.held" || f.Kind == "trouble.lost" {
		if pl, ok := datumOK(f, "settlement"); ok {
			at := r.troubles[pl.N]
			if at == nil {
				at = &seasonPlace{}
				r.troubles[pl.N] = at
			}
			if f.Kind == "trouble.held" {
				at.held++
			} else {
				at.lost++
			}
		}
	}
}

// observe copies each arc's running stage from the story view: its sides'
// marks, units and backers, which only grow while the stage runs.
func (r *liveResult) observe(v api.StoryView) {
	for _, a := range v.Arcs {
		l := r.arc(a.ID, a.Template, a.Scope)
		if len(l.regions) == 0 {
			for _, id := range a.Regions {
				if n, err := strconv.Atoi(strings.TrimPrefix(id, "r-")); err == nil {
					l.regions = append(l.regions, n)
				}
			}
		}
		for _, c := range a.Cast {
			if n, err := strconv.ParseInt(c.ID, 10, 64); err == nil && c.Kind == arc.Settlement && c.Name != "" {
				r.places[n] = c.Name
			}
		}
		if l.began == 0 {
			l.began = a.Began
		}
		at := a.Stage
		if a.Stages > 0 {
			at = min(at, a.Stages-1)
		}
		for int64(len(l.stages)) <= at {
			l.stages = append(l.stages, seasonStage{})
		}
		s := &l.stages[at]
		if s.due == 0 {
			s.due = a.Due
		}
		for _, sd := range a.Sides {
			o := sideOf(s, sd.ID)
			o.mark = max(o.mark, sd.Mark)
			o.units = max(o.units, sd.Filled)
			if int(sd.Backers) > len(o.backers) {
				o.backers = make([]string, sd.Backers)
			}
		}
		if a.Outcome == "" {
			continue
		}
		l.outcome = a.Outcome
		if s.won == "" && !s.lapsed {
			if a.Lapsed || a.Outcome == outcomeLapsed {
				s.lapsed = true
			} else {
				s.won = a.Outcome
			}
		}
	}
}

// arc is the run's record of an arc, made on first sight.
func (r *liveResult) arc(id, template, scope string) *seasonArc {
	if a, ok := r.arcs[id]; ok {
		return a
	}
	n, _ := strconv.ParseInt(strings.TrimPrefix(id, "arc-"), 10, 64)
	a := &seasonArc{n: n, id: id, template: template, scope: scope}
	r.arcs[id] = a
	return a
}

func sideOf(s *seasonStage, side string) *seasonSide {
	for i := range s.sides {
		if s.sides[i].side == side {
			return &s.sides[i]
		}
	}
	s.sides = append(s.sides, seasonSide{side: side})
	return &s.sides[len(s.sides)-1]
}

func datumOK(f api.Fact, key string) (api.Datum, bool) {
	for _, d := range f.Data {
		if d.Key == key {
			return d, true
		}
	}
	return api.Datum{}, false
}

func datum(f api.Fact, key string) api.Datum {
	d, _ := datumOK(f, key)
	return d
}

func simFact(f api.Fact) fact.Fact {
	out := fact.Fact{ID: fact.ID(f.ID), Tick: f.Tick, Kind: f.Kind, Region: f.Region, Weight: f.Weight}
	for _, d := range f.Data {
		out.Data = append(out.Data, fact.Datum{Key: d.Key, N: d.N, S: d.S})
	}
	return out
}

// liveClient is the world over HTTP, counting the sides players were
// offered and the backs they sent, and keeping when each character's long
// action ends.
type liveClient struct {
	*client.HTTP
	res  *seasonResult
	busy map[string]int64
}

func (c *liveClient) Options(ctx context.Context, id string) (api.Options, error) {
	o, err := c.HTTP.Options(ctx, id)
	if err != nil {
		return o, err
	}
	if len(o.Sides) > 0 {
		c.res.offered++
	}
	delete(c.busy, id)
	if o.Long != nil && o.Fight == nil {
		c.busy[id] = o.Long.Ends
	}
	return o, nil
}

func (c *liveClient) Act(ctx context.Context, req api.ActionRequest) (api.ActionReply, *api.Refusal, error) {
	rep, ref, err := c.HTTP.Act(ctx, req)
	if req.Kind == api.ActBackSide && err == nil {
		c.res.backs++
		c.res.backRefused += btoi(ref != nil)
	}
	return rep, ref, err
}

// liveDue is who plays at world tick t, rel ticks into the run: the
// headless run's arrivals and hours, less a character whose long action
// runs on.
func liveDue(c *liveClient, players []*agent.Player, rel, t int64, due []*agent.Player) []*agent.Player {
	for i, p := range players {
		if rel < int64(i)*sheets.TicksPerDay/int64(len(players)) {
			continue
		}
		if (rel+int64(i))%workPeriod != 0 || (rel+int64(i)*wakeSpread)%sheets.TicksPerDay >= awake {
			continue
		}
		if e, ok := p.Policy.(*agent.Earner); ok && e.Role == agent.Casual && (rel+int64(i)*casualSpread)%casualEvery >= casualSession {
			continue
		}
		if p.Character != "" && c.busy[p.Character] > t {
			continue
		}
		due = append(due, p)
	}
	return due
}

// liveReading is the season-zero row on the live world: the headless
// row's rule on one world, which no second run can repeat.
func liveReading(r liveResult) Measured {
	v := fmt.Sprintf("live, ticks %d to %d: %d stages decided by players, %d lapsed, the finale %s, the close %s, the ledger %s",
		r.start, r.end, r.decided(), r.lapsed(), either(r.finale, "written", "**not written**"), either(r.closed, "written", "**not written**"),
		either(len(r.audit) == 0, "clean", "**not clean**"))
	return Measured{Target: "season-zero", Value: v, Holds: r.holds()}
}

// liveDoc is the live run's report.
func liveDoc(b *sheets.Book, base string, r liveResult, m Measured) *lineDoc {
	var doc lineDoc
	p := doc.p
	p("# Season run, live")
	p("")
	p("Season zero on the live world at %s (GDD 12.6): %d scripted players (`harness/agent.Earner`: %s) from one server, whose guild plays the Economy run's plan and who back the sides they can serve, over the service's HTTP API. They join over the first world day and take one turn per service tick until the world writes `season.closed` (season 0 is %d world days). Arcs and sides are read from `GET %s` after each turn, stage outcomes from `GET %s`.",
		base, seasonPlayers, roleList(), sheets.IntParam(b.StoryParams, "season-zero-days"), api.PathOperatorStory, api.PathStoryEvents)
	p("")
	p("A stage is decided by players when a side won with its mark met by %d or more distinct characters. The row holds when the world has such a stage and a stage that lapsed, writes `season.finale` and `season.closed`, and keeps the ledger clean. One world cannot be played twice, so the live row has no repeat.", decidedBackers)
	p("")
	p("**season-zero:** %s. Holds: %s.", m.Value, holds(m.Holds))
	p("")
	p("Ticks %d to %d in %s; %d ticks ran while the players were a tick behind; %d turns failed in transport. Finale: %s. Close: %s; the clock after is %s.",
		r.start, r.end, r.elapsed.Round(time.Second), r.lagged, r.failed, finaleCell(r.seasonResult),
		either(r.closed, fmt.Sprintf("`season.closed` at tick %d (world day %d)", r.closedTick, r.closedTick/sheets.TicksPerDay), "**not written**"), clockCell(r.clock))
	p("")
	p("Backing: sides listed in %d option reads; %d `goal-back` presses, %d refused. Actions %d, refused %d.", r.offered, r.backs, r.backRefused, r.actions, r.refuse)
	p("")
	if !r.holds() {
		p("Does not hold: %s.", r.why())
		p("")
	}
	if len(r.seasonResult.arcs) == 0 {
		p("No arc was cast.")
		p("")
	} else {
		p("| Arc | Template | Scope | Regions | By | Stage | Due (day) | Outcome | Sides: units / mark, backers | Decided by players |")
		p("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
		for _, a := range r.seasonResult.arcs {
			for i, s := range a.stages {
				p("| %s | %s | %s | %s | %s | %d | %d | %s | %s | %s |", a.id, a.template, a.scope, regionList(a.regions), a.by, i+1, s.due/sheets.TicksPerDay,
					stageOutcome(s), liveSides(s), either(s.decided(), "yes", "no"))
			}
		}
		p("")
	}
	if len(r.seasonResult.troubles) > 0 {
		p("| Place | Troubles held | Troubles lost |")
		p("| --- | --- | --- |")
		for _, pl := range r.seasonResult.troubles {
			p("| %s | %d | %d |", pl.name, pl.held, pl.lost)
		}
		p("")
	}
	p("Ledger: %s. Digest %s.", auditCell(r.audit), r.digest)
	for _, a := range r.audit {
		p("- %s", a)
	}
	return &doc
}

// liveSides is a stage's sides as the view showed them; the view counts
// backers but does not name them, nor those who only declared.
func liveSides(s seasonStage) string {
	var out []string
	for _, sd := range s.sides {
		out = append(out, fmt.Sprintf("%s: %d / %d, %d", sd.side, sd.units, sd.mark, len(sd.backers)))
	}
	return strings.Join(out, "; ")
}
