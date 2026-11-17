// Package items derives what a recipe makes. Nothing is authored: a kind
// is the hash of how it is made, and its properties follow from its
// inputs, its process and method, and a quirk only the server's key can
// compute (GDD 9).
package items

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
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
	// Infuse takes a carrier and a minor input.
	infuseParts = 2
	// Resonance needs two strong components.
	pair = 2
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

// Kind is what a recipe makes, frozen at discovery.
type Kind struct {
	ID     string `json:"id"`
	Recipe Recipe `json:"recipe"`
	Tier   int64  `json:"tier"`
	// BaseTier is the highest base material's tier in the kind's ancestry.
	// Alloy rises from it, not from its inputs' tiers, so re-alloying
	// never climbs.
	BaseTier int64 `json:"baseTier"`
	// Steps is every process in the ancestry, one entry a step, sorted.
	// The quirk's trait is drawn across them.
	Steps      []string   `json:"steps"`
	Vec        Vec        `json:"vec"`
	Trimmed    int64      `json:"trimmed"` // points removed to fit the tier budget
	Traits     []string   `json:"traits"`
	Tags       []tags.Tag `json:"tags"`
	QuirkAxis  int        `json:"quirkAxis"` // -1 when the quirk moved no axis
	QuirkShift int64      `json:"quirkShift"`
}

// Deriver holds the sheets and the quirk key. One per world, one goroutine.
type Deriver struct {
	axes      []string
	materials map[string]*sheets.Material
	tiers     map[int64]sheets.Tier
	maxTier   int64
	processes map[string]*sheets.Process
	methods   map[string]*sheets.Method
	slots     map[string]*sheets.Slot
	traits    map[string]*sheets.Trait
	axisTags  []sheets.AxisTag
	resonance []sheets.Resonance
	params    []sheets.Param
	quirk     *draw.Drawer
	// Known holds kinds already derived, so a recipe can name one as input.
	Known map[string]*Kind
	// SkipQuirk derives without the quirk, to compare against it.
	SkipQuirk bool
}

func NewDeriver(b *sheets.Book, quirkKey draw.Key) *Deriver {
	d := &Deriver{
		materials: sheets.Lookup(b.Materials),
		tiers:     map[int64]sheets.Tier{},
		processes: sheets.Lookup(b.Processes),
		methods:   sheets.Lookup(b.Methods),
		slots:     sheets.Lookup(b.Slots),
		traits:    sheets.Lookup(b.Traits),
		axisTags:  b.AxisTags,
		resonance: b.Resonance,
		params:    b.ItemParams,
		quirk:     draw.NewDrawer(quirkKey),
		Known:     map[string]*Kind{},
	}
	for _, a := range b.Axes {
		d.axes = append(d.axes, a.ID)
	}
	for _, t := range b.Tiers {
		d.tiers[t.Tier] = t
		d.maxTier = max(d.maxTier, t.Tier)
	}
	return d
}

func (d *Deriver) Axes() []string { return d.axes }

func (d *Deriver) param(id string) int64 { return sheets.IntParam(d.params, id) }

// KindID is the recipe's identity: inputs sorted, canonical JSON, hashed.
func KindID(r Recipe) string {
	r.Inputs = slices.Clone(r.Inputs)
	slices.SortFunc(r.Inputs, func(a, b Input) int { return strings.Compare(a.Kind, b.Kind) })
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
	if k, ok := d.Known[in.Kind]; ok {
		return part{vec: slices.Clone(k.Vec), tier: k.Tier, baseTier: k.BaseTier, steps: k.Steps, tags: k.Tags, qty: in.Qty}, nil
	}
	return part{}, fmt.Errorf("items: unknown input %q", in.Kind)
}

