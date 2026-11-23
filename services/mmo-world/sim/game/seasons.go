package game

import (
	"errors"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/season"
	"jams.team/mmo-world/sim/sheets"
)

// World-level season and arc commands, for operators alone (GDD 12.6, 14).
const (
	// SeasonStart gives a world saved before seasons its clock, continuing
	// the season its goals already count in. The service sends it once.
	SeasonStart = "season-start"
	// SeasonEpoch records a rules epoch taken at a season boundary: Epoch
	// carries both sheets digests and the count of sheets changed.
	SeasonEpoch = "season-epoch"
	// ArcCast casts a template with its cast bound by hand.
	ArcCast = "arc-cast"
)

// Season refusal codes.
const (
	SeasonRunning = "season-running"
	NotAtBoundary = "not-at-boundary"
	NoSeason      = "no-season"
)

// ArcCmd is an arc-cast's order: the template, its cast, and the seat
// (nil: the cast's seat settlement, else its first place).
type ArcCmd struct {
	Template string   `json:"template"`
	Cast     arc.Cast `json:"cast"`
	Seat     *hex.Hex `json:"seat,omitempty"`
}

// FactSeasonClosed is the fact a season's close writes.
const FactSeasonClosed = "season.closed"

// finaleDraw breaks a tie between the finale's highest pressures.
const finaleDraw draw.Purpose = "season.finale"

// Season is the running season, its day table, and whether there is one.
func (g *Game) Season() (season.Clock, season.Table, bool) {
	c, ok := g.clock()
	if !ok {
		return season.Clock{}, nil, false
	}
	return c, season.TableFor(g.r.Book.SeasonDays, c.Days, g.storyDays()), true
}

// clock is the season clock, if the world has one.
func (g *Game) clock() (season.Clock, bool) {
	if g.Story == nil || g.Story.Clock == nil {
		return season.Clock{}, false
	}
	return *g.Story.Clock, true
}

// storyDays is a season's length after season zero.
func (g *Game) storyDays() int64 { return g.r.Story.SeasonDays }

// seasonCloses reports whether a world day closes the season, and the
// number of the season it opens. Without a clock a season is the weather's.
func (g *Game) seasonCloses(day int64) (bool, int64) {
	if c, ok := g.clock(); ok {
		return c.Closes(day), c.N + 1
	}
	days := g.r.wp("season-days")
	return day%days == 0, day / days
}

// seasonOpen gives a new world season zero, starting on day 0.
func (g *Game) seasonOpen() {
	g.Story = &Story{Clock: &season.Clock{Days: g.r.Story.SeasonZeroDays}}
}

// seasonStart gives a world saved before seasons the clock of the season
// it is in by the weather's count, so its goals' season numbers hold.
func (g *Game) seasonStart(Command) error {
	if g.Story != nil {
		return refuse(SeasonRunning, "the world already keeps a season")
	}
	days := g.r.wp("season-days")
	n := g.World.Day / days
	g.Story = &Story{Clock: &season.Clock{N: n, Start: n * days, Days: days, Legacy: true}}
	return nil
}

// seasonEpoch records the rules epoch the service took after the tick
// that closed the season. Any later and the season has run on the old
// rules, so it is refused.
func (g *Game) seasonEpoch(cmd Command) error {
	c, ok := g.clock()
	if !ok {
		return refuse(NoSeason, "the world keeps no season")
	}
	if !c.Turned(g.Tick()) {
		return refuse(NotAtBoundary, "an epoch is taken only right after a season closes")
	}
	e := cmd.Epoch
	if e == nil || e.To == "" || e.From == "" || e.Sheets < 0 {
		return refuse(BadArgs, "an epoch names the sheets digests it runs from and to")
	}
	if c.Epoch == e.To {
		return refuse(BadArgs, "the season already runs on %s", e.To)
	}
	if _, err := g.regionFact("", "season.epoch", nil, nil, fact.N("season", c.N), fact.S("from", e.From), fact.S("to", e.To),
		fact.N("sheets", e.Sheets)); err != nil {
		return err
	}
	g.Story.Clock.Epoch = e.To
	return nil
}

// arcCast casts a template with its cast bound by hand.
func (g *Game) arcCast(cmd Command) error {
	if _, ok := g.clock(); !ok {
		return refuse(NoSeason, "the world keeps no season")
	}
	if cmd.Arc == nil || cmd.Arc.Template == "" {
		return refuse(BadArgs, "an arc-cast names a template")
	}
	cast := arc.Sorted(cmd.Arc.Cast)
	seat, ok := g.castSeat(cast, cmd.Arc.Seat)
	if !ok {
		return refuse(CastMisfit, "the cast names no place to seat the arc")
	}
	_, err := g.CastArc(cmd.Arc.Template, cast, seat, ByOperator, g.Tick())
	return err
}

