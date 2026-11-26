package sheets

import "strings"

// MapStyle is one thing the live map and /map draw (GDD 4.11): its colour,
// alpha, glyph and pattern, by id. Nothing in the sim reads it.
type MapStyle struct {
	ID      string `json:"id" unit:"id" doc:"<family>-<thing> for the terrain, water, weather, fog, layer, place and site families (terrain-plain, fog-seen), else road, ink, paper, border, frontier or region-border. The map names it family:thing (MapID)."`
	Colour  string `json:"colour" unit:"text" doc:"#rrggbb"`
	Alpha   int64  `json:"alpha" unit:"count" min:"0" max:"255" doc:"0 to 255."`
	Glyph   string `json:"glyph,omitempty" unit:"enum" enum:"diamond|square|circle|ring|triangle|cross|pip|none" doc:"The mark drawn on the tile."`
	Pattern string `json:"pattern,omitempty" unit:"enum" enum:"hatch|dots|stripes|rim|none" doc:"How the fill or the edge is drawn."`
	Note    string `json:"note,omitempty" unit:"text"`
}

// MapStyleFamilies are the id families of pack.map-style. A sheet id holds
// no colon, so the row id joins family and thing with a dash.
var MapStyleFamilies = []string{"terrain", "water", "weather", "fog", "layer", "place", "site"}

// MapID is the id the map draws by: terrain-plain is terrain:plain, and an
// id outside the families is itself.
func (m MapStyle) MapID() string {
	for _, f := range MapStyleFamilies {
		if thing, ok := strings.CutPrefix(m.ID, f+"-"); ok {
			return f + ":" + thing
		}
	}
	return m.ID
}
