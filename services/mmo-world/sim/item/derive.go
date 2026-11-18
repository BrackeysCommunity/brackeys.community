// Package item derives what a recipe makes. Nothing is authored: a kind
// is the hash of how it is made, and its properties follow from its
// inputs, its process and method, and a quirk only the server's key can
// compute (GDD 9).
package item

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"maps"
	"slices"
	"strings"

	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

// structural: a kind id is SHA-256 cut to 128 bits (GDD 9.1); a percentage
// is hundredths.
const (
	kindBytes = 16
	percent   = 100
	// Infuse takes a carrier and a minor input; Inscribe an item and a
	// pattern's material.
	infuseParts   = 2
	inscribeParts = 2
	// Resonance needs two strong components; strength is the top two axes.
	pair = 2
)

// Process ids, as the items.processes sheet names them.
const (
	Alloy    = "alloy"
	Shape    = "shape"
	Infuse   = "infuse"
	Bind     = "bind"
	Inscribe = "inscribe"
	Compose  = "compose"
)

// Vec is a vector over the axes, in items.axes order, in points.
type Vec []int64

func (v Vec) Total() int64 {
	var t int64
	for _, x := range v {
		t += x
	}
	return t
}

// TopTwo is the sum of the two strongest axes, the craft-strength measure.
func (v Vec) TopTwo() int64 {
	s := slices.Clone(v)
	slices.Sort(s)
	var t int64
	for _, x := range s[max(0, len(s)-pair):] {
		t += x
	}
	return t
}

// Input is one line of a recipe: a material id or a kind id, and how many.
type Input struct {
	Kind string `json:"kind"`
	Qty  int64  `json:"qty"`
}

// Recipe is how a kind is made. Its canonical form is its identity.
type Recipe struct {
	Process string  `json:"process"`
	Method  string  `json:"method"`
	Slot    string  `json:"slot,omitempty"`
	Inputs  []Input `json:"inputs"`
}

// Exploit is what a composed kind does when run from a deck (GDD 9.13).
type Exploit struct {
	State   string   `json:"state"`
	Target  string   `json:"target"`
	OnlyTag string   `json:"onlyTag,omitempty"`
	Lends   []string `json:"lends,omitempty"`
}

// KindProps are a kind's derived properties, frozen at its first craft.
type KindProps struct {
	Tier int64 `json:"tier"`
	// BaseTier is the highest base material's tier in the kind's ancestry.
	// Alloy rises from it, not from its inputs' tiers, so re-alloying
	// never climbs.
	BaseTier int64 `json:"baseTier"`
	// Steps is every process in the ancestry, one entry a step, sorted.
	// The quirk's trait is drawn across them.
	Steps      []string   `json:"steps"`
	Slot       string     `json:"slot,omitempty"`
	Vec        Vec        `json:"vec"`
	Trimmed    int64      `json:"trimmed"` // points removed to fit the tier budget
	Traits     []string   `json:"traits"`
	Tags       []tags.Tag `json:"tags"`
	QuirkAxis  int        `json:"quirkAxis"` // -1 when the quirk moved no axis
	QuirkShift int64      `json:"quirkShift"`
	// Durability is the most a slotted kind holds; Patch lowers it.
	Durability int64    `json:"durability,omitempty"`
	Exploit    *Exploit `json:"exploit,omitempty"`
	// Failed: the recipe made nothing useful (GDD 9.10).
	Failed bool `json:"failed,omitempty"`
}

// Kind is a recipe and what it makes, as the registry holds it.
type Kind struct {
	ID     string `json:"id"`
	Recipe Recipe `json:"recipe"`
	KindProps
	FirstMaker string `json:"firstMaker,omitempty"`
	Discovered int64  `json:"discovered,omitempty"` // tick
}

// Registry holds every kind ever made. A kind is frozen at its first
// craft and never recomputed: balance moves the world around it (GDD 9.9).
type Registry interface {
	Kind(id string) (*Kind, bool)
	// Freeze stores a kind the first time it is made; a kind already
	// held is left as it was.
	Freeze(k *Kind) *Kind
	// Crafts is how many times a kind has been made, for maturity.
	Crafts(id string) int64
	AddCraft(id string)
}