// castSeat is where a hand-bound arc sits: the given tile, else the cast's
// seat settlement, else the first settlement, region or tile it binds.
func (g *Game) castSeat(cast arc.Cast, given *hex.Hex) (hex.Hex, bool) {
	if given != nil {
		return *given, true
	}
	if ref, ok := cast.Get(seatRole); ok {
		if h, ok := g.castRefHex(ref); ok {
			return h, true
		}
	}
	for _, b := range cast {
		if h, ok := g.castRefHex(b.Ref); ok {
			return h, true
		}
	}
	return hex.Hex{}, false
}

// castRefHex is the tile a cast ref stands for, if it names a place.
func (g *Game) castRefHex(ref fact.Ref) (hex.Hex, bool) {
	switch ref.Kind {
	case kindSettlement, kindRegion, kindTile:
		if n, ok := arc.RefIndex(ref); ok && n < 0 {
			return hex.Hex{}, false
		}
		return g.refHexOf(ref)
	}
	return hex.Hex{}, false
}

// structural: the cast role a template seats its arc at.
const seatRole = "seat"

// seasonDay is the season's world day: the close when the season's days
// are run, the band that starts today, the world arc's casting through
// the rising band, and the finale at the finale band's start.
func (g *Game) seasonDay(t int64) error {
	c, tb, ok := g.Season()
	if !ok {
		return nil
	}
	day := t / sheets.TicksPerDay
	if c.Closes(day) {
		if err := g.seasonClose(t); err != nil {
			return err
		}
		c, tb, _ = g.Season()
	}
	sd := c.Day(day)
	span := tb.At(sd)
	if span.From == sd {
		if _, err := g.regionFact("", "season.band", nil, nil, fact.N("season", c.N), fact.S("band", span.Band),
			fact.N("stage", int64(span.Stage)), fact.N("from", span.From), fact.N("to", span.To)); err != nil {
			return err
		}
	}
	switch {
	case sd == tb.FinaleFrom():
		before := fact.ID(g.Log.Len())
		// A world stage ends on its band's end, the day the next band casts,
		// so it ends before anything is cast in its slot.
		if err := g.stagesDue(arc.ScopeWorld, t); err != nil {
			return err
		}
		return g.castFinale(t, g.Log.Since(before))
	case span.Band == season.Rising:
		return g.castWorldArc(c, t)
	}
	return nil
}

// refusedIsNothing drops a refusal: a cast the rules turn down in a day
// turn leaves the day as it was.
func refusedIsNothing(err error) error {
	var r *Refused
	if errors.As(err, &r) {
		return nil
	}
	return err
}

// castWorldArc casts the season's world arc on a rising day while none has
// been: the opening first, then the eligible template whose cast presses
// hardest, a tie drawn under arc.cast. Every season has one: when no other
// template fits, or on the last day a whole arc still fits the bands, the
// waking tower is cast.
func (g *Game) castWorldArc(c season.Clock, t int64) error {
	from := c.Start * sheets.TicksPerDay
	for _, a := range g.Story.Arcs {
		if a.Scope == arc.ScopeWorld && (!a.over() || a.Began >= from) {
			return nil
		}
	}
	day := t / sheets.TicksPerDay
	w := g.storyView()
	type option struct {
		tpl  arc.Template
		cand arc.Candidate
	}
	var opts []option
	var ps []season.Pressure
	var fallback *option
	fits := false
	for _, tpl := range g.r.Templates {
		if tpl.Row.Scope != arc.ScopeWorld || tpl.Row.Arc == nil || tpl.Row.Arc.Finale {
			continue
		}
		cand, ok := arc.Pick(tpl.When(w, tpl.Row, g.r.Story), g.r.draw, tpl.Row.ID, arc.ScopeWorld, day)
		ring := tpl.Row.When == arc.RingWhen
		fits = fits || (ok && !ring)
		if !ok || !arc.Chance(g.r.draw, tpl.Row.ID, arc.ScopeWorld, day, tpl.Row.Chance) {
			continue
		}
		switch {
		case tpl.Row.When == openingWhen:
			_, err := g.castFrom(tpl, cand, ByOpening, t)
			return refusedIsNothing(err)
		case ring:
			fallback = &option{tpl, cand}
			continue
		}
		opts = append(opts, option{tpl, cand})
		ps = append(ps, season.Pressure{Kind: tpl.Row.ID, Score: cand.Pressure})
	}
	k, ok := season.LargestAt(ps, func(n int) int {
		return int(g.r.draw.Below(uint64(n), arc.CastDraw, draw.Str(arc.ScopeWorld), draw.Int(day), draw.Str(templatesPart)))
	})
	if ok {
		_, err := g.castFrom(opts[k].tpl, opts[k].cand, ByDirector, t)
		return refusedIsNothing(err)
	}
	// A template that fits but missed its chance is waited for while a
	// whole arc would still fit tomorrow.
	if fallback == nil || (fits && g.bandsLeft(fallback.tpl, t+sheets.TicksPerDay) == nil) {
		return nil
	}
	_, err := g.castFrom(fallback.tpl, fallback.cand, ByDirector, t)
	return refusedIsNothing(err)
}

