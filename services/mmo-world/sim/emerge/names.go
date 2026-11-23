package emerge

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/sheets"
)

// Names is the pack's names and name parts, as the game holds them.
type Names interface {
	Name(ref string) string      // a pack name by "sheet:id", "" if none
	Part(list, id string) string // a name part by list and the id Parts gives, "" if none
	Parts(list string) []string  // the part ids in a list, in pack order
}

// Name-part lists (pack.name-parts).
const (
	ListRoadWord      = "road-word"
	ListStyleLead     = "style-lead"
	ListStyleWord     = "style-word"
	ListMaterialNoun  = "material-noun"
	ListLegendEpithet = "legend-epithet"
	ListCustomWord    = "custom-word"
	ListCampWord      = "camp-word"
	ListHauntWord     = "haunt-word"
)

// structural: how generated names join.
const (
	the     = "the "
	space   = " "
	and     = "-and-"
	enDash  = "–"
	theWord = " the "
)

// drawn is a part from a list drawn under DrawName, or fallback when the
// list is empty.
func drawn(n Names, d *draw.Drawer, t Type, key, list, fallback string) string {
	ids := n.Parts(list)
	if len(ids) == 0 {
		return fallback
	}
	id := ids[d.Below(uint64(len(ids)), DrawName, draw.Str(string(t)), draw.Str(key), draw.Str(list))]
	if s := n.Part(list, id); s != "" {
		return s
	}
	return fallback
}

func partOr(n Names, list, id, fallback string) string {
	if s := n.Part(list, id); s != "" {
		return s
	}
	return fallback
}

func nameOr(n Names, ref, fallback string) string {
	if s := n.Name(ref); s != "" {
		return s
	}
	return fallback
}

// lowerFirst lowers a name's first letter where it follows another word
// ("Plated wire-eel").
func lowerFirst(s string) string {
	r, size := utf8.DecodeRuneInString(s)
	if r == utf8.RuneError {
		return s
	}
	return string(unicode.ToLower(r)) + s[size:]
}

func upperFirst(s string) string {
	r, size := utf8.DecodeRuneInString(s)
	if r == utf8.RuneError {
		return s
	}
	return string(unicode.ToUpper(r)) + s[size:]
}

// RoadName is "the {place} {road word}", the word drawn by the road's key.
func RoadName(n Names, d *draw.Drawer, place, key string) string {
	return the + place + space + drawn(n, d, Road, key, ListRoadWord, string(Road))
}

// RouteName is "{A}–{B}".
func RouteName(a, b string) string { return a + enDash + b }

// SiteName names a camp or a haunt: "the {site} {word}".
func SiteName(n Names, d *draw.Drawer, t Type, site, key string) string {
	list := ListCampWord
	if t == Haunt {
		list = ListHauntWord
	}
	return the + site + space + drawn(n, d, t, key, list, string(t))
}

// StyleName is a pairing row's pack name, else "{lead}-and-{word}".
func StyleName(n Names, id, lead, keystone string) string {
	if s := n.Name("items.pairings:" + id); s != "" {
		return s
	}
	if keystone == "" {
		if _, k, ok := strings.Cut(id, styleSep); ok {
			keystone = k
		}
	}
	axis := strings.TrimSuffix(lead, ledTag)
	l := partOr(n, ListStyleLead, axis, upperFirst(axis))
	return l + and + lowerFirst(partOr(n, ListStyleWord, keystone, keystone))
}

// VariantName is "{variant adjective} {archetype name}" (GDD 4.17).
func VariantName(n Names, row, archetype string) string {
	adj := nameOr(n, "creatures.variants:"+row, upperFirst(row))
	return adj + space + lowerFirst(nameOr(n, "creatures.archetypes:"+archetype, archetype))
}

// MaterialName is "{adjective} {noun}", the noun the base's first tag's.
func MaterialName(n Names, row string, base sheets.Material) string {
	adj := nameOr(n, "creatures.variants:"+row, upperFirst(row))
	noun := base.ID
	if len(base.Tags) > 0 {
		noun = partOr(n, ListMaterialNoun, base.Tags[0], base.Tags[0])
	}
	return adj + space + lowerFirst(noun)
}

// LegendName is "{of} the {epithet}", of being the target's or the item's
// name and the epithet drawn by the legend's id.
func LegendName(n Names, d *draw.Drawer, of, id string) string {
	return of + theWord + drawn(n, d, Legend, id, ListLegendEpithet, string(Legend))
}

// CustomName is "the {place} {verb word}".
func CustomName(place, verb string, n Names) string {
	return the + place + space + partOr(n, ListCustomWord, verb, verb)
}

// structural: a pack name part's id is "<list>-<key>".
const partSep = "-"

// PackNames is Names over the pack's name parts and a name lookup.
type PackNames struct {
	parts map[string]map[string]string // list: key: text
	order map[string][]string          // list: keys in pack order
	name  func(ref string) string
}

func NewPackNames(parts []sheets.NamePart, name func(ref string) string) *PackNames {
	p := &PackNames{parts: map[string]map[string]string{}, order: map[string][]string{}, name: name}
	for _, np := range parts {
		key := strings.TrimPrefix(np.ID, np.List+partSep)
		if p.parts[np.List] == nil {
			p.parts[np.List] = map[string]string{}
		}
		if _, dup := p.parts[np.List][key]; !dup {
			p.order[np.List] = append(p.order[np.List], key)
		}
		p.parts[np.List][key] = np.Text
	}
	return p
}

func (p *PackNames) Name(ref string) string {
	if p.name == nil {
		return ""
	}
	return p.name(ref)
}

func (p *PackNames) Part(list, id string) string { return p.parts[list][id] }
func (p *PackNames) Parts(list string) []string  { return p.order[list] }
