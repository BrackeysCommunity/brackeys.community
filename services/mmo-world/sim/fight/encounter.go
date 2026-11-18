package fight

import (
	"fmt"
	"slices"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

// Where a state sits.
const (
	OnSelf     = "self"
	OnCreature = "creature"
	OnPlace    = "place"
)

// Results an encounter can end in.
const (
	Won     = "won"
	Lost    = "lost"
	Left    = "left"
	Escaped = "escaped"
	Held    = "held"
)

// State is a state in force: on whom, for whom (a character's own), and
// how many beats it has left (0: the rest of the encounter).
type State struct {
	Tag  tags.Tag `json:"tag"`
	On   string   `json:"on"`
	Who  string   `json:"who,omitempty"`
	Left int64    `json:"left"`
}

// Encounter is 3 to 6 beats against one creature, edited in place from
// beat to beat (GDD 7.1).
type Encounter struct {
	ID       string         `json:"id"`
	Creature Creature       `json:"creature"`
	Site     []tags.Tag     `json:"site"`
	Measures []tags.Measure `json:"-"`
	Beats    []string       `json:"beats"`
	Machines []string       `json:"machines"` // a Lock's or Puzzle's family, by beat
	Levels   []int64        `json:"levels"`
	At       int            `json:"at"`
	Press    int64          `json:"press"`
	Guardian int64          `json:"guardian"` // a guardian beat's health left
	States   []State        `json:"states"`
	Failures item.Tally     `json:"failures"`
	Down     []string       `json:"down"`
	Gone     []string       `json:"gone"`   // backed out of a party
	Warded   []string       `json:"warded"` // characters whose ward has been used
	Haul     []item.Spoil   `json:"haul"`
	Share    item.Tally     `json:"share"` // contribution, for splitting the haul
	Party    int64          `json:"party"`
	Troubled bool           `json:"troubled"`
	Floor    int64          `json:"floor"`
	Over     bool           `json:"over"`
	Result   string         `json:"result,omitempty"`
	Why      []string       `json:"why,omitempty"`
}

// Site is where an encounter happens.
type Site struct {
	ID       string
	Tags     []tags.Tag // the tile's, its weather's and its region's
	Measures []tags.Measure
	Party    int64
	Troubled bool
	Floor    int64 // a dungeon floor, from 1; 0 outside
}

// Assemble builds an encounter: its beat count from the creature's tier,
// each beat drawn by the weight the site's and creature's tags give it,
// the hardest moved last, joins and flights from behaviour rules, and on
// a dungeon floor at least one Hazard, Lock or Puzzle (GDD 7.9).
func (r *Rules) Assemble(site Site, c Creature) *Encounter {
	e := &Encounter{ID: site.ID, Creature: c, Site: slices.Clone(site.Tags), Measures: site.Measures,
		Party: max(1, site.Party), Troubled: site.Troubled, Floor: site.Floor, Guardian: -1}
	tier := r.tiers[c.Tier]
	pick := r.gen.Stream("encounter.beats", draw.Str(site.ID))
	n := tier.BeatsMin + int64(pick.Below(uint64(tier.BeatsMax-tier.BeatsMin+1)))
	all := append(slices.Clone(c.Tags), site.Tags...)
	weights := make([]int64, len(r.beatIDs))
	for _, bt := range r.beatTags {
		if slices.Contains(all, tags.Tag(bt.Tag)) {
			weights[slices.Index(r.beatIDs, bt.Beat)] += bt.Weight
		}
	}
	for range n {
		e.Beats = append(e.Beats, r.beatIDs[pickWeighted(weights, pick)])
	}
	if site.Floor > 0 && !slices.ContainsFunc(e.Beats, r.mixes) {
		best := ""
		for i, id := range r.beatIDs {
			if r.mixes(id) && (best == "" || weights[i] > weights[slices.Index(r.beatIDs, best)]) {
				best = id
			}
		}
		e.Beats[0] = best
		e.Why = append(e.Why, "floor-mix")
	}
	hardest := 0
	for i, b := range e.Beats {
		if r.beats[b].Modifier >= r.beats[e.Beats[hardest]].Modifier {
			hardest = i
		}
	}
	last := len(e.Beats) - 1
	e.Beats[hardest], e.Beats[last] = e.Beats[last], e.Beats[hardest]

	beh := r.Behave(c, site.Tags, site.Measures)
	e.Why = append(e.Why, beh.Because...)
	if beh.Joins > 0 {
		at := min(int(beh.JoinAt)-1, len(e.Beats)-1)
		for range beh.Joins * r.Param("join-beat") {
			e.Beats = slices.Insert(e.Beats, max(0, at), "clash")
		}
	}
	if beh.EndsAt > 0 && int(beh.EndsAt) < len(e.Beats) {
		e.Beats = e.Beats[:beh.EndsAt]
		e.Why = append(e.Why, "flees")
	}
	for i, b := range e.Beats {
		fam, lvl := "", int64(0)
		if r.beats[b].Puzzle {
			fams := r.P.Families(tagStrings(all), b == "lock")
			if len(fams) == 0 {
				fams = r.P.Families(r.P.Family(firstFamily(r, b == "lock")).AppearsOn, b == "lock")
			}
			w := puzzle.Where{Place: site.ID, Beat: int64(i)}
			fam = fams[r.gen.Below(uint64(len(fams)), "encounter.machine", draw.Str(site.ID), draw.Int(int64(i)))]
			lvl = r.P.Level(fam, c.Tier, site.Floor, w)
		}
		e.Machines = append(e.Machines, fam)
		e.Levels = append(e.Levels, lvl)
	}
	return e
}

func firstFamily(r *Rules, lockpick bool) string {
	for _, f := range r.P.Families(nil, lockpick) {
		return f
	}
	if lockpick {
		return puzzle.Pins
	}
	return puzzle.Rewire
}

func (r *Rules) mixes(beat string) bool {
	return beat == "hazard" || r.beats[beat].Puzzle
}

func pickWeighted(w []int64, s *draw.Stream) int {
	var total int64
	for _, x := range w {
		total += x
	}
	if total == 0 {
		return 0
	}
	n := int64(s.Below(uint64(total)))
	for i, x := range w {
		if n < x {
			return i
		}
		n -= x
	}
	return 0
}

func tagStrings(ts []tags.Tag) []string {
	out := make([]string, len(ts))
	for i, t := range ts {
		out[i] = string(t)
	}
	return out
}

// Final reports whether the encounter is on its last beat.
func (e *Encounter) Final() bool { return e.At == len(e.Beats)-1 }

// Situation is the current beat as one character sees it.
func (r *Rules) Situation(e *Encounter, who string) Situation {
	s := Situation{Encounter: e.ID, Beat: int64(e.At), Kind: e.Beats[e.At], Creature: &e.Creature,
		Place: slices.Clone(e.Site), Measures: e.Measures, Party: e.Party - int64(len(e.Down)), Troubled: e.Troubled,
		Puzzle: e.Machines[e.At], Level: e.Levels[e.At]}
	for _, st := range e.States {
		switch st.On {
		case OnCreature:
			s.Other = append(s.Other, st.Tag)
		case OnPlace:
			s.Place = append(s.Place, st.Tag)
		}
	}
	return s
}

// SelfStates are the states on one character.
func (e *Encounter) SelfStates(who string) []tags.Tag {
	var out []tags.Tag
	for _, st := range e.States {
		if st.On == OnSelf && st.Who == who {
			out = append(out, st.Tag)
		}
	}
	return out
}

// Member is one character pressing on a beat.
type Member struct {
	Ch     *char.Character
	Kit    Kit
	Pick   string
	Puzzle *puzzle.Result // a replayed machine, for a Lock or Puzzle pick
}

// Pressed is what one member's press did.
type Pressed struct {
	Who     string  `json:"who"`
	Option  Option  `json:"option"`
	Outcome Outcome `json:"outcome"`
	Why     Why     `json:"why"`
}

// Press resolves one beat for everyone in it. Each member picks
// privately; the beat is won when at least half of those still up win
// with a winning option (GDD 7.5).
func (r *Rules) Press(e *Encounter, ms []*Member, tick int64) ([]Pressed, []fact.Fact, error) {
	if e.Over {
		return nil, nil, fmt.Errorf("fight: encounter %s is over", e.ID)
	}
	var out []Pressed
	var facts []fact.Fact
	var wins, up int64
	left := false
	downBefore := len(e.Down)
	beat := r.beats[e.Beats[e.At]]
	if beat.Health > 0 && e.Guardian < 0 {
		e.Guardian = fixed.Ratio(r.tiers[e.Creature.Tier].HuntHealth*beat.Health, percent).Int()
	}
	for _, m := range ms {
		if slices.Contains(e.Down, m.Ch.ID) || slices.Contains(e.Gone, m.Ch.ID) {
			continue
		}
		up++
		m.Kit.Self = append(m.Kit.Self, e.SelfStates(m.Ch.ID)...)
		m.Kit.Self = append(m.Kit.Self, m.Ch.ConditionTags(tick)...)
		s := r.Situation(e, m.Ch.ID)
		opts := r.Options(s, m.Kit)
		i := slices.IndexFunc(opts, func(o Option) bool { return o.ID == m.Pick })
		if i < 0 {
			return nil, nil, fmt.Errorf("fight: %s cannot pick %q here", m.Ch.ID, m.Pick)
		}
		o := opts[i]
		id := Roll{Who: m.Ch.ID, Encounter: e.ID, Beat: int64(e.At), Press: e.Press}
		var oc Outcome
		var why Why
		switch {
		case o.Puzzle && m.Puzzle == nil:
			return nil, nil, fmt.Errorf("fight: %s's %s needs a replayed machine", m.Ch.ID, o.ID)
		case o.Puzzle:
			oc, why = r.ResolvePuzzle(o, *m.Puzzle), o.Why
		default:
			oc, why = r.Resolve(o, id)
		}
		out = append(out, Pressed{Who: m.Ch.ID, Option: o, Outcome: oc, Why: why})
		f := r.apply(e, m, s, o, oc, tick)
		facts = append(facts, f...)
		switch {
		case o.Kind == WayOut:
			left = true
			e.Gone = append(e.Gone, m.Ch.ID)
		case o.Kind == Win && oc.Success:
			wins++
			e.Share.Bump(m.Ch.ID, max(1, o.Score))
			if e.Guardian >= 0 {
				e.Guardian = max(0, e.Guardian-o.Score)
			}
		}
	}
	if len(e.Down) > downBefore {
		for _, m := range ms {
			if !slices.Contains(e.Down, m.Ch.ID) {
				r.put(e, m, State{Tag: "shaken", On: OnSelf, Who: m.Ch.ID}, tick)
			}
		}
	}
	facts = append(facts, r.afterBeat(e, ms, out, wins, up, left, tick)...)
	return out, facts, nil
}

// apply is what one member's press does to them and their gear.
func (r *Rules) apply(e *Encounter, m *Member, s Situation, o Option, oc Outcome, tick int64) []fact.Fact {
	var facts []fact.Fact
	who := m.Ch.ID
	g := o.Gear
	beat := r.beats[s.Kind]
	if g != nil {
		facts = append(facts, r.wear(m, g, r.Param("beat-wear"), tick)...)
	}
	if o.Kind == Cast {
		charge := r.Param("cast-charge")
		if m.Kit.OffHand != nil {
			for _, p := range m.Kit.Exploit.Inst.Picks {
				if off, ok := r.G.ExploitOffer(p); ok && off.Effect == "charge" {
					charge = max(r.Param("cast-charge-min"), charge-off.Magnitude)
				}
			}
			facts = append(facts, r.wear(m, m.Kit.OffHand, charge, tick)...)
		}
	}
	creatureTags := append(slices.Clone(e.Creature.Tags), s.Other...)
	record := func(event string) {
		if g == nil {
			return
		}
		g.Inst.Record.Add(event, tags.Tag(o.Verb), tags.Tag(s.Kind))
		for _, t := range creatureTags {
			g.Inst.Record.Bump("vs:"+string(t), 1)
		}
		for _, t := range s.Place {
			g.Inst.Record.Bump("in:"+string(t), 1)
		}
	}
	if o.Puzzle {
		facts = append(facts, r.machine(e, m, s, oc, tick)...)
	}
	if oc.Success {
		record("won")
		m.Ch.Fights.Won.Add("beat", creatureTags...)
		if o.Practice != "" && o.Practice != "standing" {
			uses := int64(1)
			if o.Puzzle {
				uses = r.P.Param("live-solve-uses")
			}
			facts = append(facts, r.practise(m.Ch, o.Practice, uses, tick)...)
			if o.Puzzle && o.Practice != s.Puzzle {
				facts = append(facts, r.practise(m.Ch, s.Puzzle, uses, tick)...)
			}
		}
		switch o.Kind {
		case Win:
			units := beat.Haul
			if s.Kind == "harvest" {
				if te := r.gearEffect(g, "gather-units"); te != nil {
					units += te.Magnitude
				}
			}
			if oc.Puzzle != nil {
				units = fixed.Ratio(units*r.P.HaulPercent(*oc.Puzzle), percent).Int()
			}
			r.haul(e, units, e.Press)
			if o.Verb == "strike" || o.Verb == "smash" {
				r.onHit(e, g)
			}
		case Cast:
			r.cast(e, m, tick)
		case Careful:
			r.put(e, m, State{Tag: "braced", On: OnSelf, Who: who}, tick)
		}
		if g != nil && o.Kind != WayOut {
			xp := r.G.FightXP(g.Kind.Tier, e.Creature.Tier, o.Kind != Careful, e.Troubled)
			facts = append(facts, r.grow(m, g, xp, tick)...)
		}
		return facts
	}
	if o.Puzzle {
		return facts
	}
	// Failure: the stated risk lands.
	record("lost")
	m.Ch.Fights.Lost.Add("beat", creatureTags...)
	e.Failures.Bump(who, 1)
	half := slices.ContainsFunc(e.States, func(st State) bool {
		return st.On == OnSelf && st.Who == who && r.states[st.Tag] != nil && r.states[st.Tag].HalvesNext
	})
	if half {
		e.States = slices.DeleteFunc(e.States, func(st State) bool {
			return st.On == OnSelf && st.Who == who && r.states[st.Tag] != nil && r.states[st.Tag].HalvesNext
		})
	}
	size := o.RiskSize
	if half {
		size /= statHalf
	}
	switch o.Risk {
	case "durability":
		if g != nil {
			if te := r.gearEffect(g, "wear-on-fail"); te != nil {
				size = fixed.Ratio(size*(percent-te.Magnitude), percent).Int()
			}
			facts = append(facts, r.wear(m, g, size, tick)...)
		}
	case "wound":
		m.Ch.Set("wounded", tick+r.Param("wound-ticks"))
	case "haul":
		r.loseHaul(e, size)
	case "first-strike":
		if r.kitEffect(m.Kit, "no-first-strike") == nil {
			r.put(e, m, State{Tag: "off-guard", On: OnSelf, Who: who}, tick)
		}
	case "escape":
		e.Over, e.Result = true, Escaped
	case "coin":
		m.Ch.Coin = max(0, m.Ch.Coin-size)
	case "standing", "ticks", "none":
	}
	if s.Kind == "clash" {
		r.put(e, m, State{Tag: "bleeding", On: OnSelf, Who: who}, tick)
	}
	if g != nil {
		xp := r.G.FightXP(g.Kind.Tier, e.Creature.Tier, false, false)
		facts = append(facts, r.grow(m, g, xp, tick)...)
	}
	if e.Failures.Get(who) >= r.Param("failures-to-down") {
		facts = append(facts, r.down(e, m, tick)...)
	}
	return facts
}

// machine applies a Lock's or Puzzle's result: a solve counts toward
// practice; a haywire does its row's damage and is not a failure of the
// fight.
func (r *Rules) machine(e *Encounter, m *Member, s Situation, oc Outcome, tick int64) []fact.Fact {
	who := fact.Ref{Kind: "character", ID: m.Ch.ID}
	if oc.Puzzle.Solved {
		return []fact.Fact{r.fact(tick, "puzzle.solved", []fact.Ref{who}, fact.S("family", s.Puzzle), fact.N("level", s.Level), fact.N("clean", boolN(oc.Puzzle.Clean)))}
	}
	var facts []fact.Fact
	facts = append(facts, r.practise(m.Ch, s.Puzzle, r.P.Param("haywire-uses"), tick)...)
	hw := r.P.HaywireRow(oc.Puzzle.Haywire)
	switch hw.Effect {
	case "shock":
		if m.Kit.Hand != nil {
			facts = append(facts, r.wear(m, m.Kit.Hand, hw.Magnitude, tick)...)
		}
	case "short":
		r.put(e, m, State{Tag: tags.Tag(hw.Tag), On: OnSelf, Who: m.Ch.ID}, tick)
	case "alarm", "lockdown":
	}
	return append(facts, r.fact(tick, "puzzle.haywire", []fact.Ref{who}, fact.S("family", s.Puzzle), fact.S("haywire", hw.ID), fact.N("magnitude", hw.Magnitude)))
}

func boolN(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

// afterBeat moves the encounter on: a won (or held, or failed) beat
// advances, the final beat must be won, and states tick down.
func (r *Rules) afterBeat(e *Encounter, ms []*Member, out []Pressed, wins, up int64, left bool, tick int64) []fact.Fact {
	var facts []fact.Fact
	stillUp := up - int64(countOut(e, ms))
	switch {
	case e.Over:
	case left && stillUp == 0 && len(e.Down) == 0:
		e.Over, e.Result = true, Left
	case stillUp == 0:
		e.Over, e.Result = true, Lost
	}
	if !e.Over {
		won := wins*statHalf >= stillUp && wins > 0
		careful := allCareful(out)
		switch {
		case e.Guardian > 0:
			e.Press++
		case e.Final() && won:
			e.Over, e.Result = true, Won
		case e.Final() && careful:
			e.Over, e.Result = true, Held
		case e.Final():
			e.Press++
		case castOnly(out):
			e.Press++
		default:
			e.At++
			e.Press = 0
			e.Guardian = -1
		}
	}
	r.tickStates(e, ms, tick, &facts)
	if e.Over {
		facts = append(facts, r.end(e, ms, tick)...)
	}
	return facts
}

func countOut(e *Encounter, ms []*Member) int {
	n := 0
	for _, m := range ms {
		if slices.Contains(e.Down, m.Ch.ID) || slices.Contains(e.Gone, m.Ch.ID) {
			n++
		}
	}
	return n
}

func allCareful(out []Pressed) bool {
	for _, p := range out {
		if p.Option.Kind != Careful || !p.Outcome.Success {
			return false
		}
	}
	return len(out) > 0
}

func castOnly(out []Pressed) bool {
	for _, p := range out {
		if p.Option.Kind != Cast {
			return false
		}
	}
	return len(out) > 0
}

// tickStates counts states down a beat; burning wears its holder's hand
// item and ends on wet.
func (r *Rules) tickStates(e *Encounter, ms []*Member, tick int64, facts *[]fact.Fact) {
	var keep []State
	for _, st := range e.States {
		row := r.states[st.Tag]
		if row != nil && row.EndsOn != "" && r.holds(e, st, tags.Tag(row.EndsOn)) {
			continue
		}
		if row != nil && row.Wear > 0 {
			switch st.On {
			case OnSelf:
				for _, m := range ms {
					if m.Ch.ID == st.Who && m.Kit.Hand != nil {
						*facts = append(*facts, r.wear(m, m.Kit.Hand, row.Wear, tick)...)
					}
				}
			case OnCreature:
				if e.Guardian > 0 {
					e.Guardian = max(0, e.Guardian-row.Wear)
				}
			}
		}
		if st.Left > 0 {
			st.Left--
			if st.Left == 0 {
				continue
			}
		}
		keep = append(keep, st)
	}
	e.States = keep
}

func (r *Rules) holds(e *Encounter, st State, t tags.Tag) bool {
	return slices.ContainsFunc(e.States, func(x State) bool { return x.Tag == t && (x.On == st.On || x.On == OnPlace) })
}

// put adds a state; a character's warded item turns aside the first
// state put on them in an encounter.
func (r *Rules) put(e *Encounter, m *Member, st State, tick int64) {
	if st.On == OnSelf && st.Tag != "braced" && !slices.Contains(e.Warded, st.Who) && r.kitEffect(m.Kit, "ward-first") != nil {
		e.Warded = append(e.Warded, st.Who)
		return
	}
	if st.Left == 0 {
		if row := r.states[st.Tag]; row != nil {
			st.Left = row.Beats
		}
	}
	e.States = slices.DeleteFunc(e.States, func(x State) bool { return x.Tag == st.Tag && x.On == st.On && x.Who == st.Who })
	e.States = append(e.States, st)
}

// onHit: a won strike can leave a state on the creature, and an arcing
// conductive hit takes a joined creature with it.
func (r *Rules) onHit(e *Encounter, g *Gear) {
	for _, te := range r.traitFx {
		if te.Effect != "on-hit-state" || !g.has(tags.Tag(te.Tag)) {
			continue
		}
		if te.Lacks != "" && slices.Contains(e.Creature.Tags, tags.Tag(te.Lacks)) {
			continue
		}
		r.put(e, nil, State{Tag: tags.Tag(te.State), On: OnCreature}, 0)
	}
	if r.gearEffect(g, "arc") != nil && g.has("conductive") {
		for i := len(e.Beats) - 1; i > e.At; i-- {
			if e.Beats[i] == "clash" && i < len(e.Beats)-1 {
				e.Beats = slices.Delete(e.Beats, i, i+1)
				e.Machines = slices.Delete(e.Machines, i, i+1)
				e.Levels = slices.Delete(e.Levels, i, i+1)
				break
			}
		}
	}
}

// cast lands an exploit's state: on the creature, on the tile, on the
// caster, or on every creature holding a tag; for longer with level and
// traits.
func (r *Rules) cast(e *Encounter, m *Member, tick int64) {
	ex := m.Kit.Exploit
	x := ex.Kind.Exploit
	if x == nil || x.State == "" {
		return
	}
	row := r.states[tags.Tag(x.State)]
	beats := row.Beats
	if beats > 0 {
		beats += r.G.ExploitBeats(ex.Inst.Level)
		for _, te := range r.traitFx {
			if te.Effect == "state-beats" && ex.has(tags.Tag(te.Tag)) && (te.Place == "" || slices.Contains(e.Site, tags.Tag(te.Place)) || r.holds(e, State{On: OnPlace}, tags.Tag(te.Place))) {
				beats += te.Magnitude
			}
		}
		for _, p := range ex.Inst.Picks {
			if off, ok := r.G.ExploitOffer(p); ok && off.Effect == "echo" {
				beats++
			}
		}
	}
	creature := append(slices.Clone(e.Creature.Tags), r.Situation(e, m.Ch.ID).Other...)
	if x.OnlyTag != "" && x.Target != "caster" && !slices.Contains(creature, tags.Tag(x.OnlyTag)) {
		return
	}
	switch x.Target {
	case "caster":
		r.put(e, m, State{Tag: tags.Tag(x.State), On: OnSelf, Who: m.Ch.ID, Left: beats}, tick)
	case "tile":
		r.put(e, m, State{Tag: tags.Tag(x.State), On: OnPlace, Left: beats}, tick)
		r.put(e, m, State{Tag: tags.Tag(x.State), On: OnCreature, Left: beats}, tick)
	case "creature", "tagged":
		r.put(e, m, State{Tag: tags.Tag(x.State), On: OnCreature, Left: beats}, tick)
	}
	ex.Inst.Record.Add("landed", tags.Tag(x.State))
	ex.Inst.Record.Add("cast")
}

func (r *Rules) haul(e *Encounter, units, press int64) {
	if units <= 0 || len(e.Creature.Drops) == 0 {
		return
	}
	for u := range units {
		d := e.Creature.Drops[r.gen.Below(uint64(len(e.Creature.Drops)), "encounter.drop", draw.Str(e.ID), draw.Int(int64(e.At)), draw.Int(press), draw.Int(u))]
		e.Haul = addSpoil(e.Haul, d, 1)
	}
}

func (r *Rules) loseHaul(e *Encounter, units int64) {
	for i := len(e.Haul) - 1; i >= 0 && units > 0; i-- {
		take := min(units, e.Haul[i].Qty)
		e.Haul[i].Qty -= take
		units -= take
	}
	e.Haul = slices.DeleteFunc(e.Haul, func(s item.Spoil) bool { return s.Qty == 0 })
}

func addSpoil(list []item.Spoil, m string, n int64) []item.Spoil {
	for i := range list {
		if list[i].Material == m {
			list[i].Qty += n
			return list
		}
	}
	return append(list, item.Spoil{Material: m, Qty: n})
}

// down: a second failure. The character cannot act; others in the beat
// are shaken; what was carried out of the outing is lost.
func (r *Rules) down(e *Encounter, m *Member, tick int64) []fact.Fact {
	e.Down = append(e.Down, m.Ch.ID)
	m.Ch.Set("down", 0)
	m.Ch.Fights.Downs++
	m.Ch.Fights.DownedBy.Bump(e.Creature.Archetype, 1)
	m.Ch.Fights.DownedAt = append(m.Ch.Fights.DownedAt, m.Ch.At)
	return []fact.Fact{r.fact(tick, "character.down", []fact.Ref{{Kind: "character", ID: m.Ch.ID}, {Kind: "archetype", ID: e.Creature.Archetype}})}
}

// end closes an encounter: bleeding becomes a wound, a loss costs the
// haul, and the result is a fact.
func (r *Rules) end(e *Encounter, ms []*Member, tick int64) []fact.Fact {
	var subjects []fact.Ref
	for _, m := range ms {
		subjects = append(subjects, fact.Ref{Kind: "character", ID: m.Ch.ID})
		for _, st := range e.States {
			if st.On == OnSelf && st.Who == m.Ch.ID && r.states[st.Tag] != nil && r.states[st.Tag].WoundsAtEnd {
				m.Ch.Set("wounded", tick+r.Param("wound-ticks"))
			}
		}
	}
	if e.Result == Lost {
		r.loseHaul(e, fixed.Ratio(total(e.Haul)*r.Param("haul-lost-on-down"), percent).Int())
	}
	subjects = append(subjects, fact.Ref{Kind: "archetype", ID: e.Creature.Archetype})
	return []fact.Fact{r.fact(tick, "encounter."+e.Result, subjects, fact.N("beats", int64(len(e.Beats))), fact.N("haul", total(e.Haul)))}
}

func total(ss []item.Spoil) int64 {
	var n int64
	for _, s := range ss {
		n += s.Qty
	}
	return n
}

// Split shares a haul by contribution, largest remainder first, ties by
// id: what each member takes home.
func Split(haul []item.Spoil, share item.Tally) map[string][]item.Spoil {
	out := map[string][]item.Spoil{}
	var whole int64
	for _, c := range share {
		whole += c.N
	}
	if whole == 0 {
		return out
	}
	for _, s := range haul {
		type cut struct {
			who  string
			n    int64
			rest int64
		}
		var cuts []cut
		var given int64
		for _, c := range share {
			n := s.Qty * c.N / whole
			cuts = append(cuts, cut{c.Key, n, s.Qty * c.N % whole})
			given += n
		}
		slices.SortStableFunc(cuts, func(a, b cut) int {
			if a.rest != b.rest {
				return int(b.rest - a.rest)
			}
			return 0
		})
		for i := range cuts {
			if given < s.Qty {
				cuts[i].n++
				given++
			}
		}
		for _, c := range cuts {
			if c.n > 0 {
				out[c.who] = append(out[c.who], item.Spoil{Material: s.Material, Qty: c.n})
			}
		}
	}
	return out
}

// wear spends durability and reports a break or dormancy.
func (r *Rules) wear(m *Member, g *Gear, n int64, tick int64) []fact.Fact {
	who := fact.Ref{Kind: "character", ID: m.Ch.ID}
	it := fact.Ref{Kind: "item", ID: g.Inst.ID}
	switch g.Inst.Use(n) {
	case item.Broke:
		m.Ch.Pack = slices.DeleteFunc(m.Ch.Pack, func(in *item.Instance) bool { return in.ID == g.Inst.ID })
		salvage := r.D.Salvage(g.Kind.Recipe.Inputs, sheets.IntParam(r.wearParams, "salvage-break"))
		return []fact.Fact{r.fact(tick, "item.broke", []fact.Ref{who, it}, fact.N("salvage", total(salvage)))}
	case item.WentDormant:
		return []fact.Fact{r.fact(tick, "item.dormant", []fact.Ref{who, it})}
	case item.Worn:
	}
	return nil
}

func (r *Rules) grow(m *Member, g *Gear, xp int64, tick int64) []fact.Fact {
	lv := r.G.AddXP(g.Inst, g.Kind, xp)
	if lv.To == lv.From {
		return nil
	}
	refs := []fact.Ref{{Kind: "character", ID: m.Ch.ID}, {Kind: "item", ID: g.Inst.ID}}
	facts := []fact.Fact{r.fact(tick, "item.levelled", refs, fact.N("level", lv.To))}
	for _, ms := range lv.Milestones {
		facts = append(facts, r.fact(tick, "item.milestone", refs, fact.N("level", ms)))
	}
	return facts
}

func (r *Rules) practise(c *char.Character, skill string, uses, tick int64) []fact.Fact {
	if n := c.Practise(skill, uses, r.G.Params()); n > 0 {
		return []fact.Fact{r.fact(tick, "practice.levelled", []fact.Ref{{Kind: "character", ID: c.ID}}, fact.S("skill", skill), fact.N("level", c.Level(skill)))}
	}
	return nil
}

func (r *Rules) fact(tick int64, kind string, subjects []fact.Ref, data ...fact.Datum) fact.Fact {
	return fact.Fact{Tick: tick, Kind: kind, Subjects: subjects, Data: data, Weight: r.weights[kind]}
}

// KitOf resolves a character's equipped items into a kit.
func (r *Rules) KitOf(c *char.Character) Kit {
	gear := func(in *item.Instance) *Gear {
		if in == nil {
			return nil
		}
		k, ok := r.D.Reg.Kind(in.Kind)
		if !ok {
			return nil
		}
		return &Gear{Inst: in, Kind: k, Tags: in.Tags(k, r.D)}
	}
	k := Kit{Who: c.ID, Hand: gear(c.In(char.Hand, 0)), OffHand: gear(c.In(char.OffHand, 0)), Body: gear(c.In(char.Body, 0)),
		Practice: c.Level}
	for i := range int(r.Param("charm-slots")) {
		if g := gear(c.In(char.Charm, i)); g != nil {
			k.Charms = append(k.Charms, g)
		}
	}
	if k.OffHand != nil && k.OffHand.Inst.Exploit != nil {
		k.Exploit = gear(k.OffHand.Inst.Exploit)
	}
	return k
}