// structural: tells the world templates' tie from any one template's draws.
const templatesPart = "templates"

// structural: the predicate of the opening, which jumps the world queue.
const openingWhen = "core-open"

// castFinale casts the finale from the largest unresolved pressure across
// the finale templates, due at the close; a tie is drawn under
// season.finale.
func (g *Game) castFinale(t int64, fresh []fact.Fact) error {
	day := t / sheets.TicksPerDay
	w := freshView{storyView: g.storyView()}
	for _, f := range fresh {
		w.fresh = append(w.fresh, g.memoryOf(f))
	}
	type option struct {
		tpl  arc.Template
		cand arc.Candidate
	}
	var opts []option
	var ps []season.Pressure
	for _, tpl := range g.r.Templates {
		if tpl.Row.Arc == nil || !tpl.Row.Arc.Finale {
			continue
		}
		for _, cand := range arc.Ordered(tpl.When(w, tpl.Row, g.r.Story)) {
			region := -1
			if len(cand.Regions) > 0 {
				region = cand.Regions[0]
			}
			var ref fact.Ref
			if len(cand.Cast) > 0 {
				ref = cand.Cast[0].Ref
			}
			opts = append(opts, option{tpl, cand})
			ps = append(ps, season.Pressure{Kind: tpl.Row.ID, Ref: ref, Region: region, Score: cand.Pressure})
		}
	}
	k, ok := season.LargestAt(ps, func(n int) int { return int(g.r.draw.Below(uint64(n), finaleDraw, draw.Int(day))) })
	if !ok {
		return nil
	}
	_, err := g.castFrom(opts[k].tpl, opts[k].cand, ByFinale, t)
	return refusedIsNothing(err)
}

// freshView is the story view with the facts written earlier in this day
// turn, which the memory ring takes in only when the tick ends: the world
// arc's last stage lapses on the finale's first day, and the finale reads
// that lapse.
type freshView struct {
	*storyView
	fresh []arc.Memory
}

func (v freshView) Recall(kind string, within int64) []arc.Memory {
	out := v.storyView.Recall(kind, within)
	for _, m := range v.fresh {
		if m.Kind == kind {
			out = append(out, m)
		}
	}
	return out
}

// seasonClose ends the season and begins the next. What is due on the close
// day (stages, ruins, cities' visitors) settles first, so it counts toward
// the closing season; goals and guild ranks turn over in their own day
// turns.
func (g *Game) seasonClose(t int64) error {
	c := *g.Story.Clock
	day := t / sheets.TicksPerDay
	if err := g.stagesDue("", t); err != nil {
		return err
	}
	if err := g.ruinsDay(t); err != nil {
		return err
	}
	g.keepDay()
	var finale *Arc
	for _, a := range g.Story.Arcs {
		if a.By == ByFinale && a.Began >= c.Start*sheets.TicksPerDay {
			finale = a
		}
	}
	for _, a := range g.openArcs(arc.ScopeWorld) {
		if err := g.closeArc(a, t); err != nil {
			return err
		}
	}
	data := []fact.Datum{fact.N("season", c.N)}
	var causes []fact.ID
	if finale != nil {
		data = append(data, fact.S("template", finale.Template), fact.S("outcome", finale.Outcome))
		causes = []fact.ID{finale.Fact}
	}
	if _, err := g.regionFact("", "season.finale", nil, causes, data...); err != nil {
		return err
	}
	for _, gd := range g.Guilds {
		gd.G.Votes = nil
	}
	if err := g.citiesClose(); err != nil {
		return err
	}
	if err := g.ringClose(); err != nil {
		return err
	}
	for i := range g.Story.At {
		g.Story.At[i].Lost = 0
	}
	if err := g.emergenceClose(day); err != nil {
		return err
	}
	closed, err := g.regionFact("", FactSeasonClosed, nil, nil, fact.N("season", c.N), fact.N("start", c.Start), fact.N("days", c.Days))
	if err != nil {
		return err
	}
	next := c.Next(day, g.storyDays())
	*g.Story.Clock = next
	began, err := g.regionFact("", "season.began", nil, []fact.ID{closed}, fact.N("season", next.N), fact.N("start", next.Start), fact.N("days", next.Days))
	if err != nil {
		return err
	}
	return g.emergenceBegin(day, began)
}
