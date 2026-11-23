package game

import (
	"cmp"
	"maps"
	"slices"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
	"jams.team/mmo-world/sim/world"
)

// Adaptation and variants (GDD 13.2, 13.3): once a style is named in a
// region, that region's creatures adapt against it day by day; adapted
// enough, they resist the style's tag, and the archetype it beats most
// there becomes a variant that drops a material nobody has seen.

func init() {
	registerEmerge(emergeHook{
		Name:    "variants",
		Kinds:   encounterEnds,
		Fact:    lootedFirst,
		Instead: map[emerge.Type]func(*Game, *Promoting) (bool, error){emerge.Style: styleNamedOnce},
		Day:     adaptationDay,
	})
}

const factLootedFirst = "material.looted-first"

// Data a variant's promotion carries for the run and the cards.
const (
	datumResists  = "resists"
	datumMaterial = "material"
	datumStyle    = "style"
	datumVariant  = "variant"
	datumBase     = "base"
	// the archetype an encounter's end names
	datumArchetype = "archetype"
)

// encounterEnds are the facts an encounter's end writes, after which its
// haul is held.
var encounterEnds = []string{
	"encounter." + fight.Won, "encounter." + fight.Lost, "encounter." + fight.Left, "encounter." + fight.Escaped,
}

// styleNamedOnce gives a style promoted in a second region the name the
// world first gave it.
func styleNamedOnce(g *Game, p *Promoting) (bool, error) {
	if p.Name != "" {
		return false, nil
	}
	for _, x := range g.Emergence.Promotions {
		if x.Type == emerge.Style && x.Of == p.Of {
			p.Name = x.Shown()
			break
		}
	}
	return false, nil
}

// promotedStyles are the styles named in a region, in the order they were
// named; region -1 is every region.
func (g *Game) promotedStyles(region int) []*emerge.StyleTrace {
	e := g.Emergence
	var out []*emerge.StyleTrace
	for i := range e.Promotions {
		p := &e.Promotions[i]
		if p.Type != emerge.Style || (region >= 0 && p.Region != region) {
			continue
		}
		if st := e.Styles[emerge.StyleKey{Region: p.Region, Style: p.Of}]; st != nil {
			out = append(out, st)
		}
	}
	return out
}

// adaptationDay moves each named style's adaptation by its share of its
// region's won beats on the day just ended (GDD 4.15's daily clock), and
// makes the variant of one that passes the variant line.
func adaptationDay(g *Game, day, _ int64) error {
	e, r := g.Emergence, g.r.Emerge
	yesterday := day - 1
	percent := r.Lines[string(emerge.Variant)].Percent
	for _, st := range g.promotedStyles(-1) {
		share := int64(0)
		if rt := e.Regions[st.Key.Region]; rt != nil {
			share = fixed.ShareFloor(st.Today.On(yesterday), rt.Today.On(yesterday))
		}
		st.Adapt = emerge.Adapted(st.Adapt, share, r.P)
		if st.Variant == "" && st.Adapt >= percent {
			if err := g.makeVariant(st); err != nil {
				return err
			}
		}
	}
	return nil
}

// variantArchetype is the archetype a style has beaten most in its region
// that is not yet a variant there; ties go to the lowest id.
func (g *Game) variantArchetype(st *emerge.StyleTrace) string {
	best, n := "", int64(0)
	for _, a := range slices.Sorted(maps.Keys(st.Beaten)) {
		if _, taken := g.variantFor(st.Key.Region, a); !taken && st.Beaten[a] > n {
			best, n = a, st.Beaten[a]
		}
	}
	return best
}