// MemRegistry is a Registry in memory.
type MemRegistry struct {
	kinds  map[string]*Kind
	crafts map[string]int64
}

func NewMemRegistry() *MemRegistry {
	return &MemRegistry{kinds: map[string]*Kind{}, crafts: map[string]int64{}}
}

func (r *MemRegistry) Kind(id string) (*Kind, bool) { k, ok := r.kinds[id]; return k, ok }

func (r *MemRegistry) Freeze(k *Kind) *Kind {
	if old, ok := r.kinds[k.ID]; ok {
		return old
	}
	r.kinds[k.ID] = k
	return k
}

func (r *MemRegistry) Crafts(id string) int64 { return r.crafts[id] }
func (r *MemRegistry) AddCraft(id string)     { r.crafts[id]++ }

// IDs lists every frozen kind, sorted.
func (r *MemRegistry) IDs() []string {
	return slices.Sorted(maps.Keys(r.kinds))
}

// Deriver holds the sheets and the quirk key. One per world, one goroutine.
type Deriver struct {
	axes       []string
	materials  map[string]*sheets.Material
	tiers      map[int64]sheets.Tier
	maxTier    int64
	processes  map[string]*sheets.Process
	methods    map[string]*sheets.Method
	slots      map[string]*sheets.Slot
	traits     map[string]*sheets.Trait
	durability map[string]int64
	traitTags  []tags.Tag
	axisTags   []sheets.AxisTag
	resonance  []sheets.Resonance
	compose    []sheets.ComposeRow
	params     []sheets.Param
	quirk      *draw.Drawer
	// Reg holds the kinds already made, so a recipe can name one as input.
	Reg Registry
	// SkipQuirk derives without the quirk, to compare against it.
	SkipQuirk bool
}

func NewDeriver(b *sheets.Book, quirkKey draw.Key) *Deriver {
	d := &Deriver{
		materials:  sheets.Lookup(b.Materials),
		tiers:      map[int64]sheets.Tier{},
		processes:  sheets.Lookup(b.Processes),
		methods:    sheets.Lookup(b.Methods),
		slots:      sheets.Lookup(b.Slots),
		traits:     sheets.Lookup(b.Traits),
		durability: map[string]int64{},
		axisTags:   b.AxisTags,
		resonance:  b.Resonance,
		compose:    b.Compose,
		params:     b.ItemParams,
		quirk:      draw.NewDrawer(quirkKey),
		Reg:        NewMemRegistry(),
	}
	for _, a := range b.Axes {
		d.axes = append(d.axes, a.ID)
	}
	for _, t := range b.Traits {
		d.traitTags = append(d.traitTags, tags.Tag(t.Tag))
	}
	tierIDs := map[string]int64{}
	for _, t := range b.Tiers {
		d.tiers[t.Tier] = t
		tierIDs[t.ID] = t.Tier
		d.maxTier = max(d.maxTier, t.Tier)
	}
	for _, w := range b.Durability {
		d.durability[durKey(w.Slot, tierIDs[w.Tier])] = w.Durability
	}
	return d
}

func durKey(slot string, tier int64) string { return fmt.Sprint(slot, "/", tier) }

func (d *Deriver) Axes() []string { return d.axes }

// Axis is an axis's index in a Vec.
func (d *Deriver) Axis(id string) int { return slices.Index(d.axes, id) }

// Budget is a tier's budget in points.
func (d *Deriver) Budget(tier int64) int64 { return d.tiers[tier].Budget }

// Material reports whether id is a base material, and its tier.
func (d *Deriver) Material(id string) (int64, bool) {
	m, ok := d.materials[id]
	if !ok {
		return 0, false
	}
	return m.Tier, true
}

// Trait is a trait's sheet row.
func (d *Deriver) Trait(id string) *sheets.Trait { return d.traits[id] }

