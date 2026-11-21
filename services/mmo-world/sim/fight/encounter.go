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
	"jams.team/mmo-world/sim/tally"
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

// Encounter is a run of beats against one creature, its count from the
// creature's tier, edited in place from beat to beat (GDD 7.1).
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
	Failures tally.Tally    `json:"failures"`
	Down     []string       `json:"down"`
	Gone     []string       `json:"gone"`   // backed out of a party
	Warded   []string       `json:"warded"` // characters whose ward has been used
	Haul     []item.Spoil   `json:"haul"`
	Lost     []item.Spoil   `json:"lost,omitempty"` // haul dropped on going down, left on the tile
	Share    tally.Tally    `json:"share"`          // contribution, for splitting the haul
	Party    int64          `json:"party"`
	Troubled bool           `json:"troubled"`
	Floor    int64          `json:"floor"`
	Over     bool           `json:"over"`
	Result   string         `json:"result,omitempty"`
	Why      []string       `json:"why,omitempty"`
	Salvage  []Salvaged     `json:"salvage,omitempty"` // left by gear that broke
}

// Salvaged is what one character's broken gear left them.
type Salvaged struct {
	Who   string       `json:"who"`
	Spoil []item.Spoil `json:"spoil"`
}

// Site is where an encounter happens. ID is the encounter's own
// identity and keys its draws, so two encounters on one tile differ;
// Place is the tile or floor its machines stand on ("tile:q,r" or
// "floor:<dungeon>/<n>"), ID when empty.
type Site struct {
	ID       string
	Place    string
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
	n := pick.Between(tier.BeatsMin, tier.BeatsMax)
	all := append(slices.Clone(c.Tags), site.Tags...)
	weights := make([]int64, len(r.beatIDs))
	for _, bt := range r.beatTags {
		if slices.Contains(all, tags.Tag(bt.Tag)) {
			weights[slices.Index(r.beatIDs, bt.Beat)] += bt.Weight
		}
	}
	for range n {
		e.Beats = append(e.Beats, r.beatIDs[pick.Pick(weights)])
	}
	mix := func() {
		if site.Floor == 0 || slices.ContainsFunc(e.Beats, r.mixes) {
			return
		}
		best := ""
		for i, id := range r.beatIDs {
			if r.mixes(id) && (best == "" || weights[i] > weights[slices.Index(r.beatIDs, best)]) {
				best = id
			}
		}
		e.Beats[0] = best
		e.Why = append(e.Why, "floor-mix")
	}
	mix()
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
	// A flight can cut off the mixing beat the hardest swap moved last.
	mix()
	for i, b := range e.Beats {
		fam, lvl := "", int64(0)
		if r.beats[b].Puzzle {
			fams := r.P.Families(all, b == BeatLock)
			if len(fams) == 0 {
				fallback := puzzle.Rewire
				if b == BeatLock {
					fallback = puzzle.Pins
				}
				fams = r.P.Families(tags.Of(r.P.Family(fallback).AppearsOn), b == BeatLock)
			}
			place := site.Place
			if place == "" {
				place = site.ID
			}
			w := puzzle.Where{Place: place, Beat: int64(i)}
			fam = fams[r.gen.Below(uint64(len(fams)), "encounter.machine", draw.Str(site.ID), draw.Int(int64(i)))]
			lvl = r.P.Level(fam, c.Tier, site.Floor, w)
		}
		e.Machines = append(e.Machines, fam)
		e.Levels = append(e.Levels, lvl)
	}
	return e
}

func (r *Rules) mixes(beat string) bool {
	return beat == "hazard" || r.beats[beat].Puzzle
}

// BeatLock is the beat whose machine is a lock; any other machine beat
// is a puzzle.
const BeatLock = "lock"

