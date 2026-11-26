package render

import (
	"errors"
	"fmt"
	"image/color"
	"regexp"
	"slices"

	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/sheets"
)

// StyleIDs are the pack.map-style ids /map and the live map draw by,
// besides one terrain: id per map.terrain row and one weather: id per
// world.weather row.
var StyleIDs = []string{
	"fog:unknown", "fog:seen", "fog:sight",
	"layer:threat", "layer:corruption", "layer:danger", "layer:trouble", "layer:fire",
	"layer:busy", "layer:self", "layer:route", "layer:camp", "layer:haunted",
	"place:settlement", "place:city", "place:city-tile", "place:ruin", "place:faction",
	"site:dungeon", "site:other",
	"water:" + gen.WaterStream, "water:" + gen.WaterRiver, "water:" + gen.WaterFord, "water:" + gen.WaterCoast,
	"water:" + gen.WaterBog, "water:" + gen.WaterLake, "water:" + gen.WaterSea,
	"road", "ink", "paper", "border", "frontier", "region-border",
}

// MapViewIDs are the pack.map-view numbers the map reads.
var MapViewIDs = []string{
	"seen-dim", "zoom-area", "zoom-tile", "zoom-min", "zoom-max", "blend-max",
	"busy-light", "busy-busy", "busy-crowded", "busy-distinct",
}

var colourPattern = regexp.MustCompile(`^#[0-9a-f]{6}$`)

// MapStyleProblems are what a pack lacks for the map to draw from it.
func MapStyleProblems(b *sheets.Book) []string {
	var p []string
	have := map[string]bool{}
	for _, e := range b.MapStyle {
		have[e.MapID()] = true
		if !colourPattern.MatchString(e.Colour) {
			p = append(p, fmt.Sprintf("pack.map-style %s: colour %q is not #rrggbb", e.ID, e.Colour))
		}
	}
	need := slices.Clone(StyleIDs)
	for _, t := range b.Terrain {
		need = append(need, "terrain:"+t.ID)
	}
	for _, w := range b.Weather {
		need = append(need, "weather:"+w.ID)
	}
	for _, id := range need {
		if !have[id] {
			p = append(p, "pack.map-style: no entry for "+id)
		}
	}
	for _, id := range MapViewIDs {
		if !slices.ContainsFunc(b.MapView, func(r sheets.Param) bool { return r.ID == id }) {
			p = append(p, "pack.map-view: no "+id)
		}
	}
	return p
}

// MapStyleErr joins MapStyleProblems into one error; nil when there are none.
func MapStyleErr(b *sheets.Book) error {
	p := MapStyleProblems(b)
	if len(p) == 0 {
		return nil
	}
	errs := make([]error, len(p))
	for i, s := range p {
		errs[i] = errors.New(s)
	}
	return errors.Join(errs...)
}

// MapStyle is the map's look, from the pack.
type MapStyle struct {
	entries map[string]sheets.MapStyle
	colours map[string]color.NRGBA
	SeenDim int64 // percent
}

// MapStyleOf reads the map's look from a book; it refuses a pack that
// lacks an entry the map draws by.
func MapStyleOf(b *sheets.Book) (MapStyle, error) {
	if err := MapStyleErr(b); err != nil {
		return MapStyle{}, err
	}
	s := MapStyle{
		entries: make(map[string]sheets.MapStyle, len(b.MapStyle)),
		colours: make(map[string]color.NRGBA, len(b.MapStyle)),
		SeenDim: sheets.ParamOf(b.MapView, "seen-dim").Floor(),
	}
	for _, e := range b.MapStyle {
		id := e.MapID()
		s.entries[id] = e
		s.colours[id] = Alpha(Hex(e.Colour), uint8(e.Alpha))
	}
	return s, nil
}

// Colour is an entry's colour at its alpha; an id the pack lacks is
// magenta, so the gap shows.
func (s MapStyle) Colour(id string) color.NRGBA {
	if c, ok := s.colours[id]; ok {
		return c
	}
	return Alpha(unknownTerrain, unknownTerrain.A)
}

// Glyph is an entry's glyph; "" draws none.
func (s MapStyle) Glyph(id string) string { return Plain(s.entries[id].Glyph) }

// Pattern is an entry's pattern; "" draws none.
func (s MapStyle) Pattern(id string) string { return Plain(s.entries[id].Pattern) }

// Plain is a glyph or pattern cell as drawn: none is empty.
func Plain(v string) string {
	if v == "none" {
		return ""
	}
	return v
}
