package game

import (
	"cmp"
	"fmt"
	"slices"
	"strings"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// Emergence (GDD 13): traces are counted where their signal is made, a
// trace that crosses its line is promoted into a named record with a fact
// of its own, and what each promotion does is registered by the files that
// build it. Nothing here reads the fact log back.

// Facts emergence's core writes and reads.
const (
	factPromotion        = "promotion"
	factEmergenceStarted = "emergence.started"
	factSeasonAdded      = "season.added"
	factKindDiscovered   = "kind.discovered"
)

// structural: how a fact names a promotion, and the ref kinds renown is
// counted on (GDD 13.1: an item, a notable, a character).
const (
	refPromotion    = "promotion"
	renownItem      = "item"
	renownNotable   = "notable"
	renownCharacter = "character"
)

// structural: the kinds of a pin's facts, which no trace reads (GDD 14.5).
const pinKinds = "pin."

// Data a promotion's fact may carry that its name is built from.
const (
	datumRow    = "row"
	datumVerb   = "verb"
	datumOfName = "of-name"
)

func promotionRef(id string) fact.Ref { return fact.Ref{Kind: refPromotion, ID: id} }

// emergeOn reports whether the world keeps emergence.
func (g *Game) emergeOn() bool { return g.Emergence != nil }

// traceAt is the world day of a tick and the season stamp traces are
// written with, which the season's close moves on.
func (g *Game) traceAt(t int64) (day, season int64) {
	return t / sheets.TicksPerDay, g.Emergence.Season
}

// traced reports whether play here may feed a trace: emergence is on, the
// command in hand is not staged, and neither h nor the character's tile
// holds placed content (GDD 14.5).
func (g *Game) traced(c *Char, h hex.Hex) bool {
	if g.Emergence == nil || g.stagedBy != nil {
		return false
	}
	if g.Placed(h) != nil {
		return false
	}
	return c == nil || c.C.At == h || g.Placed(c.C.At) == nil
}

// emergenceStart gives a world saved before emergence its state, stamped
// with today's season.
func (g *Game) emergenceStart(Command) error {
	if g.Emergence != nil {
		return refuse(BadArgs, "emergence has already started")
	}
	day := g.Tick() / sheets.TicksPerDay
	g.Emergence = emerge.New(day, g.season())
	g.wireEmergence()
	_, err := g.regionFact("", factEmergenceStarted, nil, nil, fact.N("day", day))
	return err
}

// wireEmergence binds the found materials into the item, price and tag
// rules and marks the log's facts as they are written, or unbinds both
// for a world without emergence, so rules shared with another world read
// only the sheets.
func (g *Game) wireEmergence() {
	r := g.r
	if g.Emergence == nil {
		g.foundReg = nil
		r.Fight.D.Found, r.Values.Found = nil, nil
		if g.Log != nil {
			g.Log.Stage = nil
		}
		return
	}
	g.foundReg = &item.Found{}
	for _, m := range g.Emergence.Materials {
		g.registerFound(m)
	}
	r.Fight.D.Found, r.Values.Found = g.foundReg, g.foundReg
	g.Log.Stage = g.stage
}

// emergeHook is what one promotion type, or one feature, does. The files
// that build them register in init(); every hook runs in (Order, Name)
// order so a replay applies them alike.
type emergeHook struct {
	Name  string
	Order int
	// Kinds are the fact kinds Fact sees, once each, after the core's
	// counts.
	Kinds []string
	Fact  func(g *Game, f fact.Fact) error
	// Instead may take a crossed line over before it is promoted (a road
	// tile joining a road): true and nothing is promoted.
	Instead map[emerge.Type]func(g *Game, p *Promoting) (bool, error)
	// Promote runs once a promotion is recorded and its fact written. A
	// hook that promotes again re-reads its record by id.
	Promote map[emerge.Type]func(g *Game, p *emerge.Promotion) error
	// Renown sees a subject once a heavy fact has counted on it.
	Renown func(g *Game, s *emerge.Subject, f fact.Fact) error
	Day    func(g *Game, day, t int64) error
	Close  func(g *Game, day int64) error
	Begin  func(g *Game, day int64) error
	// Holds are the ledger balances its records hold, for the audit.
	Holds func(g *Game) []ledger.Balance
}

var (
	emergeHooks []emergeHook
	// emergeKinds are the hooks' indexes by the fact kind they see.
	emergeKinds = map[string][]int{}
)

func registerEmerge(h emergeHook) {
	if h.Name == "" || slices.ContainsFunc(emergeHooks, func(x emergeHook) bool { return x.Name == h.Name }) {
		panic(fmt.Sprintf("emergence hook %q registered twice or unnamed", h.Name))
	}
	emergeHooks = append(emergeHooks, h)
	slices.SortStableFunc(emergeHooks, func(a, b emergeHook) int {
		return cmp.Or(cmp.Compare(a.Order, b.Order), strings.Compare(a.Name, b.Name))
	})
	emergeKinds = map[string][]int{}
	for i, x := range emergeHooks {
		if x.Fact == nil {
			continue
		}
		for _, k := range slices.Compact(slices.Sorted(slices.Values(x.Kinds))) {
			emergeKinds[k] = append(emergeKinds[k], i)
		}
	}
}

// untraced reports whether no trace reads a fact kind.
func untraced(kind string) bool { return strings.HasPrefix(kind, pinKinds) || ThreadFact(kind) }

// traceNews counts a batch's facts toward the traces and measures, then
// counts what the hooks wrote while doing so, until they write nothing
// more. It returns the batch with those facts after it; the first error a
// hook gave waits in traceErr.
func (g *Game) traceNews(fs []fact.Fact) []fact.Fact {
	if g.Emergence == nil {
		return fs
	}
	defer clear(g.playerFacts)
	next := fact.ID(g.Log.Len())
	batch := fs
	var wrote []fact.Fact
	for len(batch) > 0 {
		if err := g.noteTraces(batch); err != nil && g.traceErr == nil {
			g.traceErr = err
		}
		batch = g.Log.Since(next)
		next = fact.ID(g.Log.Len())
		wrote = append(wrote, batch...)
	}
	if len(wrote) == 0 {
		return fs
	}
	g.World.Note(wrote...)
	return append(slices.Clip(fs), wrote...)
}

// takeTraceErr hands over the error a trace hook gave while news was kept,
// once.
func (g *Game) takeTraceErr() error {
	err := g.traceErr
	g.traceErr = nil
	return err
}

// noteTraces is the seam every fact passes once (GDD 13.1): renown on
// what a heavy fact names, the measures' counts, then the hooks that read
// the fact's kind. Staged facts, pins and threads count toward nothing.
func (g *Game) noteTraces(fs []fact.Fact) error {
	e := g.Emergence
	if e == nil {
		return nil
	}
	p := g.r.Emerge.P
	for _, f := range fs {
		if f.StagedBy != nil || untraced(f.Kind) {
			continue
		}
		day, season := g.traceAt(f.Tick)
		if f.Weight >= p.RenownWeight {
			e.Now.Heavy++
			if g.byPlayer(f) {
				e.Now.HeavyPlayer++
			}
			if err := g.renown(f, day, season); err != nil {
				return err
			}
		}
		if f.Kind == factKindDiscovered && len(e.Weeks) > 0 {
			e.Weeks[len(e.Weeks)-1].Kinds++
		}
		for _, i := range emergeKinds[f.Kind] {
			if err := emergeHooks[i].Fact(g, f); err != nil {
				return err
			}
		}
	}
	return nil
}

// renowned reports whether renown counts on a ref kind.
func renowned(kind string) bool {
	return kind == renownItem || kind == renownNotable || kind == renownCharacter
}

// renown counts a heavy fact on every item, notable and character it
// names, with the season's heavy count an item legend reads (GDD 13.2).
func (g *Game) renown(f fact.Fact, day, season int64) error {
	e := g.Emergence
	at, placed := g.World.FactAt(f)
	region, regional := world.ParseRegionRef(f.Region)
	for _, ref := range f.Subjects {
		if !renowned(ref.Kind) {
			continue
		}
		k := ref.String()
		s := e.Renown[k]
		if s == nil {
			s = &emerge.Subject{Ref: ref, Region: -1}
			e.Renown[k] = s
		}
		s.Count.Add(day, season, 1, g.r.Emerge.Decay[emerge.Renown])
		s.AddHeavy(season)
		if regional {
			s.Region = region
		}
		if placed {
			s.At = at
		}
		e.Touch(day, emerge.DueKey{Trace: emerge.Renown, Ref: k})
		for _, h := range emergeHooks {
			if h.Renown == nil {
				continue
			}
			if err := h.Renown(g, s, f); err != nil {
				return err
			}
		}
	}
	return nil
}

// Promoting is a line crossed: what the core records and names. Region is
// -1 for none. Name, when set, is used as given; Tick, when set, dates the
// promotion (a tick's long actions run before the clock moves), else the
// cause's tick or now.
type Promoting struct {
	Type   emerge.Type
	Region int
	At     *hex.Hex
	Places []int
	Of     string
	First  string
	Cause  fact.ID
	Data   []fact.Datum
	Name   string
	Tick   int64
}

// promoteTrace records a crossed line (GDD 13.2): an id, a name, the promotion
// fact, the season's count, then what its type does. A hook may take the
// line over first, and then nothing is promoted.
func (g *Game) promoteTrace(p Promoting) (*emerge.Promotion, error) {
	e := g.Emergence
	if e == nil {
		return nil, nil
	}
	for _, h := range emergeHooks {
		if f := h.Instead[p.Type]; f != nil {
			done, err := f(g, &p)
			if err != nil || done {
				return nil, err
			}
		}
	}
	if p.Region < 0 && p.At != nil {
		p.Region = g.World.RegionAt(*p.At)
	}
	tick := g.Tick()
	if f, ok := g.Log.Get(p.Cause); ok && p.Cause != 0 {
		tick = max(tick, f.Tick)
	}
	if p.Tick != 0 {
		tick = p.Tick
	}
	id := e.NewID(p.Type)
	name := p.Name
	if name == "" {
		name = g.promotionName(p, id)
	}
	data := []fact.Datum{fact.S("type", string(p.Type)), fact.S("id", id), fact.S("name", name)}
	if p.Of != "" {
		data = append(data, fact.S("of", p.Of))
	}
	if p.At != nil {
		data = append(data, fact.At(*p.At)...)
	}
	for _, d := range p.Data {
		if !slices.ContainsFunc(data, func(x fact.Datum) bool { return x.Key == d.Key }) {
			data = append(data, d)
		}
	}
	subjects := []fact.Ref{promotionRef(id)}
	if p.First != "" {
		subjects = append(subjects, char.Ref(p.First))
	}
	var causes []fact.ID
	if p.Cause != 0 {
		causes = []fact.ID{p.Cause}
	}
	region := ""
	if p.Region >= 0 {
		region = world.RegionRef(p.Region)
	}
	f, err := g.r.weights.New(tick, factPromotion, region, subjects, causes, data...)
	if err != nil {
		return nil, err
	}
	fid, err := g.Log.Append(f)
	if err != nil {
		return nil, err
	}
	var at *hex.Hex
	if p.At != nil {
		h := *p.At
		at = &h
	}
	e.Promotions = append(e.Promotions, emerge.Promotion{ID: id, Type: p.Type, Name: name, First: p.First, Tick: tick,
		Season: e.Season, Region: p.Region, At: at, Places: slices.Clone(p.Places), Of: p.Of, Fact: fid})
	e.Now.Promotions[p.Type]++
	for _, h := range emergeHooks {
		if f := h.Promote[p.Type]; f != nil {
			if err := f(g, e.Promotion(id)); err != nil {
				return nil, err
			}
		}
	}
	return e.Promotion(id), nil
}

// datumOf is a string datum among a promotion's data.
func datumOf(data []fact.Datum, key string) string {
	for _, d := range data {
		if d.Key == key {
			return d.S
		}
	}
	return ""
}

// structural: how the core names what the GDD's name builders do not.
const (
	theName     = "the "
	nameSpace   = " "
	mastersWord = " masters"
)

// promotionName is a promotion's name from what crossed its line, through
// the emerge builders and emergence.name draws keyed by its id.
func (g *Game) promotionName(p Promoting, id string) string {
	n, d := g.r.emergeNames, g.r.draw
	nameOr := func(ref, fallback string) string {
		if s := g.r.Name(ref); s != "" {
			return s
		}
		return fallback
	}
	switch p.Type {
	case emerge.Road:
		return emerge.RoadName(n, d, g.nearPlaceName(p), id)
	case emerge.Camp, emerge.Haunt:
		site := g.nearPlaceName(p)
		if p.At != nil {
			site = g.placeName(*p.At)
		}
		return emerge.SiteName(n, d, p.Type, site, id)
	case emerge.Route:
		if len(p.Places) > 1 {
			return emerge.RouteName(g.settlementName(p.Places[0]), g.settlementName(p.Places[1]))
		}
	case emerge.Style:
		lead := ""
		if st := g.Emergence.Styles[emerge.StyleKey{Region: p.Region, Style: p.Of}]; st != nil {
			lead = st.Lead
		}
		keystone, _ := g.r.Emerge.Styles.Keystone(p.Of)
		return emerge.StyleName(n, p.Of, lead, keystone)
	case emerge.Variant:
		return emerge.VariantName(n, datumOf(p.Data, datumRow), p.Of)
	case emerge.Material:
		if row, base, ok := g.foundParts(p.Of); ok {
			return emerge.MaterialName(n, row, base)
		}
	case emerge.Legend:
		of := datumOf(p.Data, datumOfName)
		if of == "" {
			kind, ref, _ := strings.Cut(p.Of, ":")
			of = ref
			if kind == kindCreature {
				of = nameOr("creatures.archetypes:"+ref, ref)
			}
		}
		return emerge.LegendName(n, d, of, id)
	case emerge.Custom:
		place := g.nearPlaceName(p)
		return emerge.CustomName(place, datumOf(p.Data, datumVerb), n)
	case emerge.Class:
		return nameOr("classes.classes:"+p.Of, p.Of)
	case emerge.Masters:
		return theName + g.nearPlaceName(p) + nameSpace + nameOr("puzzles.families:"+p.Of, p.Of) + mastersWord
	}
	return id
}

// structural: a legend's creature ref kind.
const kindCreature = "creature"

// settlementName is an open settlement's name by index.
func (g *Game) settlementName(n int) string {
	if n < 0 || n >= len(g.Places) {
		return ""
	}
	return g.placeName(g.Places[n].Hex)
}

// nearPlaceName is the name of a promotion's first place, else of the open
// settlement nearest its tile, else of its tile, else of its region.
func (g *Game) nearPlaceName(p Promoting) string {
	if len(p.Places) > 0 {
		return g.settlementName(p.Places[0])
	}
	if p.At == nil {
		if p.Region >= 0 {
			if p.Region < len(g.World.Regions) {
				return g.placeName(g.regionHex(p.Region))
			}
		}
		return ""
	}
	if n, ok := g.nearestOpen(*p.At); ok {
		return g.settlementName(n)
	}
	return g.placeName(*p.At)
}

// foundParts are the adaptation row and base material a found id names.
func (g *Game) foundParts(id string) (string, sheets.Material, bool) {
	row, base, ok := emerge.ParseMaterialID(id)
	if !ok {
		return "", sheets.Material{}, false
	}
	m, ok := sheets.Lookup(g.r.Book.Materials)[base]
	if !ok {
		return "", sheets.Material{}, false
	}
	return row, *m, true
}

// emergenceDay is the traces' day turn: the keys untouched for keep-days
// are let go, the measures' week rolls, then each hook's day in order.
func (g *Game) emergenceDay(t int64) error {
	e := g.Emergence
	if e == nil {
		return nil
	}
	if err := g.takeTraceErr(); err != nil {
		return err
	}
	day := t / sheets.TicksPerDay
	p := g.r.Emerge.P
	for _, k := range e.Expired(day, p.KeepDays) {
		g.expireKey(k, day)
	}
	g.rollWeek(day)
	for _, h := range emergeHooks {
		if h.Day == nil {
			continue
		}
		if err := h.Day(g, day, t); err != nil {
			return err
		}
	}
	return nil
}

// stale reports whether a trace last written on day in season has gone
// keep-days untouched, or belongs to an earlier season and so reads 0.
func (g *Game) stale(last, season, day int64) bool {
	return last <= day-g.r.Emerge.P.KeepDays || season != g.Emergence.Season
}

// expireKey lets a trace go if nothing touched it since its bucket and it
// was never promoted. An item's renown is kept through the season its
// heavy facts count in, since an item legend reads the whole season.
func (g *Game) expireKey(k emerge.DueKey, day int64) {
	e := g.Emergence
	spots := func(m emerge.Spots) {
		if s := m[*k.Hex]; s != nil && s.Done == "" && g.stale(max(s.Count.Day, s.Window.Last), s.Count.Season, day) {
			delete(m, *k.Hex)
		}
	}
	switch k.Trace {
	case emerge.Passage:
		if k.Hex != nil {
			spots(e.Passage)
		}
	case emerge.Clearing:
		if k.Hex != nil {
			spots(e.Clearing)
		}
	case emerge.Loss:
		if k.Hex != nil {
			spots(e.Loss)
		} else {
			g.expireRegion(k.Region, day)
		}
	case emerge.Haulage:
		if k.Pair != nil {
			if x := e.Pairs[*k.Pair]; x != nil && x.Done == "" && g.stale(max(x.Count.Day, x.Window.Last), x.Count.Season, day) {
				delete(e.Pairs, *k.Pair)
			}
		} else if x := e.RoadLoad[k.Region]; x != nil && g.stale(x.Window.Last, x.Window.Season, day) {
			delete(e.RoadLoad, k.Region)
		}
	case emerge.Reliance:
		if k.Style != nil {
			if x := e.Styles[*k.Style]; x != nil && x.Done == "" && g.stale(max(x.Count.Day, x.Today.Day), x.Count.Season, day) {
				delete(e.Styles, *k.Style)
			}
		} else {
			g.expireRegion(k.Region, day)
		}
	case emerge.Renown:
		x := e.Renown[k.Ref]
		switch {
		case x == nil || x.Done != "" || !g.stale(x.Count.Day, x.Count.Season, day):
		case x.Ref.Kind == renownItem && x.HeavyIn(e.Season) > 0:
			e.Touch(day, k)
		default:
			delete(e.Renown, k.Ref)
		}
	}
}

// expireRegion lets a region's tally go once both its wins and its downs
// are stale.
func (g *Game) expireRegion(r int, day int64) {
	e := g.Emergence
	x := e.Regions[r]
	if x == nil {
		return
	}
	last := max(x.Reliance.Day, x.Downs.Day, x.Today.Day)
	season := max(x.Reliance.Season, x.Downs.Season)
	if g.stale(last, season, day) {
		delete(e.Regions, r)
	}
}

// structural: GDD 13.5 measures new kinds a week.
const weekDays = 7

// rollWeek closes the measures' week once it has run a week, with the
// characters active at its end, and keeps the newest measure-weeks.
func (g *Game) rollWeek(day int64) {
	e := g.Emergence
	n := len(e.Weeks)
	if n == 0 {
		e.Weeks = []emerge.Week{{From: day}}
		return
	}
	if day-e.Weeks[n-1].From < weekDays {
		return
	}
	e.Weeks[n-1].Active = g.Active()
	e.Weeks = append(e.Weeks, emerge.Week{From: day})
	if over := len(e.Weeks) - int(g.r.Emerge.P.MeasureWeeks) - 1; over > 0 {
		e.Weeks = slices.Delete(e.Weeks, 0, over)
	}
}

// emergenceClose is the season's close for emergence (GDD 13.4), before
// season.closed: each hook's close (goal lines to legends, signatures to
// customs), the season's measures kept, then the stamp moves on so every
// trace that never reached a line reads 0, and the season's lines reset.
func (g *Game) emergenceClose(day int64) error {
	e := g.Emergence
	if e == nil {
		return nil
	}
	for _, h := range emergeHooks {
		if h.Close == nil {
			continue
		}
		if err := h.Close(g, day); err != nil {
			return err
		}
	}
	e.Now.Active = g.Active()
	e.Seasons = append(e.Seasons, e.Now)
	next := g.season() + 1
	e.Season = next
	e.Now = emerge.SeasonCount{Season: next, Promotions: map[emerge.Type]int64{}}
	e.Lines = map[string]*emerge.Line{}
	return nil
}

// added are the promotion types a player can use, which a new season shows
// (GDD 12.6).
var added = []emerge.Type{emerge.Style, emerge.Variant, emerge.Material, emerge.Class}

// emergenceBegin opens the season for emergence, after season.began:
// season.added counts and names what the last season promoted that a
// player can use, then each hook's begin.
func (g *Game) emergenceBegin(day int64, began fact.ID) error {
	e := g.Emergence
	if e == nil {
		return nil
	}
	last := e.Season - 1
	counts := map[emerge.Type]int64{}
	first := ""
	for i := len(e.Promotions) - 1; i >= 0 && e.Promotions[i].Season >= last; i-- {
		x := e.Promotions[i]
		if x.Season != last || !slices.Contains(added, x.Type) {
			continue
		}
		counts[x.Type]++
		first = x.Shown()
	}
	if first != "" {
		var causes []fact.ID
		if began != 0 {
			causes = []fact.ID{began}
		}
		if _, err := g.regionFact("", factSeasonAdded, nil, causes, fact.N("season", last), fact.N("styles", counts[emerge.Style]),
			fact.N("variants", counts[emerge.Variant]), fact.N("materials", counts[emerge.Material]),
			fact.N("classes", counts[emerge.Class]), fact.S("first", first)); err != nil {
			return err
		}
	}
	for _, h := range emergeHooks {
		if h.Begin == nil {
			continue
		}
		if err := h.Begin(g, day); err != nil {
			return err
		}
	}
	return nil
}