func (d *Deriver) param(id string) int64 { return sheets.IntParam(d.params, id) }

// KindID is the recipe's identity: canonical JSON, hashed. Inputs are
// sorted, except for Compose, whose order is part of the recipe.
func KindID(r Recipe) string {
	r.Inputs = slices.Clone(r.Inputs)
	if r.Process != Compose {
		slices.SortFunc(r.Inputs, func(a, b Input) int { return strings.Compare(a.Kind, b.Kind) })
	}
	b, err := canon.Marshal(r)
	if err != nil {
		panic(err)
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:kindBytes])
}

// part is a resolved input.
type part struct {
	vec      Vec
	tier     int64
	baseTier int64
	steps    []string
	tags     []tags.Tag
	traits   []string
	slot     string
	dur      int64
	qty      int64
}

func (d *Deriver) resolve(in Input) (part, error) {
	if m, ok := d.materials[in.Kind]; ok {
		v := m.Vector
		return part{
			vec:  Vec{v.Edge, v.Weight, v.Flex, v.Conduct, v.Heat, v.Ward, v.Reach, v.Bond},
			tier: m.Tier, baseTier: m.Tier, tags: toTags(m.Tags), qty: in.Qty,
		}, nil
	}
	if k, ok := d.Reg.Kind(in.Kind); ok {
		return part{vec: slices.Clone(k.Vec), tier: k.Tier, baseTier: k.BaseTier, steps: k.Steps, tags: k.Tags,
			traits: k.Traits, slot: k.Slot, dur: k.Durability, qty: in.Qty}, nil
	}
	return part{}, fmt.Errorf("item: unknown input %q", in.Kind)
}

// Derive makes (or returns) the kind a recipe gives, and freezes it in
// the registry. stationTier caps what an Alloy can reach.
func (d *Deriver) Derive(r Recipe, stationTier int64) (*Kind, error) {
	id := KindID(r)
	if k, ok := d.Reg.Kind(id); ok {
		return k, nil
	}
	p, err := d.Props(r, stationTier)
	if err != nil {
		return nil, err
	}
	return d.Reg.Freeze(&Kind{ID: id, Recipe: r, KindProps: p}), nil
}

