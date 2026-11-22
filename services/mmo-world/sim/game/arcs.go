package game

import (
	"cmp"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/econ"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// The director (GDD 12): once a world day it ends the stages whose time is
// up and casts templates whose predicates find a cast, within each scope's
// pacing; every tick it ends a stage a side has met. A stage's sides are
// pooled Back goals whose escrow the sponsor's faction mints inside the
// day's faucet budget; the winner is paid by its goal, the others by
// contribution when the stage ends, and the rest goes back.

// Refusal codes of a hand-bound cast.
const (
	NoTemplate = "no-template"
	CastMisfit = "cast-misfit"
	SlotBusy   = "slot-busy"
)

// Who cast an arc.
const (
	ByDirector = "director"
	ByOperator = "operator"
	ByFinale   = "finale"
	ByOpening  = "opening"
	ByPattern  = "pattern"
	ByEffect   = "effect"
)

// Draws of the settlement scope and the spreading front, each its own.
const (
	troubleDraw   draw.Purpose = "trouble.start"
	occasionDraw  draw.Purpose = "occasion.start"
	structureDraw draw.Purpose = "trouble.structure"
	spreadDraw    draw.Purpose = "front.spread"
)

// structural: how arcs, sides and their goals are named, and the one
// side a trouble has.
const (
	arcPrefix     = "arc-"
	sidePart      = "/"
	refList       = ","
	sideHold      = "hold"
	outcomeLapsed = "lapsed"
	whyStageEnded = "stage-ended"
	scopeSubject  = "scope"
	// coinWorth is a sold side's unit: a coin's worth sold.
	coinWorth = 1
)

// Cast kinds as refs name them.
const (
	kindFaction    = "faction"
	kindRegion     = "region"
	kindHolding    = "holding"
	kindSettlement = "settlement"
	kindNotable    = "notable"
	kindNPC        = "npc"
	kindCharacter  = "character"
	kindTile       = "tile"
)

// structural: the roles a trouble binds.
const (
	rolePlace   = "place"
	roleSource  = sheets.RoleSource
	roleFaction = "faction"

	gaugeCorruption = "corruption"
)

func arcRef(id string) fact.Ref { return fact.Ref{Kind: "arc", ID: id} }

func itoa(n int) string { return strconv.Itoa(n) }

func i64(n int64) string { return strconv.FormatInt(n, decimal) }

// template is an arc, trouble or occasion row with its predicate.
func (g *Game) template(id string) (arc.Template, bool) {
	for _, t := range g.r.Templates {
		if t.Row.ID == id {
			return t, true
		}
	}
	return arc.Template{}, false
}

// troubleOf is the trouble row an arc runs, or nil for an arc row.
func (g *Game) troubleOf(a *Arc) *sheets.TroubleRow {
	if a.Scope != arc.Settlement {
		return nil
	}
	t, ok := g.template(a.Template)
	if !ok {
		return nil
	}
	return t.Row.Trouble
}

// stages is how many stages an arc runs.
func (g *Game) stages(a *Arc) int {
	if a.Scope == arc.Settlement {
		return 1
	}
	if row := g.arcRow(a.Template); row != nil {
		return len(row.Stages)
	}
	return 0
}

// stageRow is the sheet stage an arc's stage runs. A trouble is one stage
// of one side, hold it off, whose win is the trouble held and whose lapse
// is the trouble lost.
func (g *Game) stageRow(a *Arc, stage int) (sheets.StageRow, bool) {
	if tr := g.troubleOf(a); tr != nil {
		return sheets.StageRow{ID: tr.ID, Lapse: tr.Lost, Sides: []sheets.SideRow{
			{ID: sideHold, Wants: tr.Wants, Tag: tr.Tag, Per: tr.Per, At: rolePlace, Won: tr.Held}}}, true
	}
	row := g.arcRow(a.Template)
	if row == nil || stage < 0 || stage >= len(row.Stages) {
		return sheets.StageRow{}, false
	}
	return row.Stages[stage], true
}

// sideRow is one side of a stage row.
func sideRow(row sheets.StageRow, id string) (sheets.SideRow, bool) {
	i := slices.IndexFunc(row.Sides, func(s sheets.SideRow) bool { return s.ID == id })
	if i < 0 {
		return sheets.SideRow{}, false
	}
	return row.Sides[i], true
}

// pacing is a scope's story.pacing row.
func (g *Game) pacing(scope string) sheets.Pacing {
	for _, p := range g.r.Book.Pacing {
		if p.ID == scope {
			return p
		}
	}
	return sheets.Pacing{AtOnce: 1}
}

// over reports whether an arc has ended: its outcome is set, since an
// end at tick 0 leaves Ended at 0.
func (a *Arc) over() bool { return a.Outcome != "" }

// over reports whether a stage has ended, won or lapsed.
func (st *StageRun) over() bool { return st.Won != "" || st.Lapsed }

// openArcs are the arcs of a scope still running, in casting order; "" is
// every scope.
func (g *Game) openArcs(scope string) []*Arc {
	if g.Story == nil {
		return nil
	}
	var out []*Arc
	for _, a := range g.Story.Arcs {
		if !a.over() && (scope == "" || a.Scope == scope) {
			out = append(out, a)
		}
	}
	return out
}

// storyDay is the director's world day, in order: the streaks, the season,
// the stages due; the troubles' standing damage, cities, faction cities and
// pattern boards; the spreading fronts and the occasions run out, then
// casting by scope: settlements, characters, regions.
func (g *Game) storyDay(t int64) error {
	if g.Story == nil {
		return nil
	}
	day := t / sheets.TicksPerDay
	g.streaksDay(day)
	if err := g.seasonDay(t); err != nil {
		return err
	}
	if err := g.stagesDue(t); err != nil {
		return err
	}
	for _, daily := range []func(int64) error{g.troubleDay, g.citiesDay, g.factionCitiesDay, g.patternsDay} {
		if err := daily(day); err != nil {
			return err
		}
	}
	if err := g.spreadsDay(t); err != nil {
		return err
	}
	if err := g.occasionsDue(t); err != nil {
		return err
	}
	g.storyKept(t)
	w := g.storyView()
	if err := g.castSettlements(w, t); err != nil {
		return err
	}
	if err := g.castPersonal(w, t); err != nil {
		return err
	}
	return g.castRegions(w, t)
}

// storyTick ends each stage a side has met, a raid whose hunt was slain,
// and any stage past its time.
func (g *Game) storyTick(t int64) error {
	if g.Story == nil {
		return nil
	}
	for _, a := range g.openArcs("") {
		if a.Stage >= len(a.Stages) || a.Stages[a.Stage].over() {
			continue
		}
		st := &a.Stages[a.Stage]
		won := ""
		for _, sr := range st.Sides {
			if x := g.GoalOf(sr.Goal); x != nil && x.State == goal.Done {
				won = sr.Side
				break
			}
		}
		if won == "" && g.huntDown(a.Hunt) {
			won = sideHold
		}
		if won == "" && st.Due > t {
			continue
		}
		if err := g.endStage(a, won, t); err != nil {
			return err
		}
	}
	return nil
}

// huntDown reports whether a trouble's hunt was brought down.
func (g *Game) huntDown(id string) bool {
	if id == "" {
		return false
	}
	i := slices.IndexFunc(g.Hunts, func(x *Hunt) bool { return x.H.ID == id })
	return i >= 0 && g.Hunts[i].H.Slain
}

// stagesDue lapses every stage whose time is up; one that starts already
// due lapses with it.
func (g *Game) stagesDue(t int64) error {
	for _, a := range g.openArcs("") {
		for !a.over() && a.Stage < len(a.Stages) && !a.Stages[a.Stage].over() && a.Stages[a.Stage].Due <= t {
			if err := g.endStage(a, "", t); err != nil {
				return err
			}
		}
	}
	return nil
}

// storyKept forgets rests run out and arcs ended more than kept-arc-days
// ago, with their backers.
func (g *Game) storyKept(t int64) {
	s := g.Story
	s.Rests = slices.DeleteFunc(s.Rests, func(r ScopeRest) bool { return r.Until <= t })
	from := t - g.r.Story.KeptArcDays*sheets.TicksPerDay
	var gone []string
	s.Arcs = slices.DeleteFunc(s.Arcs, func(a *Arc) bool {
		old := a.over() && a.Ended < from
		if old {
			gone = append(gone, a.ID)
		}
		return old
	})
	if len(gone) > 0 {
		s.Backers = slices.DeleteFunc(s.Backers, func(b Backing) bool { return slices.Contains(gone, b.Arc) })
	}
}

// CastArc casts a template with its cast bound by hand (GDD 14): an arc or
// a trouble. Every refusal comes before anything changes. A cast the
// template's predicate finds today keeps that candidate's regions, causes,
// character and place; any other takes the regions its refs name.
func (g *Game) CastArc(template string, cast arc.Cast, seat hex.Hex, by string, t int64) (*Arc, error) {
	if _, ok := g.clock(); !ok {
		return nil, refuse(NoSeason, "the world keeps no season")
	}
	tpl, ok := g.template(template)
	if !ok || tpl.Row.Occasion != nil {
		return nil, refuse(NoTemplate, "no arc or trouble %q in story.arcs or story.troubles", template)
	}
	cast = arc.Sorted(cast)
	if err := g.fits(tpl.Row, cast); err != nil {
		return nil, err
	}
	c := g.candidateFor(tpl, cast, seat)
	return g.castFrom(tpl, c, by, t)
}

// castRoles are the roles a template casts and whether each must be bound.
func castRoles(row arc.Row) ([]sheets.CastRow, map[string]bool) {
	if row.Trouble == nil {
		need := map[string]bool{}
		for _, c := range row.Cast {
			need[c.Role] = true
		}
		return row.Cast, need
	}
	return []sheets.CastRow{{Role: rolePlace, Kind: kindSettlement}, {Role: roleSource, Kind: kindRegion}, {Role: roleFaction, Kind: kindFaction}},
		map[string]bool{rolePlace: true}
}

// fits refuses a cast that does not fill the template's roles with refs
// the world holds.
func (g *Game) fits(row arc.Row, cast arc.Cast) error {
	roles, need := castRoles(row)
	seen := map[string]bool{}
	for _, b := range cast {
		i := slices.IndexFunc(roles, func(c sheets.CastRow) bool { return c.Role == b.Role })
		switch {
		case i < 0:
			return refuse(CastMisfit, "%s casts no role %q", row.ID, b.Role)
		case seen[b.Role]:
			return refuse(CastMisfit, "role %q is bound twice", b.Role)
		case b.Ref.Kind != roles[i].Kind:
			return refuse(CastMisfit, "role %q takes a %s, not %s", b.Role, roles[i].Kind, b.Ref)
		case !g.holdsRef(b.Ref):
			return refuse(CastMisfit, "the world holds no %s for role %q", b.Ref, b.Role)
		}
		seen[b.Role] = true
	}
	for _, c := range roles {
		if need[c.Role] && !seen[c.Role] {
			return refuse(CastMisfit, "%s needs role %q bound", row.ID, c.Role)
		}
	}
	return nil
}

// holdsRef reports whether a cast ref names something standing.
func (g *Game) holdsRef(ref fact.Ref) bool {
	n, indexed := arc.RefIndex(ref)
	switch ref.Kind {
	case kindFaction:
		return indexed && ref == arc.FactionRef(n) && n < len(g.World.Factions) && !g.World.Factions[n].Fallen
	case kindRegion:
		return indexed && ref == arc.RegionRef(n) && n < len(g.World.Regions)
	case kindHolding:
		return indexed && ref == arc.HoldingRef(n) && n < len(g.World.Regions) && g.World.Regions[n].Holder >= 0
	case kindSettlement:
		return indexed && ref == arc.SettlementRef(n) && n < len(g.Places) && g.Places[n].Ruined == 0
	case kindNotable:
		fi, _ := g.notableFaction(ref.ID)
		return fi >= 0
	case kindNPC:
		return g.NPCs.Get(ref.ID) != nil
	case kindCharacter:
		return g.Char(ref.ID) != nil
	case kindTile:
		_, ok := hex.ParseRef(ref.ID)
		return ok
	}
	return false
}

// notableFaction is the living faction a living notable serves, and its
// index there; -1 for none.
func (g *Game) notableFaction(id string) (int, int) {
	for fi, f := range g.World.Factions {
		if f.Fallen {
			continue
		}
		for k, n := range f.Notables {
			if !n.Dead && notableID(n.ID) == id {
				return fi, k
			}
		}
	}
	return -1, -1
}

// candidateFor is a hand-bound cast as a candidate: the predicate's own
// when it finds the same cast today, else one built from the refs.
func (g *Game) candidateFor(tpl arc.Template, cast arc.Cast, seat hex.Hex) arc.Candidate {
	key := cast.Key()
	for _, c := range tpl.When(g.storyView(), tpl.Row, g.r.Story) {
		if c.Cast.Key() == key {
			c.Cast, c.Seat = cast, seat
			return c
		}
	}
	c := arc.Candidate{Cast: cast, Seat: seat, Place: -1}
	var regions []int
	for _, b := range cast {
		regions = append(regions, g.refRegions(b.Ref)...)
		switch b.Ref.Kind {
		case kindCharacter:
			c.Char = b.Ref.ID
		case kindSettlement:
			if n, ok := arc.RefIndex(b.Ref); ok && b.Role == rolePlace {
				c.Place = n
			}
		}
	}
	if tpl.Row.Trouble != nil {
		if tpl.Row.Trouble.Wants == arc.WantBeats {
			if src, ok := cast.Get(roleSource); ok {
				regions = g.refRegions(src)
			}
		} else if c.Place >= 0 {
			regions = g.refRegions(arc.SettlementRef(c.Place))
		}
	}
	if r := g.World.RegionAt(seat); r >= 0 && tpl.Row.Trouble == nil {
		regions = append(regions, r)
	}
	slices.Sort(regions)
	c.Regions = slices.Compact(regions)
	return c
}

// castFrom casts a candidate: the arc opens and its first stage starts.
// A slot its scope has no room in is refused first.
func (g *Game) castFrom(tpl arc.Template, c arc.Candidate, by string, t int64) (*Arc, error) {
	scope := tpl.Row.Scope
	if err := g.slotFree(scope, c); err != nil {
		return nil, err
	}
	if len(g.Places) == 0 {
		return nil, refuse(CastMisfit, "no settlement stands to post the sides on")
	}
	s := g.Story
	s.NextArc++
	a := &Arc{ID: arcPrefix + i64(s.NextArc), Template: tpl.Row.ID, Scope: scope, Cast: arc.Sorted(c.Cast), Regions: slices.Clone(c.Regions),
		Seat: c.Seat, By: by, Began: t, Cause: slices.Clone(c.Causes)}
	if scope == arc.Personal {
		a.Char = c.Char
	}
	if scope == arc.Settlement && c.Place >= 0 {
		a.Place = goal.SettlementRef(c.Place)
		a.Seat = g.SettlementHex(c.Place)
	}
	if len(a.Regions) == 0 {
		if r := g.World.RegionAt(a.Seat); r >= 0 {
			a.Regions = []int{r}
		}
	}
	s.Arcs = append(s.Arcs, a)
	if err := g.wakeCast(a, t); err != nil {
		return nil, err
	}
	if err := g.startStage(a, t); err != nil {
		return nil, err
	}
	return a, nil
}

// wakeCast wakes a dormant NPC the arc casts (GDD 4.18).
func (g *Game) wakeCast(a *Arc, t int64) error {
	for _, b := range a.Cast {
		if b.Ref.Kind != kindNPC {
			continue
		}
		n := g.NPCs.Get(b.Ref.ID)
		if n == nil {
			continue
		}
		woke, err := g.wake(n, t)
		if err != nil {
			return err
		}
		if woke {
			if err := g.NPCs.Touched(n); err != nil {
				return err
			}
		}
	}
	return nil
}

// slotFree refuses a cast its scope's pacing has no room for: the one
// world arc, the region slots or a region or ref another region arc holds,
// a place's one trouble or occasion, a character's one thread.
func (g *Game) slotFree(scope string, c arc.Candidate) error {
	open := g.openArcs(scope)
	switch scope {
	case arc.ScopeWorld:
		if len(open) > 0 {
			return refuse(SlotBusy, "%s is the world's arc", open[0].ID)
		}
	case arc.Region:
		p := g.pacing(arc.Region)
		if slots := arc.RegionSlots(p.AtOnce, p.PerRegions, int64(len(g.World.Regions))); int64(len(open)) >= slots {
			return refuse(SlotBusy, "%d region arcs already run", len(open))
		}
		for _, a := range open {
			if arcClashes(a, c) {
				return refuse(SlotBusy, "%s already holds part of that cast", a.ID)
			}
		}
	case arc.Settlement:
		if c.Place < 0 || c.Place >= len(g.Places) {
			return refuse(CastMisfit, "a trouble is cast at a settlement")
		}
		if g.placeTaken(c.Place) {
			return refuse(SlotBusy, "%s already has its trouble or occasion", g.PlaceName(g.SettlementHex(c.Place)))
		}
	case arc.Personal:
		if c.Char == "" {
			return refuse(CastMisfit, "a thread is cast for a character")
		}
		if slices.ContainsFunc(open, func(a *Arc) bool { return a.Char == c.Char }) {
			return refuse(SlotBusy, "%s already follows a thread", c.Char)
		}
	}
	return nil
}

// arcClashes reports whether a candidate shares a region or a non-seat ref
// with a running arc.
func arcClashes(a *Arc, c arc.Candidate) bool {
	for _, r := range c.Regions {
		if slices.Contains(a.Regions, r) {
			return true
		}
	}
	for _, b := range c.Cast {
		if b.Role != seatRole && a.binds(b.Ref) {
			return true
		}
	}
	return false
}

// placeTaken reports whether a place has a trouble running or an occasion.
func (g *Game) placeTaken(n int) bool {
	ref := goal.SettlementRef(n)
	if slices.ContainsFunc(g.openArcs(arc.Settlement), func(a *Arc) bool { return a.Place == ref }) {
		return true
	}
	ps := g.storyAt(n)
	return ps != nil && ps.Occasion != nil
}

// restScope keeps a ref from being cast at a scope for a scope's rest days.
func (g *Game) restScope(scope string, ref fact.Ref, t int64) {
	days := g.pacing(scope).RestDays
	if days <= 0 {
		return
	}
	s := g.Story
	r := ScopeRest{Scope: scope, Ref: ref, Until: t + days*sheets.TicksPerDay}
	i, found := slices.BinarySearchFunc(s.Rests, r, cmpRest)
	if found {
		s.Rests[i].Until = max(s.Rests[i].Until, r.Until)
		return
	}
	s.Rests = slices.Insert(s.Rests, i, r)
}

func cmpRest(a, b ScopeRest) int {
	return cmp.Or(cmp.Compare(a.Scope, b.Scope), cmp.Compare(a.Ref.Kind, b.Ref.Kind), cmp.Compare(a.Ref.ID, b.Ref.ID))
}

// castSettlements gives each standing place with room the first trouble
// in sheet order whose predicate finds it and whose chance passes; a place
// no trouble came to may have an occasion instead.
func (g *Game) castSettlements(w *storyView, t int64) error {
	day := t / sheets.TicksPerDay
	type option struct {
		tpl arc.Template
		c   arc.Candidate
	}
	troubles := make([][]option, len(g.Places))
	occasions := make([][]option, len(g.Places))
	for _, tpl := range g.r.Templates {
		if tpl.Row.Scope != arc.Settlement {
			continue
		}
		for _, c := range tpl.When(w, tpl.Row, g.r.Story) {
			if c.Place < 0 || c.Place >= len(g.Places) {
				continue
			}
			if tpl.Row.Trouble != nil {
				troubles[c.Place] = append(troubles[c.Place], option{tpl, c})
			} else {
				occasions[c.Place] = append(occasions[c.Place], option{tpl, c})
			}
		}
	}
	for n := range g.Places {
		if g.Places[n].Ruined != 0 || g.placeTaken(n) {
			continue
		}
		cast := false
		for _, o := range troubles[n] {
			if !g.r.draw.Percent(o.tpl.Row.Chance, troubleDraw, draw.Int(int64(n)), draw.Str(o.tpl.Row.ID), draw.Int(day)) {
				continue
			}
			if _, err := g.castFrom(o.tpl, o.c, ByDirector, t); refusedIsNothing(err) != nil {
				return err
			}
			cast = true
			break
		}
		if cast {
			continue
		}
		for _, o := range occasions[n] {
			if g.r.draw.Percent(o.tpl.Row.Chance, occasionDraw, draw.Int(int64(n)), draw.Str(o.tpl.Row.ID), draw.Int(day)) {
				if err := g.beginOccasion(o.tpl, o.c, t); err != nil {
					return err
				}
				break
			}
		}
	}
	return nil
}

// castPersonal casts each character's thread from its pending candidates,
// the templates in sheet order, one thread a character, and takes the
// candidate it was cast from off the queue.
func (g *Game) castPersonal(w *storyView, t int64) error {
	day := t / sheets.TicksPerDay
	for _, tpl := range g.r.Templates {
		if tpl.Row.Scope != arc.Personal {
			continue
		}
		for _, c := range tpl.When(w, tpl.Row, g.r.Story) {
			if c.Char == "" || g.slotFree(arc.Personal, c) != nil {
				continue
			}
			if !arc.Chance(g.r.draw, tpl.Row.ID, char.Ref(c.Char).String(), day, tpl.Row.Chance) {
				continue
			}
			a, err := g.castFrom(tpl, c, ByDirector, t)
			if refusedIsNothing(err) != nil {
				return err
			}
			if a != nil {
				g.unpend(c)
			}
		}
	}
	return nil
}

// unpend takes the pending candidate a thread was cast from off the queue.
func (g *Game) unpend(c arc.Candidate) {
	s := g.Story
	i := slices.IndexFunc(s.Pending, func(p arc.Pending) bool {
		if p.Char != c.Char {
			return false
		}
		if p.Fact != 0 && slices.Contains(c.Causes, p.Fact) {
			return true
		}
		return slices.ContainsFunc(c.Cast, func(b arc.Binding) bool { return b.Ref == p.Ref })
	})
	if i >= 0 {
		s.Pending = slices.Delete(s.Pending, i, i+1)
	}
}

// castRegions fills the free region slots: each region template in sheet
// order offers its hardest-pressed candidate, a tie drawn, which is cast if
// it clashes with no running region arc and its chance passes.
func (g *Game) castRegions(w *storyView, t int64) error {
	day := t / sheets.TicksPerDay
	p := g.pacing(arc.Region)
	slots := arc.RegionSlots(p.AtOnce, p.PerRegions, int64(len(g.World.Regions)))
	for _, tpl := range g.r.Templates {
		if int64(len(g.openArcs(arc.Region))) >= slots {
			return nil
		}
		if tpl.Row.Scope != arc.Region {
			continue
		}
		c, ok := arc.Pick(tpl.When(w, tpl.Row, g.r.Story), g.r.draw, tpl.Row.ID, arc.Region, day)
		if !ok || g.slotFree(arc.Region, c) != nil {
			continue
		}
		scope := arc.Region
		if len(c.Regions) > 0 {
			scope = arc.RegionRef(c.Regions[0]).String()
		}
		if !arc.Chance(g.r.draw, tpl.Row.ID, scope, day, tpl.Row.Chance) {
			continue
		}
		if _, err := g.castFrom(tpl, c, ByDirector, t); refusedIsNothing(err) != nil {
			return err
		}
	}
	return nil
}

// stageDue is the tick a stage's time runs out: a trouble's next world
// day, a region or personal stage's days, a world stage's band end, a
// finale's close.
func (g *Game) stageDue(a *Arc, row sheets.StageRow, t int64) int64 {
	switch a.Scope {
	case arc.Settlement:
		return t + sheets.TicksPerDay
	case arc.ScopeWorld:
		return g.worldDue(a, t)
	}
	return t + max(row.Days, 1)*sheets.TicksPerDay
}

// worldDue is the end of a world stage's band, or of the next band not
// passed; a finale and a stage with no band left end at the close.
func (g *Game) worldDue(a *Arc, t int64) int64 {
	c, tb, ok := g.Season()
	if !ok {
		return t + sheets.TicksPerDay
	}
	closes := (c.Start + c.Days) * sheets.TicksPerDay
	if row := g.arcRow(a.Template); row == nil || row.Finale {
		return max(closes, t+1)
	}
	for stage := a.Stage; ; stage++ {
		end := tb.StageEnds(stage)
		if end == 0 {
			return max(closes, t+1)
		}
		if due := (c.Start + end) * sheets.TicksPerDay; due > t {
			return due
		}
	}
}

// startStage starts an arc's current stage: each side's mark from the
// characters active in its regions, its pooled Back goal on the seat's
// board with escrow minted from the sponsor's faction, a raid's hunt, and
// the fact.
func (g *Game) startStage(a *Arc, t int64) error {
	row, ok := g.stageRow(a, a.Stage)
	if !ok {
		return refuse(NoTemplate, "%s has no stage %d", a.Template, a.Stage)
	}
	st := StageRun{Began: t, Due: g.stageDue(a, row, t)}
	budgets := g.Budgets()
	board := g.arcBoard(a)
	for _, sd := range row.Sides {
		mark := g.sideMark(a, sd, t)
		sponsor, opponent := g.sideFactions(a, sd)
		at, condAt := g.sideAt(a, sd)
		reward := g.sideReward(a, mark, g.unitWorth(sd), budgets)
		issuer := goal.Ref{Kind: goal.ByFaction, ID: strconv.Itoa(sponsor)}
		x := &Goal{Title: a.Template + ": " + sd.ID, Issuer: issuer, Scope: goal.World, Board: board, Reward: reward, Mode: goal.Pooled,
			Lifetime: goal.Ephemeral, Turnover: goal.Expire, Posted: t, Expires: st.Due + 1, State: goal.Live,
			Cond: goal.Condition{Verb: goal.Back, Side: a.ID + sidePart + itoa(a.Stage) + sidePart + sd.ID, Count: mark, At: condAt}}
		g.openGoal(x)
		if reward > 0 {
			k := ledger.SubKey("tick", i64(t), "arc", a.ID, itoa(a.Stage), sd.ID)
			if err := g.post(ledger.Move(k, "side", t, ledger.FromFaction, goalPool(x.ID), ledger.Coin, reward)); err != nil {
				return err
			}
		}
		st.Sides = append(st.Sides, SideRun{Side: sd.ID, Goal: x.ID, Mark: mark, Sponsor: sponsor, Opponent: opponent, At: at})
	}
	a.Stages = append(a.Stages[:min(a.Stage, len(a.Stages))], st)
	if tr := g.troubleOf(a); tr != nil && tr.Hunt != "" {
		if err := g.troubleHunt(a, tr, t); err != nil {
			return err
		}
	}
	f, err := g.stageBegan(a, row, t)
	if err != nil {
		return err
	}
	a.Stages[a.Stage].Fact = f
	if a.Stage == 0 {
		a.Fact = f
	}
	return nil
}

// stageBegan writes a stage's start: arc.cast for an arc's first, the
// thread's or trouble's own kind, arc.stage-began after.
func (g *Game) stageBegan(a *Arc, row sheets.StageRow, t int64) (fact.ID, error) {
	kind := "arc.stage-began"
	switch {
	case a.Scope == arc.Settlement:
		kind = "trouble.started"
	case a.Scope == arc.Personal:
		kind = "thread.cast"
	case a.Stage == 0:
		kind = "arc.cast"
	}
	causes := a.Cause
	if a.Stage > 0 {
		causes = []fact.ID{a.Stages[a.Stage-1].Fact}
	}
	st := a.Stages[a.Stage]
	data := append([]fact.Datum{fact.S("arc", a.ID), fact.S("template", a.Template), fact.S("scope", a.Scope), fact.N("stage", int64(a.Stage)),
		fact.S("stageId", row.ID), fact.N("due", st.Due), fact.S("by", a.By)}, fact.At(a.Seat)...)
	for _, sr := range st.Sides {
		data = append(data, fact.N("mark:"+sr.Side, sr.Mark))
	}
	if n, ok := goal.SettlementOf(a.Place); ok {
		data = append(data, fact.N("settlement", int64(n)))
	}
	if a.Hunt != "" {
		data = append(data, fact.S("hunt", a.Hunt))
	}
	return g.worldFact(a.Seat, kind, g.arcSubjects(a), causes, data...)
}

// arcSubjects are the arc and every ref its cast binds.
func (g *Game) arcSubjects(a *Arc) []fact.Ref {
	out := []fact.Ref{arcRef(a.ID)}
	for _, b := range a.Cast {
		if !slices.Contains(out, b.Ref) {
			out = append(out, b.Ref)
		}
	}
	if a.Char != "" && !slices.Contains(out, char.Ref(a.Char)) {
		out = append(out, char.Ref(a.Char))
	}
	return out
}

// troubleHunt opens a raid's hunt at its place through OpenHunt, or counts
// the one of its row already open in the place's region. A hunt the rules
// will not open leaves the raid to beats alone.
func (g *Game) troubleHunt(a *Arc, tr *sheets.TroubleRow, t int64) error {
	r := g.World.RegionAt(a.Seat)
	if r < 0 {
		return nil
	}
	if x := g.openHunt(tr.Hunt, world.RegionRef(r)); x != nil {
		a.Hunt = x.H.ID
		return nil
	}
	x, err := g.OpenHunt(tr.Hunt, a.Seat, t, WhyTrouble)
	if err != nil {
		return refusedIsNothing(err)
	}
	a.Hunt = x.H.ID
	return nil
}

// arcBoard is the place whose board shows an arc's sides: its trouble's
// place, its seat settlement, or the place nearest its seat.
func (g *Game) arcBoard(a *Arc) int {
	if n, ok := goal.SettlementOf(a.Place); ok && n < len(g.Places) {
		return n
	}
	if ref, ok := a.Cast.Get(seatRole); ok && ref.Kind == kindSettlement {
		if n, ok := arc.RefIndex(ref); ok && n < len(g.Places) {
			return n
		}
	}
	if n, ok := g.storyView().NearestPlace(a.Seat); ok {
		return n
	}
	return 0
}

// activeIn counts the characters who acted within active-days and stand
// in one of regions.
func (g *Game) activeIn(regions []int, t int64) int64 {
	from := t - g.r.Story.ActiveDays*sheets.TicksPerDay
	var n int64
	for _, c := range g.Chars {
		if c.Banned || c.Acted < from {
			continue
		}
		if r := g.World.RegionAt(c.C.At); r >= 0 && slices.Contains(regions, r) {
			n++
		}
	}
	return n
}

// sideMark is a side's mark: per unit for each character active in the
// arc's regions, never under the floor; a thread's for its one character
// at thread-mark; a trouble's for the place's users, a raid's after its
// wall's cut, less what its keepers and a stocked wall already count.
func (g *Game) sideMark(a *Arc, sd sheets.SideRow, t int64) int64 {
	p := g.r.Story
	switch a.Scope {
	case arc.Personal:
		per := p.ThreadMark
		if sd.Wants == arc.WantReach {
			per = sd.Per
		}
		return arc.Mark(per, 1, 1)
	case arc.Settlement:
		return g.troubleMark(a, sd, t)
	}
	return arc.Mark(sd.Per, g.activeIn(a.Regions, t), p.MarkFloorCharacters)
}

func (g *Game) troubleMark(a *Arc, sd sheets.SideRow, t int64) int64 {
	p := g.r.Story
	n, ok := goal.SettlementOf(a.Place)
	if !ok || n >= len(g.Places) {
		return arc.Mark(sd.Per, 0, p.MarkFloorCharacters)
	}
	place := g.Places[n]
	active := g.storyView().placeUsers()[n]
	if sd.Wants == arc.WantBeats {
		active = g.activeIn(a.Regions, t)
	}
	mark := arc.Mark(sd.Per, active, p.MarkFloorCharacters)
	if sd.Wants == arc.WantDefence {
		tiers, cut := g.wallCut(place)
		mark = arc.DefenceMark(sd.Per, active, p.MarkFloorCharacters, tiers, cut)
		if row, _ := g.workAt(n, giveRaidDefence, nil); row != nil {
			mark -= p.StockedWallDefence
		}
	}
	if place.Guild == "" {
		mark -= p.KeeperWatch
	}
	return max(mark, 1)
}

// structural: what a stocked wall's work gives.
const giveRaidDefence = "raid-defence"

// wallCut is a place's wall tiers for a raid's cut and the cut a tier
// takes; a Bulwark standing there counts the wall a tier higher, to its
// top (GDD 12.10).
func (g *Game) wallCut(p *Place) (tiers, cut int64) {
	row := g.r.structures[structureWall]
	st := p.Get(structureWall)
	if row == nil || st == nil || st.Closed() {
		return 0, 0
	}
	tiers = st.Tier
	for _, c := range g.CharsAt(p.Hex) {
		if g.charScale(c, "wall-tier", 0) > 0 {
			tiers = min(tiers+1, row.MaxTier)
			break
		}
	}
	return tiers, row.Per
}

// sideFactions are a side's sponsor, whose faction pays, and opponent,
// who loses standing: the factions its roles name, the holder of its At or
// the keepers for no sponsor, and none for an opponent that is the sponsor.
func (g *Game) sideFactions(a *Arc, sd sheets.SideRow) (sponsor, opponent int) {
	sponsor, opponent = econ.Keepers, -1
	if f, ok := g.roleFaction(a, sd.Sponsor); ok && sd.Sponsor != "" {
		sponsor = f
	} else if f, ok := g.roleHolder(a, sd.At); ok {
		sponsor = f
	}
	if f, ok := g.roleFaction(a, sd.Opponent); ok && sd.Opponent != "" && f != sponsor {
		opponent = f
	}
	return sponsor, opponent
}

// roleFaction is the faction a role names: a faction, a notable's, a
// holding's or a region's holder, a settlement's region's holder.
func (g *Game) roleFaction(a *Arc, role string) (int, bool) {
	ref, ok := a.Cast.Get(role)
	if !ok {
		return -1, false
	}
	switch ref.Kind {
	case kindFaction:
		if fi, ok := arc.RefIndex(ref); ok && fi < len(g.World.Factions) {
			return fi, true
		}
		return -1, false
	case kindNotable:
		fi, _ := g.notableFaction(ref.ID)
		return fi, fi >= 0
	}
	return g.roleHolder(a, role)
}

// roleHolder is the living holder of the region a role stands in.
func (g *Game) roleHolder(a *Arc, role string) (int, bool) {
	ref, ok := g.roleRef(a, role)
	if !ok {
		return -1, false
	}
	for _, r := range g.refRegions(ref) {
		if h := g.World.Regions[r].Holder; h >= 0 && !g.World.Factions[h].Fallen {
			return h, true
		}
	}
	return -1, false
}

// roleRef is the ref a role binds; a trouble's empty role is its place.
func (g *Game) roleRef(a *Arc, role string) (fact.Ref, bool) {
	if role == "" {
		role = rolePlace
	}
	return a.Cast.Get(role)
}

// refRegions are the regions a ref stands for: a region or holding, a
// faction's holdings, a settlement's or tile's region, a notable's
// faction's holdings, an NPC's home's, a character's.
func (g *Game) refRegions(ref fact.Ref) []int {
	in := func(h hex.Hex) []int {
		if r := g.World.RegionAt(h); r >= 0 {
			return []int{r}
		}
		return nil
	}
	n, indexed := arc.RefIndex(ref)
	switch ref.Kind {
	case kindRegion, kindHolding:
		if indexed && n < len(g.World.Regions) {
			return []int{n}
		}
	case kindFaction:
		if indexed {
			return g.heldRegions(n)
		}
	case kindNotable:
		if fi, _ := g.notableFaction(ref.ID); fi >= 0 {
			return g.heldRegions(fi)
		}
	case kindSettlement:
		if indexed && n < len(g.Places) {
			return in(g.SettlementHex(n))
		}
	case kindTile:
		if h, ok := hex.ParseRef(ref.ID); ok {
			return in(h)
		}
	case kindNPC:
		if x := g.NPCs.Get(ref.ID); x != nil {
			return in(x.Stub.Home)
		}
	case kindCharacter:
		if c := g.Char(ref.ID); c != nil {
			return in(c.C.At)
		}
	}
	return nil
}

// heldRegions are the regions a faction holds, in order.
func (g *Game) heldRegions(fi int) []int {
	var out []int
	for r, reg := range g.World.Regions {
		if reg.Holder == fi {
			out = append(out, r)
		}
	}
	return out
}

// regionHex is a region's centre.
func (g *Game) regionHex(r int) hex.Hex { return g.r.Gen.Region(g.World.Regions[r].Lattice).Centre }

// refHexOf is the tile a ref stands on: a settlement's, a tile, a region's
// or holding's centre, a faction's or a notable's seat, an NPC's home, a
// character's.
func (g *Game) refHexOf(ref fact.Ref) (hex.Hex, bool) {
	n, indexed := arc.RefIndex(ref)
	switch ref.Kind {
	case kindSettlement:
		if indexed && n < len(g.Places) {
			return g.SettlementHex(n), true
		}
	case kindTile:
		return hex.ParseRef(ref.ID)
	case kindRegion, kindHolding:
		if indexed && n < len(g.World.Regions) {
			return g.regionHex(n), true
		}
	case kindFaction:
		if indexed && n < len(g.World.Factions) {
			return g.regionHex(g.World.Factions[n].Seat), true
		}
	case kindNotable:
		if fi, _ := g.notableFaction(ref.ID); fi >= 0 {
			return g.regionHex(g.World.Factions[fi].Seat), true
		}
	case kindNPC:
		if x := g.NPCs.Get(ref.ID); x != nil {
			return x.Stub.Home, true
		}
	case kindCharacter:
		if c := g.Char(ref.ID); c != nil {
			return c.C.At, true
		}
	}
	return hex.Hex{}, false
}

// sideAt is where a side counts, as the side keeps it and as its goal's
// condition reads it: goods and sales at the standing settlement nearest
// its role, a reach on the role's tile, beats and defence in the role's
// regions (a trouble's in the arc's).
func (g *Game) sideAt(a *Arc, sd sheets.SideRow) (at, cond string) {
	ref, ok := g.roleRef(a, sd.At)
	h := a.Seat
	if ok {
		if rh, ok := g.refHexOf(ref); ok {
			h = rh
		}
	}
	switch sd.Wants {
	case arc.WantGoods, arc.WantSold:
		n := g.arcBoard(a)
		if a.Scope != arc.Settlement {
			if m, ok := g.storyView().NearestPlace(h); ok {
				n = m
			}
		}
		ref := goal.SettlementRef(n)
		return ref, ref
	case arc.WantReach:
		ref := goal.TileRef(h)
		return ref, ref
	}
	regions := a.Regions
	if ok && a.Scope != arc.Settlement {
		if rs := g.refRegions(ref); len(rs) > 0 {
			regions = rs
		}
	}
	refs := make([]string, len(regions))
	for i, r := range regions {
		refs[i] = goal.RegionRef(world.RegionRef(r))
	}
	return strings.Join(refs, refList), ""
}

// unitWorth is the coin's worth of one unit of a side's mark: the
// cheapest goods it takes at reference value, beat-coin a point of beats,
// defence or reach, a coin for a sale.
func (g *Game) unitWorth(sd sheets.SideRow) int64 {
	switch sd.Wants {
	case arc.WantGoods:
		if sd.Tag == ledger.Provisions {
			return g.r.Values.Asset(ledger.Provisions)
		}
		worth := int64(0)
		for _, m := range g.r.Book.Materials {
			if sd.Tag != "" && !slices.Contains(m.Tags, sd.Tag) {
				continue
			}
			if v := g.r.Values.Material(m.ID); v > 0 && (worth == 0 || v < worth) {
				worth = v
			}
		}
		if sd.Tag == "" {
			if v := g.r.Values.Asset(ledger.Provisions); worth == 0 || v < worth {
				worth = v
			}
		}
		return worth
	case arc.WantSold:
		return coinWorth
	}
	return g.r.Story.BeatCoin
}

// sideReward is a side's escrow: mark × worth × side-pay, capped at
// side-budget-share of the day's budgets of the places it is held from; a
// trouble's is capped at the place's bounty share, as a bounty is.
func (g *Game) sideReward(a *Arc, mark, worth int64, budgets []int64) int64 {
	p := g.r.Story
	var budget int64
	for _, n := range g.heldFrom(a) {
		budget += budgets[n]
	}
	share := p.SideBudgetShare
	if a.Scope == arc.Settlement {
		share = g.gp("bounty-share")
	}
	return arc.Reward(mark, worth, p.SidePay, budget, share)
}

// heldFrom are the places whose faction orders an arc's escrow is held
// out of: a trouble's place; else the standing places with a market in its
// regions, or its board's.
func (g *Game) heldFrom(a *Arc) []int {
	board := g.arcBoard(a)
	if a.Scope == arc.Settlement {
		return []int{board}
	}
	var out []int
	for n, p := range g.Places {
		if p.Ruined == 0 && p.Open(structureMarket) && slices.Contains(a.Regions, g.World.RegionAt(p.Hex)) {
			out = append(out, n)
		}
	}
	if len(out) == 0 {
		return []int{board}
	}
	return out
}

// sideHelds is, per place, the escrow of the sides posted since the last
// faction orders, each spread over the places it was held from by their
// budgets, the rounding on the first.
func (g *Game) sideHelds(budgets []int64) []int64 {
	out := make([]int64, len(g.Places))
	if g.Story == nil {
		return out
	}
	t := g.Tick()
	for _, x := range g.Goals {
		if x.Cond.Verb != goal.Back || x.Reward <= 0 || x.Posted > t || x.Posted <= t-sheets.TicksPerDay {
			continue
		}
		s, ok := g.sideOf(x)
		if !ok {
			continue
		}
		from := g.heldFrom(s.a)
		var total int64
		for _, n := range from {
			total += budgets[n]
		}
		left := x.Reward
		for i, n := range from {
			part := x.Reward / int64(len(from))
			if total > 0 {
				part = arcShare(x.Reward, budgets[n], total)
			}
			if i > 0 {
				out[n] += part
				left -= part
			}
		}
		out[from[0]] += left
	}
	return out
}

// arcShare is floor(whole × part / total).
func arcShare(whole, part, total int64) int64 { return whole * part / total }

// endStage ends an arc's current stage, won by a side or lapsed (""):
// the sides not met are paid side-pay-other of their share by contribution
// (a trouble lost pays nothing, held pays all) and their goals end, the
// rest going back to the sponsors; the fact, the effects, the rivals the
// winners made; then the next stage, or the arc's end.
func (g *Game) endStage(a *Arc, won string, t int64) error {
	if a.over() || a.Stage >= len(a.Stages) || a.Stages[a.Stage].over() {
		return nil
	}
	row, ok := g.stageRow(a, a.Stage)
	if !ok {
		return refuse(NoTemplate, "%s has no stage %d", a.Template, a.Stage)
	}
	sd, isSide := sideRow(row, won)
	if !isSide {
		won = ""
	}
	st := &a.Stages[a.Stage]
	st.Ended, st.Won, st.Lapsed = t, won, won == ""
	key := ledger.SubKey("tick", i64(t), "arc", a.ID, itoa(a.Stage), "end")
	var backers []string
	var units int64
	var winner *SideRun
	for i := range st.Sides {
		sr := &st.Sides[i]
		x := g.GoalOf(sr.Goal)
		if x == nil {
			continue
		}
		for _, p := range x.Progress {
			if p.N > 0 && !slices.Contains(backers, p.Key) {
				backers = append(backers, p.Key)
			}
		}
		units += x.Total()
		if sr.Side == won {
			winner = sr
		}
		if err := g.closeSide(a, sr, x, sr.Side == won, ledger.SubKey(key, sr.Side)); err != nil {
			return err
		}
	}
	f, err := g.stageEnded(a, row, won, int64(len(backers)), units, t)
	if err != nil {
		return err
	}
	effects := row.Lapse
	if isSide {
		effects = sd.Won
	}
	if err := g.applyFrom(a, effects, winner, f, t); err != nil {
		return err
	}
	g.troubleEnded(a, won, t)
	g.rivals(winner, f, t)
	if a.Stage+1 < g.stages(a) {
		a.Stage++
		return g.startStage(a, t)
	}
	return g.endArc(a, won, f, t)
}

// closeSide settles one side's goal at its stage's end. A met goal paid
// itself; any other pays side-pay-other of its escrow scaled by how far it
// filled, by contribution, and ends, its rest going back to the sponsor.
// A trouble held pays its whole escrow by contribution; lost, nothing.
func (g *Game) closeSide(a *Arc, sr *SideRun, x *Goal, won bool, key string) error {
	if !x.Open() {
		return nil
	}
	share, mark := g.r.Story.SidePayOther, sr.Mark
	if a.Scope == arc.Settlement {
		share, mark = 0, 0
		if won {
			share = fixed.Hundredths
		}
	}
	if coin := g.Ledger.Of(goalPool(x.ID), ledger.Coin); share > 0 && coin > 0 {
		pays, _ := arc.Split(coin, share, mark, x.Progress)
		claims := make([]goal.Claim, 0, len(pays))
		for _, p := range pays {
			var facts []fact.ID
			for _, c := range x.Facts {
				if c.Who == p.Who {
					facts = append(facts, c.Fact)
				}
			}
			claims = append(claims, goal.Claim{Who: p.Who, Units: x.Progress.Get(p.Who), Coin: p.Coin, Facts: facts})
		}
		if err := g.payClaims(x, claims, key); err != nil {
			return err
		}
		x.Claims = append(x.Claims, claims...)
	}
	return g.endGoal(x, whyStageEnded, key)
}

// stageEnded writes a stage's end: trouble.held or trouble.lost, a
// thread's end, or arc.stage-ended naming the side or "lapsed".
func (g *Game) stageEnded(a *Arc, row sheets.StageRow, won string, backers, units, t int64) (fact.ID, error) {
	kind := "arc.stage-ended"
	switch {
	case a.Scope == arc.Settlement && won != "":
		kind = "trouble.held"
	case a.Scope == arc.Settlement:
		kind = "trouble.lost"
	case a.Scope == arc.Personal:
		kind = "thread.ended"
	}
	side := cmp.Or(won, outcomeLapsed)
	lapsed := int64(0)
	if won == "" {
		lapsed = 1
	}
	data := append([]fact.Datum{fact.S("arc", a.ID), fact.S("template", a.Template), fact.S("scope", a.Scope), fact.N("stage", int64(a.Stage)),
		fact.S("stageId", row.ID), fact.S("side", side), fact.N("backers", backers), fact.N("units", units), fact.N("lapsed", lapsed)}, fact.At(a.Seat)...)
	if n, ok := goal.SettlementOf(a.Place); ok {
		data = append(data, fact.N("settlement", int64(n)))
	}
	subjects := g.arcSubjects(a)
	if a.Scope == arc.Personal {
		subjects = append(subjects, fact.Ref{Kind: scopeSubject, ID: a.Scope})
	}
	return g.worldFact(a.Seat, kind, subjects, []fact.ID{a.Stages[a.Stage].Fact}, data...)
}

// troubleEnded counts a trouble held or lost at its place, and notes a
// raid that got in, which a fire may follow.
func (g *Game) troubleEnded(a *Arc, won string, t int64) {
	tr := g.troubleOf(a)
	n, ok := goal.SettlementOf(a.Place)
	if tr == nil || !ok {
		return
	}
	ps := g.placeStory(n)
	if ps == nil {
		return
	}
	if won != "" {
		ps.Held++
		return
	}
	ps.Lost++
	if tr.Wants == arc.WantDefence {
		ps.Followed = t
	}
}

// rivals queue the rival thread for each backer of a side that won against
// a faction (GDD 12.8).
func (g *Game) rivals(winner *SideRun, f fact.ID, t int64) {
	if winner == nil || winner.Opponent < 0 || winner.Opponent == winner.Sponsor {
		return
	}
	x := g.GoalOf(winner.Goal)
	if x == nil {
		return
	}
	for _, p := range x.Progress {
		if p.N > 0 && g.Char(p.Key) != nil {
			g.pend(arc.Pending{Kind: arc.PendRival, Char: p.Key, Ref: arc.FactionRef(winner.Opponent), Tick: t, Fact: f})
		}
	}
}

// endArc closes an arc after its last stage: arc.ended (a thread's and a
// trouble's own end already said it), its backers' marks cleared, and its
// scope's rest.
func (g *Game) endArc(a *Arc, won string, last fact.ID, t int64) error {
	a.Ended, a.Outcome = t, cmp.Or(won, outcomeLapsed)
	if a.Scope == arc.ScopeWorld || a.Scope == arc.Region {
		lapsed := int64(0)
		if won == "" {
			lapsed = 1
		}
		subjects := []fact.Ref{arcRef(a.ID), {Kind: scopeSubject, ID: a.Scope}}
		for _, r := range a.Regions {
			subjects = append(subjects, arc.RegionRef(r))
		}
		if _, err := g.worldFact(a.Seat, "arc.ended", subjects, []fact.ID{last}, append([]fact.Datum{fact.S("arc", a.ID), fact.S("template", a.Template),
			fact.S("scope", a.Scope), fact.S("outcome", a.Outcome), fact.N("lapsed", lapsed), fact.N("stages", int64(len(a.Stages)))}, fact.At(a.Seat)...)...); err != nil {
			return err
		}
	}
	g.unmark(a)
	switch a.Scope {
	case arc.Region:
		for _, r := range a.Regions {
			g.restScope(arc.Region, arc.RegionRef(r), t)
		}
	case arc.Settlement:
		if n, ok := goal.SettlementOf(a.Place); ok {
			g.restScope(arc.Settlement, arc.SettlementRef(n), t)
		}
	case arc.Personal:
		g.restScope(arc.Personal, char.Ref(a.Char), t)
	}
	return nil
}

// unmark clears arc-marked from an ended arc's backers; a mark an effect
// set for days runs out on its own.
func (g *Game) unmark(a *Arc) {
	if a.Scope != arc.ScopeWorld {
		return
	}
	for _, b := range g.Story.Backers {
		if b.Arc != a.ID {
			continue
		}
		c := g.Char(b.Char)
		if c == nil {
			continue
		}
		i := slices.IndexFunc(c.C.Conditions, func(x char.Condition) bool { return x.Tag == char.ArcMarked })
		if i >= 0 && c.C.Conditions[i].Ends == 0 {
			c.C.Clear(char.ArcMarked)
			g.touchOnce(c)
		}
	}
}

// beginOccasion starts an occasion at its place: the stake its readers
// see until it ends, its hunt opened through OpenHunt, and the fact.
func (g *Game) beginOccasion(tpl arc.Template, c arc.Candidate, t int64) error {
	row := tpl.Row.Occasion
	ps := g.placeStory(c.Place)
	if row == nil || ps == nil {
		return nil
	}
	h := g.SettlementHex(c.Place)
	data := append([]fact.Datum{fact.S("occasion", row.ID), fact.N("settlement", int64(c.Place)), fact.N("days", row.Days)}, fact.At(h)...)
	if row.Hunt != "" {
		at := h
		if len(c.Regions) > 0 && g.World.RegionAt(h) != c.Regions[0] {
			at = g.regionHex(c.Regions[0])
		}
		x, err := g.OpenHunt(row.Hunt, at, t, WhyOccasion)
		if refusedIsNothing(err) != nil {
			return err
		}
		if x != nil {
			data = append(data, fact.S("hunt", x.H.ID))
		}
	}
	f, err := g.worldFact(h, "occasion.began", []fact.Ref{arc.SettlementRef(c.Place)}, c.Causes, data...)
	if err != nil {
		return err
	}
	ps.Occasion = &Occasion{Kind: row.ID, Began: t, Ends: t + row.Days*sheets.TicksPerDay, Fact: f}
	return g.occasionOpens(row, c.Place, f, t)
}

// occasionsDue ends the occasions whose days have run, and rests their
// places.
func (g *Game) occasionsDue(t int64) error {
	for n := range g.Story.At {
		ps := &g.Story.At[n]
		o := ps.Occasion
		if o == nil || o.Ends > t || n >= len(g.Places) {
			continue
		}
		ps.Occasion = nil
		h := g.SettlementHex(n)
		if _, err := g.worldFact(h, "occasion.ended", []fact.Ref{arc.SettlementRef(n)}, []fact.ID{o.Fact},
			append([]fact.Datum{fact.S("occasion", o.Kind), fact.N("settlement", int64(n))}, fact.At(h)...)...); err != nil {
			return err
		}
		g.restScope(arc.Settlement, arc.SettlementRef(n), t)
	}
	return nil
}

// spreadsDay spreads each lapsed front's corruption to one of its region's
// awake neighbours, drawn per arc and day, for its days.
func (g *Game) spreadsDay(t int64) error {
	s := g.Story
	day := t / sheets.TicksPerDay
	p := g.r.Story
	for i := range s.Spreads {
		sp := &s.Spreads[i]
		if sp.Left <= 0 || sp.Region < 0 || sp.Region >= len(g.World.Regions) {
			sp.Left = 0
			continue
		}
		sp.Left--
		ns := g.World.Regions[sp.Region].Neighbours
		if len(ns) == 0 || p.FrontSpread == 0 {
			continue
		}
		k := g.r.draw.Below(uint64(len(ns)), spreadDraw, draw.Str(sp.Arc), draw.Int(day))
		g.Pending = append(g.Pending, world.Action{Kind: world.ActGauge, Hex: g.regionHex(ns[k]), By: arcRef(sp.Arc), Tag: gaugeCorruption, Units: p.FrontSpread})
	}
	s.Spreads = slices.DeleteFunc(s.Spreads, func(sp Spread) bool { return sp.Left <= 0 })
	return nil
}