// makeVariant promotes the variant a style's region adapted into, then the
// material its first drop becomes, once per row and base (GDD 13.3).
func (g *Game) makeVariant(st *emerge.StyleTrace) error {
	e, r := g.Emergence, g.r.Emerge
	region, style := st.Key.Region, st.Key.Style
	arch := g.variantArchetype(st)
	rows := emerge.Candidates(st.Resisted, st.Lead, r.Adapt)
	if arch == "" || len(rows) == 0 {
		return nil
	}
	row := rows[0]
	if len(rows) > 1 {
		row = rows[g.r.draw.Below(uint64(len(rows)), emerge.DrawVariant, draw.Int(int64(region)), draw.Str(arch), draw.Str(style))]
	}
	var found sheets.Material
	base := ""
	if c, ok := sheets.Lookup(g.r.Book.Creatures)[arch]; ok && len(c.Drops) > 0 {
		if m, ok := sheets.Lookup(g.r.Book.Materials)[c.Drops[0]]; ok {
			base = m.ID
			found, _ = r.Found(*m, row)
		}
	}
	isNew := found.ID != "" && !g.knownMaterial(found.ID)
	first := ""
	if mp := g.materialPromotion(found.ID); mp != nil {
		first = mp.First
	}
	var cause fact.ID
	if sp := e.Promotion(st.Done); sp != nil {
		cause = sp.Fact
	}
	vp, err := g.promoteTrace(Promoting{Type: emerge.Variant, Region: region, Of: arch, First: first, Cause: cause,
		Data: []fact.Datum{fact.S(datumRow, row), fact.S(datumResists, st.Resisted), fact.S(datumMaterial, found.ID), fact.S(datumStyle, style)}})
	if err != nil || vp == nil {
		return err
	}
	id := vp.ID
	e.Variants = append(e.Variants, &emerge.VariantRec{ID: id, Region: region, Archetype: arch, Row: row, Style: style,
		Resisted: st.Resisted, Material: found.ID})
	st.Variant = id
	if !isNew || !g.foundMaterial(found) {
		return nil
	}
	_, err = g.promoteTrace(Promoting{Type: emerge.Material, Region: region, Of: found.ID, Cause: e.Promotion(id).Fact,
		Data: []fact.Datum{fact.S(datumRow, row), fact.S(datumVariant, id), fact.S(datumBase, base)}})
	return err
}

// materialPromotion is a found material's promotion; nil for none.
func (g *Game) materialPromotion(id string) *emerge.Promotion {
	if id == "" {
		return nil
	}
	e := g.Emergence
	for i := len(e.Promotions) - 1; i >= 0; i-- {
		if p := &e.Promotions[i]; p.Type == emerge.Material && p.Of == id {
			return p
		}
	}
	return nil
}

// variantFor is a region's variant of an archetype.
func (g *Game) variantFor(region int, archetype string) (*emerge.VariantRec, bool) {
	if g.Emergence == nil {
		return nil, false
	}
	for _, v := range g.Emergence.Variants {
		if v.Region == region && v.Archetype == archetype {
			return v, true
		}
	}
	return nil, false
}

// VariantAt is the variant a creature met on h is, if it is one: the
// region's variant of its archetype, dropping the variant's material.
func (g *Game) VariantAt(h hex.Hex, c fight.Creature) (*emerge.VariantRec, bool) {
	v, ok := g.variantFor(g.World.RegionAt(h), c.Archetype)
	if !ok {
		return nil, false
	}
	if v.Material != "" {
		return v, len(c.Drops) > 0 && c.Drops[0] == v.Material
	}
	return v, slices.Contains(c.Tags, tags.Tag(g.r.Emerge.Tags[v.Row]))
}

// resistFor is what a region's creatures have adapted against (GDD 13.2):
// each named style's resisted tag once the region resists, and the
// variant's own style harder. A tag two styles resist takes the larger.
func (g *Game) resistFor(region int, archetype string, variant bool) []fight.Resist {
	if g.Emergence == nil || region < 0 {
		return nil
	}
	var v *emerge.VariantRec
	if variant {
		v, _ = g.variantFor(region, archetype)
	}
	var out []fight.Resist
	for _, st := range g.promotedStyles(region) {
		bands := emerge.Bands(st.Adapt, v != nil && v.Style == st.Key.Style, g.r.Emerge.P)
		if bands <= 0 || st.Resisted == "" {
			continue
		}
		tag := tags.Tag(st.Resisted)
		if i := slices.IndexFunc(out, func(x fight.Resist) bool { return x.Tag == tag }); i >= 0 {
			out[i].Bands = max(out[i].Bands, bands)
			continue
		}
		out = append(out, fight.Resist{Tag: tag, Bands: bands})
	}
	slices.SortFunc(out, func(a, b fight.Resist) int { return cmp.Compare(a.Tag, b.Tag) })
	return out
}

