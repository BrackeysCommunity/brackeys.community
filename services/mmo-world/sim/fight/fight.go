// Package fight is encounters, headless: creatures from archetypes, beats
// chosen by tags, options from the tags of the situation and the kit,
// keyed resolution, outcomes and states, parties and hunts (GDD 7).
package fight

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

// structural: a score is half its stat.
const statHalf = 2

// structural: a halving state and the spoils' floor each take half.
const halved = 2

// structural: a vote carries when the wins are at least half of those
// still up.
const majority = 2

// Option kinds, as fights.options names them.
const (
	Win     = "win"
	Careful = "cautious"
	WayOut  = "way-out"
	Cast    = "cast"
)

// Rules holds the Fights sheets and the keys. One per world.
type Rules struct {
	D          *item.Deriver
	G          *item.Growth
	P          *puzzle.Puzzles
	rules      []tags.Rule
	tiers      map[int64]*sheets.FightTier
	beats      map[string]*sheets.BeatKind
	beatIDs    []string
	beatTags   []sheets.BeatTag
	options    []sheets.OptionRow
	states     map[tags.Tag]*sheets.StateRow
	traitFx    []sheets.TraitEffect
	margins    []sheets.MarginBand
	bands      []sheets.OddsBand
	pairings   []sheets.Pairing
	creatures  map[string]*sheets.Creature
	hunts      map[string]*sheets.Hunt
	params     []sheets.Param
	wearParams []sheets.Param
	weights    fact.Weights
	roll       *draw.Drawer
	gen        *draw.Drawer
}

func New(b *sheets.Book, d *item.Deriver, g *item.Growth, p *puzzle.Puzzles, k keys.Set) (*Rules, error) {
	rs, err := tags.Compile(b.Rules)
	if err != nil {
		return nil, err
	}
	r := &Rules{D: d, G: g, P: p, rules: rs, tiers: map[int64]*sheets.FightTier{}, beats: sheets.Lookup(b.Beats),
		beatTags: b.BeatTags, options: b.Options, states: map[tags.Tag]*sheets.StateRow{}, traitFx: b.TraitEffects,
		margins: b.Margins, bands: b.OddsBands, pairings: b.Pairings, creatures: sheets.Lookup(b.Creatures),
		hunts: sheets.Lookup(b.Hunts), params: b.FightParams, wearParams: b.WearParams, weights: fact.NewWeights(b.FactWeights),
		roll: draw.NewDrawer(k.Roll), gen: draw.NewDrawer(k.Generation)}
	for i := range b.FightTiers {
		r.tiers[b.FightTiers[i].Tier] = &b.FightTiers[i]
	}
	for _, bk := range b.Beats {
		r.beatIDs = append(r.beatIDs, bk.ID)
	}
	for i := range b.States {
		r.states[tags.Tag(b.States[i].Tag)] = &b.States[i]
	}
	slices.SortFunc(r.bands, func(a, c sheets.OddsBand) int { return cmp.Compare(a.Rank, c.Rank) })
	return r, nil
}

func (r *Rules) Param(id string) int64 { return sheets.IntParam(r.params, id) }

// Tier is a creature tier's row.
func (r *Rules) Tier(t int64) *sheets.FightTier { return r.tiers[t] }

// Gear is an equipped instance with its kind and tags resolved.
type Gear struct {
	Inst *item.Instance
	Kind *item.Kind
	Tags []tags.Tag
}

func (g *Gear) has(t tags.Tag) bool { return g != nil && slices.Contains(g.Tags, t) }

// Kit is what a character brings to a beat.
type Kit struct {
	Who      string
	Hand     *Gear
	OffHand  *Gear
	Body     *Gear
	Charms   []*Gear
	Exploit  *Gear // the exploit the off-hand deck holds
	Practice func(skill string) int64
	Standing int64 // with whoever a parley is with
	// Self is the character's own states and conditions.
	Self []tags.Tag
}