// Derive makes (or returns) the kind a recipe gives, and records it.
// stationTier caps what an Alloy can reach.
func (d *Deriver) Derive(r Recipe, stationTier int64) (*Kind, error) {
	id := KindID(r)
	if k, ok := d.Known[id]; ok {
		return k, nil
	}
	if len(r.Inputs) == 0 || int64(len(r.Inputs)) > d.param("recipe-max-inputs") {
		return nil, fmt.Errorf("items: %d inputs", len(r.Inputs))
	}
	parts := make([]part, len(r.Inputs))
	for i, in := range r.Inputs {
		if in.Qty < 1 || in.Qty > d.param("input-max-quantity") {
			return nil, fmt.Errorf("items: quantity %d", in.Qty)
		}
		p, err := d.resolve(in)
		if err != nil {
			return nil, err
		}
		parts[i] = p
	}
	method, ok := d.methods[r.Method]
	if !ok || method.Process != r.Process {
		return nil, fmt.Errorf("items: method %q is not one of %s's", r.Method, r.Process)
	}
	var vec Vec
	var tier int64
	var resonant []string
	switch r.Process {
	case "alloy":
		if int64(len(parts)) < d.param("alloy-min-inputs") {
			return nil, fmt.Errorf("items: alloy takes %d or more different inputs", d.param("alloy-min-inputs"))
		}
		vec, tier = d.alloy(parts, stationTier)
	case "shape":
		if len(parts) != 1 {
			return nil, fmt.Errorf("items: shape takes one input")
		}
		slot, ok := d.slots[r.Slot]
		if !ok {
			return nil, fmt.Errorf("items: unknown slot %q", r.Slot)
		}
		vec, tier = d.shape(parts[0], slot), parts[0].tier
	case "infuse":
		if len(parts) != infuseParts {
			return nil, fmt.Errorf("items: infuse takes a carrier and a minor input")
		}
		vec, tier = d.infuse(parts[0], parts[1]), parts[0].tier
	case "bind":
		vec, tier = d.bind(parts)
		resonant = d.resonate(parts)
	default:
		return nil, fmt.Errorf("items: process %q does not derive a vector", r.Process)
	}
	vec = d.tilt(vec, method)
	k := &Kind{ID: id, Recipe: r, Tier: tier, QuirkAxis: -1, Steps: []string{r.Process}}
	for _, p := range parts {
		k.BaseTier = max(k.BaseTier, p.baseTier)
		k.Steps = append(k.Steps, p.steps...)
	}
	slices.Sort(k.Steps)
	k.Vec = vec
	k.Traits = resonant
	if !d.SkipQuirk {
		d.applyQuirk(k)
	}
	k.Vec, k.Trimmed = d.trim(k.Vec, tier)
	k.Tags = d.tagsOf(k, parts)
	d.Known[id] = k
	return k, nil
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
	limit := carrier.vec[slices.Index(d.axes, "bond")]
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

func (d *Deriver) bind(parts []part) (Vec, int64) {
	out := slices.Clone(parts[0].vec)
	tail := d.param("bind-tail")
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
		a, b := slices.Index(d.axes, row.AxisA), slices.Index(d.axes, row.AxisB)
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

func (d *Deriver) tilt(v Vec, m *sheets.Method) Vec {
	for _, t := range []struct {
		axis string
		pct  int64
	}{{m.AxisA, m.TiltA}, {m.AxisB, m.TiltB}} {
		if t.axis == "" {
			continue
		}
		a := slices.Index(d.axes, t.axis)
		v[a] = max(0, v[a]+fixed.Ratio(v[a]*t.pct, percent).Int())
	}
	return v
}

// applyQuirk: a keyed hash of the kind picks one axis and shifts it by up
// to the sheet's share either way, and may grant a trait. The trait comes
// from one step of the recipe's ancestry, each step equally likely, so a
// blade alloyed twice and shaped once draws from Alloy two times in three.
// Nobody without the quirk key can compute it.
func (d *Deriver) applyQuirk(k *Kind) {
	maxShift := d.param("quirk-shift-max")
	span := uint64(maxShift + maxShift + 1)
	axis := int(d.quirk.Below(uint64(len(d.axes)), "quirk.axis", draw.Str(k.ID)))
	shift := int64(d.quirk.Below(span, "quirk.shift", draw.Str(k.ID))) - maxShift
	if shift != 0 && k.Vec[axis] != 0 {
		k.QuirkAxis, k.QuirkShift = axis, shift
		k.Vec[axis] = max(0, k.Vec[axis]+fixed.Ratio(k.Vec[axis]*shift, percent).Int())
	}
	chance := sheets.ParamOf(d.params, "quirk-trait-chance")
	if d.quirk.Roll(chance, "quirk.trait", draw.Str(k.ID)) {
		step := k.Steps[d.quirk.Below(uint64(len(k.Steps)), "quirk.trait.step", draw.Str(k.ID))]
		table := d.processes[step].Traits
		if t := table[d.quirk.Below(uint64(len(table)), "quirk.trait.which", draw.Str(k.ID))]; !slices.Contains(k.Traits, t) {
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

func (d *Deriver) tagsOf(k *Kind, parts []part) []tags.Tag {
	var out []tags.Tag
	add := func(t tags.Tag) {
		if !slices.Contains(out, t) {
			out = append(out, t)
		}
	}
	// Material and trait tags carry through a recipe; axis tags are read
	// off the kind's own vector, never inherited.
	fromAxis := func(t tags.Tag) bool {
		return slices.ContainsFunc(d.axisTags, func(at sheets.AxisTag) bool { return tags.Tag(at.Tag) == t })
	}
	for _, p := range parts {
		for _, t := range p.tags {
			if !fromAxis(t) {
				add(t)
			}
		}
	}
	if k.Recipe.Slot != "" {
		add(tags.Tag("item"))
		add(tags.Tag(k.Recipe.Slot))
	}
	budget := d.tiers[k.Tier].Budget
	for _, at := range d.axisTags {
		if k.Vec[slices.Index(d.axes, at.Axis)]*percent >= budget*at.ShareOfBudget {
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