// legendTag is the trait tag a goal legend's archetype carries in its
// region, among the newest legends the cast reads.
func (g *Game) legendTag(region int, archetype string) (tags.Tag, bool) {
	e := g.Emergence
	kept := g.r.Emerge.P.LegendsKept
	for i := len(e.Legends) - 1; i >= 0 && kept > 0; i-- {
		l := e.Legends[i]
		if l == nil || l.Laid != 0 {
			continue
		}
		kept--
		if l.Region != region || l.Of.Kind != kindCreature || l.Of.ID != archetype {
			continue
		}
		for _, row := range g.r.Book.LegendTraits {
			if row.ID == l.Trait || row.Tag == l.Trait {
				return tags.Tag(row.Tag), true
			}
		}
	}
	return "", false
}

// emergentBegin is what emergence makes of an encounter about to begin on
// h: the haunted place tag, a legend's trait, the region's resistance and,
// on its keyed draw, the variant with its tag. It returns the found
// material the variant drops first, or "".
func (g *Game) emergentBegin(h hex.Hex, b *beginning, site *fight.Site) string {
	if g.Emergence == nil {
		return ""
	}
	if site.Floor == 0 {
		site.Tags = g.hauntedPlace(h, site.Tags)
	}
	region := g.World.RegionAt(h)
	if region < 0 {
		return ""
	}
	if tag, ok := g.legendTag(region, b.arch); ok && !slices.Contains(b.extra, tag) {
		b.extra = append(slices.Clip(b.extra), tag)
	}
	v, ok := g.variantFor(region, b.arch)
	ok = ok && site.Floor == 0 && g.r.draw.Percent(g.r.Emerge.P.VariantShare, emerge.DrawSpawn, draw.Str(site.ID))
	site.Resist = g.resistFor(region, b.arch, ok)
	if !ok {
		return ""
	}
	if tag := tags.Tag(g.r.Emerge.Tags[v.Row]); tag != "" && !slices.Contains(b.extra, tag) {
		b.extra = append(slices.Clip(b.extra), tag)
	}
	return v.Material
}

// lootedFirst names a found material's finder: the first character to hold
// it after an encounter with its variant ends (GDD 4.17). The variant's
// first is the material's.
func lootedFirst(g *Game, f fact.Fact) error {
	e := g.Emergence
	at, ok := g.World.FactAt(f)
	if !ok || len(e.Variants) == 0 {
		return nil
	}
	region, arch := g.World.RegionAt(at), datumOf(f.Data, datumArchetype)
	for _, v := range e.Variants {
		if v.Material == "" || v.Archetype != arch || v.Region != region {
			continue
		}
		vp := e.Promotion(v.ID)
		if vp == nil || vp.First != "" {
			continue
		}
		who := g.holder(f.Subjects, v.Material)
		if who == "" {
			continue
		}
		mp := g.materialPromotion(v.Material)
		if mp != nil && mp.First != "" {
			vp.First = mp.First
			continue
		}
		vp.First = who
		name := v.Material
		if mp != nil {
			mp.First = who
			name = mp.Shown()
		}
		lf, err := g.r.weights.New(f.Tick, factLootedFirst, world.RegionRef(region), []fact.Ref{char.Ref(who)}, []fact.ID{f.ID},
			fact.S(datumMaterial, v.Material), fact.S("name", name))
		if err != nil {
			return err
		}
		if _, err := g.Log.Append(lf); err != nil {
			return err
		}
	}
	return nil
}

// holder is the first character among a fact's subjects carrying a
// material.
func (g *Game) holder(subjects []fact.Ref, material string) string {
	for _, s := range subjects {
		if s.Kind != renownCharacter {
			continue
		}
		c := g.Char(s.ID)
		if c != nil && slices.ContainsFunc(c.C.Goods, func(x item.Spoil) bool { return x.Material == material && x.Qty > 0 }) {
			return c.C.ID
		}
	}
	return ""
}