func (k Kit) slot(s string) *Gear {
	switch s {
	case char.Hand:
		return k.Hand
	case char.OffHand:
		return k.OffHand
	case char.Body:
		return k.Body
	case deckSlot:
		if k.OffHand != nil && k.Exploit != nil && k.OffHand.has("focus") {
			return k.Exploit
		}
	}
	return nil
}

// deckSlot is an option's slot for the exploit an off-hand focus holds.
const deckSlot = "deck"

// drop takes broken gear out of the kit.
func (k *Kit) drop(g *Gear) {
	for _, p := range []**Gear{&k.Hand, &k.OffHand, &k.Body, &k.Exploit} {
		if *p == g {
			*p = nil
		}
	}
	k.Charms = slices.DeleteFunc(k.Charms, func(c *Gear) bool { return c == g })
}

func (k Kit) all() []*Gear {
	var out []*Gear
	for _, g := range append([]*Gear{k.Hand, k.OffHand, k.Body, k.Exploit}, k.Charms...) {
		if g != nil {
			out = append(out, g)
		}
	}
	return out
}

func (k Kit) practice(skill string) int64 {
	if k.Practice == nil {
		return 0
	}
	return k.Practice(skill)
}

// pairingTags are the tags a loadout's pairings give: two tags held by
// two different equipped items or exploits (GDD 9.8).
func (r *Rules) pairingTags(k Kit) []tags.Tag {
	gear := k.all()
	var out []tags.Tag
	for _, p := range r.pairings {
		for i, a := range gear {
			for j, b := range gear {
				if i != j && a.has(tags.Tag(p.TagA)) && b.has(tags.Tag(p.TagB)) && !slices.Contains(out, tags.Tag(p.Tag)) {
					out = append(out, tags.Tag(p.Tag))
				}
			}
		}
	}
	return out
}

// Pairings names the pairings a kit makes, for the Battle run.
func (r *Rules) Pairings(k Kit) []string {
	var out []string
	for _, t := range r.pairingTags(k) {
		out = append(out, string(t))
	}
	return out
}

// Situation is one beat as the rules see it.
type Situation struct {
	Encounter string
	Beat      int64 // 0-based index
	Kind      string
	Creature  *Creature
	// Other holds the creature's states; Place the tile's, the weather's
	// and the region's tags and states.
	Other    []tags.Tag
	Place    []tags.Tag
	Measures []tags.Measure
	Party    int64
	Troubled bool
	Puzzle   string // the machine's family on a Lock or Puzzle beat
	Level    int64  // the machine's level
}

// Part is one line of a score's why.
type Part struct {
	Label string `json:"label"`
	Value int64  `json:"value"`
}

// Why is everything behind an option's band (GDD 8.4).
type Why struct {
	Parts    []Part   `json:"parts"`
	Rules    tags.Why `json:"rules"`
	BandFrom int64    `json:"bandFrom"`
	BandTo   int64    `json:"bandTo"`
	Notes    []string `json:"notes,omitempty"`
}

// Option is one choice on a beat, with its odds and stated risk.
type Option struct {
	ID         string     `json:"id"`
	Verb       string     `json:"verb"`
	Kind       string     `json:"kind"`
	Slot       string     `json:"slot"`
	Gear       *Gear      `json:"-"`
	Axis       string     `json:"axis,omitempty"`
	Practice   string     `json:"practice"`
	Stat       int64      `json:"stat"`
	Score      int64      `json:"score"`
	Difficulty int64      `json:"difficulty"`
	Margin     int64      `json:"margin"`
	Band       int64      `json:"band"`
	Chance     fixed.F    `json:"chance"`
	Rolled     bool       `json:"rolled"`
	Risk       string     `json:"risk"`
	RiskSize   int64      `json:"riskSize"`
	Tags       []tags.Tag `json:"tags"`
	Puzzle     bool       `json:"puzzle,omitempty"`
	Why        Why        `json:"why"`
}