// Props derives a recipe's properties without freezing them. Appraisal
// reads it with the quirk off.
func (d *Deriver) Props(r Recipe, stationTier int64) (KindProps, error) {
	if len(r.Inputs) == 0 || int64(len(r.Inputs)) > d.param("recipe-max-inputs") {
		return KindProps{}, fmt.Errorf("item: %d inputs", len(r.Inputs))
	}
	parts := make([]part, len(r.Inputs))
	for i, in := range r.Inputs {
		if in.Qty < 1 || in.Qty > d.param("input-max-quantity") {
			return KindProps{}, fmt.Errorf("item: quantity %d", in.Qty)
		}
		p, err := d.resolve(in)
		if err != nil {
			return KindProps{}, err
		}
		parts[i] = p
	}
	method, ok := d.methods[r.Method]
	if !ok || method.Process != r.Process {
		return KindProps{}, fmt.Errorf("item: method %q is not one of %s's", r.Method, r.Process)
	}
	k := KindProps{QuirkAxis: -1, Steps: []string{r.Process}}
	var lent []string
	switch r.Process {
	case Alloy:
		if int64(len(parts)) < d.param("alloy-min-inputs") {
			return KindProps{}, fmt.Errorf("item: alloy takes %d or more different inputs", d.param("alloy-min-inputs"))
		}
		k.Vec, k.Tier = d.alloy(parts, stationTier)
	case Shape:
		if len(parts) != 1 {
			return KindProps{}, fmt.Errorf("item: shape takes one input")
		}
		slot, ok := d.slots[r.Slot]
		if !ok {
			return KindProps{}, fmt.Errorf("item: unknown slot %q", r.Slot)
		}
		k.Vec, k.Tier, k.Slot = d.shape(parts[0], slot), parts[0].tier, r.Slot
	case Infuse:
		if len(parts) != infuseParts {
			return KindProps{}, fmt.Errorf("item: infuse takes a carrier and a minor input")
		}
		k.Vec, k.Tier, k.Slot = d.infuse(parts[0], parts[1]), parts[0].tier, parts[0].slot
	case Bind:
		k.Vec, k.Tier = d.bind(parts, d.param("bind-tail"))
		k.Slot = parts[0].slot
		lent = d.resonate(parts)
	case Inscribe:
		if len(parts) != inscribeParts || parts[0].slot == "" {
			return KindProps{}, fmt.Errorf("item: inscribe takes an item and a pattern's material")
		}
		k.Vec, k.Tier, k.Slot = slices.Clone(parts[0].vec), parts[0].tier, parts[0].slot
		lent = []string{d.inscribed(r, method)}
	case Compose:
		if int64(len(parts)) < d.param("compose-min-inputs") {
			return KindProps{}, fmt.Errorf("item: compose orders %d or more components", d.param("compose-min-inputs"))
		}
		k.Vec, k.Tier = d.bind(parts, d.param("compose-tail"))
		k.Exploit, lent = d.composed(parts)
	default:
		return KindProps{}, fmt.Errorf("item: process %q does not derive a vector", r.Process)
	}
	k.Vec = d.tilt(k.Vec, method)
	var cut int64
	for _, p := range parts {
		k.BaseTier = max(k.BaseTier, p.baseTier)
		k.Steps = append(k.Steps, p.steps...)
		for _, t := range p.traits {
			if r.Process != Alloy && !slices.Contains(lent, t) {
				lent = append(lent, t)
			}
		}
	}
	if r.Process == Inscribe {
		cut = method.DurabilityCost
	}
	slices.Sort(k.Steps)
	k.Traits = lent
	if !d.SkipQuirk {
		d.applyQuirk(&k, KindID(r))
	}
	k.Vec, k.Trimmed = d.trim(k.Vec, k.Tier)
	if k.Slot != "" {
		base := d.durability[durKey(k.Slot, k.Tier)]
		if r.Process == Shape {
			k.Durability = base
		} else {
			k.Durability = max(1, min(parts[0].dur, base)-cut)
		}
	}
	k.Tags = d.tagsOf(&k, parts)
	k.Failed = d.failed(&k)
	return k, nil
}

// failed: a kind is nothing useful when its two strongest axes fall
// under a share of its tier's budget, or an exploit sets no state.
func (d *Deriver) failed(k *KindProps) bool {
	if k.Exploit != nil {
		return k.Exploit.State == ""
	}
	return k.Vec.TopTwo()*percent < d.tiers[k.Tier].Budget*d.param("failed-share")
}

func (d *Deriver) alloy(parts []part, stationTier int64) (Vec, int64) {
	n := len(d.axes)
	out := make(Vec, n)
	var qty, top int64
	for _, p := range parts {
		qty += p.qty
		top = max(top, p.baseTier)
	}
	floor, gain := d.param("alloy-agree-floor"), d.param("alloy-agree-gain")
	for a := range n {
		var sum int64
		lowest := parts[0].vec[a]
		for _, p := range parts {
			sum += p.vec[a] * p.qty
			lowest = min(lowest, p.vec[a])
		}
		out[a] = fixed.Ratio(sum, qty).Int()
		if lowest >= floor {
			out[a] += fixed.Ratio(lowest*gain, percent).Int()
		}
	}
	tier := min(top+d.param("alloy-tier-step"), stationTier, d.maxTier)
	return out, tier
}

func (d *Deriver) shape(p part, slot *sheets.Slot) Vec {
	mult := []fixed.F{slot.Edge, slot.Weight, slot.Flex, slot.Conduct, slot.Heat, slot.Ward, slot.Reach, slot.Bond}
	carry := sheets.ParamOf(d.params, "shape-unnamed-carry")
	strongest := -1
	if slot.StrongestOther != 0 {
		for a, x := range p.vec {
			if mult[a] == 0 && (strongest < 0 || x > p.vec[strongest]) {
				strongest = a
			}
		}
	}
	out := make(Vec, len(d.axes))
	for a, x := range p.vec {
		m := mult[a]
		switch {
		case a == strongest:
			m = slot.StrongestOther
		case m == 0:
			m = carry
		}
		out[a] = m.Of(x)
	}
	return out
}

