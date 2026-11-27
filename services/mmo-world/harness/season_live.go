package harness

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
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
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/season"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
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
	LiveOptions
}

// LiveOptions are what a live season adds to season zero's one server:
// the players split across Servers servers (live-a, live-b, ...), each with
// an admin who saves its house's channels, and play kept up for On world
// days after the close, into season one.
type LiveOptions struct {
	Servers int
	On      int64
}

// structural: the live servers' names and the house settings their
// keepers save: Discord-shaped channel and role ids, one block a server.
const (
	liveServerPrefix = "live-"
	liveChannelID    = "9%02d00000000000000%d"
	liveKeeper       = "keeper"
)

// SeasonLive plays season zero on a live world over HTTP (GDD 12.6): the
// same scripted players as the headless run, one turn per service tick,
// until the world writes season.closed, and on into the next season for
// o.On world days. It reads the outcome from the operator's story view and
// the events, and applies the season-zero reading to the one world.
func SeasonLive(b *sheets.Book, base, out string, o LiveOptions) ([]Measured, error) {
	if base == "" {
		return nil, errors.New("season -live needs the world's URL")
	}
	op := client.New(base, service.TokenFromEnv(service.EnvOperatorToken))
	w := liveSeason{api: client.New(base, service.TokenFromEnv(service.EnvAPIToken)), op: op, pace: waitTick(op), LiveOptions: o}
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
	if err := writeJSON(filepath.Join(out, "season-live.json"), r.summary()); err != nil {
		return nil, err
	}
	return []Measured{m}, nil
}

// liveServers are the servers a live season's players come from: run
// alone, or live-a, live-b, ... for two or more.
func liveServers(run string, n int) []string {
	if n < 2 {
		return []string{run}
	}
	out := make([]string, n)
	for i := range out {
		out[i] = liveServerPrefix + string(rune('a'+i))
	}
	return out
}

// liveRoster is the season's players split across servers in turn, each
// server's first players its admins, and with two or more servers an
// admin a server who saves its house's channels once.
func liveRoster(b *sheets.Book, run string, servers []string) []*agent.Player {
	players := seasonRoster(b, servers[0])
	for _, p := range players {
		p.Discord = run + "-" + p.Discord
	}
	if len(servers) < 2 {
		return players
	}
	admins := map[string]int{}
	for i, p := range players {
		p.Server = servers[i%len(servers)]
		p.Admin = admins[p.Server] < economyAdmins
		admins[p.Server]++
	}
	for k, server := range servers {
		players = append(players, &agent.Player{Discord: run + "-" + liveKeeper + "-" + server, Start: "hook", Server: server, Admin: true,
			Policy: &agent.HouseKeeper{Settings: api.HouseSettings{
				Channels:   []api.Channel{{Kind: "chronicle", ID: fmt.Sprintf(liveChannelID, k+1, 1)}, {Kind: "events", ID: fmt.Sprintf(liveChannelID, k+1, 2)}},
				StaffRoles: []string{fmt.Sprintf(liveChannelID, k+1, 3)},
			}}})
	}
	return players
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
	began      map[int64]int64 // season → the tick its season.began was written
	epochs     []liveEpoch
	houses     []liveHouse
	on         int64 // world days played after the close
}

// liveEpoch is a season.epoch as the promotions route served it.
type liveEpoch struct {
	Tick   int64  `json:"tick"`
	Season int64  `json:"season"`
	From   string `json:"from"`
	To     string `json:"to"`
	Sheets int64  `json:"sheets"`
	Seen   int    `json:"seen"`
	Unseen int64  `json:"unseen"`
}

// liveHouse is a server's house at the run's end.
type liveHouse struct {
	Server      string `json:"server"`
	Guild       string `json:"guild"`
	Arrival     int    `json:"arrival"`
	Settlements int    `json:"settlements"`
	Channels    int    `json:"channels"`
	Players     int    `json:"players"`
}

// liveSummary is the run's end as a script reads it.
type liveSummary struct {
	Start      int64           `json:"start"`
	End        int64           `json:"end"`
	Closed     bool            `json:"closed"`
	ClosedTick int64           `json:"closedTick"`
	On         int64           `json:"on"`
	Began      map[int64]int64 `json:"began"`
	Epochs     []liveEpoch     `json:"epochs"`
	Houses     []liveHouse     `json:"houses"`
	Audit      []string        `json:"audit"`
	Digest     string          `json:"digest"`
	Holds      bool            `json:"holds"`
}

func (r *liveResult) summary() liveSummary {
	return liveSummary{Start: r.start, End: r.end, Closed: r.closed, ClosedTick: r.closedTick, On: r.on, Began: r.began,
		Epochs: append([]liveEpoch{}, r.epochs...), Houses: append([]liveHouse{}, r.houses...), Audit: append([]string{}, r.audit...), Digest: r.digest, Holds: r.holds()}
}