// Difficulty is the creature tier's base plus the beat's modifier, more
// per party member past the first.
func (r *Rules) Difficulty(s Situation) int64 {
	base := r.tiers[s.Creature.Tier].BaseDifficulty + r.beats[s.Kind].Modifier
	if s.Party > 1 {
		base = fixed.PercentPlus(base, r.Param("party-difficulty-step")*(s.Party-1))
	}
	return base
}

// BandOf is the band a margin falls in, as a rank.
func (r *Rules) BandOf(margin int64) int64 {
	for _, m := range r.margins {
		if margin >= m.AtLeast {
			return r.rank(m.Band)
		}
	}
	return r.bands[0].Rank
}

func (r *Rules) rank(id string) int64 {
	for _, b := range r.bands {
		if b.ID == id {
			return b.Rank
		}
	}
	return 0
}

func (r *Rules) band(rank int64) sheets.OddsBand {
	for _, b := range r.bands {
		if b.Rank == rank {
			return b
		}
	}
	return r.bands[0]
}

// BandName is a rank's id, for reports.
func (r *Rules) BandName(rank int64) string { return r.band(rank).ID }

func (r *Rules) ignored(g *Gear) []tags.Tag {
	var out []tags.Tag
	for _, te := range r.traitFx {
		if te.Effect == "ignore-state" && g.has(tags.Tag(te.Tag)) {
			out = append(out, tags.Tag(te.State))
		}
	}
	return out
}

func (r *Rules) gearEffect(g *Gear, effect string) *sheets.TraitEffect {
	for i, te := range r.traitFx {
		if te.Effect == effect && g.has(tags.Tag(te.Tag)) {
			return &r.traitFx[i]
		}
	}
	return nil
}

func (r *Rules) kitEffect(k Kit, effect string) *sheets.TraitEffect {
	for _, g := range k.all() {
		if te := r.gearEffect(g, effect); te != nil {
			return te
		}
	}
	return nil
}

func (r *Rules) unanswered(s Situation, g *Gear) bool {
	ignore := r.ignored(g)
	for _, t := range s.Other {
		if st := r.states[t]; st != nil && st.Unanswered && !slices.Contains(ignore, t) {
			return true
		}
	}
	return false
}

func set(src string, ts ...[]tags.Tag) tags.TagSet {
	var s tags.TagSet
	for _, list := range ts {
		for _, t := range list {
			s.Add(tags.Held{Tag: t, From: tags.Source{Note: src}})
		}
	}
	return s
}

// self is a measure for a member after the rules its own tags fire: a
// class ability's change to its armour's wear or its exploits' states.
func (r *Rules) self(k Kit, measure string, base int64) int64 {
	return tags.Adjust(r.rules, set("self", []tags.Tag{tags.Character}, k.Self), tags.Context{}, measure, base)
}

func without(ts []tags.Tag, drop []tags.Tag) []tags.Tag {
	return slices.DeleteFunc(slices.Clone(ts), func(t tags.Tag) bool { return slices.Contains(drop, t) })
}

// Options are the choices a beat offers this kit: every option row the
// beat lists whose item is held, plus the cautious option and the way
// out, which are always there. A creature that cannot be answered leaves
// only those two.
func (r *Rules) Options(s Situation, k Kit) []Option {
	pairs := r.pairingTags(k)
	var out []Option
	for _, row := range r.options {
		if len(row.Beats) > 0 && !slices.Contains(row.Beats, s.Kind) {
			continue
		}
		g, axis := k.slot(row.Slot), row.Axis
		if row.Slot != "none" && g == nil {
			if row.FallbackSlot == "" {
				continue
			}
			g, axis = k.slot(row.FallbackSlot), row.FallbackAxis
		}
		if len(row.Needs) > 0 && !slices.ContainsFunc(row.Needs, func(t string) bool { return g.has(tags.Tag(t)) }) {
			continue
		}
		if g != nil && !g.Inst.Usable() {
			continue
		}
		if (row.Kind == Win || row.Kind == Cast) && r.unanswered(s, g) {
			continue
		}
		if row.Kind == Cast && !lands(g, s) {
			continue
		}
		out = append(out, r.option(s, k, row, g, axis, pairs))
	}
	r.balance(out)
	return out
}