func (d *Deriver) infuse(carrier, minor part) Vec {
	out := slices.Clone(carrier.vec)
	limit := carrier.vec[d.Axis("bond")]
	order := make([]int, len(minor.vec))
	for i := range order {
		order[i] = i
	}
	slices.SortStableFunc(order, func(a, b int) int { return int(minor.vec[b] - minor.vec[a]) })
	for _, a := range order[:d.param("infuse-lent-axes")] {
		out[a] += min(minor.vec[a], limit)
	}
	return out
}

// bind sums the first component whole and the rest at tail percent.
// Compose uses it with its own tail.
func (d *Deriver) bind(parts []part, tail int64) (Vec, int64) {
	out := slices.Clone(parts[0].vec)
	tier := parts[0].tier
	for _, p := range parts[1:] {
		for a := range out {
			out[a] += fixed.Ratio(p.vec[a]*tail, percent).Int()
		}
		tier = max(tier, p.tier)
	}
	return out, tier
}

// resonate: two components each at or above a row's threshold on both its
// axes give the row's trait, once.
func (d *Deriver) resonate(parts []part) []string {
	var out []string
	for _, row := range d.resonance {
		a, b := d.Axis(row.AxisA), d.Axis(row.AxisB)
		strong := 0
		for _, p := range parts {
			if p.vec[a] >= row.Threshold && p.vec[b] >= row.Threshold {
				strong++
			}
		}
		if strong >= pair && !slices.Contains(out, row.Trait) {
			out = append(out, row.Trait)
		}
	}
	return out
}

// inscribed is the trait a Patch adds: one of Inscribe's table, drawn by
// the recipe under the quirk key, strong traits for the deep method only.
func (d *Deriver) inscribed(r Recipe, m *sheets.Method) string {
	deep := m.DurabilityCost > d.param("inscribe-durability-cost")
	var pool []string
	for _, t := range d.processes[Inscribe].Traits {
		if d.traits[t].Strong == deep {
			pool = append(pool, t)
		}
	}
	if len(pool) == 0 {
		pool = d.processes[Inscribe].Traits
	}
	return pool[d.quirk.Below(uint64(len(pool)), "inscribe.trait", draw.Str(KindID(r)))]
}

// composed reads the components in order: the first sets the state and
// whom it lands on, later ones lend traits by their tags.
func (d *Deriver) composed(parts []part) (*Exploit, []string) {
	e := &Exploit{}
	var lent []string
	for _, row := range d.compose {
		if row.Position == "first" && e.State == "" && slices.Contains(parts[0].tags, tags.Tag(row.Tag)) {
			e.State, e.Target, e.OnlyTag = row.State, row.Target, row.OnlyTag
		}
	}
	for _, p := range parts[1:] {
		for _, row := range d.compose {
			if row.Position == "later" && slices.Contains(p.tags, tags.Tag(row.Tag)) && !slices.Contains(lent, row.Trait) {
				lent = append(lent, row.Trait)
			}
		}
	}
	e.Lends = lent
	return e, lent
}

// castTag is the tag an exploit carries for loadout pairings.
func (d *Deriver) castTag(e *Exploit) string {
	for _, row := range d.compose {
		if row.Position == "first" && row.State == e.State && row.CastTag != "" {
			return row.CastTag
		}
	}
	return ""
}

func (d *Deriver) tilt(v Vec, m *sheets.Method) Vec {
	for _, t := range []struct {
		axis string
		pct  int64
	}{{m.AxisA, m.TiltA}, {m.AxisB, m.TiltB}} {
		if t.axis == "" {
			continue
		}
		a := d.Axis(t.axis)
		v[a] = max(0, v[a]+fixed.Ratio(v[a]*t.pct, percent).Int())
	}
	return v
}