// Machine is the family on the encounter's current beat and whether it is
// a lock; ok is false on a beat with no machine.
func (r *Rules) Machine(e *Encounter) (family string, lock, ok bool) {
	if e.Over || !r.beats[e.Beats[e.At]].Puzzle {
		return "", false, false
	}
	return e.Machines[e.At], e.Beats[e.At] == BeatLock, true
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

// Choices is what a character sees on the current beat: the situation,
// their kit with their states and conditions added, and its options.
func (r *Rules) Choices(e *Encounter, c *char.Character, k Kit, tick int64) (Situation, Kit, []Option) {
	k.Self = slices.Concat(k.Self, e.SelfStates(c.ID), c.ConditionTags(tick))
	s := r.Situation(e, c.ID)
	return s, k, r.Options(s, k)
}

// OptionByID finds a picked option.
func OptionByID(opts []Option, id string) (Option, bool) {
	i := slices.IndexFunc(opts, func(o Option) bool { return o.ID == id })
	if i < 0 {
		return Option{}, false
	}
	return opts[i], true
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
	var wins int64
	left := false
	downBefore := len(e.Down)
	beat := r.beats[e.Beats[e.At]]
	if beat.Health > 0 && e.Guardian < 0 {
		e.Guardian = fixed.PercentOf(r.tiers[e.Creature.Tier].HuntHealth, beat.Health)
	}
	// Every pick is checked before any applies, so a refused press changes
	// nothing a retry would repeat.
	type chosen struct {
		m *Member
		s Situation
		o Option
	}
	var picks []chosen
	for _, m := range ms {
		if slices.Contains(e.Down, m.Ch.ID) || slices.Contains(e.Gone, m.Ch.ID) {
			continue
		}
		s, k, opts := r.Choices(e, m.Ch, m.Kit, tick)
		o, ok := OptionByID(opts, m.Pick)
		if !ok {
			return nil, nil, fmt.Errorf("fight: %s cannot pick %q here", m.Ch.ID, m.Pick)
		}
		if o.Puzzle && m.Puzzle == nil {
			return nil, nil, fmt.Errorf("fight: %s's %s needs a replayed machine", m.Ch.ID, o.ID)
		}
		pm := *m
		pm.Kit = k
		picks = append(picks, chosen{&pm, s, o})
	}
	for _, p := range picks {
		m, s, o := p.m, p.s, p.o
		var oc Outcome
		var why Why
		if o.Puzzle {
			oc, why = r.ResolvePuzzle(o, *m.Puzzle), o.Why
		} else {
			oc, why = r.Resolve(o, Roll{Who: m.Ch.ID, Encounter: e.ID, Beat: int64(e.At), Press: e.Press})
		}
		out = append(out, Pressed{Who: m.Ch.ID, Option: o, Outcome: oc, Why: why})
		f := r.apply(e, m, s, o, oc, tick)
		facts = append(facts, f...)
		switch {
		case o.Kind == WayOut:
			left = true
			e.Gone = append(e.Gone, m.Ch.ID)
		case o.Kind == Cast && oc.Success && !e.Final():
			wins++
		case o.Kind == Win && oc.Success:
			wins++
			e.Share.Bump(m.Ch.ID, max(1, o.Score))
			if e.Guardian >= 0 {
				e.Guardian = max(0, e.Guardian-o.Score)
			}
		}
		if e.Over {
			break
		}
	}
	if len(e.Down) > downBefore {
		for _, p := range picks {
			if !slices.Contains(e.Down, p.m.Ch.ID) && !slices.Contains(e.Gone, p.m.Ch.ID) {
				r.put(e, p.m, State{Tag: "shaken", On: OnSelf, Who: p.m.Ch.ID}, tick)
			}
		}
	}
	facts = append(facts, r.afterBeat(e, ms, out, wins, left, tick)...)
	return out, facts, nil
}

// apply is what one member's press does to them and their gear.
func (r *Rules) apply(e *Encounter, m *Member, s Situation, o Option, oc Outcome, tick int64) []fact.Fact {
	var facts []fact.Fact
	who := m.Ch.ID
	g := o.Gear
	beat := r.beats[s.Kind]
	if g != nil {
		facts = append(facts, r.wear(e, m, g, r.Param("beat-wear"), tick)...)
	}
	if o.Kind == Cast {
		charge := r.Param("cast-charge")
		if m.Kit.OffHand != nil {
			for _, p := range m.Kit.Exploit.Inst.Picks {
				if off, ok := r.G.ExploitOffer(p); ok && off.Effect == "charge" {
					charge = max(r.Param("cast-charge-min"), charge-off.Magnitude)
				}
			}
			facts = append(facts, r.wear(e, m, m.Kit.OffHand, charge, tick)...)
		}
	}
	creatureTags := append(slices.Clone(e.Creature.Tags), s.Other...)
	record := func(event string) {
		if g == nil || g.Inst.Broken() {
			return
		}
		g.Inst.Record.Add(event, tags.Tag(o.Verb), tags.Tag(s.Kind))
		g.Inst.Record.Each("vs", creatureTags...)
		g.Inst.Record.Each("in", s.Place...)
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
				units = fixed.PercentOf(units, r.P.HaulPercent(*oc.Puzzle))
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
		size /= halved
	}
	switch o.Risk {
	case "durability":
		if g != nil {
			if te := r.gearEffect(g, "wear-on-fail"); te != nil {
				size = fixed.PercentPlus(size, -te.Magnitude)
			}
			if g == m.Kit.Body {
				size = r.self(m.Kit, "armour-wear", size)
			}
			facts = append(facts, r.wear(e, m, g, size, tick)...)
		}
	case "wound":
		m.Ch.Set(char.Wounded, tick+r.Param("wound-ticks"))
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
	who := char.Ref(m.Ch.ID)
	if oc.Puzzle.Solved {
		return []fact.Fact{r.fact(tick, "puzzle.solved", []fact.Ref{who}, fact.S("family", s.Puzzle), fact.N("level", s.Level), fact.B("clean", oc.Puzzle.Clean))}
	}
	var facts []fact.Fact
	facts = append(facts, r.practise(m.Ch, s.Puzzle, r.P.Param("haywire-uses"), tick)...)
	hw := r.P.HaywireRow(oc.Puzzle.Haywire)
	switch hw.Effect {
	case "shock":
		if m.Kit.Hand != nil {
			facts = append(facts, r.wear(e, m, m.Kit.Hand, hw.Magnitude, tick)...)
		}
	case "short":
		st := State{Tag: tags.Tag(hw.Tag), On: OnSelf, Who: m.Ch.ID}
		// A state that counts beats is put on for the row's beats after
		// this one, which ends as the machine does.
		if row := r.states[st.Tag]; row != nil && row.Beats > 0 {
			st.Left = hw.Magnitude + 1
		}
		r.put(e, m, st, tick)
	case "alarm", "lockdown":
	}
	return append(facts, r.fact(tick, "puzzle.haywire", []fact.Ref{who}, fact.S("family", s.Puzzle), fact.S("haywire", hw.ID), fact.N("magnitude", hw.Magnitude)))
}

// afterBeat moves the encounter on: a won (or held, or failed) beat
// advances, the final beat must be won, and states tick down.
func (r *Rules) afterBeat(e *Encounter, ms []*Member, out []Pressed, wins int64, left bool, tick int64) []fact.Fact {
	var facts []fact.Fact
	stillUp := countUp(e, ms)
	switch {
	case e.Over:
	case left && stillUp == 0 && len(e.Down) == 0:
		e.Over, e.Result = true, Left
	case stillUp == 0:
		e.Over, e.Result = true, Lost
	}
	if !e.Over {
		won := wins*majority >= stillUp && wins > 0
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

func countUp(e *Encounter, ms []*Member) int64 {
	var n int64
	for _, m := range ms {
		if !slices.Contains(e.Down, m.Ch.ID) && !slices.Contains(e.Gone, m.Ch.ID) {
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
						*facts = append(*facts, r.wear(e, m, m.Kit.Hand, row.Wear, tick)...)
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
		beats = r.self(m.Kit, "state-beats", beats)
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
		e.Haul = item.AddSpoil(e.Haul, d, 1)
	}
}

func (r *Rules) loseHaul(e *Encounter, units int64) {
	for i := len(e.Haul) - 1; i >= 0 && units > 0; i-- {
		take := min(units, e.Haul[i].Qty)
		e.Haul[i].Qty -= take
		e.Lost = item.AddSpoil(e.Lost, e.Haul[i].Material, take)
		units -= take
	}
	e.Haul = slices.DeleteFunc(e.Haul, func(s item.Spoil) bool { return s.Qty == 0 })
}

// down: a second failure. The character cannot act; others in the beat
// are shaken; what was carried out of the outing is lost.
func (r *Rules) down(e *Encounter, m *Member, tick int64) []fact.Fact {
	e.Down = append(e.Down, m.Ch.ID)
	m.Ch.Set(char.Down, 0)
	m.Ch.Fights.Downs++
	m.Ch.Fights.DownedBy.Bump(e.Creature.Archetype, 1)
	m.Ch.Fights.DownedAt = append(m.Ch.Fights.DownedAt, m.Ch.At)
	return []fact.Fact{r.fact(tick, "character.down", []fact.Ref{char.Ref(m.Ch.ID), {Kind: "archetype", ID: e.Creature.Archetype}})}
}

// end closes an encounter: bleeding becomes a wound, a loss costs the
// haul, and the result is a fact.
func (r *Rules) end(e *Encounter, ms []*Member, tick int64) []fact.Fact {
	var subjects []fact.Ref
	for _, m := range ms {
		subjects = append(subjects, char.Ref(m.Ch.ID))
		for _, st := range e.States {
			if st.On == OnSelf && st.Who == m.Ch.ID && r.states[st.Tag] != nil && r.states[st.Tag].WoundsAtEnd {
				m.Ch.Set(char.Wounded, tick+r.Param("wound-ticks"))
			}
		}
	}
	if e.Result == Lost {
		r.loseHaul(e, fixed.PercentOf(item.Total(e.Haul), r.Param("haul-lost-on-down")))
	}
	subjects = append(subjects, fact.Ref{Kind: "archetype", ID: e.Creature.Archetype})
	return []fact.Fact{r.fact(tick, "encounter."+e.Result, subjects, fact.N("beats", int64(len(e.Beats))), fact.N("haul", item.Total(e.Haul)))}
}

// Split shares a haul by contribution, largest remainder first, ties by
// id: what each member takes home.
func Split(haul []item.Spoil, share tally.Tally) map[string][]item.Spoil {
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

// wear spends durability and reports a break or dormancy. Broken gear
// leaves the pack and the kit, and its salvage goes on the encounter.
func (r *Rules) wear(e *Encounter, m *Member, g *Gear, n int64, tick int64) []fact.Fact {
	who := char.Ref(m.Ch.ID)
	it := fact.Ref{Kind: "item", ID: g.Inst.ID}
	switch g.Inst.Use(n) {
	case item.Broke:
		m.Ch.Drop(g.Inst.ID)
		m.Kit.drop(g)
		salvage := r.D.Salvage(g.Kind.Recipe.Inputs, sheets.IntParam(r.wearParams, "salvage-break"))
		if len(salvage) > 0 {
			e.Salvage = append(e.Salvage, Salvaged{Who: m.Ch.ID, Spoil: salvage})
		}
		return []fact.Fact{r.fact(tick, "item.broke", []fact.Ref{who, it}, fact.N("salvage", item.Total(salvage)))}
	case item.WentDormant:
		return []fact.Fact{r.fact(tick, "item.dormant", []fact.Ref{who, it})}
	case item.Worn:
	}
	return nil
}

func (r *Rules) grow(m *Member, g *Gear, xp int64, tick int64) []fact.Fact {
	if g.Inst.Broken() {
		return nil
	}
	lv := r.G.AddXP(g.Inst, g.Kind, xp)
	if lv.To == lv.From {
		return nil
	}
	refs := []fact.Ref{char.Ref(m.Ch.ID), {Kind: "item", ID: g.Inst.ID}}
	facts := []fact.Fact{r.fact(tick, "item.levelled", refs, fact.N("level", lv.To))}
	for _, ms := range lv.Milestones {
		facts = append(facts, r.fact(tick, "item.milestone", refs, fact.N("level", ms)))
	}
	return facts
}

func (r *Rules) practise(c *char.Character, skill string, uses, tick int64) []fact.Fact {
	if n := c.Practise(skill, uses, r.G.Params()); n > 0 {
		return []fact.Fact{r.fact(tick, "practice.levelled", []fact.Ref{char.Ref(c.ID)}, fact.S("skill", skill), fact.N("level", c.Level(skill)))}
	}
	return nil
}

func (r *Rules) fact(tick int64, kind string, subjects []fact.Ref, data ...fact.Datum) fact.Fact {
	f, err := r.weights.New(tick, kind, "", subjects, nil, data...)
	if err != nil {
		panic(err)
	}
	return f
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