func (r *Rules) option(s Situation, k Kit, row sheets.OptionRow, g *Gear, axis string, pairs []tags.Tag) Option {
	o := Option{ID: row.ID, Verb: row.Verb, Kind: row.Kind, Slot: row.Slot, Gear: g, Axis: axis, Practice: row.Practice,
		Risk: row.Risk, RiskSize: row.RiskSize}
	beat := r.beats[s.Kind]
	o.Puzzle = beat.Puzzle && row.Kind == Win
	if o.Practice == "puzzle" {
		o.Practice = s.Puzzle
	}
	var why Why
	// A deck governs the exploit it runs; the exploit takes the xp.
	gov := g
	if row.Slot == "deck" && k.OffHand != nil {
		gov = k.OffHand
	}
	if gov != nil && axis != "" {
		pts := gov.Kind.Vec[r.D.Axis(axis)]
		o.Stat = r.G.Stat(pts, gov.Kind.Tier, gov.Inst.Level)
		why.Parts = append(why.Parts, Part{Label: axis + " pts", Value: pts}, Part{Label: axis + " at level", Value: o.Stat})
	}
	practice := k.practice(o.Practice)
	if row.Practice == "standing" {
		practice = max(0, k.Standing) / r.Param("standing-per-point")
	}
	o.Score = fixed.Ratio(o.Stat, statHalf).Int() + practice*r.G.Param("practice-score")
	why.Parts = append(why.Parts, Part{Label: "practice", Value: practice})

	verb := []tags.Tag{"option", tags.Tag(row.Verb), tags.Tag(s.Kind)}
	if axis != "" {
		verb = append(verb, tags.Tag(axis+"-led"))
	}
	var gearTags []tags.Tag
	ignore := []tags.Tag{}
	if g != nil {
		gearTags = g.Tags
		ignore = r.ignored(g)
		for _, p := range pairs {
			if r.paired(p, g, k) {
				verb = append(verb, p)
			}
		}
	}
	subject := set("option", verb, gearTags, without(k.Self, ignore))
	ctx := tags.Context{
		Other:    set("creature", without(s.Creature.Tags, ignore), without(s.Other, ignore)),
		Place:    set("place", without(s.Place, ignore)),
		Measures: s.Measures,
	}
	effects, rw := tags.Apply(r.rules, subject, ctx)
	var steps int64
	for _, e := range effects {
		switch e := e.(type) {
		case tags.Score:
			o.Score += e.Points
			why.Parts = append(why.Parts, Part{Label: rw.Steps[e.Step()-1].Rule, Value: e.Points})
		case tags.Band:
			steps += e.Steps
		case tags.AddTag, tags.RemoveTag, tags.Scale, tags.Add, tags.Join, tags.End:
		}
	}
	o.Tags = subject.Tags()
	o.Difficulty = r.Difficulty(s)
	o.Margin = o.Score - o.Difficulty
	why.BandFrom = r.BandOf(o.Margin)
	o.Band = why.BandFrom + steps
	switch row.Kind {
	case WayOut:
		o.Band = r.bands[len(r.bands)-1].Rank
	default:
		o.Band = min(r.Param("band-ceiling"), max(r.Param("band-floor"), o.Band))
	}
	why.BandTo = o.Band
	why.Rules = rw
	o.Why = why
	b := r.band(o.Band)
	o.Chance, o.Rolled = b.Chance, b.Rolled
	return o
}

// paired: a pairing tag counts for an option when the option's own item
// holds one of the pair.
func (r *Rules) paired(t tags.Tag, g *Gear, k Kit) bool {
	for _, p := range r.pairings {
		if tags.Tag(p.Tag) == t && (g.has(tags.Tag(p.TagA)) || g.has(tags.Tag(p.TagB))) {
			return true
		}
	}
	return false
}