// playLive plays season zero on w from where the world stands.
func playLive(ctx context.Context, b *sheets.Book, w liveSeason) (liveResult, error) {
	begin := time.Now()
	res := liveResult{arcs: map[string]*seasonArc{}, hunts: map[string]bool{}, places: map[int64]string{}, troubles: map[int64]*seasonPlace{},
		began: map[int64]int64{}, on: w.On}
	hl, err := w.api.Health(ctx)
	if err != nil {
		return res, err
	}
	view, err := w.op.OperatorStory(ctx)
	if err != nil {
		return res, err
	}
	if view.Season.N != 0 {
		return res, fmt.Errorf("the world is in season %d: season zero is played on a fresh world (op reset)", view.Season.N)
	}
	res.start, res.seed = hl.Tick, "live"
	run := fmt.Sprintf("season-live-%d", hl.Tick)
	lc := &liveClient{counting: counting{w.api, &res.seasonResult}, busy: map[string]int64{}}
	servers := liveServers(run, w.Servers)
	players := liveRoster(b, run, servers)
	script := agent.NewScript(lc, players, run)
	var last int64
	var playing []*agent.Player
	// turn is one tick's play: the events so far, the turns of the players
	// due, and the story view once they have acted, before the next tick
	// can end a stage they filled.
	turn := func(t int64) error {
		var err error
		if last, err = res.events(ctx, w.api, last); err != nil {
			return err
		}
		playing = liveDue(lc, players, t-res.start, t, playing[:0])
		if err := script.TurnFor(ctx, t, playing); err != nil {
			return err
		}
		if view, err = w.op.OperatorStory(ctx); err != nil {
			return err
		}
		res.observe(view)
		return nil
	}
	until := view.Season.Ends + sheets.TicksPerDay + w.On*sheets.TicksPerDay
	going := func(t int64) bool { return !res.closed || t <= res.closedTick+w.On*sheets.TicksPerDay }
	failures := 0
	for t := hl.Tick; going(t) && t <= until && (w.limit <= 0 || t < res.start+w.limit); t++ {
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
	if err := res.promotions(ctx, w.api); err != nil {
		return res, err
	}
	if err := res.readHouses(ctx, w.api, servers, players); err != nil {
		return res, err
	}
	return res, res.finish(ctx, w, players, begin)
}

// promotions reads the season.epoch facts the promotions route served,
// with their notes.
func (r *liveResult) promotions(ctx context.Context, c *client.HTTP) error {
	after := int64(0)
	for {
		page, err := c.StoryPromotions(ctx, after)
		if err != nil {
			return err
		}
		for _, e := range page.Events {
			if e.Fact.Kind != game.FactSeasonEpoch {
				continue
			}
			ep := liveEpoch{Tick: e.Fact.Tick, Season: datum(e.Fact, "season").N, From: datum(e.Fact, "from").S, To: datum(e.Fact, "to").S, Sheets: datum(e.Fact, "sheets").N}
			if n := e.Epoch; n != nil {
				ep.Season, ep.Seen, ep.Unseen = n.Season, len(n.Seen), n.Unseen
			}
			r.epochs = append(r.epochs, ep)
		}
		if page.Last <= after {
			return nil
		}
		after = page.Last
	}
}

// readHouses reads each server's house: its guild, where it arrived and
// the channels its admin saved.
func (r *liveResult) readHouses(ctx context.Context, c *client.HTTP, servers []string, players []*agent.Player) error {
	for _, server := range servers {
		h, err := c.House(ctx, server, "", "")
		if err != nil {
			return fmt.Errorf("the house of %s: %w", server, err)
		}
		lh := liveHouse{Server: server, Guild: h.Guild, Arrival: h.Arrival, Settlements: len(h.Settlements), Channels: len(h.Settings.Channels)}
		for _, p := range players {
			if p.Server == server && p.Character != "" {
				lh.Players++
			}
		}
		r.houses = append(r.houses, lh)
	}
	return nil
}

// finish reads the world's state at the run's end into the result.
func (r *liveResult) finish(ctx context.Context, w liveSeason, players []*agent.Player, begin time.Time) error {
	view, err := w.op.OperatorStory(ctx)
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

// events reads the story's events after a fact id and returns the last id
// read.
func (r *liveResult) events(ctx context.Context, c *client.HTTP, after int64) (int64, error) {
	for {
		page, err := c.StoryEvents(ctx, after)
		if err != nil {
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
	if f.Kind == game.FactSeasonBegan {
		if n := datum(f, "season").N; !hasKey(r.began, n) {
			r.began[n] = f.Tick
		}
	}
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
		if stageLapsed(sf) {
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
		if pl, ok := f.Get("settlement"); ok {
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
// marks, units and contributors, which only grow while the stage runs. A
// backer who only declared does not count toward a stage decided by
// players.
func (r *liveResult) observe(v api.StoryView) {
	for _, a := range v.Arcs {
		l := r.arc(a.ID, a.Template, a.Scope)
		if len(l.regions) == 0 {
			for _, id := range a.Regions {
				if n, ok := world.ParseRegionRef(id); ok {
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
			if int(sd.Contributors) > len(o.backers) {
				o.backers = make([]string, sd.Contributors)
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
	a := &seasonArc{n: arcNumber(id), id: id, template: template, scope: scope}
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

func datum(f api.Fact, key string) api.Datum {
	d, _ := f.Get(key)
	return d
}

// simFact is f as a sim fact, its data sorted by key as Get's search needs.
func simFact(f api.Fact) fact.Fact {
	out := fact.Fact{ID: fact.ID(f.ID), Tick: f.Tick, Kind: f.Kind, Region: f.Region, Weight: f.Weight}
	for _, d := range f.Data {
		out.Data = append(out.Data, fact.Datum{Key: d.Key, N: d.N, S: d.S})
	}
	slices.SortStableFunc(out.Data, func(a, b fact.Datum) int { return strings.Compare(a.Key, b.Key) })
	return out
}

// liveClient is the world over HTTP, counted, keeping when each
// character's long action ends.
type liveClient struct {
	counting
	busy map[string]int64
}

func (c *liveClient) Options(ctx context.Context, id string) (api.Options, error) {
	o, err := c.counting.Options(ctx, id)
	if err != nil {
		return o, err
	}
	delete(c.busy, id)
	if o.Long != nil && o.Fight == nil {
		c.busy[id] = o.Long.Ends
	}
	return o, nil
}

// liveDue is who plays at world tick t, rel ticks into the run: the
// headless run's arrivals and hours, less a character whose long action
// runs on.
func liveDue(c *liveClient, players []*agent.Player, rel, t int64, out []*agent.Player) []*agent.Player {
	busy := func(p *agent.Player) bool { return p.Character != "" && c.busy[p.Character] > t }
	for i, p := range players {
		if joined(i, rel, len(players)) && due(i, rel, p, busy) {
			out = append(out, p)
		}
	}
	return out
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
		base, seasonPlayers, roleList(), arc.ParamsOf(b).SeasonZeroDays, api.PathOperatorStory, api.PathStoryEvents)
	p("")
	seasonRule(p, m, false)
	lead := fmt.Sprintf("Ticks %d to %d in %s; %d ticks ran while the players were a tick behind; %d turns failed in transport. ",
		r.start, r.end, r.elapsed.Round(time.Second), r.lagged, r.failed)
	seasonBody(p, r.seasonResult, lead, fmt.Sprintf(" Actions %d, refused %d.", r.actions, r.refuse), "Sides: units / mark, backers", liveSides)
	liveAfter(p, r)
	return &doc
}

// liveAfter is what the run saw beyond season zero's reading: the servers'
// houses, the seasons begun, the rules epochs taken and the play after
// the close.
func liveAfter(p func(string, ...any), r liveResult) {
	if len(r.houses) > 1 {
		p("")
		p("## Servers")
		p("")
		p("| Server | Guild | Arrived at settlement | Settlements | Channels saved | Characters |")
		p("| --- | --- | --- | --- | --- | --- |")
		for _, h := range r.houses {
			p("| %s | %s | %d | %d | %d | %d |", h.Server, orDash(h.Guild), h.Arrival, h.Settlements, h.Channels, h.Players)
		}
	}
	p("")
	p("## After the close")
	p("")
	if r.on > 0 {
		p("The players kept playing for %d world days after season zero's close%s.", r.on, either(r.closed, fmt.Sprintf(" (tick %d), to tick %d", r.closedTick, r.end), ", which never came"))
	} else {
		p("The run ended at season zero's close.")
	}
	for _, n := range slices.Sorted(maps.Keys(r.began)) {
		p("- `season.began` for season %d at tick %d.", n, r.began[n])
	}
	for _, e := range r.epochs {
		p("- `season.epoch` at tick %d for season %d: book `%s` to `%s`, %d sheets changed, %d notes seen, %d unseen.", e.Tick, e.Season, shortID(e.From), shortID(e.To), e.Sheets, e.Seen, e.Unseen)
	}
	if len(r.epochs) == 0 {
		p("- No rules epoch was taken.")
	}
}

func hasKey[K comparable, V any](m map[K]V, k K) bool {
	_, ok := m[k]
	return ok
}

// liveSides is a stage's sides as the view showed them; the view counts
// the characters who put units in but does not name them.
func liveSides(s seasonStage) string {
	var out []string
	for _, sd := range s.sides {
		out = append(out, fmt.Sprintf("%s: %d / %d, %d", sd.side, sd.units, sd.mark, len(sd.backers)))
	}
	return strings.Join(out, "; ")
}