// applyQuirk: a keyed hash of the kind picks one axis and shifts it by up
// to the sheet's share either way, and may grant a trait. The trait comes
// from one step of the recipe's ancestry, each step equally likely, so a
// blade alloyed twice and shaped once draws from Alloy two times in three.
// Nobody without the quirk key can compute it.
func (d *Deriver) applyQuirk(k *KindProps, id string) {
	maxShift := d.param("quirk-shift-max")
	span := uint64(maxShift + maxShift + 1)
	axis := int(d.quirk.Below(uint64(len(d.axes)), "quirk.axis", draw.Str(id)))
	shift := int64(d.quirk.Below(span, "quirk.shift", draw.Str(id))) - maxShift
	if shift != 0 && k.Vec[axis] != 0 {
		k.QuirkAxis, k.QuirkShift = axis, shift
		k.Vec[axis] = max(0, k.Vec[axis]+fixed.Ratio(k.Vec[axis]*shift, percent).Int())
	}
	chance := sheets.ParamOf(d.params, "quirk-trait-chance")
	if d.quirk.Roll(chance, "quirk.trait", draw.Str(id)) {
		step := k.Steps[d.quirk.Below(uint64(len(k.Steps)), "quirk.trait.step", draw.Str(id))]
		table := d.processes[step].Traits
		if t := table[d.quirk.Below(uint64(len(table)), "quirk.trait.which", draw.Str(id))]; !slices.Contains(k.Traits, t) {
			k.Traits = append(k.Traits, t)
		}
	}
}

// trim caps each axis at the sheet's share of the tier's budget, then
// scales the vector down to the budget, rounding each axis down so the
// total never exceeds it. Points over the cap are lost, not moved.
func (d *Deriver) trim(v Vec, tier int64) (Vec, int64) {
	budget := d.tiers[tier].Budget
	limit := fixed.Ratio(budget*d.param("axis-cap-share"), percent).Floor()
	before := v.Total()
	out := make(Vec, len(v))
	for a, x := range v {
		out[a] = min(x, limit)
	}
	if total := out.Total(); total > budget {
		for a, x := range out {
			out[a] = fixed.Ratio(x*budget, total).Floor()
		}
	}
	return out, before - out.Total()
}

func (d *Deriver) tagsOf(k *KindProps, parts []part) []tags.Tag {
	var out []tags.Tag
	add := func(t tags.Tag) {
		if t != "" && !slices.Contains(out, t) {
			out = append(out, t)
		}
	}
	// Material and trait tags carry through a recipe; axis and slot tags
	// are read off the kind itself, never inherited.
	own := func(t tags.Tag) bool {
		if _, ok := d.slots[string(t)]; ok || t == "item" || t == "exploit" {
			return true
		}
		if slices.Contains(d.traitTags, t) {
			return true
		}
		return slices.ContainsFunc(d.axisTags, func(at sheets.AxisTag) bool { return tags.Tag(at.Tag) == t })
	}
	for _, p := range parts {
		for _, t := range p.tags {
			if !own(t) {
				add(t)
			}
		}
	}
	if k.Slot != "" {
		add("item")
		add(tags.Tag(k.Slot))
	}
	if k.Exploit != nil {
		add("exploit")
		add(tags.Tag(d.castTag(k.Exploit)))
	}
	budget := d.tiers[k.Tier].Budget
	for _, at := range d.axisTags {
		if k.Vec[d.Axis(at.Axis)]*percent >= budget*at.ShareOfBudget {
			add(tags.Tag(at.Tag))
		}
	}
	for _, tr := range k.Traits {
		add(tags.Tag(d.traits[tr].Tag))
	}
	slices.Sort(out)
	return out
}

func toTags(ss []string) []tags.Tag {
	out := make([]tags.Tag, len(ss))
	for i, s := range ss {
		out[i] = tags.Tag(s)
	}
	return out
}