// balance: an item whose trait says so has its worst option shown, and
// rolled, a band up.
func (r *Rules) balance(opts []Option) {
	worst := map[*Gear]int{}
	for i, o := range opts {
		if o.Gear == nil || o.Kind == WayOut || r.gearEffect(o.Gear, "worst-band") == nil {
			continue
		}
		if j, ok := worst[o.Gear]; !ok || o.Band < opts[j].Band {
			worst[o.Gear] = i
		}
	}
	for i := range opts {
		o := &opts[i]
		if j, ok := worst[o.Gear]; !ok || j != i {
			continue
		}
		te := r.gearEffect(o.Gear, "worst-band")
		o.Band = min(r.Param("band-ceiling"), o.Band+te.Magnitude)
		o.Why.BandTo = o.Band
		o.Why.Notes = append(o.Why.Notes, te.ID)
		b := r.band(o.Band)
		o.Chance, o.Rolled = b.Chance, b.Rolled
	}
}

// Roll identifies a keyed roll: the character, the encounter, the beat
// and the option. A retry or a double press gets the same result.
type Roll struct {
	Who       string
	Encounter string
	Beat      int64
	Press     int64 // a guardian beat's nth press
}

// Outcome is what an option did.
type Outcome struct {
	Option  string `json:"option"`
	Success bool   `json:"success"`
	Draw    int64  `json:"draw"` // the keyed draw, in ten-thousandths
	Puzzle  *puzzle.Result
}

// Resolve rolls an option under the roll key. An option at a band that
// never rolls succeeds.
func (r *Rules) Resolve(o Option, id Roll) (Outcome, Why) {
	if !o.Rolled {
		return Outcome{Option: o.ID, Success: true}, o.Why
	}
	n := int64(r.roll.Below(fixed.Scale, "fight.roll", draw.Str(id.Who), draw.Str(id.Encounter), draw.Int(id.Beat), draw.Int(id.Press), draw.Str(o.ID)))
	return Outcome{Option: o.ID, Success: n < int64(o.Chance), Draw: n}, o.Why
}

// ResolvePuzzle turns a replayed machine into an outcome.
func (r *Rules) ResolvePuzzle(o Option, res puzzle.Result) Outcome {
	return Outcome{Option: o.ID, Success: res.Solved, Puzzle: &res}
}

// ModelPuzzle stands in for a player in the harness: a keyed draw against
// the solve-rate model.
func (r *Rules) ModelPuzzle(s Situation, k Kit, party int64, id Roll) puzzle.Result {
	rate := r.P.SolveRate(s.Puzzle, k.practice(s.Puzzle), s.Level, s.Creature.Tier, party)
	n := int64(r.roll.Below(fixed.Scale, "puzzle.model", draw.Str(id.Who), draw.Str(id.Encounter), draw.Int(id.Beat)))
	if n < int64(rate) {
		return puzzle.Result{Solved: true}
	}
	return puzzle.Result{Haywire: r.P.Haywire(s.Puzzle, puzzle.Where{Place: id.Encounter, Beat: id.Beat})}
}

// lands: an exploit that needs its target to hold a tag is not offered
// against a creature without it.
func lands(g *Gear, s Situation) bool {
	x := g.Kind.Exploit
	if x == nil || x.State == "" {
		return false
	}
	if x.OnlyTag == "" || x.Target == "caster" {
		return true
	}
	t := tags.Tag(x.OnlyTag)
	return slices.Contains(s.Creature.Tags, t) || slices.Contains(s.Other, t)
}

// StateBeats is how many beats a state counts before it lifts; 0 for one
// that lasts the encounter.
func (r *Rules) StateBeats(tag tags.Tag) int64 {
	if row := r.states[tag]; row != nil {
		return row.Beats
	}
	return 0
}
