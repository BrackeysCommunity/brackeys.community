package emerge

import (
	"slices"
	"strings"

	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

// structural: how a style id and a lead tag are spelt.
const (
	styleSep = "+"
	ledTag   = "-led"
)

type pairing struct {
	id, tag, tagA string
}

// StyleBook knows which tags can key a style: items.pairings rows, the
// trait tags in items.traits order, and the substance-kind vocabulary.
type StyleBook struct {
	pairings  []pairing
	traits    []tags.Tag
	substance map[tags.Tag]bool
}

func NewStyleBook(b *sheets.Book) StyleBook {
	s := StyleBook{substance: map[tags.Tag]bool{}}
	for _, p := range b.Pairings {
		s.pairings = append(s.pairings, pairing{id: p.ID, tag: p.Tag, tagA: p.TagA})
	}
	for _, t := range b.Traits {
		s.traits = append(s.traits, tags.Tag(t.Tag))
	}
	for _, v := range b.Vocabulary {
		if v.Kind == "substance" {
			s.substance[tags.Tag(v.ID)] = true
		}
	}
	return s
}

// StyleOf is the style a won press counts toward: its id, its lead axis and
// the tag a region adapting to it resists. The keystone is a pairing tag
// the option carries, else the item's first trait in items.traits order,
// else its first substance tag. ok is false for no style.
func (s StyleBook) StyleOf(axis string, optionTags, gearTags []tags.Tag) (id, lead, resisted string, ok bool) {
	if axis == "" {
		return "", "", "", false
	}
	for _, p := range s.pairings {
		if slices.Contains(optionTags, tags.Tag(p.tag)) {
			return p.id, axis, p.tagA, true
		}
	}
	for _, t := range s.traits {
		if slices.Contains(gearTags, t) {
			return axis + styleSep + string(t), axis, string(t), true
		}
	}
	for _, t := range gearTags {
		if s.substance[t] {
			return axis + styleSep + string(t), axis, string(t), true
		}
	}
	return "", "", "", false
}

// Keystone is the tag a style id is keyed on, and whether it is a pairing.
func (s StyleBook) Keystone(id string) (string, bool) {
	if _, k, ok := strings.Cut(id, styleSep); ok {
		return k, false
	}
	for _, p := range s.pairings {
		if p.id == id {
			return p.tag, true
		}
	}
	return id, false
}

// Adapted is a day's adaptation from yesterday's and the style's share of
// the region's won beats that day: it rises by adapt-rate at a full share
// and fades by adapt-fade under adapt-floor, held 0 to 100.
func Adapted(adapt, sharePercent int64, p Params) int64 {
	if sharePercent < p.AdaptFloor || sharePercent <= 0 {
		adapt -= p.AdaptFade
	} else {
		adapt += fixed.PercentOf(p.AdaptRate, sharePercent)
	}
	return min(max(adapt, 0), fixed.Hundredths)
}

// Bands is what an option carrying the resisted tag loses: a variant
// resists for good, the rest of the region from resist-at.
func Bands(adapt int64, variant bool, p Params) int64 {
	if variant {
		return p.VariantResistBands
	}
	if adapt >= p.ResistAt {
		return p.ResistBands
	}
	return 0
}

// LedTag is an axis's lead tag; an id already spelt so is kept.
func LedTag(lead string) string {
	if strings.HasSuffix(lead, ledTag) {
		return lead
	}
	return lead + ledTag
}

// Candidates are the adaptation rows a style becomes, tied best: those that
// resist its resisted tag, else those that resist its lead tag, in sheet
// order. A tie among them is drawn under DrawVariant.
func Candidates(resisted, lead string, rows []sheets.Adaptation) []string {
	for _, want := range []string{resisted, LedTag(lead)} {
		var out []string
		for _, r := range rows {
			if want != "" && slices.Contains(r.Resists, want) {
				out = append(out, r.ID)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	return nil
}

// Derive is the found material a variant row makes of a base drop: one
// tier up (capped), the base's tags plus the row's, its up axis scaled by
// upPercent and its down axis lowered by downPoints.
func Derive(base sheets.Material, row sheets.Adaptation, axes []string, step, maxTier int64) sheets.Material {
	m := sheets.Material{
		ID:     MaterialID(row.ID, base.ID),
		Tier:   min(base.Tier+step, max(maxTier, base.Tier)),
		Tags:   slices.Clone(base.Tags),
		Vector: base.Vector,
	}
	if !slices.Contains(m.Tags, row.ID) {
		m.Tags = append(m.Tags, row.ID)
	}
	v := axisPtrs(&m.Vector)
	if i := slices.Index(axes, row.Up); i >= 0 && i < len(v) {
		*v[i] = fixed.PercentOf(*v[i], row.UpPercent)
	}
	if i := slices.Index(axes, row.Down); i >= 0 && i < len(v) {
		*v[i] = max(*v[i]-row.DownPoints, 0)
	}
	return m
}

// axisPtrs are a vector's axes in Vector.Slice's order.
func axisPtrs(v *sheets.Vector) []*int64 {
	return []*int64{&v.Edge, &v.Weight, &v.Flex, &v.Conduct, &v.Heat, &v.Ward, &v.Reach, &v.Bond}
}

// structural: a found material's id is "found.<row>.<base>".
const (
	foundPrefix = "found."
	foundSep    = "."
)

// MaterialID is the id of the found material a variant row makes of a base.
func MaterialID(row, base string) string { return foundPrefix + row + foundSep + base }

// ParseMaterialID is the row and base a found material's id names.
func ParseMaterialID(id string) (row, base string, ok bool) {
	rest, ok := strings.CutPrefix(id, foundPrefix)
	if !ok {
		return "", "", false
	}
	row, base, ok = strings.Cut(rest, foundSep)
	if !ok || row == "" || base == "" {
		return "", "", false
	}
	return row, base, true
}
